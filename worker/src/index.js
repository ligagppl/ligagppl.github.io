// ============================================================
//  GPPL member area – gatekeeper (Cloudflare Worker)
//
//  Teams log in with their team code and can schedule their matches,
//  enter results (with the matchday photo) and confirm or dispute the
//  opponent's result. The worker checks the rules and writes the data
//  files in the GitHub repository with its own token – players never
//  touch GitHub.
//
//  Data (GitHub, public):  data/matches.json – schedules + results waiting for confirmation
//                          data/results.json, data/cup.json – official results
//  Private (KV):           team codes, photos, dispute notes, activity log
// ============================================================

const FILES = { pairs: "data/pairs.json", results: "data/results.json", cup: "data/cup.json", matches: "data/matches.json" };
const FALLBACK = { pairs: [], results: [], cup: { rounds: [] }, matches: {} };
const AUTO_CONFIRM_MS = 48 * 3600 * 1000;
const TOKEN_DAYS = 90;
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
    // official results first, then matches.json – if the second write fails, a retry is harmless
    for (const k of keys.slice().sort((x, y) => (x === "matches") - (y === "matches"))) {
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

async function login(request, env, body) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const rlKey = `rl:${ip}`;
  const tries = +(await env.KV.get(rlKey)) || 0;
  if (tries >= 20) throw httpError(429, "Too many attempts – please wait 15 minutes.");
  const teamId = await env.KV.get(`code:${await codeHash(env, body.code)}`);
  if (!teamId) {
    await env.KV.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    throw httpError(401, "This team code is not valid.");
  }
  const rec = JSON.parse(await env.KV.get(`team:${teamId}`));
  const payload = b64url(enc.encode(JSON.stringify({ t: +teamId, v: rec.ver, exp: Date.now() + TOKEN_DAYS * 86400000 })));
  await addLog(env, { team: +teamId, action: "login" });
  return json({ token: `${payload}.${await hmac(env, payload)}`, team: +teamId });
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
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  const raw = [...rnd].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
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
  if (!validSet(s1) || !validSet(s2)) throw httpError(400, "A set must end 6–0…6–4, 7–5 or 7–6.");
  const split = (s1[0] > s1[1]) !== (s2[0] > s2[1]);
  if (split && !s3) throw httpError(400, fullSets ? "Sets are 1–1 – enter set 3." : "Sets are 1–1 – enter the match tie-break.");
  if (!split && s3) throw httpError(400, "The match was over after 2 sets – remove the third one.");
  if (s3 && fullSets && !validSet(s3)) throw httpError(400, "Set 3 must end 6–0…6–4, 7–5 or 7–6.");
  if (s3 && !fullSets && !validTieBreak(s3)) throw httpError(400, "Match tie-break: first to 10, win by 2 (e.g. 10–8, 12–10).");
}

// ---------------------------------------------------------------- team actions

async function me(env, team) {
  const { files } = await readAll(env, ["pairs", "results", "cup", "matches"]);
  const notes = {};
  for (const [key, m] of Object.entries(files.matches)) {
    if (m.pending && m.pending.status === "disputed" && key.includes(String(team))) {
      notes[key] = await env.KV.get(`note:${key}`);
    }
  }
  return json({ team, ...files, notes });
}

const cleanDate = d => (d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const cleanTime = t => (t === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);

async function schedule(env, team, body) {
  const date = cleanDate(String(body.date ?? "")), time = cleanTime(String(body.time ?? ""));
  const court = String(body.court ?? "").trim().slice(0, 160);
  if (date === null || time === null) throw httpError(400, "Date or time not valid.");
  const entry = await update(env, ["pairs", "cup", "results", "matches"], files => {
    const info = matchInfo(body.key, files);
    requirePlayer(info, team);
    if (officialResult(info, files)) throw httpError(400, "This match already has a result.");
    const m = files.matches[info.key] || {};
    if (date || time || court) Object.assign(m, { date, time, court, by: team, at: new Date().toISOString() });
    else ["date", "time", "court", "by", "at"].forEach(k => delete m[k]);
    if (Object.keys(m).length) files.matches[info.key] = m; else delete files.matches[info.key];
    return m;
  }, `schedule ${body.key}`);
  await addLog(env, { team, action: "schedule", key: body.key, detail: [date, time, court].filter(Boolean).join(" · ") || "cleared" });
  return json({ ok: true, match: entry });
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
  let photoKey;
  const pending = await update(env, ["pairs", "cup", "results", "matches"], async files => {
    const info = matchInfo(body.key, files);
    requirePlayer(info, team);
    if (officialResult(info, files)) throw httpError(400, "This match already has a confirmed result – contact the organizers to change it.");
    const sets = orient(body.sets, team, info.a);
    checkSets(sets, info.fullSets);
    const m = files.matches[info.key] || {};
    if (m.pending && m.pending.by !== team) throw httpError(400, "Your opponent already entered a result – please confirm or dispute it.");
    if (!m.date) throw httpError(400, "Set the match date first, then enter the result.");
    photoKey = info.key;
    m.pending = { a: info.a, b: info.b, sets, ...(link ? { link } : {}), by: team, at: new Date().toISOString(), status: "pending" };
    files.matches[info.key] = m;
    return m.pending;
  }, `result ${body.key}`);
  await env.KV.put(`photo:${photoKey}`, photoBytes, { metadata: { team, at: pending.at } });
  await env.KV.delete(`note:${photoKey}`);
  await addLog(env, { team, action: "result entered", key: photoKey, detail: setsText(pending.sets) });
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
  await update(env, ["pairs", "cup", "matches"], files => {
    const info = matchInfo(body.key, files);
    const m = files.matches[info.key];
    if (!m || !m.pending || m.pending.by !== team) throw httpError(400, "There is no result from your team to withdraw.");
    delete m.pending;
    if (!Object.keys(m).length) delete files.matches[info.key];
  }, `withdraw ${body.key}`);
  await env.KV.delete(`photo:${body.key}`);
  await addLog(env, { team, action: "result withdrawn", key: body.key });
  return json({ ok: true });
}

async function confirm(env, team, body) {
  const result = await update(env, ["pairs", "cup", "results", "matches"], files => {
    const info = matchInfo(body.key, files);
    requirePlayer(info, team);
    const m = files.matches[info.key];
    if (!m || !m.pending) throw httpError(400, "There is no result to confirm.");
    if (m.pending.by === team) throw httpError(400, "Your opponent has to confirm your result.");
    return makeOfficial(info, files, m.pending);
  }, `confirm ${body.key}`);
  await addLog(env, { team, action: "result confirmed", key: body.key, detail: setsText(result.sets) });
  return json({ ok: true });
}

async function dispute(env, team, body) {
  const note = String(body.note || "").trim().slice(0, 500);
  if (!note) throw httpError(400, "Please write what is wrong.");
  await update(env, ["pairs", "cup", "matches"], files => {
    const info = matchInfo(body.key, files);
    requirePlayer(info, team);
    const m = files.matches[info.key];
    if (!m || !m.pending || m.pending.status !== "pending") throw httpError(400, "There is no result to dispute.");
    if (m.pending.by === team) throw httpError(400, "You can withdraw your own result instead.");
    m.pending.status = "disputed";
    m.pending.disputedBy = team;
    m.pending.disputedAt = new Date().toISOString();
  }, `dispute ${body.key}`);
  await env.KV.put(`note:${body.key}`, note);
  await addLog(env, { team, action: "result disputed", key: body.key, detail: note });
  return json({ ok: true });
}

// write the result into results.json / cup.json and clear it from matches.json
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
  const entry = files.matches[info.key];
  delete entry.pending;
  ["date", "time", "court", "by", "at"].forEach(k => delete entry[k]);
  delete files.matches[info.key];
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
  let confirmed = [];
  await update(env, ["pairs", "cup", "results", "matches"], files => {
    confirmed = [];
    for (const [key, m] of Object.entries(files.matches)) {
      const p = m.pending;
      if (!p || p.status !== "pending" || Date.now() - Date.parse(p.at) < AUTO_CONFIRM_MS) continue;
      try { makeOfficial(matchInfo(key, files), files, p); confirmed.push(key); } catch {}
    }
  }, "auto-confirm after 48 hours");
  for (const key of confirmed) await addLog(env, { action: "auto-confirmed", key });
  return confirmed;
}

// ---------------------------------------------------------------- admin

async function adminOpen(env) {
  const { files } = await readAll(env, ["matches"]);
  const open = [];
  for (const [key, m] of Object.entries(files.matches)) {
    if (!m.pending) continue;
    open.push({ key, ...m.pending, note: m.pending.status === "disputed" ? await env.KV.get(`note:${key}`) : null });
  }
  return json({ open });
}

async function adminResolve(env, body) {
  const accept = body.action === "accept";
  await update(env, ["pairs", "cup", "results", "matches"], files => {
    const info = matchInfo(body.key, files);
    const m = files.matches[info.key];
    if (!m || !m.pending) throw httpError(400, "Nothing open for this match.");
    if (accept) makeOfficial(info, files, m.pending);
    else { delete m.pending; if (!Object.keys(m).length) delete files.matches[info.key]; }
  }, `${accept ? "accept" : "reject"} ${body.key} (admin)`);
  await env.KV.delete(`note:${body.key}`);
  if (!accept) await env.KV.delete(`photo:${body.key}`);
  await addLog(env, { action: accept ? "accepted by admin" : "rejected by admin", key: body.key, by: "admin" });
  return json({ ok: true });
}

async function photo(env, key) {
  const { value, metadata } = await env.KV.getWithMetadata(`photo:${key}`, { type: "arrayBuffer" });
  if (!value) throw httpError(404, "No photo for this match.");
  return new Response(value, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Uploaded-At": (metadata && metadata.at) || "" } });
}

// ---------------------------------------------------------------- activity log (private, last 300 entries)

async function getLog(env) { return JSON.parse((await env.KV.get("log")) || "[]"); }
async function addLog(env, entry) {
  const log = await getLog(env);
  log.unshift({ at: new Date().toISOString(), ...entry });
  await env.KV.put("log", JSON.stringify(log.slice(0, 300)));
}
