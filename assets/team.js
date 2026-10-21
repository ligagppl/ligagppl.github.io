// ============================================================
//  My team (member area): teams log in with their team code,
//  schedule their matches, enter results with the matchday photo
//  and confirm or dispute their opponent's result.
//  All changes go through the GPPL gatekeeper (LEAGUE.memberApi).
// ============================================================

(function teamArea() {
  const el = document.getElementById("team-body");
  if (!el) return;
  const TOKEN_KEY = "gppl-team-token";
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };
  // localStorage "gppl-member-api" overrides the address for local testing
  const api = () => (ls.get("gppl-member-api") || LEAGUE.memberApi || "").replace(/\/+$/, "");

  let state = null;   // data from /me
  let form = null;    // "<key>|schedule", "<key>|result" or "<key>|dispute"
  let msg = null;     // { key, text, ok }
  let loading = false;
  const photos = {};  // key → object URL of a loaded photo

  async function call(path, body) {
    const token = ls.get(TOKEN_KEY);
    const res = await fetch(api() + path, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (path === "/photo" || path.startsWith("/photo?")) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/login") { ls.set(TOKEN_KEY, null); state = null; }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function load() {
    if (!api()) { el.innerHTML = `<div class="card muted">The member area isn't open yet.</div>`; return; }
    if (!ls.get(TOKEN_KEY)) { state = null; return render(); }
    loading = true; render();
    try { state = await call("/me"); } catch (e) { msg = { key: "top", text: e.message, ok: false }; }
    loading = false; render();
  }

  // ---------------------------------------------------------------- helpers

  const pairOf = id => (state && state.pairs.find(x => x.id === id)) || { id, name: `#${id}`, players: [] };
  const teamName = id => pairOf(id).name;
  const players = id => (pairOf(id).players || []).filter(Boolean).map(esc).join(" & ");
  // still logo of a team (a ball for teams without one yet)
  function logo(id, cls = "tm-logo") {
    const l = (LEAGUE.logos || {})[teamName(id)];
    const src = l && (typeof l === "string" ? l : l.src);
    return src ? `<img class="${cls}" src="${esc(src)}" alt="">` : `<span class="${cls} ph" aria-hidden="true">🎾</span>`;
  }
  const teamCell = id => `<span class="tm-tc">${logo(id, "tm-logo-sm")}<span class="tm-tn">${esc(teamName(id))}</span></span>`;
  // score table like in Admin: one row per team, one column per set (my team first)
  function board(m, sets) {
    const labels = ["Set 1", "Set 2", m.fullSets ? "Set 3" : "Tie-break"].slice(0, Math.max(2, sets ? sets.length : 3));
    const cell = (i, side) => sets ? `<span class="tm-g ${sets[i] && sets[i][side] > sets[i][1 - side] ? "win" : ""}">${sets[i] ? sets[i][side] : ""}</span>`
      : `<input type="number" inputmode="numeric" min="0" max="${i === 2 && !m.fullSets ? 99 : 7}" name="s${i}${side ? "b" : "a"}" aria-label="${labels[i]} – ${esc(teamName(side ? m.opp : state.team))}">`;
    return `<div class="tm-board" style="--sets:${labels.length}"><span></span>${labels.map(l => `<span class="tm-bh">${l}</span>`).join("")}
      ${teamCell(state.team)}${labels.map((_, i) => cell(i, 0)).join("")}
      ${teamCell(m.opp)}${labels.map((_, i) => cell(i, 1)).join("")}</div>`;
  }
  const linkHtml = link => link && /^https:\/\/[^/]*playtomic\.(io|com)\//.test(link) ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Playtomic ↗</a>` : "";
  const dayText = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  // sets as seen by my team: [my games, their games]
  const mine = (sets, a) => (state.team === a ? sets : sets.map(([x, y]) => [y, x]));
  const scoreText = (sets, fullSets) => sets.map(([x, y], i) => (i === 2 && !fullSets ? `[${x}-${y}]` : `${x}-${y}`)).join(" ");
  const won = sets => sets.filter(([x, y]) => x > y).length >= 2;

  // my matches: league (by matchday) and cup
  function myMatches() {
    const me = state.team, list = [];
    GPPL.fixtures.forEach((games, i) => games.forEach(([a, b]) => {
      if (a !== me && b !== me) return;
      const [x, y] = a < b ? [a, b] : [b, a];
      const win = GPPL.matchdayWindow(i + 1);
      list.push({ key: `L:${x}-${y}`, a: x, b: y, opp: a === me ? b : a, fullSets: false, group: "league",
        label: `Matchday ${i + 1}` + (LEAGUE.datesConfirmed !== false ? ` · ${GPPL.fmt(win.from)} – ${GPPL.fmt(win.to)}` : ""),
        official: GPPL.findResult(state.results, x, y) });
    }));
    (state.cup.rounds || []).forEach((r, ri) => (r.matches || []).forEach((m, mi) => {
      if (m.a !== me && m.b !== me) return;
      list.push({ key: `C:${ri}:${mi}`, a: m.a, b: m.b, opp: m.a === me ? m.b : m.a, group: "cup", label: `GPPC Cup · ${r.name}`,
        fullSets: r.name === "Semi-finals" || r.name === "Final", official: m.sets || m.walkover || m.winner ? m : null });
    }));
    return list;
  }

  function status(m) {
    const p = (state.matches[m.key] || {}).pending;
    if (m.official) return { cls: "done", text: "✅ Played" };
    if (p && p.status === "disputed") return { cls: "disputed", text: "❗ Disputed" };
    if (p && p.by !== state.team) return { cls: "action", text: "⚠️ Please confirm" };
    if (p) return { cls: "waiting", text: "⏳ Waiting for confirmation" };
    if ((state.matches[m.key] || {}).date) return { cls: "scheduled", text: "📅 Scheduled" };
    return { cls: "open", text: "Open" };
  }

  // ---------------------------------------------------------------- views

  function render() {
    if (!api()) return;
    if (!state && !loading) {
      el.innerHTML = `<div class="card tm-login">
        <p>Log in with the <b>team code</b> the organizers sent you on WhatsApp. Both players of a team use the same code.</p>
        <form id="tm-login"><input id="tm-code" autocomplete="off" autocapitalize="characters" placeholder="e.g. K7PM-Q2XD" maxlength="12">
        <button class="btn" type="submit">Log in</button></form>
        ${msgHtml("top")}</div>`;
      return;
    }
    if (!state) { el.innerHTML = `<div class="card muted">Loading…</div>`; return; }
    const pair = state.pairs.find(p => p.id === state.team) || { name: `#${state.team}`, players: [] };
    const matches = myMatches();
    const todo = matches.filter(m => status(m).cls === "action");
    el.innerHTML = `<div class="card tm-me"><div class="tm-me-id">${logo(state.team, "tm-logo-lg")}<div><b class="tm-team">${esc(pair.name)}</b>
        <span class="muted">${players(state.team)}</span></div></div>
        <div class="tm-me-btns"><button class="btn ghost small" data-act="reload">↻ Refresh</button><button class="btn ghost small" data-act="logout">Log out</button></div></div>
      ${msgHtml("top")}
      ${todo.length ? `<h3>⚠️ Waiting for you</h3>` + todo.map(card).join("") : ""}
      <h3>🏆 GPPC Cup</h3>${matches.filter(m => m.group === "cup" && !todo.includes(m)).map(card).join("") || `<div class="card muted">No cup match for you right now.</div>`}
      <h3>📅 League</h3>${matches.filter(m => m.group === "league" && !todo.includes(m)).map(card).join("") || `<div class="card muted">The league schedule appears here after the draw.</div>`}
      <p class="note">Results count once your opponent confirms them – or automatically after 48 hours. If something is wrong, tap “Dispute” and the organizers decide.</p>`;
  }

  function msgHtml(key) {
    return msg && msg.key === key ? `<div class="msg ${msg.ok ? "" : "err"}">${msg.ok ? "✅ " : "❌ "}${esc(msg.text)}</div>` : "";
  }

  function card(m) {
    const entry = state.matches[m.key] || {}, p = entry.pending, st = status(m);
    let body = "";
    if (m.official) {
      if (m.official.walkover) body = `<p>Decided by walkover (organizers).</p>`;
      else { const s = mine(m.official.sets, m.official.a); body = board(m, s) + `<p class="tm-score">${won(s) ? "🏆 Won" : "Lost"}${linkHtml(m.official.link)}</p>`; }
    } else if (p) {
      const s = mine(p.sets, p.a), txt = `<b>${scoreText(s, m.fullSets)}</b> (${won(s) ? "your team won" : "your team lost"})`;
      body = board(m, s) + (p.link ? `<p class="note">${linkHtml(p.link)}</p>` : "");
      if (p.status === "disputed") body += `<p>This result was disputed. The organizers will decide.</p>` +
        (state.notes && state.notes[m.key] ? `<p class="note">“${esc(state.notes[m.key])}”</p>` : "");
      else if (p.by === state.team) body += `<p>You entered ${txt}. ${esc(teamName(m.opp))} has 48 hours to confirm – after that it counts automatically.</p>
        <div class="tm-btns"><button class="btn ghost small" data-act="withdraw" data-key="${m.key}">Withdraw & correct</button>${photoBtn(m.key)}</div>`;
      else body += `<div class="tm-ask"><p><b>${esc(teamName(m.opp))}</b> entered ${txt}.<br><b>Is that right?</b></p>
        <div class="tm-btns"><button class="btn" data-act="confirm" data-key="${m.key}">✅ Yes, confirm</button>
        <button class="btn ghost" data-act="form" data-form="${m.key}|dispute">❌ No, dispute</button>${photoBtn(m.key)}</div></div>` +
        (form === `${m.key}|dispute` ? `<form class="tm-form" data-submit="dispute" data-key="${m.key}">
          <label>What is wrong?<textarea name="note" maxlength="500" required placeholder="e.g. Set 2 was 6-4 for us"></textarea></label>
          <button class="btn small" type="submit">Send to the organizers</button></form>` : "");
    } else {
      const when = entry.date ? `<p class="tm-when">📅 ${dayText(entry.date)}${entry.time ? " · " + esc(entry.time) : ""}${entry.court ? ` · 📍 ${esc(entry.court)}` : ""}</p>` : "";
      body = when + `<div class="tm-btns"><button class="btn ghost small" data-act="form" data-form="${m.key}|schedule">${entry.date ? "Change date" : "Set date"}</button>
        ${entry.date ? `<button class="btn small" data-act="form" data-form="${m.key}|result">Enter result</button>` : ""}</div>`;
      if (form === `${m.key}|schedule`) body += `<form class="tm-form" data-submit="schedule" data-key="${m.key}">
        <div class="tm-row"><label>Date<input type="date" name="date" value="${esc(entry.date || "")}"></label>
        <label>Time<input type="time" name="time" value="${esc(entry.time || "")}"></label></div>
        <label>Court / venue<input name="court" maxlength="80" value="${esc(entry.court || "")}" placeholder="e.g. Padel City, court 3"></label>
        <button class="btn small" type="submit">Save</button> <span class="note">Visible to both teams. Leave everything empty to clear.</span></form>`;
      if (form === `${m.key}|result` && entry.date) body += resultForm(m);
    }
    if (photos[m.key]) body += `<img class="tm-photo" src="${photos[m.key]}" alt="Matchday photo">`;
    return `<div class="card tm-match st-${st.cls}">
      <div class="tm-head"><span class="tm-label">${esc(m.label)}</span><span class="tm-chip">${st.text}</span></div>
      <div class="tm-vs">${logo(m.opp)}<div><b>${esc(teamName(m.opp))}</b><span class="tm-players">${players(m.opp)}</span></div></div>
      ${body}${msgHtml(m.key)}</div>`;
  }

  function photoBtn(key) { return `<button class="btn ghost small" data-act="photo" data-key="${key}">📷 Photo</button>`; }

  function resultForm(m) {
    return `<form class="tm-form" data-submit="result" data-key="${m.key}">
      <div><b>Score</b>${board(m)}</div>
      <p class="note">${m.fullSets ? "Semi-finals and final: 3 full sets." : "Leave the tie-break empty if the match ended 2–0. Match tie-break: first to 10, win by 2."}</p>
      <label>Matchday photo (all 4 players)<input type="file" name="photo" accept="image/*" required></label>
      <label>Playtomic link <span class="note">optional – the match on Playtomic</span><input type="url" name="link" inputmode="url" placeholder="https://app.playtomic.io/…"></label>
      <button class="btn small" type="submit">Submit result</button></form>`;
  }

  // ---------------------------------------------------------------- actions

  // shrink the photo in the browser (max 1600 px, JPEG) before uploading
  async function compress(file) {
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) throw new Error("Could not read this photo – please try another one (JPEG or PNG).");
    const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }

  async function act(key, fn, okText) {
    msg = null;
    try {
      await fn();
      form = null;
      state = await call("/me");
      msg = { key, text: okText, ok: true };
    } catch (e) { msg = { key, text: e.message, ok: false }; }
    render();
  }

  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const key = b.dataset.key, a = b.dataset.act;
    if (a === "logout") { ls.set(TOKEN_KEY, null); state = null; msg = null; return render(); }
    if (a === "reload") { msg = null; return load(); }
    if (a === "form") { form = form === b.dataset.form ? null : b.dataset.form; msg = null; return render(); }
    if (a === "photo") {
      if (photos[key]) { URL.revokeObjectURL(photos[key]); delete photos[key]; return render(); }
      const res = await call(`/photo?key=${encodeURIComponent(key)}`);
      if (res.ok) photos[key] = URL.createObjectURL(await res.blob()); else msg = { key, text: "No photo found.", ok: false };
      return render();
    }
    b.disabled = true;
    if (a === "confirm") return act(key, () => call("/confirm", { key }), "Result confirmed – thanks!");
    if (a === "withdraw" && confirm("Withdraw your result? You can then enter it again.")) return act(key, () => call("/withdraw", { key }), "Result withdrawn.");
    b.disabled = false;
  });

  el.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, key = f.dataset.key, kind = f.dataset.submit || f.id;
    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    if (kind === "tm-login") {
      msg = null;
      try {
        const r = await call("/login", { code: document.getElementById("tm-code").value });
        ls.set(TOKEN_KEY, r.token);
        return load();
      } catch (err) { msg = { key: "top", text: err.message, ok: false }; return render(); }
    }
    const v = n => (f.elements[n] ? f.elements[n].value.trim() : "");
    if (kind === "schedule") return act(key, () => call("/schedule", { key, date: v("date"), time: v("time"), court: v("court") }), "Saved.");
    if (kind === "dispute") return act(key, () => call("/dispute", { key, note: v("note") }), "Sent – the organizers will decide.");
    if (kind === "result") {
      return act(key, async () => {
        const sets = [];
        for (let i = 0; i < 3; i++) {
          const x = v(`s${i}a`), y = v(`s${i}b`);
          if (x === "" && y === "") continue;
          if (x === "" || y === "") throw new Error(`Set ${i + 1} is incomplete.`);
          sets.push([+x, +y]);
        }
        const file = f.elements.photo.files[0];
        if (!file) throw new Error("Please add the matchday photo.");
        await call("/result", { key, sets, link: v("link"), photo: await compress(file) });
      }, "Result sent – your opponent now confirms it.");
    }
  });

  window.addEventListener("hashchange", () => { if (location.hash === "#team") load(); });
  if (location.hash === "#team") load();
})();
