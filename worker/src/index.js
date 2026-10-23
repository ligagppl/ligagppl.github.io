// ============================================================
//  GPPL member area – gatekeeper (Cloudflare Worker)
//
//  Teams log in with their team code and can schedule their matches,
//  enter results (with the matchday photo) and confirm or dispute the
//  opponent's result. The worker checks the rules and writes the data
//  files in the GitHub repository with its own token – players never
//  touch GitHub.
//
//  Data (GitHub, public):  data/results.json, data/cup.json – official results
//  Private (KV):           team codes, photos, dispute notes, activity log
//  Private (Durable Objects): match dates/venues (only the two teams + admins see them),
//                          results waiting for confirmation
// ============================================================

import { DurableObject } from "cloudflare:workers";

const FILES = { pairs: "data/pairs.json", results: "data/results.json", cup: "data/cup.json", matches: "data/matches.json", gallery: "data/gallery.json" }; // matches.json: old public schedules, only read by /admin/move-pending
const FALLBACK = { pairs: [], results: [], cup: { rounds: [] }, matches: {}, gallery: [] };
const AUTO_CONFIRM_MS = 48 * 3600 * 1000;
const TOKEN_DAYS = 30;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(request, env, ctx);
      Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e.stack || e);
      return json({ error: status === 500 ? "Something went wrong – please try again." : e.message }, status, cors);
    }
  },
  // hourly: results nobody reacted to for 48 hours become official
  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoConfirm(env));
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (path === "/") return json({ ok: true, service: "GPPL member area" });
  if (path === "/login" && request.method === "POST") return login(request, env, body);

  if (path.startsWith("/admin/")) {
    requireAdmin(request, env);
    if (path === "/admin/teams") return adminTeams(env);
    if (path === "/admin/code" && request.method === "POST") return adminCode(env, body);
    if (path === "/admin/open") return adminOpen(env);
    if (path === "/admin/resolve" && request.method === "POST") return adminResolve(env, body);
    if (path === "/admin/log") return json({ log: await getLog(env) });
    if (path === "/admin/photo") return photo(env, url.searchParams.get("key"));
    if (path === "/admin/auto-confirm" && request.method === "POST") return json({ confirmed: await autoConfirm(env) });
    if (path === "/admin/move-pending" && request.method === "POST") return adminMovePending(env);
    if (path === "/admin/gallery") return request.method === "POST" ? adminGallery(env, body) : adminGalleryList(env);
    if (path === "/admin/phones") return request.method === "POST" ? adminSetPhones(env, body) : json({ phones: await getPhones(env) });
    throw httpError(404, "Not found");
  }

  const team = await requireTeam(request, env);
  if (path === "/me") return me(env, team);
  if (path === "/photo") {
    const key = url.searchParams.get("key");
    const { files } = await readAll(env, ["pairs", "cup"]);
    if (!matchInfo(key, files).teams.includes(team)) throw httpError(403, "Not your match.");
    return photo(env, key);
  }
  if (request.method !== "POST") throw httpError(404, "Not found");
  if (path === "/schedule") return schedule(env, team, body);
  if (path === "/result") return submitResult(env, team, body);
  if (path === "/withdraw") return withdraw(env, team, body);
  if (path === "/confirm") return confirm(env, team, body);
  if (path === "/dispute") return dispute(env, team, body);
  throw httpError(404, "Not found");
}

// ---------------------------------------------------------------- helpers

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  } : { Vary: "Origin" };
}

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const toBase64Utf8 = text => { let bin = ""; enc.encode(text).forEach(b => (bin += String.fromCharCode(b))); return btoa(bin); };
const fromBase64Utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
function sameText(a, b) { // constant-time compare
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- GitHub

async function gh(env, path, init = {}) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}` + (init.method ? "" : `?ref=${encodeURIComponent(env.GH_BRANCH)}`);
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "gppl-member-area",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

// Local testing without GitHub (DEV_FAKE_GITHUB=1 in .dev.vars): the files live in KV,
// first copied from the local website (DEV_SITE, e.g. http://localhost:8765)
async function fakeRead(env, key) {
  let text = await env.KV.get(`dev-file:${key}`);
  if (text === null) {
    const res = await fetch(`${env.DEV_SITE}/${FILES[key]}`);
    text = res.ok ? await res.text() : JSON.stringify(FALLBACK[key]);
    await env.KV.put(`dev-file:${key}`, text);
  }
  return { data: JSON.parse(text), sha: await sha256hex(text) };
}
async function fakeWrite(env, key, data, sha) {
  const cur = await fakeRead(env, key);
  if (cur.sha !== sha) return false;
  await env.KV.put(`dev-file:${key}`, JSON.stringify(data, null, 2) + "\n");
  return true;
}

async function readFile(env, key) {
  if (env.DEV_FAKE_GITHUB === "1") return fakeRead(env, key);
  const res = await gh(env, FILES[key]);
  if (res.status === 404) return { data: structuredClone(FALLBACK[key]), sha: undefined };
  if (!res.ok) throw new Error(`GitHub read ${FILES[key]}: ${res.status}`);
  const meta = await res.json();
  return { data: JSON.parse(fromBase64Utf8(meta.content)), sha: meta.sha };
}

// a binary file (gallery photo) in the repository: write (bytes) or delete (null)
async function putBinary(env, path, bytes, message) {
  if (env.DEV_FAKE_GITHUB === "1") return bytes ? env.KV.put(`dev-file:${path}`, bytes) : env.KV.delete(`dev-file:${path}`);
  const cur = await gh(env, path);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  if (!bytes && !sha) return;
  let bin = "";
  if (bytes) for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = await gh(env, path, {
    method: bytes ? "PUT" : "DELETE",
    body: JSON.stringify({ message: `GPPL members: ${message}`, branch: env.GH_BRANCH, sha, ...(bytes ? { content: btoa(bin) } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub ${bytes ? "write" : "delete"} ${path}: ${res.status} ${await res.text()}`);
}

async function readAll(env, keys) {
  const list = await Promise.all(keys.map(k => readFile(env, k)));
  const files = {}, shas = {};
  keys.forEach((k, i) => { files[k] = list[i].data; shas[k] = list[i].sha; });
  return { files, shas };
}

async function writeFile(env, key, data, sha, message) {
  if (env.DEV_FAKE_GITHUB === "1") return fakeWrite(env, key, data, sha);
  const res = await gh(env, FILES[key], {
    method: "PUT",
    body: JSON.stringify({ message: `GPPL members: ${message}`, content: toBase64Utf8(JSON.stringify(data, null, 2) + "\n"), branch: env.GH_BRANCH, sha }),
  });
  if (res.status === 409 || res.status === 422) return false; // changed in the meantime → retry
  if (!res.ok) throw new Error(`GitHub write ${FILES[key]}: ${res.status} ${await res.text()}`);
  return true;
}

// Read the files, let `change` modify them, write the ones that changed.
// Retries when someone else saved in between (admin, another team).
async function update(env, keys, change, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { files, shas } = await readAll(env, keys);
    const before = Object.fromEntries(keys.map(k => [k, JSON.stringify(files[k])]));
    const result = await change(files);
    let ok = true;
    for (const k of keys) {
      if (JSON.stringify(files[k]) === before[k]) continue;
      if (!(await writeFile(env, k, files[k], shas[k], message))) { ok = false; break; }
    }
    if (ok) return result;
  }
  throw httpError(409, "Someone saved at the same moment – please try again.");
}

// ---------------------------------------------------------------- teams & login

const normCode = code => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const codeHash = (env, code) => sha256hex(`${env.SESSION_SECRET}:${normCode(code)}`);

// 8 characters from a secure random source; bytes above the last full multiple of the alphabet
// size are skipped, so every character is exactly equally likely (no modulo bias): ~40 bits
function randomCode(len) {
  const n = CODE_ALPHABET.length, limit = 256 - (256 % n);
  let out = "";
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < len) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

async function login(request, env, body) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  // 1) Cloudflare's rate limiter: quick first filter (max 10 login tries a minute per connection)
  if (env.LOGIN_RL) {
    const { success } = await env.LOGIN_RL.limit({ key: ip });
    if (!success) throw httpError(429, "Too many attempts – please wait a minute.");
  }
  // 2) the login guard: 10 wrong codes per 15 minutes per connection + league-wide brake
  const guard = env.GUARD.get(env.GUARD.idFromName("login"));
  const state = await guard.check(ip);
  if (state.blocked) throw httpError(429, state.blocked);
  // 3) Turnstile: proves a person (not a script) is logging in
  await checkTurnstile(env, body.turnstile, ip);

  const teamId = await env.KV.get(`code:${await codeHash(env, body.code)}`);
  if (!teamId) {
    const after = await guard.fail(ip);
    if (after.brakeStarted) await addLog(env, { action: "⚠️ login brake on – too many wrong codes league-wide, logins paused for 10 minutes" });
    throw httpError(401, after.left > 0 ? `This team code is not valid (${after.left} ${after.left === 1 ? "try" : "tries"} left).` : "This team code is not valid. Too many attempts – please wait 15 minutes.");
  }
  const rec = JSON.parse(await env.KV.get(`team:${teamId}`));
  const payload = b64url(enc.encode(JSON.stringify({ t: +teamId, v: rec.ver, exp: Date.now() + TOKEN_DAYS * 86400000 })));
  await addLog(env, { team: +teamId, action: "login" });
  return json({ token: `${payload}.${await hmac(env, payload)}`, team: +teamId });
}

async function checkTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return; // not set up (e.g. local testing)
  if (!token) throw httpError(400, "Please complete the security check.");
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.success) throw httpError(400, "The security check failed – please try again.");
}

async function requireTeam(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const [payload, sig] = auth.replace(/^Bearer\s+/i, "").split(".");
  if (!payload || !sig || !sameText(sig, await hmac(env, payload))) throw httpError(401, "Please log in with your team code.");
  const { t, v, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (Date.now() > exp) throw httpError(401, "Your login expired – please log in again.");
  const rec = JSON.parse((await env.KV.get(`team:${t}`)) || "null");
  if (!rec || rec.ver !== v) throw httpError(401, "Your team code was changed – please log in with the new code.");
  return t;
}

function requireAdmin(request, env) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Admin\s+/i, "");
  if (!env.ADMIN_KEY || !sameText(auth, env.ADMIN_KEY)) throw httpError(401, "Admin key not valid.");
}

async function adminTeams(env) {
  const { files } = await readAll(env, ["pairs"]);
  const teams = await Promise.all(files.pairs.map(async p => {
    const rec = JSON.parse((await env.KV.get(`team:${p.id}`)) || "null");
    return { id: p.id, name: p.name, hasCode: !!rec, created: rec && rec.created };
  }));
  return json({ teams });
}

async function adminCode(env, body) {
  const { files } = await readAll(env, ["pairs"]);
  const pair = files.pairs.find(p => p.id === +body.team);
  if (!pair) throw httpError(400, "Unknown team.");
  const old = JSON.parse((await env.KV.get(`team:${pair.id}`)) || "null");
  if (old) await env.KV.delete(`code:${old.hash}`);
  const raw = randomCode(8);
  const hash = await codeHash(env, raw);
  await env.KV.put(`code:${hash}`, String(pair.id));
  // a new version logs out every device that used the old code
  await env.KV.put(`team:${pair.id}`, JSON.stringify({ hash, ver: (old ? old.ver : 0) + 1, created: new Date().toISOString() }));
  await addLog(env, { team: pair.id, action: old ? "code reset" : "code created", by: "admin" });
  return json({ team: pair.id, code: `${raw.slice(0, 4)}-${raw.slice(4)}` });
}

// ---------------------------------------------------------------- matches

// "L:3-7" = league match of pairs 3 and 7, "C:1:0" = cup round 2, match 1
function matchInfo(key, files) {
  let m;
  if ((m = /^L:(\d+)-(\d+)$/.exec(key || ""))) {
    const a = +m[1], b = +m[2], ids = files.pairs.map(p => p.id);
    if (a >= b || !ids.includes(a) || !ids.includes(b)) throw httpError(400, "Unknown match.");
    return { type: "league", key, teams: [a, b], a, b, fullSets: false };
  }
  if ((m = /^C:(\d+):(\d+)$/.exec(key || ""))) {
    const round = (files.cup.rounds || [])[+m[1]];
    const match = round && round.matches && round.matches[+m[2]];
    if (!match || !match.a || !match.b) throw httpError(400, "Unknown cup match.");
    return { type: "cup", key, teams: [match.a, match.b], a: match.a, b: match.b, round, match,
      fullSets: round.name === "Semi-finals" || round.name === "Final" };
  }
  throw httpError(400, "Unknown match.");
}

function officialResult(info, files) {
  if (info.type === "league") return files.results.find(r => (r.a === info.a && r.b === info.b) || (r.a === info.b && r.b === info.a)) || null;
  const m = info.match;
  return m.sets || m.walkover || m.winner ? m : null;
}

function requirePlayer(info, team) {
  if (!info.teams.includes(team)) throw httpError(403, "This is not one of your matches.");
}

// ---------------------------------------------------------------- set validation (same rules as Admin)

function validSet([x, y]) {
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
}
function validTieBreak([x, y]) {
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return hi >= 10 && hi - lo >= 2 && (hi === 10 || hi - lo === 2);
}
function checkSets(sets, fullSets) {
  if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) throw httpError(400, "Enter 2 or 3 sets.");
  sets.forEach(s => {
    if (!Array.isArray(s) || s.length !== 2 || !s.every(n => Number.isInteger(n) && n >= 0 && n <= 99)) throw httpError(400, "Scores must be whole numbers.");
  });
  const [s1, s2, s3] = sets;
  const fin = (s, label) => { if (!validSet(s)) throw httpError(400, `${label}: ${s[0]}-${s[1]} is not a finished set – a set ends 6-0 … 6-4, 7-5 or 7-6.`); };
  fin(s1, "Set 1"); fin(s2, "Set 2");
  const split = (s1[0] > s1[1]) !== (s2[0] > s2[1]);
  const third = fullSets ? "set 3" : "the match tie-break";
  if (split && !s3) throw httpError(400, `Sets are 1-1 – enter ${third}.`);
  if (!split && s3) throw httpError(400, `The match was over after 2 sets – clear ${third}.`);
  if (s3 && fullSets) fin(s3, "Set 3");
  if (s3 && !fullSets && !validTieBreak(s3)) throw httpError(400, `Tie-break: ${s3[0]}-${s3[1]} isn't possible – first to 10, win by 2 (e.g. 10-7, 12-10).`);
}

// ---------------------------------------------------------------- team actions

// results waiting for confirmation (or disputed) live privately in the PendingStore, not on GitHub;
// match dates and venues in a second instance of the same store ("schedule")
const pendingStore = env => env.PENDING.get(env.PENDING.idFromName("pending"));
const scheduleStore = env => env.PENDING.get(env.PENDING.idFromName("schedule"));

const isMine = (key, files, team) => { try { return matchInfo(key, files).teams.includes(team); } catch { return false; } };

async function me(env, team) {
  const { files } = await readAll(env, ["pairs", "results", "cup"]);
  const [dates, pending] = await Promise.all([scheduleStore(env).all(), pendingStore(env).all()]);
  const notes = {};
  files.matches = {};
  // a team sees the dates, venues and waiting/disputed results of its own matches only
  for (const [key, e] of Object.entries(dates)) if (isMine(key, files, team)) files.matches[key] = { ...e };
  for (const [key, p] of Object.entries(pending)) {
    if (p.a !== team && p.b !== team) continue;
    files.matches[key] = { ...(files.matches[key] || {}), pending: p };
    if (p.status === "disputed") notes[key] = await env.KV.get(`note:${key}`);
  }
  // the organizers' WhatsApp number (Worker secret) – only for logged-in teams, for "Contact the organizers"
  return json({ team, ...files, notes, organizer: String(env.ORGANIZER_PHONE || "").replace(/\D/g, "") });
}

const cleanDate = d => (d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const cleanTime = t => (t === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);

async function schedule(env, team, body) {
  const date = cleanDate(String(body.date ?? "")), time = cleanTime(String(body.time ?? ""));
  const court = String(body.court ?? "").trim().slice(0, 160);
  if (date === null || time === null) throw httpError(400, "Date or time not valid.");
  if ((date || time || court) && !(date && time && court)) throw httpError(400, "Please give the date, time and venue.");
  const duration = [60, 90, 120].includes(+body.duration) ? +body.duration : 90; // minutes booked
  const { files } = await readAll(env, ["pairs", "cup", "results"]);
  const info = matchInfo(body.key, files);
  requirePlayer(info, team);
  if (officialResult(info, files)) throw httpError(400, "This match already has a result.");
  const cur = await scheduleStore(env).get(info.key);
  if (cur && cur.date && cur.time && berlinMs(cur.date, cur.time) <= Date.now()) throw httpError(400, "The match has already started – the date and venue can't be changed any more. Contact the organizers if something is wrong.");
  const entry = date ? { date, time, duration, court } : {}; // who set it and when is in the private activity log
  if (date) await scheduleStore(env).set(info.key, entry); else await scheduleStore(env).remove(info.key);
  await addLog(env, { team, action: "schedule", key: body.key, detail: date ? [date, `${time} (${duration} min)`, court].join(" · ") : "cleared" });
  return json({ ok: true, match: entry });
}

// "2026-10-22" + "19:00" in Munich time → milliseconds (the worker itself runs in UTC)
function berlinMs(date, time) {
  const utc = Date.parse(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(utc));
  const g = t => +parts.find(p => p.type === t).value;
  return utc - (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - utc);
}

// sets come from the submitting team's point of view: [their games, opponent's games]
const orient = (sets, team, a) => (team === a ? sets : sets.map(([x, y]) => [y, x]));

// link to the match on Playtomic (required with every result)
function cleanLink(link) {
  const text = String(link || "").trim();
  if (!text) throw httpError(400, "Please paste the Playtomic link of the match.");
  let url;
  try { url = new URL(text); } catch { throw httpError(400, "The Playtomic link is not a valid address."); }
  if (url.protocol !== "https:" || !/(^|\.)playtomic\.(io|com)$/.test(url.hostname)) throw httpError(400, "Please paste a Playtomic link (https://…playtomic…).");
  return url.href.slice(0, 300);
}

async function submitResult(env, team, body) {
  const photoBytes = decodePhoto(body.photo);
  const link = cleanLink(body.link);
  const { files } = await readAll(env, ["pairs", "cup", "results"]);
  const info = matchInfo(body.key, files);
  requirePlayer(info, team);
  if (officialResult(info, files)) throw httpError(400, "This match already has a confirmed result – contact the organizers to change it.");
  const sets = orient(body.sets, team, info.a);
  checkSets(sets, info.fullSets);
  const when = await scheduleStore(env).get(info.key);
  if (!(when || {}).date) throw httpError(400, "Set the match date first, then enter the result.");
  // more than 48 hours after the match: the organizers decide (Rules §11)
  if (when.time && berlinMs(when.date, when.time) + ((+when.duration || 90) + 48 * 60) * 60000 < Date.now()) throw httpError(400, "More than 48 hours have passed since the match – please contact the organizers.");
  const pending = { a: info.a, b: info.b, sets, link, by: team, at: new Date().toISOString(), status: "pending" };
  const saved = await pendingStore(env).submit(info.key, pending);
  if (!saved.ok) throw httpError(400, "Your opponent already entered a result – please confirm or dispute it.");
  await env.KV.put(`photo:${info.key}`, photoBytes, { metadata: { team, at: pending.at } });
  await env.KV.delete(`note:${info.key}`);
  await addLog(env, { team, action: "result entered", key: info.key, detail: setsText(sets) });
  return json({ ok: true, pending });
}

function decodePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw httpError(400, "Please add the matchday photo.");
  const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (bytes.length > MAX_PHOTO_BYTES) throw httpError(400, "The photo is too big (max 4 MB).");
  return bytes;
}

async function withdraw(env, team, body) {
  const p = await pendingStore(env).get(body.key);
  if (!p || p.by !== team) throw httpError(400, "There is no result from your team to withdraw.");
  await pendingStore(env).remove(body.key);
  await env.KV.delete(`photo:${body.key}`);
  await addLog(env, { team, action: "result withdrawn", key: body.key });
  return json({ ok: true });
}

async function confirm(env, team, body) {
  const p = await pendingStore(env).get(body.key);
  if (!p) throw httpError(400, "There is no result to confirm.");
  if (p.by === team) throw httpError(400, "Your opponent has to confirm your result.");
  if (p.status !== "pending") throw httpError(400, "This result is disputed – the organizers will decide.");
  await update(env, ["pairs", "cup", "results"], files => {
    const info = matchInfo(body.key, files);
    requirePlayer(info, team);
    if (officialResult(info, files)) throw httpError(400, "The organizers already entered the result of this match.");
    makeOfficial(info, files, p);
  }, `confirm ${body.key}`);
  await pendingStore(env).remove(body.key);
  await scheduleStore(env).remove(body.key); // the date/venue isn't needed once the match has a result
  await addLog(env, { team, action: "result confirmed", key: body.key, detail: setsText(p.sets) });
  return json({ ok: true });
}

async function dispute(env, team, body) {
  const note = String(body.note || "").trim().slice(0, 500); // optional
  const p = await pendingStore(env).get(body.key);
  if (!p || p.status !== "pending" || (p.a !== team && p.b !== team)) throw httpError(400, "There is no result to dispute.");
  if (p.by === team) throw httpError(400, "You can withdraw your own result instead.");
  await pendingStore(env).set(body.key, { ...p, status: "disputed", disputedBy: team, disputedAt: new Date().toISOString() });
  if (note) await env.KV.put(`note:${body.key}`, note); else await env.KV.delete(`note:${body.key}`);
  await addLog(env, { team, action: "result disputed", key: body.key, ...(note ? { detail: note } : {}) });
  return json({ ok: true });
}

// write the result into results.json / cup.json (the caller clears the date/venue from the schedule store)
function makeOfficial(info, files, pending) {
  const sets = pending.sets, link = pending.link;
  if (info.type === "league") {
    files.results = files.results.filter(r => !((r.a === info.a && r.b === info.b) || (r.a === info.b && r.b === info.a)));
    files.results.push({ a: info.a, b: info.b, sets, ...(link ? { link } : {}) });
  } else {
    const m = info.match;
    delete m.walkover; delete m.winner; delete m.link;
    m.sets = sets;
    if (link) m.link = link;
    syncFinal(files.cup);
  }
  return { sets };
}

// same as Admin: when both semi-finals are decided, the final (and a 3rd-place match) get their pairs
function cupWinner(m) {
  if (m.walkover === "both") return null;
  if (m.walkover) return m.walkover;
  if (m.winner) return m.winner;
  if (!m.sets || !m.sets.length) return null;
  let sa = 0, sb = 0;
  m.sets.forEach(([x, y]) => (x > y ? sa++ : sb++));
  return sa >= 2 ? m.a : sb >= 2 ? m.b : null;
}
function syncFinal(cup) {
  const rounds = cup.rounds || [];
  const sf = rounds.find(r => r.name === "Semi-finals" && !r.third);
  if (!sf || sf.matches.length !== 2) return;
  const winners = sf.matches.map(cupWinner);
  if (!winners.every(Boolean)) return;
  const losers = sf.matches.map((m, i) => (winners[i] === m.a ? m.b : m.a));
  let fin = rounds.find(r => r.name === "Final");
  if (!fin) rounds.push(fin = { name: "Final", type: "matches", matches: [{ a: winners[0], b: winners[1] }], byes: [] });
  else if (!cupWinner(fin.matches[0])) fin.matches[0] = { a: winners[0], b: winners[1] };
  const third = rounds.find(r => r.third);
  if (third && !cupWinner(third.matches[0])) third.matches[0] = { a: losers[0], b: losers[1] };
}

const setsText = sets => sets.map(([x, y]) => `${x}-${y}`).join(" ");

// ---------------------------------------------------------------- automatic confirmation

async function autoConfirm(env) {
  const all = await pendingStore(env).all();
  const due = Object.entries(all).filter(([, p]) => p.status === "pending" && Date.now() - Date.parse(p.at) >= AUTO_CONFIRM_MS);
  if (!due.length) return [];
  let confirmed = [], dropped = [];
  await update(env, ["pairs", "cup", "results"], files => {
    confirmed = []; dropped = [];
    for (const [key, p] of due) {
      try {
        const info = matchInfo(key, files);
        // the organizers already entered this match → their result stays, the team's entry is dropped
        if (officialResult(info, files)) { dropped.push(key); continue; }
        makeOfficial(info, files, p); confirmed.push(key);
      } catch {}
    }
  }, "auto-confirm after 48 hours");
  for (const key of confirmed.concat(dropped)) { await pendingStore(env).remove(key); await scheduleStore(env).remove(key); }
  for (const key of confirmed) await addLog(env, { action: "auto-confirmed", key });
  return confirmed;
}

// ---------------------------------------------------------------- admin

async function adminOpen(env) {
  const { files } = await readAll(env, ["pairs", "results", "cup"]);
  const open = [], schedule = {};
  // admins see every unplayed match's date and venue
  for (const [key, e] of Object.entries(await scheduleStore(env).all())) {
    try { if (!officialResult(matchInfo(key, files), files)) schedule[key] = e; } catch {}
  }
  for (const [key, p] of Object.entries(await pendingStore(env).all())) {
    try { if (officialResult(matchInfo(key, files), files)) continue; } catch { continue; } // already entered by the organizers
    open.push({ key, ...p, note: p.status === "disputed" ? await env.KV.get(`note:${key}`) : null });
  }
  return json({ open, schedule });
}

async function adminResolve(env, body) {
  const accept = body.action === "accept";
  const p = await pendingStore(env).get(body.key);
  if (!p) throw httpError(400, "Nothing open for this match.");
  if (accept) {
    await update(env, ["pairs", "cup", "results"], files => {
      const info = matchInfo(body.key, files);
      if (body.sets) { checkSets(body.sets, info.fullSets); makeOfficial(info, files, { ...p, sets: body.sets }); } // corrected by the admin
      else makeOfficial(info, files, p);
    }, `accept ${body.key} (admin)`);
  }
  await pendingStore(env).remove(body.key);
  if (accept) await scheduleStore(env).remove(body.key);
  await env.KV.delete(`note:${body.key}`);
  if (!accept) await env.KV.delete(`photo:${body.key}`);
  await addLog(env, { action: accept ? (body.sets ? "corrected by admin" : "accepted by admin") : "rejected by admin", key: body.key, by: "admin", ...(body.sets ? { detail: setsText(body.sets) } : {}) });
  return json({ ok: true });
}

// one-off: move dates/venues and waiting results still in the public data/matches.json into the private stores
async function adminMovePending(env) {
  const moved = [];
  await update(env, ["matches"], async files => {
    moved.length = 0;
    for (const [key, m] of Object.entries(files.matches)) {
      if (m.pending) await pendingStore(env).set(key, m.pending);
      if (m.date) await scheduleStore(env).set(key, { date: m.date, time: m.time, duration: m.duration || 90, court: m.court });
      moved.push(key);
    }
    files.matches = {};
  }, "move match dates and venues to private storage");
  return json({ moved });
}

// ---------------------------------------------------------------- gallery (public: data/gallery.json + img/gallery/*.jpg)

// the matches with a matchday photo, and what is already in the gallery
async function adminGalleryList(env) {
  const photos = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: "photo:", cursor });
    page.keys.forEach(k => photos.push({ key: k.name.slice(6), at: (k.metadata || {}).at || null }));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const { files } = await readAll(env, ["gallery"]);
  return json({ photos, gallery: files.gallery });
}

// body: { key, caption, action: "publish" | "remove" } – only matches with an official result can be published
async function adminGallery(env, body) {
  const key = String(body.key || ""), file = `img/gallery/${key.replace(/[^A-Za-z0-9]+/g, "-")}.jpg`;
  if (body.action === "remove") {
    await update(env, ["gallery"], files => { files.gallery = files.gallery.filter(g => g.key !== key); }, `gallery: remove ${key}`);
    await putBinary(env, file, null, `gallery: remove ${key}`);
    await addLog(env, { action: "photo removed from gallery", key, by: "admin" });
    return json({ ok: true });
  }
  const { files } = await readAll(env, ["pairs", "cup", "results"]);
  const info = matchInfo(key, files);
  if (!officialResult(info, files)) throw httpError(400, "Only matches with a confirmed result can go in the gallery.");
  const bytes = await env.KV.get(`photo:${key}`, { type: "arrayBuffer" });
  if (!bytes) throw httpError(404, "No photo for this match.");
  await putBinary(env, file, new Uint8Array(bytes), `gallery: photo ${key}`);
  const caption = String(body.caption || "").trim().slice(0, 140);
  await update(env, ["gallery"], f => {
    f.gallery = f.gallery.filter(g => g.key !== key);
    f.gallery.unshift({ key, src: `${file}?v=${Date.now()}`, caption, at: new Date().toISOString() }); // newest first
  }, `gallery: add ${key}`);
  await addLog(env, { action: "photo published in gallery", key, by: "admin" });
  return json({ ok: true });
}

async function photo(env, key) {
  const { value, metadata } = await env.KV.getWithMetadata(`photo:${key}`, { type: "arrayBuffer" });
  if (!value) throw httpError(404, "No photo for this match.");
  return new Response(value, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Uploaded-At": (metadata && metadata.at) || "" } });
}

// ---------------------------------------------------------------- WhatsApp numbers (private, KV "phones")
// { "<team id>": ["4917612345678", "923001234567"] } – digits with country code, one per player

async function getPhones(env) { return JSON.parse((await env.KV.get("phones")) || "{}"); }

function cleanPhone(p) {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  let digits = d.startsWith("+") ? d.slice(1) : d.startsWith("00") ? d.slice(2)
    : /^03\d{9}$/.test(d) ? "92" + d.slice(1)   // Pakistani mobile 03xx…
    : d.startsWith("0") ? "49" + d.slice(1) : d; // German number 0…
  if (!/^\d{8,15}$/.test(digits)) throw httpError(400, `Phone number not valid: ${p}`);
  return digits;
}

// body: { all: { id: [p1, p2] } } replaces everything; { team, phones: [p1, p2] } one team; { clear: true } deletes all
async function adminSetPhones(env, body) {
  let phones = await getPhones(env);
  if (body.clear) phones = {};
  else if (body.all) phones = Object.fromEntries(Object.entries(body.all).map(([id, l]) => [id, (l || []).map(cleanPhone)]));
  else if (body.team) phones[body.team] = (body.phones || []).map(cleanPhone);
  Object.keys(phones).forEach(id => { if (!phones[id].some(Boolean)) delete phones[id]; });
  await env.KV.put("phones", JSON.stringify(phones));
  await addLog(env, { action: body.clear ? "phone numbers deleted" : "phone numbers saved", by: "admin" });
  return json({ phones });
}

// ---------------------------------------------------------------- activity log (private, last 300 entries)

async function getLog(env) { return JSON.parse((await env.KV.get("log")) || "[]"); }
async function addLog(env, entry) {
  const log = await getLog(env);
  log.unshift({ at: new Date().toISOString(), ...entry });
  await env.KV.put("log", JSON.stringify(log.slice(0, 300)));
}

// ---------------------------------------------------------------- login guard (Durable Object)
// One instance counts wrong team codes for the whole league (exact and global, no KV writes):
// - per connection: 10 wrong codes in 15 minutes → blocked until the oldest one is 15 minutes old
// - league-wide brake: 200 wrong codes in an hour → all logins paused for 10 minutes
const IP_LIMIT = 10, IP_WINDOW = 15 * 60000, BRAKE_LIMIT = 200, BRAKE_WINDOW = 60 * 60000, BRAKE_PAUSE = 10 * 60000;

export class LoginGuard extends DurableObject {
  async load() {
    if (!this.s) this.s = (await this.ctx.storage.get("s")) || { ips: {}, all: [], pausedUntil: 0 };
    const now = Date.now(), s = this.s;
    for (const ip of Object.keys(s.ips)) { s.ips[ip] = s.ips[ip].filter(t => now - t < IP_WINDOW); if (!s.ips[ip].length) delete s.ips[ip]; }
    s.all = s.all.filter(t => now - t < BRAKE_WINDOW);
    return s;
  }
  async check(ip) {
    const s = await this.load(), now = Date.now();
    if (s.pausedUntil > now) return { blocked: `Logins are paused for a few minutes – please try again at ${new Date(s.pausedUntil).toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })}.` };
    if ((s.ips[ip] || []).length >= IP_LIMIT) return { blocked: "Too many wrong codes – please wait 15 minutes." };
    return {};
  }
  async fail(ip) {
    const s = await this.load(), now = Date.now();
    (s.ips[ip] = s.ips[ip] || []).push(now);
    s.all.push(now);
    let brakeStarted = false;
    if (s.all.length >= BRAKE_LIMIT && s.pausedUntil <= now) { s.pausedUntil = now + BRAKE_PAUSE; s.all = []; brakeStarted = true; }
    await this.ctx.storage.put("s", s);
    return { left: IP_LIMIT - s.ips[ip].length, brakeStarted };
  }
}

// ---------------------------------------------------------------- results waiting for confirmation (Durable Object)
// One instance holds every waiting/disputed result, so two teams entering results at the same time can't overwrite each other.
export class PendingStore extends DurableObject {
  async load() { return (this.p = this.p || (await this.ctx.storage.get("p")) || {}); }
  async save() { await this.ctx.storage.put("p", this.p); }
  async all() { return await this.load(); }
  async get(key) { return (await this.load())[key] || null; }
  async set(key, value) { (await this.load())[key] = value; await this.save(); }
  async remove(key) { delete (await this.load())[key]; await this.save(); }
  // only the same team may replace a waiting result (to correct it); the opponent has to confirm or dispute
  async submit(key, value) {
    const p = await this.load(), cur = p[key];
    if (cur && cur.by !== value.by) return { ok: false };
    p[key] = value; await this.save(); return { ok: true };
  }
}
