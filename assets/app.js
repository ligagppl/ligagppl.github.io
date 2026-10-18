// GPPL website – reads settings from data.js and results/cup from /data/*.json

const { pairById, pairName, fmt, matchdayWindow, fixtures, DAY, start } = GPPL;
let results = [], cup = { rounds: [] };

const sign = n => (n > 0 ? "+" + n : String(n));
const datesOn = LEAGUE.datesConfirmed !== false; // dates hidden until the start date is fixed

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
    html += `<tr class="${i < 2 ? "top" : ""}"><td>${i + 1}</td>
      <td class="left"><b>${pairName(r.id)}</b><br><span class="note">${pairById[r.id].players.join(" & ")}</span></td>
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
  return `<div class="match"><span class="a ${wa}">${pairName(a)}</span>
    <span class="score">${score}</span><span class="${wb}">${pairName(b)}</span></div>`;
}

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
      ${games.map(([a, b]) => matchRow(a, b)).join("")}${ms}</div>`;
  }).join("");
}

function renderHome() {
  const total = fixtures.reduce((n, g) => n + g.length, 0);
  const last = matchdayWindow(fixtures.length).to;
  const leader = GPPL.rankStandings(results)[0];
  document.getElementById("home-stats").innerHTML = `
    <div class="card"><div class="note">Pairs</div><div style="font-size:1.8rem;font-weight:700">${LEAGUE.pairs.length}</div></div>
    <div class="card"><div class="note">Matches played</div><div style="font-size:1.8rem;font-weight:700">${results.length} / ${total}</div></div>
    <div class="card"><div class="note">Season</div><div style="font-size:1.1rem;font-weight:700">${datesOn ? `${fmt(start)} – ${fmt(last)}` : "Dates follow"}</div></div>
    <div class="card"><div class="note">Leader</div><div style="font-size:1.1rem;font-weight:700">${results.length ? pairName(leader.id) : "–"}</div></div>`;
  const cur = currentMatchday();
  const md = cur || (Date.now() < start.getTime() ? 1 : fixtures.length);
  const label = cur ? "Current" : md === 1 ? "First" : "Last";
  const { from, to } = matchdayWindow(md);
  document.getElementById("home-next").innerHTML =
    `<h3 style="margin-top:0">${label} matchday: ${md} ${datesOn ? `<span class="note">(${fmt(from)} – ${fmt(to)})</span>` : ""}</h3>` +
    fixtures[md - 1].map(([a, b]) => matchRow(a, b)).join("");
}

function renderCup() {
  const el = document.getElementById("cup-rounds");
  if (!cup.rounds.length) {
    el.innerHTML = `<div class="card muted">The cup draw hasn't happened yet – it starts in the second half of the league.</div>`;
    return;
  }
  const ns = GPPL.cupNextStage(cup);
  const champ = ns.type === "done"
    ? `<div class="card" style="text-align:center"><div style="font-size:2rem">🏆</div><h3 style="margin:4px 0">GPPC Cup champions</h3><div style="font-size:1.3rem;font-weight:800">${pairName(ns.champion)}</div></div>` : "";
  const seedLine = (r, i) => r.words
    ? `<p class="note">🔐 Seed words: “${r.words}” · <a href="#verify" data-verify="${i}">Verify</a></p>` : "";
  el.innerHTML = champ + `<div class="bracket">` + cup.rounds.map((r, ri) => {
    if (r.type === "lucky") {
      return `<div class="card"><h3 style="margin-top:0">🍀 ${r.name}</h3><p>Back in the cup: <b>${r.lucky.map(pairName).join(", ")}</b></p>${seedLine(r, ri)}</div>`;
    }
    return `<div class="card"><h3 style="margin-top:0">${r.name}</h3>
      ${r.matches.map(m => {
        const w = GPPL.cupWinner(m);
        const score = m.walkover === "both" ? "W/O – both out" : m.walkover ? "W/O" : m.sets && m.sets.length ? GPPL.scoreText(m, m.a, false) : "";
        return `<div class="cupmatch">
          <div><span class="${w === m.a ? "w" : ""}">${pairName(m.a)}</span><span class="note">${score}</span></div>
          <div><span class="${w === m.b ? "w" : ""}">${pairName(m.b)}</span></div></div>`;
      }).join("")}
      ${r.byes && r.byes.length ? `<p class="note">Bye: ${r.byes.map(pairName).join(", ")}</p>` : ""}
      ${seedLine(r, ri)}
    </div>`;
  }).join("") + `</div>`;
}

// ---------- Verify draw ----------
const verifiableRounds = () => cup.rounds.map((r, i) => ({ r, i })).filter(x => x.r.words);
let verifyPick = null; // round index chosen via a "Verify" link on the cup tab

function renderVerifySelect() {
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

document.getElementById("v-round").addEventListener("change", () => fillVerifyForm(true));
document.getElementById("v-type").addEventListener("change", () => {
  document.getElementById("v-lucky-row").hidden = document.getElementById("v-type").value !== "lucky";
});
document.getElementById("v-run").addEventListener("click", runVerify);
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

function renderGallery() {
  const el = document.getElementById("gallery-grid");
  if (!LEAGUE.gallery.length) {
    el.innerHTML = `<div class="card muted">Photos will appear here during the season 📸</div>`;
    return;
  }
  el.innerHTML = `<div class="gallery">` + LEAGUE.gallery.map(g =>
    `<figure><img src="${g.src}" alt="${g.caption || ""}" loading="lazy"><figcaption>${g.caption || ""}</figcaption></figure>`).join("") + `</div>`;
}

// registration settings come from data/settings.json (Admin → Registration), fallback data.js
let settings = {};
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderRegister() {
  const reg = { ...LEAGUE.registration, ...(settings.registration || {}) };
  const status = reg.status || (reg.open ? "open" : "soon");
  const banner = {
    soon: `<div class="reg-banner soon"><b>Registration opens soon</b><span>Watch the GPPL WhatsApp group 📲</span></div>`,
    open: `<div class="reg-banner open"><b>Registration is open</b><span>Deadline: ${esc(reg.deadline)}</span></div>`,
    closed: `<div class="reg-banner closed"><b>Registration is closed</b><span>Thanks to everyone who registered – see you on court!</span></div>`,
  }[status] || "";
  let html = banner + `<div class="card">
    <p><b>Registration deadline:</b> ${esc(reg.deadline)}<br><b>Entry fee:</b> ${esc(reg.fee)}</p>
    <p class="note">${status === "open" && reg.paymentUrl ? "" : esc(reg.paymentNote) + " "}A registration only counts once it's paid – the time of payment is the time of registration.
    Places are first come, first served – one organizer pair may be exempt from this.</p></div>`;
  if (status === "open" && reg.paymentUrl) {
    html += `<div class="card pay-card"><div><b>Entry fee: ${esc(reg.fee)}</b><span class="note">${esc(reg.paymentNote)}</span></div>
      <a class="btn" href="${esc(reg.paymentUrl)}" target="_blank" rel="noopener">Pay via PayPal pool</a></div>`;
  }
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
function showTab() {
  const id = (location.hash || "#home").slice(1);
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
}

function renderData() {
  renderHome();
  renderSchedule();
  renderStandings();
  renderCup();
  renderVerifySelect();
  renderRegister();
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
  await refresh();
}
init();
