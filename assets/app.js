// GPPL website – reads settings from data.js and results/cup from /data/*.json

const { pairName, fmt, matchdayWindow, fixtures, DAY } = GPPL;
let results = [], cup = { rounds: [] };

const sign = n => (n > 0 ? "+" + n : String(n));
let datesOn = LEAGUE.datesConfirmed !== false; // dates hidden until the start date is set (Admin → League results)

// matchday running today (null before the season starts / after it ends)
function currentMatchday() {
  if (!datesOn) return null;
  const now = Date.now();
  for (let md = 1; md <= fixtures.length; md++) {
    const { from, to } = matchdayWindow(md);
    if (now >= from.getTime() && now < to.getTime() + DAY) return md;
  }
  return null;
}

function renderStandings() {
  const rows = GPPL.rankStandings(results);
  let html = `<table><tr><th>#</th><th class="left">Pair</th><th>P</th><th>W</th><th>L</th><th>Sets</th><th>Games</th><th>Pts</th></tr>`;
  rows.forEach((r, i) => {
    html += `<tr class="${i < 2 ? "top" : ""}"><td>${results.length && i < 3 ? `<span class="medal-rank">${["🥇", "🥈", "🥉"][i]}</span>` : i + 1}</td>
      <td class="left"><span class="tbl-team">${teamLogo(r.id)}<b>${pairName(r.id)}</b></span></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.l}</td>
      <td>${sign(r.sf - r.sa)}</td><td>${sign(r.gf - r.ga)}</td><td class="pts">${r.pts}</td></tr>`;
  });
  document.getElementById("standings").innerHTML = html + "</table>";
}

function matchRow(a, b) {
  const r = GPPL.findResult(results, a, b);
  let score = '<span class="muted">vs</span>', wa = "", wb = "";
  if (r) {
    score = GPPL.scoreText(r, a);
    const w = GPPL.evaluate(r).winner; // null when both pairs were at fault
    if (w === a) wa = "w"; else if (w === b) wb = "w";
  }
  const cup = '<span class="win-mark" title="Winner">🏆</span>'; // small trophy next to the winner, on the score side
  return `<div class="match"><span class="a ${wa}">${teamLogo(a)}<span class="tn">${pairName(a)}</span>${wa ? cup : ""}</span>
    <span class="score">${score}</span><span class="b ${wb}">${wb ? cup : ""}<span class="tn">${pairName(b)}</span>${teamLogo(b)}</span></div>`;
}

// small still logo next to a team name (a ball for teams without one yet)
function teamLogo(id) {
  const l = (LEAGUE.logos || {})[pairName(id)];
  const src = l && (typeof l === "string" ? l : l.src);
  return src ? `<img class="mlogo" src="${src}" alt="" loading="lazy">` : `<span class="mlogo ph" aria-hidden="true">🎾</span>`;
}

// matches with a result first, then the open ones (in draw order); dates and venues are private (🎾 My team)
const playedFirst = games => games.filter(([a, b]) => GPPL.findResult(results, a, b)).concat(games.filter(([a, b]) => !GPPL.findResult(results, a, b)));

function renderSchedule() {
  const cur = currentMatchday();
  document.getElementById("schedule-list").innerHTML = fixtures.map((games, i) => {
    const md = i + 1, { from, to } = matchdayWindow(md);
    const milestones = (LEAGUE.milestonesByPairs || {})[LEAGUE.pairs.length] || [];
    const mi = milestones.findIndex(m => m.md === md);
    const ms = mi === -1 ? "" : `<div class="milestone">🏁 <b>Milestone ${mi + 1}</b> – by ${datesOn ? fmt(to) : "the end of this matchday"}, every pair has played
      ${milestones[mi].min === "all" ? "<b>all</b> its matches" : `at least <b>${milestones[mi].min}</b> matches`}</div>`;
    const cw = ((LEAGUE.cupWindowsByPairs || {})[LEAGUE.pairs.length] || []).find(w => w.from === md);
    const cup = cw ? `<div class="cupwindow">🏆 <b>GPPC Cup – ${cw.round}</b>: ${cw.draw || "draw"} at the start of this matchday,
      play by the end of matchday ${cw.to}</div>` : "";
    return `<div class="card md ${md === cur ? "current" : ""}">${cup}
      <div class="md-head"><h3>Matchday ${md}</h3>
      <span class="note">${datesOn ? `${fmt(from)} – ${fmt(to)}` : "dates follow"}${md === cur ? ' · <span class="pill">Current</span>' : ""}</span></div>
      ${playedFirst(games).map(([a, b]) => matchRow(a, b)).join("")}${ms}</div>`;
  }).join("");
}

function renderHome() {
  const n = LEAGUE.pairs.length, total = fixtures.length ? fixtures.reduce((s, g) => s + g.length, 0) : n * (n - 1) / 2; // before the draw: everyone plays everyone once
  const last = matchdayWindow(fixtures.length).to;
  // the Top 3 only means something once every pair has played at least once
  const ranked = GPPL.rankStandings(results), started = ranked.filter(r => r.p > 0).length;
  const top = ranked.length && started === ranked.length ? ranked.slice(0, 3) : [];
  document.getElementById("home-stats").innerHTML = `
    <div class="card"><div class="note">Pairs</div><div style="font-size:1.8rem;font-weight:700">${LEAGUE.pairs.length}</div>
      ${tabAllowed("participants") ? `<a href="#participants">👥 See all teams →</a>` : ""}</div>
    <div class="card"><div class="note">Matches played</div><div style="font-size:1.8rem;font-weight:700">${results.length} / ${total}</div></div>
    <div class="card"><div class="note">Season</div><div style="font-size:1.1rem;font-weight:700">${datesOn ? `${fmt(GPPL.start)} – ${fmt(last)}` : "Dates follow"}</div></div>
    <div class="card top3-card"><div class="note">Top 3</div>
      ${top.length ? `<div class="top3">${top.map((r, i) => `<span>${["🥇", "🥈", "🥉"][i]} ${teamLogo(r.id)}<span class="top3-name"><b>${pairName(r.id)}</b>
          <span class="note">${r.p} played · ${r.w} W · ${r.l} L · <b>${r.pts} pts</b></span></span></span>`).join("")}</div>`
        : `<div class="top3-wait"><b>${started} of ${ranked.length}</b> pairs have played</div><span class="note">The Top 3 appears once every pair has played at least one match.</span>`}</div>`;
  renderMatchdayCard();
}

// which matchday is running (or when the season starts) and how many of its matches are played
function renderMatchdayCard() {
  const el = document.getElementById("home-md"), cur = currentMatchday();
  if (!datesOn) {
    el.innerHTML = `<h3 style="margin-top:0">📅 Matchdays</h3><p class="muted">The dates are announced soon.</p>`;
    // start date set, but the schedule waits until the organizers publish it
    const api = (localStorage.getItem("gppl-member-api") || LEAGUE.memberApi || "").replace(/\/+$/, "");
    if (settings.startDate && LEAGUE.scheduleReleased === false && api) {
      fetch(api + "/status").then(r => r.json()).then(st => {
        if (st.released) return;
        el.innerHTML = `<h3 style="margin-top:0">📅 The schedule is almost ready</h3>
          <p>It's published soon – <b>${st.signedIn} of ${st.teams}</b> teams have logged in to <a href="#team">🎾 My team</a> so far.</p>
          <div class="md-now-bar"><span style="width:${st.teams ? Math.round(100 * st.signedIn / st.teams) : 0}%"></span></div>`;
      }).catch(() => {});
    }
    return;
  }
  if (!cur) {
    const before = Date.now() < GPPL.start.getTime(), md = before ? 1 : fixtures.length, { from, to } = matchdayWindow(md);
    el.innerHTML = before
      ? `<h3 style="margin-top:0">📅 The season starts on ${from.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3><p class="muted">Matchday 1 runs ${fmt(from)} – ${fmt(to)}. Agree on dates with your opponents and set them in <a href="#team">🎾 My team</a>.</p>`
      : `<h3 style="margin-top:0">🏁 The league season is over</h3><p class="muted">Thanks for playing – see the final table.</p>`;
    return;
  }
  const { from, to } = matchdayWindow(cur), games = fixtures[cur - 1] || [];
  const played = games.filter(([a, b]) => GPPL.findResult(results, a, b)).length;
  const daysLeft = Math.max(0, Math.ceil((to.getTime() + DAY - Date.now()) / DAY));
  el.innerHTML = `<div class="md-now"><div><span class="pill">In progress</span>
      <h3 style="margin:8px 0 2px">Matchday ${cur} of ${fixtures.length}</h3>
      <span class="note">${fmt(from)} – ${fmt(to)} · ${daysLeft === 1 ? "last day" : `${daysLeft} days left`}</span></div>
      <div class="md-now-count"><b>${played}/${games.length}</b><span class="note">matches played</span></div></div>
    <div class="md-now-bar"><span style="width:${games.length ? (100 * played / games.length).toFixed(0) : 0}%"></span></div>`;
}

function renderCup() {
  const el = document.getElementById("cup-rounds");
  if (!cup.rounds.length) {
    // once the dates are published: the draw is on the first day of the first cup window
    const first = ((LEAGUE.cupWindowsByPairs || {})[LEAGUE.pairs.length] || [])[0];
    const when = first && datesOn ? matchdayWindow(first.from) : null;
    el.innerHTML = `<div class="card muted">${when
      ? `The cup draw is on <b>${fmt(when.from)}</b> – ${esc(first.round)} is played in matchdays ${first.from}–${first.to} (${fmt(when.from)} – ${fmt(matchdayWindow(first.to).to)}).`
      : "The cup draw hasn't happened yet – it starts in the second half of the league."}</div>`;
    return;
  }
  const ns = GPPL.cupNextStage(cup);
  const champ = ns.type === "done"
    ? `<div class="card" style="text-align:center"><div style="font-size:2rem">🏆</div><h3 style="margin:4px 0">GPPC Cup champions</h3><div style="font-size:1.3rem;font-weight:800">${pairName(ns.champion)}</div></div>` : "";
  const seedLine = (r, i) => r.words
    ? `<p class="note">🔐 Seed words: “${r.words}”${verifyOn ? ` · <a href="#verify" data-verify="${i}">Verify</a>` : ""}</p>` : "";
  // latest round first; every match as a small score board (logos, sets, winner) like in 🎾 My team
  const board = (m, r, ri, mi) => {
    const w = GPPL.cupWinner(m), full = GPPL.cupFullSets(r);
    const sets = m.sets || [], cols = Math.max(sets.length, 2);
    const row = (id, side) => `<span class="cb-team ${w === id ? "w" : ""}">${teamLogo(id)}<span>${pairName(id)}</span>${w === id ? " 🏆" : ""}</span>` +
      Array.from({ length: cols }, (_, i) => `<span class="cb-g ${sets[i] && sets[i][side] > sets[i][1 - side] ? "win" : ""}">${sets[i] ? sets[i][side] : ""}</span>`).join("");
    const foot = m.walkover === "both" ? "Walkover – both pairs out"
      : m.walkover ? `Walkover – ${pairName(m.walkover)} goes through`
      : sets.length ? (full ? "3 full sets" : sets.length === 3 ? "3rd set: match tie-break" : "")
      : "Not played yet";
    return `<div class="cupboard"><span class="note cb-no">Match ${mi + 1}</span>
      <div class="cb-grid" style="--cols:${cols}">${row(m.a, 0)}${row(m.b, 1)}</div>
      ${foot ? `<span class="note">${foot}</span>` : ""}</div>`;
  };
  el.innerHTML = champ + cup.rounds.map((r, ri) => [r, ri]).reverse().map(([r, ri]) => {
    if (r.type === "lucky") {
      return `<div class="card"><h3 style="margin-top:0">🍀 ${r.name}</h3><p>Back in the cup: <b>${r.lucky.map(pairName).join(", ")}</b></p>${seedLine(r, ri)}</div>`;
    }
    const done = r.matches.filter(m => GPPL.cupWinner(m) || m.walkover === "both").length;
    return `<div class="card"><div class="cup-head"><h3 style="margin:0">${r.third ? "🥉 " : r.name === "Final" ? "🏆 " : ""}${r.name}</h3>
        <span class="note">${done}/${r.matches.length} played${GPPL.cupFullSets(r) ? " · 3 full sets" : ""}</span></div>
      <div class="cup-matches">${r.matches.map((m, mi) => board(m, r, ri, mi)).join("")}</div>
      ${r.byes && r.byes.length ? `<p class="note">🎟️ Bye: ${r.byes.map(pairName).join(", ")}</p>` : ""}
      ${seedLine(r, ri)}
    </div>`;
  }).join("");
}

// ---------- Verify draw ----------
const verifiableRounds = () => cup.rounds.map((r, i) => ({ r, i })).filter(x => x.r.words);
let verifyPick = null; // round index chosen via a "Verify" link on the cup tab
const verifyOn = !!document.getElementById("verify"); // the Verify draw page can be left out of the site

function renderVerifySelect() {
  if (!verifyOn) return;
  const sel = document.getElementById("v-round");
  const before = sel.value;
  const keep = verifyPick !== null ? String(verifyPick) : before;
  sel.innerHTML = verifiableRounds().map(({ r, i }) => `<option value="${i}">${r.name}</option>`).join("") +
    `<option value="manual">Enter by hand…</option>`;
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  verifyPick = null;
  // only reset the output when the selected draw actually changed
  fillVerifyForm(sel.value !== before);
}

function fillVerifyForm(clearOutput = true) {
  const v = document.getElementById("v-round").value;
  const disabled = v !== "manual";
  ["v-words", "v-ids", "v-type", "v-lucky"].forEach(id => (document.getElementById(id).disabled = disabled));
  if (v !== "manual") {
    const r = cup.rounds[+v];
    document.getElementById("v-words").value = r.words;
    document.getElementById("v-ids").value = r.entrants.join(", ");
    document.getElementById("v-type").value = r.type === "lucky" ? "lucky"
      : r.matches.length * 2 === r.entrants.length - (r.entrants.length % 2) ? "lucky-format" : "classic";
    if (r.type === "lucky") document.getElementById("v-lucky").value = r.lucky.length;
  }
  document.getElementById("v-lucky-row").hidden = document.getElementById("v-type").value !== "lucky";
  if (clearOutput) document.getElementById("v-output").innerHTML = "";
}

function matchCount(n, type) {
  if (type === "lucky-format") return Math.floor(n / 2);
  if ((n & (n - 1)) === 0) return n / 2;
  return n - 2 ** Math.floor(Math.log2(n));
}

function runVerify() {
  const out = document.getElementById("v-output");
  const v = document.getElementById("v-round").value;
  const saved = v === "manual" ? null : cup.rounds[+v];
  const words = document.getElementById("v-words").value;
  const ids = document.getElementById("v-ids").value.split(/[^0-9]+/).filter(Boolean).map(Number);
  const type = document.getElementById("v-type").value;
  const label = id => (saved && saved.labels && saved.labels[id]) || pairName(id);

  const { clean, seed } = GPPL.wordsToSeed(words);
  if (!clean) { out.innerHTML = `<div class="card verdict bad">Enter the seed words.</div>`; return; }
  if (ids.length < 2) { out.innerHTML = `<div class="card verdict bad">Enter at least 2 pair IDs.</div>`; return; }

  const shuffle = GPPL.seededShuffle(seed, ids);
  const count = type === "lucky" ? +document.getElementById("v-lucky").value || 1 : matchCount(ids.length, type);
  const draw = GPPL.drawFromOrder(shuffle.order, type === "lucky" ? "lucky" : "matches", count);

  let verdict = "";
  if (saved) {
    const { ok } = GPPL.verifyRound(saved);
    verdict = ok
      ? `<div class="verdict ok">✅ Matches the official draw of “${saved.name}”</div>`
      : `<div class="verdict bad">❌ Does not match the official draw of “${saved.name}”</div>`;
  }

  const drawHtml = type === "lucky"
    ? `<p>🍀 Back in the cup: <b>${draw.lucky.map(label).join(", ")}</b></p>`
    : draw.matches.map((m, i) => `<div>Match ${i + 1}: <b>${label(m.a)}</b> vs <b>${label(m.b)}</b></div>`).join("") +
      (draw.byes.length ? `<div class="note" style="margin-top:6px">🎟️ Bye: ${draw.byes.map(label).join(", ")}</div>` : "");

  out.innerHTML = `<div class="card">${verdict}
    <h3 style="margin-top:0">1. Seed</h3>
    <div class="kv">
      <span class="muted">Words as given</span><span>${words.replace(/</g, "&lt;")}</span>
      <span class="muted">Cleaned</span><code>${clean}</code>
      <span class="muted">Seed number</span><code>${seed}</code>
    </div>
    <h3>2. Start list (sorted IDs)</h3>
    <p>${shuffle.start.map(id => `<b>${id}</b> ${label(id)}`).join(" · ")}</p>
    <h3>3. Shuffle steps</h3>
    <div class="table-wrap"><table class="steps">
      <tr><th>i</th><th>state</th><th>j = state mod (i+1)</th><th class="left">List after swapping i and j</th></tr>
      ${shuffle.steps.map(s => `<tr><td>${s.i}</td><td>${s.state}</td><td>${s.j}</td><td class="left">${s.i === s.j ? '<span class="muted">no change</span>' : s.list.join(", ")}</td></tr>`).join("")}
    </table></div>
    <h3>4. Final order</h3>
    <p><code>${shuffle.order.join(", ")}</code></p>
    <h3>5. Draw</h3>
    ${drawHtml}
  </div>`;
}

if (verifyOn) {
  document.getElementById("v-round").addEventListener("change", () => fillVerifyForm(true));
  document.getElementById("v-type").addEventListener("change", () => {
    document.getElementById("v-lucky-row").hidden = document.getElementById("v-type").value !== "lucky";
  });
  document.getElementById("v-run").addEventListener("click", runVerify);
}
// "Verify" links on the cup tab
document.addEventListener("click", e => {
  const link = e.target.closest("[data-verify]");
  if (!link) return;
  e.preventDefault();
  verifyPick = +link.dataset.verify;
  renderVerifySelect();
  location.hash = "#verify";
  runVerify();
});

// registered pairs (imported in Admin → Pairs; the placeholders are never shown)
function renderParticipants() {
  const el = document.getElementById("participants-body");
  const pairs = LEAGUE.pairsImported ? LEAGUE.pairs : [];
  const max = 12, min = 8;
  // last updated: set automatically by Admin → Pairs (German time)
  const upd = settings.participantsUpdated ? new Date(settings.participantsUpdated) : null;
  const updatedLine = upd && !isNaN(upd) ? `<span class="note">Last updated: ${upd.toLocaleString("en-GB", { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>` : "";
  const count = `<div class="card part-count"><span class="fee-amount">${pairs.length}</span>
    <span><b>${pairs.length === 1 ? "team" : "teams"} registered</b><span class="note">Minimum ${min} · maximum ${max} (tentative) – places in order of payment (§1.1)</span>${updatedLine}</span></div>`;
  if (!pairs.length) {
    el.innerHTML = count + `<div class="card muted">No confirmed pairs yet. <a href="#register">Register now</a> 🎾</div>`;
    return;
  }
  const logos = LEAGUE.logos || {};
  // logo if there is one; a "loading" ball while the team name is still TBD; otherwise the number
  const logo = n => typeof logos[n] === "string" ? { src: logos[n] } : logos[n];
  // Admin → Pairs → Logo animations sets the default; each visitor can switch it on/off (remembered in this browser)
  let mine = null;
  try { mine = localStorage.getItem("gppl-logo-anim"); } catch {}
  const always = (mine || settings.logoAnimation) === "always" && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const hasAnim = pairs.some(p => logos[p.name] && logo(p.name).anim);
  const toggle = hasAnim ? `<label class="anim-toggle"><input type="checkbox" id="anim-toggle"${always ? " checked" : ""}> <span>Play logo animations</span></label>` : "";
  const badge = p => logos[p.name] ? `<img class="part-logo" src="${esc(always && logo(p.name).anim ? logo(p.name).anim : logo(p.name).src)}"${logo(p.name).anim ? ` data-still="${esc(logo(p.name).src)}" data-anim="${esc(logo(p.name).anim)}"` : ""} alt="${esc(p.name)} logo">`
    : /\btbd\b/i.test(p.name) ? `<span class="part-loading" role="img" aria-label="Team name coming soon"><span></span></span>`
    : `<span class="part-num">#${p.id}</span>`;
  const label = p => logos[p.name] || /\btbd\b/i.test(p.name) ? `<span class="part-seed">#${p.id}</span>` : "";
  el.innerHTML = count + toggle + `<div class="part-grid${always ? " anim-on" : ""}">` + pairs.map(p => `<div class="card part-card${logos[p.name] && logo(p.name).anim && !always ? " has-anim" : ""}">
      ${badge(p)}
      <div class="part-info">${label(p)}<b class="part-team">${esc(p.name)}</b>
        <span class="part-players">${p.players.map((n, i) => !n ? "" : `<span class="pl">` + (p.links && p.links[i] && /^https:\/\/app\.playtomic\.com\//.test(p.links[i]) ? `<a href="${esc(p.links[i])}" target="_blank" rel="noopener" title="Playtomic profile">${esc(n)}</a>` : esc(n)) + `</span>`).filter(Boolean).join("")}</span></div></div>`).join("") + `</div>`;
}

// team logos play their animation while hovered (desktop) or after a tap (phone)
(function logoAnimations() {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const set = (card, on) => {
    if (reduce) return;
    const img = card.querySelector("img[data-anim]");
    if (!img) return;
    img.src = on ? img.dataset.anim : img.dataset.still;
    card.classList.toggle("playing", on);
  };
  const body = document.getElementById("participants-body");
  body.addEventListener("mouseover", e => { const c = e.target.closest(".part-card.has-anim"); if (c && !c.classList.contains("playing")) set(c, true); });
  body.addEventListener("mouseout", e => { const c = e.target.closest(".part-card.has-anim"); if (c && !c.contains(e.relatedTarget)) set(c, false); });
  body.addEventListener("click", e => {
    const c = e.target.closest(".part-card.has-anim");
    if (!c) return;
    const on = !c.classList.contains("playing");
    body.querySelectorAll(".part-card.playing").forEach(o => o !== c && set(o, false));
    set(c, on);
  });
  body.addEventListener("change", e => {
    if (e.target.id !== "anim-toggle") return;
    try { localStorage.setItem("gppl-logo-anim", e.target.checked ? "always" : "hover"); } catch {}
    renderParticipants();
  });
  // load the animated files ahead of time, so the first hover starts right away
  window.addEventListener("load", () => Object.values(LEAGUE.logos || {}).forEach(l => { if (l && l.anim) new Image().src = l.anim; }));
})();

// matchday photos published from Admin → 📸 Gallery (data/gallery.json, newest first), then the fixed ones in data.js
let gallery = [];
function renderGallery() {
  const el = document.getElementById("gallery-grid");
  const list = (Array.isArray(gallery) ? gallery : []).concat(LEAGUE.gallery || []);
  if (!list.length) {
    el.innerHTML = `<div class="card muted">Photos will appear here during the season 📸</div>`;
    return;
  }
  el.innerHTML = `<div class="gallery">` + list.map(g =>
    `<figure><img src="${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy"><figcaption>${esc(g.caption)}</figcaption></figure>`).join("") + `</div>`;
}

// registration settings come from data/settings.json (Admin → Registration), fallback data.js
let settings = {};
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "Saturday, 24 October 2026, 23:59:59" → that moment in German time (Europe/Berlin)
function parseDeadline(text) {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const m = String(text || "").toLowerCase().match(/(\d{1,2})\.?\s+([a-z]+)\s+(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const mon = m ? months.findIndex(x => x.startsWith(m[2].slice(0, 3))) : -1;
  if (mon < 0) return null;
  const wall = Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +(m[6] || 0));
  // Berlin's UTC offset at that time (handles summer/winter time)
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(wall)).map(x => [x.type, +x.value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wall;
  return new Date(wall - offset);
}

function countdownHtml(deadline) {
  const end = parseDeadline(deadline);
  return end ? `<div class="countdown" data-end="${end.getTime()}" aria-live="off"></div>` : "";
}

// ticks every second; registration countdowns are re-rendered with the page
setInterval(function tick() {
  document.querySelectorAll(".countdown[data-end]").forEach(el => {
    const left = Math.max(0, +el.dataset.end - Date.now()), s = Math.floor(left / 1000);
    const parts = [[Math.floor(s / 86400), "days"], [Math.floor(s / 3600) % 24, "hrs"], [Math.floor(s / 60) % 60, "min"], [s % 60, "sec"]];
    el.innerHTML = left ? parts.map(([n, l]) => `<div><b>${String(n).padStart(2, "0")}</b><small>${l}</small></div>`).join("")
      : `<b class="cd-over">The registration deadline has passed</b>`;
  });
  return tick;
}(), 1000);

function renderRegister() {
  if (!document.getElementById("register-body")) return; // the live site has no Register page any more
  const reg = { ...LEAGUE.registration, ...(settings.registration || {}) };
  const status = reg.status || (reg.open ? "open" : "soon");
  const banner = {
    soon: `<div class="reg-banner soon"><b>Registration opens soon</b><span>Watch the GPPL WhatsApp group 📲</span></div>`,
    open: `<div class="reg-banner open"><b>Registration is open</b><span>Deadline: ${esc(reg.deadline)}</span>${countdownHtml(reg.deadline)}</div>`,
    closed: `<div class="reg-banner closed"><b>Registration is closed</b><span>Thanks to everyone who registered – see you on court!</span></div>`,
  }[status] || "";
  // once registration is closed, the banner is all there is to say
  if (status === "closed") { document.getElementById("register-body").innerHTML = banner; return; }
  // the fee as a big amount ("€30 per pair" → "€30" + "per pair")
  const feeMatch = String(reg.fee || "").match(/^\s*(\S*\d\S*)\s*(.*)$/);
  const feeCard = `<div class="card fee-card">
    <div class="fee-main"><span class="fee-label">Entry fee</span>
      ${feeMatch ? `<span class="fee-amount">${esc(feeMatch[1])}</span><span class="fee-unit">${esc(feeMatch[2])}</span>` : `<span class="fee-unit">${esc(reg.fee)}</span>`}
      ${status === "open" && reg.paymentUrl ? `<span class="note">${esc(reg.paymentNote)}</span>` : ""}</div>
    ${status === "open" && reg.paymentUrl ? `<a class="btn" href="${esc(reg.paymentUrl)}" target="_blank" rel="noopener">Pay via PayPal pool</a>` : ""}</div>`;
  const perks = `<div class="card perks">
    <div><span class="perk-icon">🗓️</span><b>Play at your own pace</b><ul>
      <li><b>10 days per matchday</b> – plenty of time to find a day, time and court that suit both pairs.</li>
      <li><b>The whole league schedule from day one</b> – you know all your opponents in advance and play at your own pace.</li>
      <li><b>Scheduling conflict with an opponent?</b> Ideally you follow the matchday order – but if dates clash, you can play your matches in any order.</li>
      <li><b>Busy week or travelling?</b> Take a matchday off and catch up later – as long as you reach the milestones:</li></ul>
      <div class="ms-slot"></div>
      <span class="note">The milestones might change after the registration deadline, depending on the start date. Details in the <a href="#rules">Rules</a> (§2).</span></div></div>
    <div class="card perks">
    <div><span class="perk-icon">🏆</span><b>GPPC Cup – a fresh draw every round</b><ul>
      <li>Every pair plays in the cup.</li>
      <li>Each round is drawn randomly just before it starts.</li>
      <li>Anyone can verify the draw.</li></ul></div></div>`;
  let html = banner + feeCard + perks + `<div class="card">
    <p><b>Registration deadline:</b> ${esc(reg.deadline)}</p>
    <p class="note">${status === "open" && reg.paymentUrl ? "" : esc(reg.paymentNote) + " "}A registration only counts once it's paid – the time of payment is the time of registration.
    Places are first come, first served – one organizer pair may be exempt from this.</p></div>`;
  if (status === "open") {
    const url = reg.formUrl || "";
    const embeddable = /docs\.google\.com\/forms\/.+\/viewform/.test(url);
    const openUrl = embeddable ? url.replace(/[?&]embedded=true/, "").replace(/\?$/, "") : url;
    if (!url) html += `<div class="card muted">The registration form will appear here.</div>`;
    else {
      html += `<div class="card form-card"><b>Registration form</b>
        <a class="btn ${embeddable ? "ghost" : ""}" href="${esc(openUrl)}" target="_blank" rel="noopener">Open the form in a new tab</a></div>`;
      if (embeddable) html += `<iframe class="form" src="${esc(url.includes("embedded=true") ? url : url + (url.includes("?") ? "&" : "?") + "embedded=true")}" loading="lazy">Loading…</iframe>`;
    }
  }
  document.getElementById("register-body").innerHTML = html;
  // the milestones table, taken straight from the rulebook (§2)
  const ms = document.querySelector("#rb-2 .rb-milestones");
  const slot = document.querySelector("#register-body .ms-slot");
  if (ms && slot) slot.appendChild(ms.closest(".rb-table-wrap").cloneNode(true));
}

// printing the page (e.g. "Save as PDF") → a sensible file name instead of the page/browser title
let titleBeforePrint = document.title;
window.addEventListener("beforeprint", () => { titleBeforePrint = document.title; document.title = "GPPL Rulebook – Season 1"; });
window.addEventListener("afterprint", () => { document.title = titleBeforePrint; });

// ---------- Rulebook: rule numbers (1.1, 1.2, …) and contents ----------
document.querySelectorAll(".rb-ch").forEach(ch => {
  ch.querySelectorAll(".rb-rules > li").forEach((li, i) => (li.dataset.n = `${ch.dataset.ch}.${i + 1}`));
});
document.querySelectorAll(".rb-toc [data-goto]").forEach(btn => btn.addEventListener("click", () => {
  document.getElementById(btn.dataset.goto).scrollIntoView({ behavior: "smooth", block: "start" });
}));

// Cross-references in the rule text ("§5", "§1.6") become links to that chapter / rule
(function linkRuleRefs() {
  const body = document.querySelector(".rb-body");
  if (!body) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (/§\d/.test(n.nodeValue) && !n.parentElement.closest("h3, .rb-ref")
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const frag = document.createDocumentFragment();
    let last = 0;
    node.nodeValue.replace(/§(\d+)(?:\.(\d+))?/g, (m, ch, rule, i) => {
      frag.appendChild(document.createTextNode(node.nodeValue.slice(last, i)));
      const a = document.createElement("a");
      a.href = "#rules";
      a.className = "rb-ref";
      a.textContent = m;
      a.dataset.ref = rule ? `${ch}.${rule}` : ch;
      frag.appendChild(a);
      last = i + m.length;
      return m;
    });
    frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
    node.replaceWith(frag);
  });
  body.addEventListener("click", e => {
    const a = e.target.closest(".rb-ref");
    if (!a) return;
    e.preventDefault();
    const target = a.dataset.ref.includes(".")
      ? body.querySelector(`.rb-rules > li[data-n="${a.dataset.ref}"]`)
      : document.getElementById(`rb-${a.dataset.ref}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: a.dataset.ref.includes(".") ? "center" : "start" });
    target.classList.remove("rb-flash");
    void target.offsetWidth;
    target.classList.add("rb-flash");
  });
})();
// highlight the chapter currently being read: the last one whose heading has reached the top area
const rbChapters = [...document.querySelectorAll(".rb-ch")];
const rbTocBtns = [...document.querySelectorAll(".rb-toc [data-goto]")];
function updateRulebookToc() {
  if (!document.getElementById("rules").classList.contains("active")) return;
  let current = rbChapters[0];
  rbChapters.forEach(ch => { if (ch.getBoundingClientRect().top <= 140) current = ch; });
  rbTocBtns.forEach(b => b.classList.toggle("active", b.dataset.goto === current.id));
}
window.addEventListener("scroll", updateRulebookToc, { passive: true });

// ---------- tabs ----------
// ---------- visible tabs (pre-season: only some) ----------
const visibleTabs = Array.isArray(LEAGUE.visibleTabs) && LEAGUE.visibleTabs.length ? LEAGUE.visibleTabs : null;
const tabAllowed = id => !visibleTabs || visibleTabs.includes(id) || id === "admin";
if (visibleTabs) {
  const nav = document.getElementById("nav");
  const links = [...nav.querySelectorAll("a")];
  links.forEach(a => a.remove());
  visibleTabs.forEach(id => { const a = links.find(l => l.getAttribute("href") === "#" + id); if (a) nav.appendChild(a); });
  // links in the text to hidden tabs (e.g. "Schedule tab" in the rulebook) become plain text
  document.querySelectorAll('main a[href^="#"]').forEach(a => {
    const id = a.getAttribute("href").slice(1);
    if (id && !tabAllowed(id) && !a.classList.contains("rb-ref")) a.replaceWith(document.createTextNode(a.textContent));
  });
}
// the menu stays hidden until updateMenu has sorted out Schedule / Register / Participants (no flash of tabs)
{ const s = document.querySelector('#nav a[href="#schedule"]'); if (s) s.hidden = !LEAGUE.scheduleVisible; }
setTimeout(() => document.documentElement.classList.add("tabs-ready"), 3000); // in case the data never arrives

function showTab() {
  let id = (location.hash || "#" + (visibleTabs ? visibleTabs[0] : "home")).slice(1);
  if (!tabAllowed(id) || !document.getElementById(id) || (id === "register" && registrationOver())) {
    id = visibleTabs ? visibleTabs[0] : "home";
    history.replaceState(null, "", "#" + id);
  }
  document.querySelectorAll("main > section").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", showTab);

// keep the embedded admin pages (Draw / Admin tabs) as tall as their content
setInterval(() => {
  document.querySelectorAll("iframe.admin-frame").forEach(frame => {
    if (!frame.offsetParent) return;
    try {
      const h = frame.contentDocument.documentElement.scrollHeight;
      if (h && Math.abs(frame.offsetHeight - h) > 4) frame.style.height = Math.max(h, 720) + "px";
    } catch {}
  });
}, 500);

// Data just saved in Admin. GitHub Pages needs ~1 minute to publish a change,
// so for 3 minutes the saved version wins over the (possibly older) published file.
const justSaved = {};
const FRESH_MS = 3 * 60 * 1000;

async function loadData() {
  const pick = async (key, fallback) => {
    const fetched = await STORE.load(key, fallback);
    const s = justSaved[key];
    return s && Date.now() - s.t < FRESH_MS ? s.data : fetched;
  };
  results = await pick("results", []);
  cup = await pick("cup", { rounds: [] });
  if (!cup.rounds) cup.rounds = [];
  settings = await pick("settings", {});
  gallery = await pick("gallery", []);
}

// GPPL logo in the header: still by default, animates on hover / tap
// (Admin → Pairs → GPPL logo can switch it to "always")
const siteLogo = (() => {
  const img = document.getElementById("site-logo");
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let always = false, playing = false;
  const set = on => { playing = on; img.src = on || always ? img.dataset.anim : img.dataset.still; };
  img.addEventListener("mouseenter", () => !reduce && set(true));
  img.addEventListener("mouseleave", () => set(false));
  img.addEventListener("click", () => !reduce && set(!playing));
  window.addEventListener("load", () => { new Image().src = img.dataset.anim; });
  return { apply() { always = settings.siteLogoAnimation === "always" && !reduce; set(playing); } };
})();

// once registration is closed, Register and Participants leave the menu (the pages still open from links)
function registrationOver() {
  const reg = { ...LEAGUE.registration, ...(settings.registration || {}) };
  // …also once the league start date is set (the season is on)
  return (reg.status || (reg.open ? "open" : "soon")) === "closed" || !!LEAGUE.scheduleVisible;
}
function updateMenu() {
  const closed = registrationOver();
  if (closed && location.hash === "#register") location.hash = "#home"; // Register is gone – Participants still opens from Home
  // Participants only leaves the menu where Home links to it
  ["register", ...(tabAllowed("home") ? ["participants"] : [])].forEach(id => {
    const a = document.querySelector(`#nav a[href="#${id}"]`);
    if (a) a.hidden = closed;
  });
  // the Schedule tab appears once the league start date is set (Admin → League results)
  const sched = document.querySelector('#nav a[href="#schedule"]');
  if (sched) sched.hidden = !LEAGUE.scheduleVisible;
  if (!LEAGUE.scheduleVisible && location.hash === "#schedule") location.hash = "#" + (visibleTabs ? visibleTabs[0] : "home");
  document.documentElement.classList.add("tabs-ready");
}

function renderData() {
  // a start date saved in Admin moves every matchday date at once (the schedule only once it's released)
  if (settings.scheduleReleased) LEAGUE.scheduleReleased = true;
  GPPL.setStartDate(settings.startDate);
  datesOn = LEAGUE.datesConfirmed;
  siteLogo.apply();
  updateMenu();
  renderHome();
  renderSchedule();
  renderStandings();
  renderCup();
  renderVerifySelect();
  renderRegister();
  renderParticipants();
}

async function refresh() {
  await loadData();
  renderData();
}

// saved in the Admin tab (iframe) → update right away
window.addEventListener("message", e => {
  if (e.origin !== location.origin || !e.data || e.data.gppl !== "data-changed") return;
  justSaved[e.data.key] = { data: e.data.data, t: Date.now() };
  if (e.data.key === "results") results = e.data.data;
  if (e.data.key === "cup") cup = e.data.data;
  if (e.data.key === "settings") settings = e.data.data;
  renderData();
});
// saved in another browser tab → reload
window.addEventListener("storage", e => { if (e.key === "gppl-changed") refresh(); });
// switching tabs on the website → pick up the latest data
window.addEventListener("hashchange", () => { if (location.hash !== "#admin") refresh(); });

async function init() {
  showTab();
  renderGallery();
  renderParticipants();
  await refresh();
}
init();
