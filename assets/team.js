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
  let view = "team";  // "team" or "upcoming" (all teams' scheduled matches)
  let upTeam = null;  // Upcoming matches: only this team's matches (null = all)
  let upPaneOpen = false; // the "Filter by team" pane
  const photos = {};  // key → object URL of a loaded photo
  const matchImgs = {}; // key → image of a scheduled match (made once – Safari shares on the next tap)

  async function call(path, body) {
    const token = ls.get(TOKEN_KEY);
    let res;
    try {
      res = await fetch(api() + path, {
        method: body ? "POST" : "GET",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // the request never reached the gatekeeper ("Failed to fetch" / "Load failed")
      throw new Error("Can't reach the GPPL server from this device. Something here is probably blocking it – e.g. a company laptop or network, a VPN, an ad blocker or a privacy extension. Try another browser or network (e.g. your phone's hotspot), or use your phone.");
    }
    if (path === "/photo" || path.startsWith("/photo?")) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/login") { ls.set(TOKEN_KEY, null); state = null; }
    if (!res.ok) { const err = new Error(data.error || `Error ${res.status}`); err.needsRules = !!data.needsRules; throw err; }
    return data;
  }

  async function load() {
    if (!api()) { el.innerHTML = `<div class="card muted">The member area isn't open yet.</div>`; return; }
    if (!ls.get(TOKEN_KEY)) { state = null; return render(); }
    loading = true; render();
    Object.keys(matchImgs).forEach(k => delete matchImgs[k]);
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
  const teamCell = (id, us) => `<span class="tm-tc">${logo(id, "tm-logo-sm")}<span class="tm-tn">${esc(teamName(id))}${us ? ` <span class="tm-us">(Us)</span>` : ""}</span></span>`;
  // score table like in Admin: one row per team, one column per set (my team first)
  function board(m, sets) {
    const labels = ["Set 1", "Set 2", m.fullSets ? "Set 3" : "Tie-break"].slice(0, Math.max(2, sets ? sets.length : 3));
    const at = (row, col) => `style="grid-row:${row};grid-column:${col}"`;
    const cell = (i, side) => sets
      ? `<span class="tm-g ${sets[i] && sets[i][side] > sets[i][1 - side] ? "win" : ""}" ${at(side + 2, i + 2)}>${sets[i] ? sets[i][side] : ""}</span>`
      : `<input type="number" inputmode="numeric" min="0" max="${i === 2 && !m.fullSets ? 99 : 7}" name="s${i}${side ? "b" : "a"}" ${at(side + 2, i + 2)}
          aria-label="${labels[i]} – ${esc(teamName(side ? m.opp : state.team))}">`;
    // set by set (us, them, next set …) so the tab key goes down each column, like in Admin
    return `<div class="tm-board" style="--sets:${labels.length}">
      ${labels.map((l, i) => `<span class="tm-bh" ${at(1, i + 2)}>${l}</span>`).join("")}
      <span ${at(2, 1)}>${teamCell(state.team, true)}</span><span ${at(3, 1)}>${teamCell(m.opp)}</span>
      ${labels.map((_, i) => cell(i, 0) + cell(i, 1)).join("")}</div>`;
  }
  const linkHtml = link => link && /^https:\/\/[^/]*playtomic\.(io|com)\//.test(link) ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Playtomic ↗</a>` : "";
  const mapsUrl = place => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  // days until a date: "today", "tomorrow", "in 6 days"
  const inDays = d => { const n = Math.round((new Date(d + "T12:00:00") - new Date(new Date().toDateString() + " 12:00")) / 864e5); return n === 0 ? "<b>today</b>" : n === 1 ? "<b>tomorrow</b>" : `in ${n} days`; };
  const dayText = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // result deadlines (Rules §11): 48 hours after the booked time to enter the result, then 48 hours to confirm
  const H48 = 48 * 3600000;
  const matchStart = e => (e && e.date && e.time ? new Date(`${e.date}T${e.time}:00`).getTime() : null);
  const matchEnd = e => (e && e.date && e.time ? new Date(`${e.date}T${e.time}:00`).getTime() + (+e.duration || 90) * 60000 : null);
  const liveNow = e => !!(e && e.time) && new Date(`${e.date}T${e.time}:00`).getTime() <= Date.now() && Date.now() < matchEnd(e);
  const two = n => String(n).padStart(2, "0");
  const leftText = ms => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h ${two(m)}m` : `${h}h ${two(m)}m ${two(sec)}s`; };
  // a line with the time left, kept live by the timer below (data-due = deadline, data-what = text before the time)
  function dueLine(due, what, over) {
    return `<p class="tm-due" data-due="${due}" data-what="${esc(what)}" data-over="${esc(over)}">${dueText(due, what, over)}</p>`;
  }
  function dueText(due, what, over) {
    const ms = due - Date.now();
    return ms <= 0 ? over : `${ms < 12 * 3600000 ? "🟠" : "⏱"} ${what} <b>${leftText(ms)} left</b>`;
  }
  setInterval(() => document.querySelectorAll(".tm-due[data-due]").forEach(x => {
    const t = dueText(+x.dataset.due, x.dataset.what, x.dataset.over);
    if (x.innerHTML !== t) x.innerHTML = t; // only the countdown lines, and only when the text changes
  }), 1000);
  // Upcoming matches: redraw when a match starts (🔴 live) or ends (drops off the list) – no reload needed
  let upPhase = "";
  setInterval(() => {
    if (!state || view !== "upcoming") return;
    const sig = upcomingList().map(x => x.key + (liveNow(x.e) ? "*" : "")).join();
    if (upPhase && sig !== upPhase) render();
    upPhase = sig;
  }, 15000);
  // sets as seen by my team: [my games, their games]
  const mine = (sets, a) => (state.team === a ? sets : sets.map(([x, y]) => [y, x]));
  const scoreText = (sets, fullSets) => sets.map(([x, y], i) => (i === 2 && !fullSets ? `[${x}-${y}]` : `${x}-${y}`)).join(" ");
  const won = sets => sets.filter(([x, y]) => x > y).length >= 2;

  // my matches: league (by matchday) and cup
  function myMatches() {
    const me = state.team, list = [];
    // the league schedule stays private until the organizers publish it
    if (LEAGUE.scheduleReleased !== false) GPPL.fixtures.forEach((games, i) => games.forEach(([a, b]) => {
      if (a !== me && b !== me) return;
      const [x, y] = a < b ? [a, b] : [b, a];
      const win = GPPL.matchdayWindow(i + 1);
      list.push({ key: `L:${x}-${y}`, a: x, b: y, opp: a === me ? b : a, fullSets: false, group: "league", md: i + 1,
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
    const end = matchEnd(state.matches[m.key]);
    if (end && end <= Date.now()) return { cls: "action", text: "📝 Result due" };
    if (end) return { cls: "scheduled", text: "📅 Scheduled" };
    return { cls: "open", text: "Open" };
  }

  // ---------------------------------------------------------------- views

  function render() {
    updateNav();
    if (!api()) return;
    if (!state && !loading) {
      el.innerHTML = `<div class="card tm-login">
        <p>Log in with the <b>team code</b> the organizers sent you on WhatsApp. Both players of a team use the same code.</p>
        <p class="note">By logging in you accept the <a href="#rules">member area terms</a> (Rules §14) – don't share your code.</p>
        <form id="tm-login"><input id="tm-code" autocomplete="off" autocapitalize="characters" placeholder="e.g. K7PM-Q2XD" maxlength="12" value="${esc(typedCode)}">
        <button class="btn" type="submit">Log in</button></form>
        <div id="tm-turnstile"></div>
        ${msgHtml("top")}</div>`;
      mountTurnstile();
      return;
    }
    if (!state) { el.innerHTML = `<div class="card muted">Loading…</div>`; return; }
    const pair = state.pairs.find(p => p.id === state.team) || { name: `#${state.team}`, players: [] };
    // compulsory: the team agrees to the current rulebook (again after every change of the rules)
    // the gatekeeper decides (data/settings.json → rulesVersion); the version line on the Rules page is the fallback
    const rb = rulebook(state.rulesVersion);
    // "What changed" box from the Rules page – teams that agreed before can just read that
    const changes = (document.getElementById("rb-changes") || {}).innerHTML || "";
    if (state.needsRules || !state.rulesAccepted || (!state.rulesVersion && state.rulesAccepted.version !== rb.text)) {
      el.innerHTML = `<div class="card tm-me"><div class="tm-me-id">${logo(state.team, "tm-logo-lg")}<div><b class="tm-team">${esc(pair.name)}</b>
          <span class="muted">${players(state.team)}</span></div></div>
          <div class="tm-me-btns"><button class="btn ghost small" data-act="logout">Log out</button></div></div>
        <div class="card tm-rules"><h3 style="margin-top:0">📜 The rules</h3>
          <p>Rules last changed: <b>${esc(rb.date || "–")}</b>${rb.version ? ` (Version ${esc(rb.version)})` : ""}.
          ${state.rulesAccepted ? "The rules have changed since your team last agreed." : "Please read the rules before you continue."}
          <a href="#rules">📖 Read the rules</a></p>
          ${state.rulesAccepted && changes ? `<div class="rb-changes">${changes}<p class="note" style="margin:6px 0 0"><a href="#rules">📖 Open the rules</a> – the changes are listed at the top, with links to each rule.</p></div>` : ""}
          <form class="tm-form" data-submit="rules"><label class="tm-check"><input type="checkbox" name="ok" required>
            <span><b>We (${esc(pair.name)}) agree to all the rules.</b></span></label>
            <button class="btn" type="submit">Continue</button></form>${msgHtml("rules")}</div>`;
      return;
    }
    // sign-in only (before the season): teams log in once – the schedule follows later
    if (LEAGUE.memberMode === "signin") {
      el.innerHTML = `<div class="card tm-me"><div class="tm-me-id">${logo(state.team, "tm-logo-lg")}<div><b class="tm-team">${esc(pair.name)}</b>
          <span class="muted">${players(state.team)}</span></div></div>
          <div class="tm-me-btns"><button class="btn ghost small" data-act="logout">Log out</button></div></div>
        <div class="card tm-thanks"><h3 style="margin-top:0">✅ Thank you for signing in!</h3>
          <p>The schedule is <b>coming soon</b> – you'll set your match dates and enter your results right here.</p></div>`;
      return;
    }
    const matches = myMatches();
    const todo = matches.filter(m => status(m).cls === "action");
    el.innerHTML = `<div class="card tm-me"><div class="tm-me-id">${logo(state.team, "tm-logo-lg")}<div><b class="tm-team"><a class="team-link" href="${profileOf(state.team)}">${esc(pair.name)}</a></b>
        <span class="muted">${players(state.team)}</span></div></div>
        <div class="tm-me-btns"><a class="btn ghost small" href="${profileOf(state.team)}">👁 Public profile</a><button class="btn ghost small" data-act="reload">↻ Refresh</button><button class="btn ghost small" data-act="logout">Log out</button></div></div>
      <div class="tm-tabs" role="tablist"><button role="tab" data-act="view" data-view="team" class="${view === "team" ? "active" : ""}">🎾 My team</button><button role="tab" data-act="view" data-view="upcoming" class="${view === "upcoming" ? "active" : ""}">📅 Upcoming matches (${upcomingList().length})</button><button role="tab" data-act="view" data-view="courts" class="${view === "courts" ? "active" : ""}">🎾 Courts (${(state.slots || []).filter(c => !c.mine && !c.assigned && !c.taken).length})</button><button role="tab" data-act="view" data-view="gallery" class="${view === "gallery" ? "active" : ""}">📸 Gallery</button></div>
      ${view === "upcoming" ? upcomingHtml() : view === "gallery" ? galleryHtml() : view === "courts" ? courtsHtml() : `<div class="tm-overview">${standingHtml()}${cupStatusHtml()}</div>
      ${progressHtml()}
      ${msgHtml("top")}
      ${todo.length ? `<h3>⚠️ Waiting for you</h3>` + todo.map(card).join("") : ""}
      <h3>🏆 GPPC Cup</h3>${playedLast(matches.filter(m => m.group === "cup" && !todo.includes(m))).map(card).join("") || `<div class="card muted">No cup match for you right now.</div>`}
      <h3>📅 League</h3>${leagueCards(matches.filter(m => m.group === "league" && !todo.includes(m))) || `<div class="card muted">${LEAGUE.scheduleReleased === false ? "The league schedule appears here once it's published – coming soon." : "The league schedule appears here after the draw."}</div>`}
      <p class="note">Results count once your opponent confirms them – or automatically after 48 hours. If something is wrong, tap “Dispute” and the organizers decide.</p>`}`;
    if (view === "gallery") loadGalleryPhotos();
  }

  // 🎾 Courts: spare courts offered by teams – other teams request them, the organizers decide who gets each one
  function courtsHtml() {
    const all = state.slots || [];
    const when = c => `<span class="tm-up-when">📅 ${dayText(c.date)} · ${esc(GPPL.timeRange(c))} · ${inDays(c.date)} · 📍 <a href="${mapsUrl(c.court)}" target="_blank" rel="noopener">${esc(c.court)}</a></span>`;
    // only teams we haven't played (no result, none waiting) and haven't scheduled yet
    const open = myMatches().filter(m => { const e = state.matches[m.key] || {}; return !m.official && !e.pending && !e.date; });
    const matchName = key => { const m = myMatches().find(x => x.key === key); return m ? `${m.group === "cup" ? "GPPC Cup " + m.label.split(" · ")[1] : m.label.split(" · ")[0]} vs ${teamName(m.opp)}` : ""; };
    const row = (c, extra) => `<div class="tm-up">${when(c)}${extra}${msgHtml(c.id)}</div>`;
    const list = (title, items) => items.length ? `<h3>${title}</h3><div class="card tm-up-list">${items.join("")}</div>` : "";

    const mine = all.filter(c => c.assigned).map(c => row(c, `<span class="tm-up-label">✅ <b>This court is yours</b> – offered by ${esc(teamName(c.from))}${c.key ? ` · for ${esc(matchName(c.key))} (the match date is set)` : ""}</span>
      <div class="tm-btns"><button class="btn ghost small" data-act="slot-reoffer" data-key="${c.id}">↩ Can't use it – offer it again</button></div>`));
    const free = all.filter(c => !c.mine && !c.assigned && !c.taken).map(c => {
      const req = c.requested;
      const extra = req
        ? `<span class="tm-up-label"><span class="tm-up-chip">⏳ Requested</span>${req.key ? ` for ${esc(matchName(req.key))}` : ""} – the organizers decide</span>
           <div class="tm-btns"><button class="btn ghost small" data-act="slot-cancel" data-key="${c.id}">Cancel request</button></div>`
        : form === `${c.id}|slot-request`
          ? `<form class="tm-form" data-submit="slot-request" data-key="${c.id}"><label>Which match – who would you play?<select name="match">
              <option value="">Not sure yet</option>${open.map(m => `<option value="${m.key}">${esc(matchName(m.key))}</option>`).join("")}</select></label>
              <span class="note">A court always goes to two teams for one of their matches. Naming the team you'd play makes it much more likely you get it, and the match date is then set for you. With “Not sure yet”, the organizers may pair you with a team you still have to play.</span>
              <div class="tm-btns"><button class="btn small" type="submit">Request this court</button><button class="btn ghost small" type="button" data-act="form" data-form="${c.id}|slot-request">Cancel</button></div></form>`
          : `<div class="tm-btns"><button class="btn small" data-act="form" data-form="${c.id}|slot-request">🙋 Request</button></div>`;
      return row(c, extra);
    });
    const offered = all.filter(c => c.mine).map(c => row(c, c.assignedTo
      ? `<span class="tm-up-label">✅ Given to <b>${esc(teamName(c.assignedTo))}</b></span>`
      : `<span class="tm-up-label">${c.requests ? `🙋 ${c.requests} request${c.requests > 1 ? "s" : ""}` : "No requests yet"}</span>
         <div class="tm-btns"><button class="btn ghost small" data-act="slot-withdraw" data-key="${c.id}">Withdraw</button></div>`));
    const taken = all.filter(c => c.taken).map(c => row(c, `<span class="tm-up-label muted">Given to another team</span>`));

    const offerForm = form === "slots|slot-offer" ? `<form class="tm-form" data-submit="slot-offer" data-key="slots">
        <div class="tm-row"><label>Date &amp; time<input type="datetime-local" name="when" step="900"></label>
        <label>Duration<select name="duration">${[60, 90, 120].map(d => `<option value="${d}" ${d === 90 ? "selected" : ""}>${d} minutes</option>`).join("")}</select></label></div>
        <div class="tm-venue"><label for="court-slot">Court / venue</label>
          <input id="court-slot" name="court" maxlength="160" autocomplete="off" placeholder="Pick a club or search an address…">
          <div class="tm-sugg" hidden></div></div>
        <div class="tm-btns"><button class="btn small" type="submit">Offer this court</button><button class="btn ghost small" type="button" data-act="form" data-form="slots|slot-offer">Cancel</button></div>
        <span class="note">Other teams see the date, time and venue – not who offered it.</span></form>`
      : `<div class="tm-btns"><button class="btn small" data-act="form" data-form="slots|slot-offer">➕ Offer a spare court</button></div>`;

    return `<p class="note">Booked a court you don't need? Offer it here. Need a court? Request one – the organizers decide who gets it.</p>
      <div class="card">${offerForm}${msgHtml("slots")}</div>
      ${list("✅ Courts for you", mine)}
      ${list("🎾 Free courts", free) || `<h3>🎾 Free courts</h3><div class="card muted">No free courts right now.</div>`}
      ${list("📤 Courts you offered", offered)}
      ${list("Requested, given to another team", taken)}`;
  }

  // 📸 Gallery: matchday photos the organizers published (members only – loaded through the gatekeeper), newest first
  const galleryImgs = {}; // key → object URL
  function galleryHtml() {
    const list = (state.gallery || []).concat(LEAGUE.gallery || []);
    if (!list.length) return `<div class="card muted">Photos will appear here during the season 📸</div>`;
    return `<p class="note">Only for league members – please don't share photos of other players outside the league without their permission (Rules §12).</p><div class="gallery">` + list.map(g =>
      `<figure>${g.key ? `<div class="tm-gal-img" data-gal="${esc(g.key)}">${galleryImgs[g.key] ? `<img src="${galleryImgs[g.key]}" alt="${esc(g.caption)}">` : `<span class="note">Loading…</span>`}</div>`
        : `<img src="${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy">`}<figcaption>${esc(g.caption)}</figcaption></figure>`).join("") + `</div>`;
  }
  async function loadGalleryPhotos() {
    for (const g of state.gallery || []) {
      if (!galleryImgs[g.key]) {
        const res = await call(`/photo?key=${encodeURIComponent(g.key)}`).catch(() => null);
        if (!res || !res.ok) continue;
        galleryImgs[g.key] = URL.createObjectURL(await res.blob());
      }
      const box = el.querySelector(`[data-gal="${CSS.escape(g.key)}"]`);
      if (box && !box.querySelector("img")) box.innerHTML = `<img src="${galleryImgs[g.key]}" alt="${esc(g.caption)}">`;
    }
  }

  // every league and cup match with a date that hasn't been played yet – soonest first, our own matches highlighted
  // every unplayed match with a date (any team), soonest first
  // a team's public profile (#teams/<team-name>, from app.js)
  const profileOf = id => (typeof profileHref === "function" ? profileHref(id) : "#table");
  const keyTeams = key => {
    if (key.startsWith("C:")) { const [, ri, mi] = key.split(":"); const m = (((state.cup.rounds || [])[ri] || {}).matches || [])[mi] || {}; return [m.a, m.b]; }
    return key.slice(2).split("-").map(Number);
  };
  function upcomingList() {
    return Object.entries(state.upcoming || {}).map(([key, e]) => ({ key, e, t: keyTeams(key) }))
      .filter(x => x.e.date && x.t[0] && x.t[1] && (matchEnd(x.e) || Date.parse(x.e.date + "T23:59:00")) > Date.now())
      .sort((x, y) => `${x.e.date}T${x.e.time || "23:59"}`.localeCompare(`${y.e.date}T${y.e.time || "23:59"}`));
  }

  function upcomingHtml() {
    const label = key => {
      if (key.startsWith("C:")) { const r = (state.cup.rounds || [])[+key.split(":")[1]]; return `🏆 GPPC Cup · ${r ? r.name : ""}`; }
      const [x, y] = key.slice(2).split("-").map(Number);
      const md = GPPL.fixtures.findIndex(g => g.some(([a, b]) => (a === x && b === y) || (a === y && b === x)));
      return md >= 0 ? `Matchday ${md + 1}` : "League";
    };
    const list = upcomingList();
    if (!list.length) return `<div class="card muted">No upcoming match has a date yet.</div>`;
    const side = (id, cls) => `<span class="${cls}">${logo(id, "tm-logo-sm")}<b><a class="team-link" href="${profileOf(id)}">${esc(teamName(id))}</a></b></span>`;
    // filter by team: only teams with an upcoming match, A–Z (no ranking, no zeros)
    const per = new Map();
    list.forEach(({ t }) => t.forEach(id => per.set(id, (per.get(id) || 0) + 1)));
    // played: confirmed results, results waiting for confirmation, and matches that are over but have no score yet
    const played = new Map(), addPlayed = ids => ids.forEach(id => id && played.set(id, (played.get(id) || 0) + 1));
    (state.results || []).forEach(r => addPlayed([r.a, r.b]));
    (state.cup.rounds || []).forEach(r => (r.matches || []).forEach(m => { if (m.sets || m.walkover || m.winner) addPlayed([m.a, m.b]); }));
    const waiting = typeof matchStatus === "object" ? matchStatus : {}; // public status from app.js – no dates or scores
    Object.keys(waiting).forEach(key => waiting[key] === "waiting" && !(state.upcoming || {})[key] && addPlayed(keyTeams(key))); // started matches are counted below once they end
    Object.entries(state.upcoming || {}).forEach(([key, e]) => e.date && (matchEnd(e) || Date.parse(e.date + "T23:59:00")) <= Date.now() && addPlayed(keyTeams(key)));
    if (upTeam !== null && !per.has(upTeam)) upTeam = null;
    const chip = (id, text, n) => `<button type="button" class="tm-up-team${id === null ? " all" : ""}${upTeam === id ? " active" : ""}" data-act="up-team" data-team="${id === null ? "" : id}">${id === null ? "" : logo(id, "tm-logo-sm")}<span>${text}</span>${n ? `<small>${n} (${n + (played.get(id) || 0)})</small>` : ""}</button>`;
    const filter = `<details class="card tm-up-filter"${upPaneOpen ? " open" : ""}><summary>🔎 Filter by team${upTeam !== null ? `: <b>${esc(teamName(upTeam))}</b>` : ""}</summary><p class="note">Number of upcoming matches – in brackets: upcoming + played.</p><div class="tm-up-teams">` +
      chip(null, "All teams") + [...per].sort((x, y) => teamName(x[0]).localeCompare(teamName(y[0]))).map(([id, n]) => chip(id, esc(teamName(id)), n)).join("") + `</div></details>`;
    const shown = upTeam === null ? list : list.filter(({ t }) => t.includes(upTeam));
    const seg = `<div class="tm-seg" role="group" aria-label="View">${[["list", "📋 List"], ["cal", "🗓️ Calendar"]].map(([v, t]) => `<button type="button" data-act="up-view" data-view="${v}" class="${upView === v ? "active" : ""}">${t}</button>`).join("")}</div>`;
    const row = ({ key, e, t: [a, b] }) => {
      const ours = a === state.team || b === state.team;
      if (ours ? b === state.team : e.by === b) [a, b] = [b, a]; // our own team on the left – otherwise the team that entered the date
      const live = liveNow(e);
      return `<div class="tm-up${ours ? " tm-up-ours" : ""}${live ? " tm-up-live" : ""}">
        <span class="tm-up-pair">${side(a, "tm-up-a")}<span class="muted">vs</span>${side(b, "tm-up-b")}</span>
        <span class="tm-up-when">📅 ${dayText(e.date)}${e.time ? " · " + esc(GPPL.timeRange(e)) : ""} · ${live ? `<span class="tm-up-livechip">🔴 Playing now</span>` : inDays(e.date)}${e.court ? ` · 📍 <a href="${mapsUrl(e.court)}" target="_blank" rel="noopener">${esc(e.court)}</a>` : ""}</span>
        <span class="tm-up-label">${esc(label(key))}${ours ? ` <span class="tm-up-chip">⭐ Your match</span>` : ""}</span>
        ${predictHtml(key, a, b, e)}</div>`;
    };
    const intro = `<p class="note">Every match with a date set – come and watch! Your own matches are highlighted.</p>${filter}${seg}`;
    if (upView === "cal") return intro + calendarHtml(shown, row);
    return intro + `<div class="card tm-up-list">` + shown.map(row).join("") + `</div>`;
  }

  // calendar view of the upcoming matches: a month grid (Monday first) – tap a day to see its matches below
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let upView = ls.get("gppl-up-view") === "cal" ? "cal" : "list", calMonth = ymd(new Date()).slice(0, 7), calDay = ymd(new Date());
  function calendarHtml(list, row) {
    const byDay = {};
    list.forEach(x => (byDay[x.e.date] = byDay[x.e.date] || []).push(x));
    const [y, m] = calMonth.split("-").map(Number), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    const today = ymd(new Date()), cells = [];
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push(`<span class="tm-cal-d out"></span>`);
    for (let d = 1; d <= days; d++) {
      const date = `${calMonth}-${String(d).padStart(2, "0")}`, ms = byDay[date] || [], ours = ms.some(({ t }) => t.includes(state.team));
      const chips = ms.slice(0, 3).map(({ key, e, t: [a, b] }) => `<span class="tm-cal-m${key.startsWith("C:") ? " cup" : ""}${a === state.team || b === state.team ? " ours" : ""}${liveNow(e) ? " live" : ""}"${key.startsWith("C:") ? ' title="GPPC Cup"' : ""}><span class="t">${esc(e.time || "")}</span>${logo(a, "tm-cal-logo")}${logo(b, "tm-cal-logo")}${key.startsWith("C:") ? '<span class="cup-i" aria-label="Cup">🏆</span>' : ""}</span>`).join("");
      cells.push(`<button type="button" class="tm-cal-d${ms.length ? " has" : ""}${ours ? " ours" : ""}${date === today ? " today" : ""}${date === calDay ? " sel" : ""}" data-act="cal-day" data-day="${date}" aria-label="${date}: ${ms.length} match${ms.length === 1 ? "" : "es"}"><span class="n">${d}</span>${chips}${ms.length > 3 ? `<span class="tm-cal-more">+${ms.length - 3}</span>` : ""}</button>`);
    }
    const n = list.filter(x => x.e.date.startsWith(calMonth)).length, sel = byDay[calDay] || [];
    return `<div class="card tm-cal">
      <div class="tm-cal-head"><button type="button" class="btn ghost small" data-act="cal-nav" data-nav="-1" aria-label="Previous month">‹</button><b>${first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} <span class="note">· ${n} match${n === 1 ? "" : "es"}</span></b><button type="button" class="btn ghost small" data-act="cal-nav" data-nav="0">Today</button><button type="button" class="btn ghost small" data-act="cal-nav" data-nav="1" aria-label="Next month">›</button></div>
      <div class="tm-cal-grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<span class="tm-cal-wd">${w}</span>`).join("")}${cells.join("")}</div>
      <h4 class="tm-cal-title">${new Date(calDay + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h4>
      ${sel.map(row).join("") || `<p class="muted">No match on this day.</p>`}</div>`;
  }

  // ---- predictions: every team can pick a winner (and a set score) until 12 hours before the start
  const PREDICT_CLOSE_MS = 12 * 3600000, PREDICT_OPEN_UNTIL = Date.parse("2026-11-02T08:00:00+01:00"); // at launch: open up to the start
  const predictLaunch = () => Date.now() < PREDICT_OPEN_UNTIL;
  const predictClosed = e => !e.time || new Date(`${e.date}T${e.time}:00`).getTime() - (predictLaunch() ? 0 : PREDICT_CLOSE_MS) <= Date.now();
  const pickText = p => `${esc(teamName(p.w))}${p.s ? ` ${p.s.replace("-", "–")}` : ""}`;
  function predictHtml(key, a, b, e) {
    const p = (state.predictions || {})[key] || { n: {}, total: 0 }, closed = predictClosed(e);
    const pa = p.total ? Math.round(100 * (p.n[a] || 0) / p.total) : 50, pb = 100 - pa;
    const stats = p.total
      ? `<div class="tm-pr-bar" aria-hidden="true"><span style="width:${pa}%"></span><span></span></div>
         <div class="tm-pr-nums"><b>${pa}% <small>(${p.n[a] || 0})</small></b><span class="muted">${p.total} prediction${p.total === 1 ? "" : "s"}${p.top ? ` · most picked: ${pickText(p.top)}` : ""}</span><b><small>(${p.total - (p.n[a] || 0)})</small> ${pb}%</b></div>`
      : `<div class="tm-pr-nums"><span class="muted">No predictions yet${closed ? "" : " – be the first!"}</span></div>`;
    const btn = closed
      ? `<span class="note">🔒 Predictions closed${p.mine ? ` · your pick: ${pickText(p.mine)}` : ""}</span>`
      : `<button class="btn ghost small" data-act="predict" data-key="${key}" data-a="${a}" data-b="${b}">${p.mine ? `🔮 Your pick: ${pickText(p.mine)} · Change` : "🔮 Predict"}</button>`;
    return `<div class="tm-pr">${stats}<div class="tm-pr-act">${btn}</div></div>`;
  }

  // the popup – lives outside the member area, so redraws of the page don't close it
  let pr = null; // { key, a, b, w, s, err, busy }
  function predictDialog() {
    let d = document.getElementById("tm-predict");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "tm-predict"; d.className = "tm-pr-dlg";
      document.body.appendChild(d);
      d.addEventListener("click", async ev => {
        if (ev.target === d) return d.close(); // tap outside
        const t = ev.target.closest("button");
        if (!t || !pr || pr.busy) return;
        if (t.dataset.w) { pr.w = +t.dataset.w; return drawPredict(); }
        if (t.dataset.s !== undefined) { pr.s = t.dataset.s; return drawPredict(); }
        if ("close" in t.dataset) return d.close();
        if ("save" in t.dataset || "clear" in t.dataset) {
          pr.busy = true; pr.err = null; drawPredict();
          try {
            await call("/predict", { key: pr.key, winner: "clear" in t.dataset ? 0 : pr.w, score: pr.s });
            state = await call("/me");
            d.close(); render();
          } catch (err) { pr.err = err.message; }
          pr.busy = false;
          if (d.open) drawPredict();
        }
      });
    }
    return d;
  }
  function drawPredict() {
    const d = predictDialog(), mine = ((state.predictions || {})[pr.key] || {}).mine;
    d.innerHTML = `<div class="tm-pr-form">
      <h3>🔮 Who wins?</h3>
      <div class="tm-pr-teams">${[pr.a, pr.b].map(id => `<button type="button" class="tm-pr-team${pr.w === id ? " active" : ""}" data-w="${id}">${logo(id)}<b>${esc(teamName(id))}</b></button>`).join("")}</div>
      <p class="tm-pr-sub">Score in sets</p>
      <div class="tm-pr-scores">${[["2-0", "2–0"], ["2-1", "2–1"]].map(([v, t]) => `<button type="button" class="tm-pr-score${pr.s === v ? " active" : ""}" data-s="${v}">${t}</button>`).join("")}</div>
      <p class="note">${pr.w && pr.s ? `${esc(teamName(pr.w))} wins ${pr.s.replace("-", "–")}. ` : ""}You can change it until ${predictLaunch() ? "the match starts" : "12 hours before the match"}. Predictions are anonymous – others only see the percentages.</p>
      ${pr.err ? `<div class="msg err">❌ ${esc(pr.err)}</div>` : ""}
      <div class="tm-btns"><button type="button" class="btn small" data-save${pr.w && pr.s && !pr.busy ? "" : " disabled"}>${pr.busy ? "Saving…" : "Save prediction"}</button>${mine ? `<button type="button" class="btn ghost small" data-clear${pr.busy ? " disabled" : ""}>Remove</button>` : ""}<button type="button" class="btn ghost small" data-close>Cancel</button></div></div>`;
  }

  // my place in the league table (same order as the Table tab: points, head-to-head, wins, sets, games)
  function standingHtml() {
    const rows = GPPL.rankStandings(state.results), i = rows.findIndex(r => r.id === state.team);
    if (i < 0) return "";
    const r = rows[i], sign = n => (n > 0 ? "+" + n : String(n));
    // before the first result there's no table yet – show the seeding (registration) position
    if (!rows.some(x => x.p)) return `<div class="card tm-stat"><span class="tm-stat-label">🏆 League</span>
      <span class="tm-stat-big">Seed #${state.team} <small>of ${rows.length}</small></span>
      <span class="note">No results yet – the table starts with the first result.</span></div>`;
    const medal = r.p ? ["🥇", "🥈", "🥉"][i] || "" : "";
    return `<div class="card tm-stat"><span class="tm-stat-label">🏆 League</span>
      <span class="tm-stat-big">${medal} ${i + 1}. <small>of ${rows.length}</small></span>
      <span class="tm-stat-line"><b>${r.pts} pts</b> · ${r.p} played · ${r.w} W · ${r.l} L</span>
      <span class="note">Sets ${sign(r.sf - r.sa)} · Games ${sign(r.gf - r.ga)}${r.p ? "" : " · no results yet"}</span>${gamesInHand(rows, i)}</div>`;
  }

  // the table can mislead while pairs have played different numbers of matches – say so
  function gamesInHand(rows, i) {
    const r = rows[i], above = rows[i - 1], below = rows[i + 1], n = k => `${k} match${k === 1 ? "" : "es"}`;
    const notes = [];
    if (above && above.p > r.p) notes.push(`You've played ${n(above.p - r.p)} fewer than <b>${esc(teamName(above.id))}</b> (above you) – you have games in hand.`);
    if (below && below.p < r.p) notes.push(`<b>${esc(teamName(below.id))}</b> (below you) has played ${n(r.p - below.p)} fewer – they have games in hand.`);
    return notes.map(t => `<span class="tm-hand">📌 ${t}</span>`).join("");
  }

  // where my team is in the GPPC Cup
  function cupStatusHtml() {
    const me = state.team, rounds = state.cup.rounds || [];
    const opp = m => teamName(m.a === me ? m.b : m.a);
    let text = "The first cup draw hasn't happened yet.", icon = "⏳";
    rounds.forEach(r => {
      if (r.type === "lucky") {
        if ((r.lucky || []).includes(me)) { text = `Back in as a lucky loser 🍀 – waiting for the next draw.`; icon = "🍀"; }
        return;
      }
      const m = (r.matches || []).find(x => x.a === me || x.b === me);
      if ((r.byes || []).includes(me)) { text = `Bye in ${r.name} – straight to the next round.`; icon = "🎟️"; return; }
      if (!m) return;
      const w = GPPL.cupWinner(m);
      if (!w && m.walkover !== "both") { text = `${r.name} vs <b>${esc(opp(m))}</b> – still to play.`; icon = "🎾"; }
      else if (w === me) {
        text = r.name === "Final" ? "🏆 GPPC Cup champions!" : r.third ? "🥉 3rd place in the GPPC Cup!" : `Won ${r.name} vs ${esc(opp(m))} – waiting for the next round.`;
        icon = r.name === "Final" ? "🏆" : r.third ? "🥉" : "✅";
      } else {
        text = r.name === "Final" ? "🥈 Runner-up in the GPPC Cup!" : r.third ? "4th place in the GPPC Cup." : `Out in ${r.name} (vs ${esc(opp(m))}).`;
        icon = r.name === "Final" ? "🥈" : "❌";
      }
    });
    return `<div class="card tm-stat"><span class="tm-stat-label">🏆 GPPC Cup</span><span class="tm-stat-big">${icon}</span>
      <span class="tm-stat-line">${text}</span></div>`;
  }

  // league milestones (Rules §2): how many matches my team has played and what's due next
  function progressHtml() {
    const pr = GPPL.milestoneProgress(state.results, state.matches, state.team);
    if (!pr.total || !pr.milestones.length) return "";
    const day = t => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const missed = pr.milestones.filter(m => m.status === "missed"), m = pr.next;
    const status = missed.length ? "missed" : m ? m.status : "reached";
    const text = {
      reached: m ? `✅ Milestone ${m.n} reached – well done!` : "✅ All milestones reached – well done!",
      "on-track": `🟢 On track – with the results waiting and the matches you've scheduled, you'll reach it.`,
      open: `⚪ Plenty of time – set dates with your opponents to stay on track.`,
      behind: `🟠 Behind – schedule ${m && m.missing - pr.waiting > 0 ? m.missing - pr.waiting : ""} more match${m && m.missing - pr.waiting === 1 ? "" : "es"} before the deadline.`,
      missed: `🔴 Milestone ${missed.map(x => x.n).join(", ")} missed – missing matches count as walkovers (Rules §2).`,
      upcoming: "",
    }[status];
    return `<div class="card tm-progress tm-ms-${status}">
      <div class="tm-progress-head"><b>🏁 League progress</b><span>${pr.played} of ${pr.total} matches played</span></div>
      <div class="tm-bar"><span style="width:${(100 * pr.played / pr.total).toFixed(0)}%"></span></div>
      ${m ? `<p><b>Next: milestone ${m.n}</b> – ${m.all ? "all matches" : `at least ${m.required} matches`} by <b>${day(m.deadline)}</b>${m.missing ? ` · <b>${m.missing} to go</b>` : ""}</p>` : ""}
      <p class="note">${text}${pr.waiting ? ` ⏳ ${pr.waiting} waiting for confirmation.` : ""}${pr.scheduled ? ` 📅 ${pr.scheduled} scheduled.` : ""}</p>
      <div class="tm-ms">${pr.milestones.map(x => `<span class="tm-ms-dot ms-${x.status}">${x.status === "reached" ? "✅" : x.status === "missed" ? "🔴" : x === m ? "🏁" : "○"} M${x.n}: ${x.all ? "all" : x.required} by ${day(x.deadline)}</span>`).join("")}</div>
    </div>`;
  }

  // matches with an official result go to the end of their section (otherwise schedule order)
  const playedLast = list => list.filter(m => !m.official).concat(list.filter(m => m.official));

  function msgHtml(key) {
    return msg && msg.key === key ? `<div class="msg ${msg.ok ? "" : "err"}">${msg.ok ? "✅ " : "❌ "}${esc(msg.text)}</div>` : "";
  }

  // the league cards, with the matchday my team has off (13 pairs → one bye each) in its place
  function leagueCards(list) {
    const cards = playedLast(list).map(m => ({ md: m.official ? Infinity : m.md, html: card(m) }));
    const md = GPPL.fixtures.findIndex(g => !g.some(([a, b]) => a === state.team || b === state.team)) + 1;
    if (md && LEAGUE.scheduleReleased !== false && cards.length) {
      const win = GPPL.matchdayWindow(md), at = cards.findIndex(c => c.md > md);
      cards.splice(at < 0 ? cards.length : at, 0, { html: `<div class="card tm-match tm-bye">
        <div class="tm-head"><span class="tm-label">Matchday ${md}${LEAGUE.datesConfirmed !== false ? ` · ${GPPL.fmt(win.from)} – ${GPPL.fmt(win.to)}` : ""}</span><span class="tm-chip">😎 No match</span></div>
        <p>This matchday is off for your team. You can play any of your upcoming matches during it – or take a rest.</p></div>` });
    }
    return cards.map(c => c.html).join("");
  }

  function card(m) {
    const entry = state.matches[m.key] || {}, p = entry.pending, st = status(m);
    let body = "";
    if (m.official) {
      let lostIt = !!m.official.walkover && m.official.walkover !== state.team;
      if (m.official.walkover) body = `<p>Decided by walkover (organizers).</p>`;
      else { const s = mine(m.official.sets, m.official.a); lostIt = !won(s); body = board(m, s) + `<p class="tm-score">${won(s) ? "🏆 Won" : "Lost"}${linkHtml(m.official.link)}</p>`; }
      body += `<div class="tm-btns"><button class="btn ghost small" data-act="win-share" data-key="${m.key}">${lostIt ? "🤝" : "🏆"} Share on WhatsApp</button></div>`;
    } else if (p) {
      const s = mine(p.sets, p.a), txt = `<b>${scoreText(s, m.fullSets)}</b> (${won(s) ? "your team won" : "your team lost"})`;
      body = board(m, s) + (p.link ? `<p class="note">${linkHtml(p.link)}</p>` : "");
      if (p.status === "disputed") body += `<p>This result was disputed. The organizers will decide.</p>` +
        (state.notes && state.notes[m.key] ? `<p class="note">“${esc(state.notes[m.key])}”</p>` : "");
      else if (p.by === state.team) body += `<p>You entered ${txt}. ${esc(teamName(m.opp))} has 48 hours to confirm – after that it counts automatically.</p>
        ${dueLine(Date.parse(p.at) + H48, "Counts automatically in", "✅ Counts automatically within the next hour.")}
        <div class="tm-btns"><button class="btn ghost small" data-act="withdraw" data-key="${m.key}">Withdraw & correct</button>${photoBtn(m.key)}</div>`;
      else body += `<div class="tm-ask"><p><b>${esc(teamName(m.opp))}</b> entered ${txt}.<br><b>Is that right?</b></p>
        ${dueLine(Date.parse(p.at) + H48, "Confirm or dispute –", "✅ Counts automatically within the next hour.")}
        <div class="tm-btns"><button class="btn" data-act="confirm" data-key="${m.key}">✅ Yes, confirm</button>
        <button class="btn ghost" data-act="form" data-form="${m.key}|dispute">❌ No, dispute</button>${photoBtn(m.key)}</div></div>` +
        (form === `${m.key}|dispute` ? `<form class="tm-form" data-submit="dispute" data-key="${m.key}">
          <label>What is wrong? <span class="note">optional – helps the organizers decide</span><textarea name="note" maxlength="500" placeholder="e.g. Set 2 was 6-4 for us"></textarea></label>
          <button class="btn small" type="submit">Send to the organizers</button></form>` : "");
    } else {
      const when = entry.date ? `<p class="tm-when">📅 ${dayText(entry.date)}${entry.time ? " · " + esc(GPPL.timeRange(entry)) : ""}${entry.court ? ` · 📍 <a href="${mapsUrl(entry.court)}" target="_blank" rel="noopener">${esc(entry.court)}</a>` : ""}</p>` : "";
      const end = matchEnd(entry), start = matchStart(entry);
      const locked = !!start && start <= Date.now(); // date and venue can't change once the match has started
      const late = !!end && end + H48 <= Date.now(); // no result within 48 hours → the organizers decide (Rules §11)
      const due = end && end <= Date.now() ? dueLine(end + H48, "Played – enter the result:", "🔴 More than 48 hours since the match – please contact the organizers (Rules §11).") : "";
      body = when + due + `<div class="tm-btns">${entry.date ? `<button class="btn ghost small" data-act="match-share" data-key="${m.key}">📤 Share on WhatsApp</button>` : ""}${locked ? "" : `<button class="btn ghost small" data-act="form" data-form="${m.key}|schedule">${entry.date ? "Change Date / Venue" : "Set Date / Venue"}</button>`}
        ${late ? contactBtn(m) : entry.date ? `<button class="btn small" data-act="form" data-form="${m.key}|result">Enter result</button>` : ""}</div>`;
      if (form === `${m.key}|schedule` && !locked) body += `<form class="tm-form" data-submit="schedule" data-key="${m.key}">
        <div class="tm-row"><label>Date &amp; time<input type="datetime-local" name="when" step="900" value="${entry.date ? esc(entry.date + "T" + (entry.time || "18:00")) : ""}"></label>
        <label>Duration<select name="duration">${[60, 90, 120].map(d => `<option value="${d}" ${(+entry.duration || 90) === d ? "selected" : ""}>${d} minutes</option>`).join("")}</select></label></div>
        <div class="tm-venue"><label for="court-${m.key}">Court / venue</label>
          <input id="court-${m.key}" name="court" maxlength="160" autocomplete="off" value="${esc(entry.court || "")}" placeholder="Pick a club or search an address…">
          <div class="tm-sugg" hidden></div></div>
        <label class="tm-check"><input type="checkbox" name="agreed" required> <span>Confirmed with our opponents – they agreed to this date, time and venue</span></label>
        <div class="tm-btns"><button class="btn small" type="submit">Save</button>
          <button class="btn ghost small" type="button" data-act="form" data-form="${m.key}|schedule">Cancel</button>
          ${entry.date ? `<button class="btn ghost small" type="button" data-act="unschedule" data-key="${m.key}">Remove date</button>` : ""}</div>
        <span class="note">Visible to both teams.</span></form>`;
      if (form === `${m.key}|result` && entry.date && !late) body += resultForm(m);
    }
    if (photos[m.key]) body += `<img class="tm-photo" src="${photos[m.key]}" alt="Matchday photo">`;
    return `<div class="card tm-match st-${st.cls}">
      <div class="tm-head"><span class="tm-label">${esc(m.label)}</span><span class="tm-chip">${st.text}</span></div>
      <div class="tm-vs">${logo(m.opp)}<div><b>${esc(teamName(m.opp))}</b><span class="tm-players">${players(m.opp)}</span></div></div>
      ${body}${msgHtml(m.key)}</div>`;
  }

  // WhatsApp message to the organizers (number comes from the gatekeeper after login, never from the website)
  function contactBtn(m) {
    if (!state.organizer) return "";
    const e = state.matches[m.key] || {};
    const text = `Hi, this is ${teamName(state.team)} (GPPL). Our match ${m.label} vs ${teamName(m.opp)} on ${dayText(e.date)}${e.time ? " at " + e.time : ""} has no result in My team yet and the 48 hours are over. `;
    return `<a class="btn small" href="https://api.whatsapp.com/send?phone=${state.organizer}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 Contact the organizers</a>`;
  }

  // the phone's share sheet with the image (pick WhatsApp there); computers without it get the image saved
  async function shareImage(btn, blob, name) {
    const label = btn.textContent;
    const how = await GPPLImage.share(blob, name, () => (btn.textContent = "📤 Ready – tap again"));
    if (how === "shared") btn.textContent = label;
    if (how === "downloaded") { btn.textContent = "✅ Image saved – attach it in WhatsApp"; setTimeout(() => (btn.textContent = label), 5000); }
  }

  // the rulebook version line ("Version 1.1 · Effective from 23 October 2026") – changes whenever the rules do
  function rulebook(text) {
    text = text || ((document.querySelector(".rb-version") || {}).textContent || "").trim();
    const m = /Version\s+([\d.]+).*?from\s+(.+)$/.exec(text);
    return { text, version: m ? m[1] : "", date: m ? m[2] : "" };
  }

  function photoBtn(key) { return `<button class="btn ghost small" data-act="photo" data-key="${key}">📷 Photo</button>`; }

  function resultForm(m) {
    return `<form class="tm-form" data-submit="result" data-key="${m.key}" data-full="${m.fullSets ? 1 : 0}">
      <div><b>Score</b>${board(m)}</div>
      <p class="note">${m.fullSets ? "Semi-finals and final: 3 full sets." : "Leave the tie-break empty if the match ended 2–0. Match tie-break: first to 10, win by 2."}</p>
      <label>Matchday photo (all 4 players)<input type="file" name="photo" accept="image/*"></label>
      <label>Playtomic link <span class="note">the match on Playtomic</span><input type="text" name="link" inputmode="url" autocapitalize="off" placeholder="https://app.playtomic.io/…"></label>
      <button class="btn small" type="submit">Submit result</button></form>`;
  }

  // same rules as Admin and the gatekeeper – checked here first for a quick, clear message
  const validSet = ([x, y]) => { const hi = Math.max(x, y), lo = Math.min(x, y); return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)); };
  const validTieBreak = ([x, y]) => { const hi = Math.max(x, y), lo = Math.min(x, y); return hi >= 10 && hi - lo >= 2 && (hi === 10 || hi - lo === 2); };
  function checkScore(sets, fullSets) {
    if (sets.length < 2) throw new Error("Enter set 1 and set 2.");
    if (sets.some(s => s.some(n => !Number.isInteger(n) || n < 0))) throw new Error("Scores must be whole numbers.");
    sets.slice(0, 2).forEach((s, i) => {
      if (!validSet(s)) throw new Error(`Set ${i + 1}: ${s[0]}-${s[1]} is not a finished set – a set ends 6-0 … 6-4, 7-5 or 7-6.`);
    });
    const split = (sets[0][0] > sets[0][1]) !== (sets[1][0] > sets[1][1]);
    const third = fullSets ? "set 3" : "the match tie-break";
    if (split && !sets[2]) throw new Error(`Sets are 1-1 – enter ${third}.`);
    if (!split && sets[2]) throw new Error(`The match was over after 2 sets – clear ${third}.`);
    if (sets[2] && fullSets && !validSet(sets[2])) throw new Error(`Set 3: ${sets[2][0]}-${sets[2][1]} is not a finished set – a set ends 6-0 … 6-4, 7-5 or 7-6.`);
    if (sets[2] && !fullSets && !validTieBreak(sets[2])) throw new Error(`Tie-break: ${sets[2][0]}-${sets[2][1]} isn't possible – first to 10, win by 2 (e.g. 10-7, 12-10).`);
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
    } catch (e) {
      // the rules changed meanwhile (e.g. a page open since before) → back to the "agree to the rules" screen
      if (e.needsRules) { msg = { key: "rules", text: e.message, ok: false }; form = null; state = await call("/me").catch(() => state); return render(); }
      // keep everything the player typed (and the chosen photo) – only show the message
      msg = { key, text: e.message, ok: false };
      const kept = [...el.querySelectorAll("form[data-key]")].map(f => ({ id: f.dataset.key + "|" + f.dataset.submit,
        values: [...f.elements].filter(x => x.name).map(x => [x.name, x.type === "file" ? x.files : x.value]) }));
      render();
      kept.forEach(({ id, values }) => {
        const f = [...el.querySelectorAll("form[data-key]")].find(x => x.dataset.key + "|" + x.dataset.submit === id);
        if (f) values.forEach(([n, v]) => { const input = f.elements[n]; if (!input) return; if (input.type === "file") { if (v && v.length) input.files = v; } else input.value = v; });
      });
      return;
    }
    render();
  }

  // remember whether the "Filter by team" pane is open (the page is redrawn on every change)
  el.addEventListener("toggle", e => { if (e.target.classList.contains("tm-up-filter")) upPaneOpen = e.target.open; }, true);

  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const key = b.dataset.key, a = b.dataset.act;
    if (a === "logout") { ls.set(TOKEN_KEY, null); state = null; msg = null; return render(); }
    if (a === "reload") { msg = null; return load(); }
    if (a === "view") { view = b.dataset.view; form = null; return render(); }
    if (a === "predict") {
      const mine = ((state.predictions || {})[key] || {}).mine;
      pr = { key, a: +b.dataset.a, b: +b.dataset.b, w: mine ? mine.w : 0, s: mine && mine.s || "", err: null, busy: false };
      drawPredict(); predictDialog().showModal();
      return;
    }
    if (a === "up-view") { upView = b.dataset.view; ls.set("gppl-up-view", upView); return render(); }
    if (a === "cal-day") { calDay = b.dataset.day; return render(); }
    if (a === "cal-nav") {
      if (b.dataset.nav === "0") { calMonth = ymd(new Date()).slice(0, 7); calDay = ymd(new Date()); }
      else { const [y, m] = calMonth.split("-").map(Number); calMonth = ymd(new Date(y, m - 1 + +b.dataset.nav, 1)).slice(0, 7); }
      return render();
    }
    if (a === "up-team") { upTeam = b.dataset.team === "" ? null : +b.dataset.team; upPaneOpen = true; return render(); }
    if (a === "form") { form = form === b.dataset.form ? null : b.dataset.form; msg = null; return render(); }
    if (a === "win-share") {
      const m = myMatches().find(x => x.key === key);
      if (!m || !m.official) return;
      const label = m.group === "cup" ? m.label : m.label.split(" · ")[0];
      const name = `GPPL ${label.replace("GPPC Cup · ", "")} – ${teamName(state.team)} vs ${teamName(m.opp)} result.png`;
      const blob = matchImgs["w" + key] || (matchImgs["w" + key] = await GPPLImage.winnerImage({ label, r: m.official, a: state.team, b: m.opp, fullSets: m.fullSets, sharedBy: state.team }));
      return shareImage(b, blob, name);
    }
    if (a === "match-share") {
      const m = myMatches().find(x => x.key === key), e = state.matches[key];
      if (!m || !e) return;
      const name = `GPPL ${m.label.split(" · ")[m.group === "cup" ? 1 : 0]} – ${teamName(state.team)} vs ${teamName(m.opp)}.png`;
      const blob = matchImgs[key] || (matchImgs[key] = await GPPLImage.matchImage({
        label: m.group === "cup" ? m.label : m.label.split(" · ")[0], a: state.team, b: m.opp, e }));
      return shareImage(b, blob, name);
    }
    if (a === "photo") {
      if (photos[key]) { URL.revokeObjectURL(photos[key]); delete photos[key]; return render(); }
      const res = await call(`/photo?key=${encodeURIComponent(key)}`);
      if (res.ok) photos[key] = URL.createObjectURL(await res.blob()); else msg = { key, text: "No photo found.", ok: false };
      return render();
    }
    b.disabled = true;
    if (a === "slot-reoffer" && confirm("Put this court back in the pool as your offer? The date of your match is removed again.")) return act("slots", () => call("/slot-reoffer", { id: key }), "Back in the pool as your offer.");
    if (a === "slot-cancel") return act(key, () => call("/slot-cancel", { id: key }), "Request cancelled.");
    if (a === "slot-withdraw" && confirm("Take this court out of the pool?")) return act(key, () => call("/slot-withdraw", { id: key }), "Withdrawn.");
    if (a === "confirm") return act(key, () => call("/confirm", { key }), "Result confirmed – thanks!");
    if (a === "unschedule" && confirm("Remove the date, time and venue of this match?")) return act(key, () => call("/schedule", { key, date: "", time: "", court: "" }), "Date removed.");
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
        typedCode = document.getElementById("tm-code").value;
        if (LEAGUE.turnstileSiteKey && !tsToken) throw new Error("Please wait for the security check below to finish.");
        const r = await call("/login", { code: typedCode, turnstile: tsToken });
        ls.set(TOKEN_KEY, r.token); typedCode = "";
        return load();
      } catch (err) { msg = { key: "top", text: err.message, ok: false }; tsToken = null; return render(); }
    }
    const v = n => (f.elements[n] ? f.elements[n].value.trim() : "");
    if (kind === "schedule") return act(key, () => {
      const [date = "", time = ""] = v("when").split("T");
      if (!date || !time) throw new Error("Please pick the date and time.");
      if (!v("court")) throw new Error("Please add the court / venue.");
      return call("/schedule", { key, date, time: time.slice(0, 5), duration: +v("duration") || 90, court: v("court") });
    }, "Saved.");
    if (kind === "slot-offer") return act(key, () => {
      const [date = "", time = ""] = v("when").split("T");
      if (!date || !time) throw new Error("Please pick the date and time.");
      if (!v("court")) throw new Error("Please add the court / venue.");
      return call("/slot-offer", { date, time: time.slice(0, 5), duration: +v("duration") || 90, court: v("court") });
    }, "Your court is in the pool – the organizers will give it to a team that needs one.");
    if (kind === "slot-request") return act(key, () => call("/slot-request", { id: key, key: v("match") }), "Requested – the organizers will decide.");
    if (kind === "dispute") return act(key, () => call("/dispute", { key, note: v("note") }), "Sent – the organizers will decide.");
    if (kind === "rules") {
      try {
        if (!f.elements.ok.checked) throw new Error("Please tick the box to agree to the rules.");
        await call("/accept-rules", {});
        state = await call("/me"); // only now the team's data is sent
        msg = LEAGUE.memberMode === "signin" ? null : { key: "top", text: "Thanks – welcome to the GPPL! 🎾", ok: true };
      } catch (err) { msg = { key: "rules", text: err.message, ok: false }; }
      return render();
    }
    if (kind === "result") {
      return act(key, async () => {
        const sets = [];
        for (let i = 0; i < 3; i++) {
          const x = v(`s${i}a`), y = v(`s${i}b`);
          if (x === "" && y === "") continue;
          if (x === "" || y === "") throw new Error(`Set ${i + 1} is incomplete.`);
          sets.push([+x, +y]);
        }
        checkScore(sets, f.dataset.full === "1");
        const file = f.elements.photo.files[0];
        if (!file) throw new Error("Please add the matchday photo.");
        if (!/^https:\/\/([a-z0-9-]+\.)*playtomic\.(io|com)\//i.test(v("link"))) throw new Error("Please paste the Playtomic link of the match (https://…playtomic…).");
        await call("/result", { key, sets, link: v("link"), photo: await compress(file) });
      }, "Result sent – your opponent now confirms it.");
    }
  });

  // ---------------------------------------------------------------- venue search
  // venues other matches already use, then addresses from OpenStreetMap (Photon, Germany only)
  let venueTimer = null, venueReq = 0;
  // the organizers' list of venues (data.js → venues) first, then venues other matches already use
  const knownVenues = () => [...new Set((LEAGUE.venues || []).concat(Object.values(state.matches).map(x => x.court)).filter(Boolean))];
  function showVenues(box, list, q) {
    box.innerHTML = list.map(v => `<button type="button" data-venue="${esc(v)}">📍 ${esc(v)}</button>`).join("") +
      (q && q.length >= 3 ? `<a class="tm-sugg-maps" href="${mapsUrl(q)}" target="_blank" rel="noopener">${list.length ? "Not in the list?" : "Nothing found –"} check “${esc(q)}” on Google Maps ↗<br>
        <span class="note">You can also just keep what you typed – it links to Google Maps.</span></a>` : "");
    box.hidden = !box.innerHTML;
  }
  // every word typed must appear in the venue ("frankfurter city" finds PadelCity Frankfurter Ring)
  const matchVenue = (v, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => v.toLowerCase().includes(w));
  function venueInput(input) {
    const box = input.parentElement.querySelector(".tm-sugg"), q = input.value.trim();
    clearTimeout(venueTimer);
    const known = knownVenues().filter(v => v !== q && matchVenue(v, q)).slice(0, q ? 8 : 40);
    showVenues(box, known, q);
    // clubs from the list come first; search addresses only when the list has (almost) nothing
    if (q.length < 3 || known.length >= 3) return;
    venueTimer = setTimeout(async () => {
      const req = ++venueReq;
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=de&bbox=5.8,47.2,15.1,55.1&lat=48.137&lon=11.575`); // results near Munich first
        const data = await res.json();
        if (req !== venueReq || input.value.trim() !== q) return;
        // only places you can play at (clubs, sports centres, buildings with a house number) – no streets or stations
        const playable = ({ properties: p }) => ["leisure", "amenity", "club", "building", "sport"].includes(p.osm_key) || !!p.housenumber;
        const found = data.features.filter(playable).map(({ properties: p }) => [p.name, [p.street, p.housenumber].filter(Boolean).join(" "), [p.postcode, p.city || p.town || p.village].filter(Boolean).join(" ")]
          .filter((x, i, a) => x && a.indexOf(x) === i).join(", ")).filter(Boolean);
        showVenues(box, [...new Set(known.concat(found))].slice(0, 8), q);
      } catch {}
    }, 350);
  }
  el.addEventListener("input", e => { if (e.target.name === "court") venueInput(e.target); });
  // focusing the empty field shows the whole club list
  el.addEventListener("focusin", e => { if (e.target.name === "court" && !e.target.value.trim()) venueInput(e.target); });
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-venue]");
    if (b) { const input = b.closest(".tm-venue").querySelector("input"); input.value = b.dataset.venue; b.parentElement.hidden = true; input.focus(); return; }
    if (!e.target.closest(".tm-venue")) el.querySelectorAll(".tm-sugg").forEach(x => (x.hidden = true));
  });

  // Cloudflare Turnstile on the login form (mostly invisible – proves a person is logging in)
  let tsToken = null, typedCode = "", tsLoading = null;
  function mountTurnstile() {
    const box = document.getElementById("tm-turnstile"), key = LEAGUE.turnstileSiteKey;
    if (!box || !key) return;
    tsToken = null;
    tsLoading = tsLoading || new Promise(res => {
      window.gpplTurnstileReady = res;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=gpplTurnstileReady";
      s.async = true; document.head.appendChild(s);
    });
    tsLoading.then(() => window.turnstile.render(box, {
      sitekey: key, appearance: "interaction-only",
      callback: t => (tsToken = t), "expired-callback": () => (tsToken = null), "error-callback": () => (tsToken = null),
    }));
  }

  // menu item: once a team is logged in, its logo replaces the padel ball
  function updateNav() {
    const a = document.querySelector('#nav a[href="#team"]');
    if (!a) return;
    let id = null;
    try { id = JSON.parse(atob(ls.get(TOKEN_KEY).split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).t; } catch {}
    const p = id && LEAGUE.pairs.find(x => x.id === id), l = p && (LEAGUE.logos || {})[p.name];
    const src = l && (typeof l === "string" ? l : l.src);
    a.innerHTML = src ? `<img class="nav-logo" src="${esc(src)}" alt="">My team` : "🎾 My team";
  }
  updateNav();

  window.addEventListener("hashchange", () => { if (location.hash === "#team") load(); });
  if (location.hash === "#team") load();
})();
