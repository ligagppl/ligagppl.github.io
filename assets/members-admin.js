// Admin → Member area (team codes, activity log) and ❗ Disputes (results waiting, disputes).
// Talks to the GPPL gatekeeper with the admin key (kept in this browser only).
(function membersAdmin() {
  const $ = id => document.getElementById(id);
  if (!$("panel-members")) return;
  const KEY = "gppl-member-admin";
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
  const api = () => (get("gppl-member-api") || LEAGUE.memberApi || "").replace(/\/+$/, "");
  const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const name = id => (GPPL.pairById[id] ? GPPL.pairById[id].name : `#${id}`);
  const show = (id, text, ok = true) => { $(id).textContent = text; $(id).className = "msg " + (ok ? "ok" : "err"); };
  const when = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  let lastCode = null; // the code just created – shown once in its team's card
  let phones = {};      // WhatsApp numbers per team (private, kept by the gatekeeper)
  const siteUrl = () => new URL("index.html#team", location.href).href.replace("index.html", "");
  const codeMessage = (team, code) => `Hi ${team}! 🎾\nYour GPPL team code is: ${code}\n\nLog in at ${siteUrl()} (🎾 My team) to set the dates of your matches and enter results.\nBoth of you use the same code – please keep it private.`;
  // "+49 176 123", "0049…", "0176…" (Germany), "0300…" (Pakistan) → digits with country code
  function normPhone(p) {
    let d = String(p || "").replace(/[^\d+]/g, "");
    if (!d) return "";
    if (d.startsWith("+")) d = d.slice(1);
    else if (d.startsWith("00")) d = d.slice(2);
    else if (/^03\d{9}$/.test(d)) d = "92" + d.slice(1);
    else if (d.startsWith("0")) d = "49" + d.slice(1);
    return d;
  }
  const players = id => (GPPL.pairById[id] ? GPPL.pairById[id].players.filter(Boolean).map(esc).join(" & ") : "");
  function logo(teamName) {
    const l = (LEAGUE.logos || {})[teamName];
    const src = l && (typeof l === "string" ? l : l.src);
    return src ? `<img class="mb-logo" src="${esc(src)}" alt="">` : `<span class="mb-logo ph" aria-hidden="true">🎾</span>`;
  }

  // one WhatsApp button per team: WhatsApp links open one chat at a time, so with two numbers
  // the button opens the first player's chat and then offers the partner ("Next: …")
  function sendButton(msg, steps) {
    if (!steps.length) return `<a class="btn small" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">📲 Send via WhatsApp</a>`;
    return `<button class="btn small" data-wa="${encodeURIComponent(JSON.stringify(steps))}" data-step="0">📲 Send to ${steps.map(s => esc(s.name)).join(" & ")}</button>`;
  }

  async function call(path, body, raw) {
    const res = await fetch(api() + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Admin ${get(KEY) || ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // "L:3-7" / "C:1:0" → readable match name
  function matchName(key, cup) {
    let m = /^L:(\d+)-(\d+)$/.exec(key);
    if (m) return `League · ${name(+m[1])} vs ${name(+m[2])}`;
    m = /^C:(\d+):(\d+)$/.exec(key);
    const r = m && cup && cup.rounds[+m[1]], x = r && r.matches[+m[2]];
    return x ? `Cup ${r.name} · ${name(x.a)} vs ${name(x.b)}` : key;
  }
  const score = sets => sets.map(([x, y]) => `${x}-${y}`).join(" ");

  async function loadAll() {
    $("mb-api").textContent = api() || "(not set – LEAGUE.memberApi in data.js)";
    if (!api() || !get(KEY)) return;
    try {
      const [{ teams }, { log }, ph] = await Promise.all([call("/admin/teams"), call("/admin/log"), call("/admin/phones")]);
      phones = ph.phones || {};
      const cup = await STORE.load("cup", { rounds: [] });
      $("mb-teams").className = "mb-teams";
      $("mb-teams").innerHTML = teams.length ? teams.map(t => {
        const pl = (GPPL.pairById[t.id] || { players: [] }).players, nums = phones[t.id] || [];
        const msg = lastCode && lastCode.team === t.id ? codeMessage(t.name, lastCode.code) : "";
        return `<div class="mb-team ${t.hasCode ? "has-code" : ""}">
          ${logo(t.name)}<div class="mb-team-info"><span class="note">#${t.id}</span><b>${esc(t.name)}</b>
          <span class="note">${players(t.id)}</span>
          <span class="mb-team-state">${t.hasCode ? `✅ Code since ${when(t.created)}` : "No code yet"}</span>
          ${msg ? `<span class="mb-newcode"><code class="mb-code">${lastCode.code}</code>
            <button class="btn ghost small" data-copy="${lastCode.code}">Copy</button>
            ${sendButton(msg, [0, 1].filter(i => nums[i]).map(i => ({ name: (pl[i] || `Player ${i + 1}`).split(" ")[0], url: `https://wa.me/${nums[i]}?text=${encodeURIComponent(msg)}` })))}
            <span class="note">Shown only now – send it privately to both players.</span></span>` : ""}
          ${[0, 1].filter(i => pl[i] && !nums[i]).map(i => `<span class="mb-nophone">⚠️ No WhatsApp number for ${esc(pl[i])}</span>`).join("")}
          <button class="btn ${t.hasCode ? "ghost " : ""}small" data-code="${t.id}">${t.hasCode ? "Reset code" : "Create code"}</button></div></div>`;
      }).join("") : "No teams yet.";
      $("mb-log").className = "reslist";
      $("mb-log").innerHTML = log.length ? log.slice(0, 60).map(l => `<div class="row"><span class="note">${when(l.at)}</span>
        <span>${l.team ? esc(name(l.team)) : l.by === "admin" ? "Admin" : "System"} · ${esc(l.action)}${l.key ? " · " + esc(matchName(l.key, cup)) : ""}${l.detail ? " · " + esc(l.detail) : ""}</span></div>`).join("")
        : "No activity yet.";
      show("mb-msg", "✅ Connected");
    } catch (e) { show("mb-msg", "❌ " + e.message, false); }
  }

  $("mb-key").value = get(KEY) || "";
  $("mb-connect").addEventListener("click", () => { set(KEY, $("mb-key").value.trim()); loadAll(); });
  $("panel-members").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.code) {
      const id = +b.dataset.code;
      if (b.textContent.startsWith("Reset") && !confirm(`Make a new code for ${name(id)}? Their old code stops working and their phones are logged out.`)) return;
      try {
        const r = await call("/admin/code", { team: id });
        lastCode = { team: id, code: r.code };
        $("mb-code").textContent = "";
        loadAll();
      } catch (err) { show("mb-code", "❌ " + err.message, false); }
    }
    if (b.dataset.wa) {
      const steps = JSON.parse(decodeURIComponent(b.dataset.wa)), i = +b.dataset.step % steps.length;
      window.open(steps[i].url, "_blank", "noopener");
      const next = i + 1;
      b.dataset.step = next;
      b.textContent = next < steps.length ? `📲 Next: ${steps[next].name}` : `✅ Sent to ${steps.map(s => s.name).join(" & ")} – again?`;
      return;
    }
    if (b.dataset.copy) { navigator.clipboard.writeText(b.dataset.copy).then(() => (b.textContent = "Copied ✓")); }
    if (b.id === "ph-save-all") {
      try { await call("/admin/phones", { all: { ...phones, ...phImport } }); show("ph-msg", `✅ Numbers saved for ${Object.keys(phImport).length} teams.`); $("ph-preview").innerHTML = ""; loadAll(); }
      catch (err) { show("ph-msg", "❌ " + err.message, false); }
    }
    if (b.id === "ph-clear") {
      if (!confirm("Delete ALL WhatsApp numbers from the gatekeeper? (e.g. at the end of the season)")) return;
      try { await call("/admin/phones", { clear: true }); show("ph-msg", "✅ All numbers deleted."); loadAll(); }
      catch (err) { show("ph-msg", "❌ " + err.message, false); }
    }
  });

  // import the numbers from the registration form export (Google Sheet → CSV)
  let phImport = {};
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  $("ph-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const { header, rows } = parseCSV(await file.text());
    const col = re => header.findIndex(h => re.test(h));
    const cTeam = col(/team/i), cNames = col(/name/i) === cTeam ? -1 : header.findIndex((h, i) => i !== cTeam && /name/i.test(h)), cNum = col(/whatsapp|phone|number|nummer/i);
    if (cNum < 0) return show("ph-msg", "❌ No WhatsApp / phone column found in this file.", false);
    phImport = {};
    const lines = rows.map(r => {
      const nums = String(r[cNum] || "").split(/\r?\n|,|;|\//).map(normPhone).filter(Boolean).slice(0, 2);
      const names = String(r[cNames] || "").split(/\r?\n/).map(norm).filter(Boolean);
      // match by team name, else by a player name
      const pair = LEAGUE.pairs.find(p => norm(p.name) === norm(r[cTeam])) ||
        LEAGUE.pairs.find(p => p.players.some(n => n && names.includes(norm(n))));
      if (pair && nums.length) {
        // put each number next to the right player when the form lists the players in the other order
        const formOrder = names.length === 2 && norm(pair.players[0]) === names[1] ? [nums[1], nums[0]] : nums;
        phImport[pair.id] = formOrder.map(x => x || "");
      }
      return `<div class="row"><span>${pair ? `✅ <b>${esc(pair.name)}</b>` : `⚠️ <b>${esc(r[cTeam])}</b> – no matching team`}</span><span class="note">${nums.length ? `${nums.length} number${nums.length === 1 ? "" : "s"}` : "no number"}</span></div>`;
    });
    $("ph-preview").innerHTML = lines.join("") + (Object.keys(phImport).length ? `<button class="btn" id="ph-save-all" style="margin-top:10px">Save numbers for ${Object.keys(phImport).length} team${Object.keys(phImport).length === 1 ? "" : "s"}</button>` : "");
    show("ph-msg", "Check the list, then save. Numbers are stored only in the gatekeeper – never on the website.");
    e.target.value = "";
  });

  document.querySelector('.subnav button[data-panel="members"]').addEventListener("click", loadAll);

  // ---------------------------------------------------------------- ❗ Disputes tab
  const navBtn = document.querySelector('.subnav button[data-panel="disputes"]');
  const fullSetsOf = (key, cup) => { const m = /^C:(\d+):/.exec(key); const r = m && cup.rounds[+m[1]]; return !!r && (r.name === "Semi-finals" || r.name === "Final"); };
  function matchLabel(key, cup) {
    let m = /^L:(\d+)-(\d+)$/.exec(key);
    if (m) {
      const md = GPPL.fixtures.findIndex(g => g.some(([x, y]) => (x === +m[1] && y === +m[2]) || (x === +m[2] && y === +m[1])));
      return md >= 0 ? `League · Matchday ${md + 1}` : "League";
    }
    m = /^C:(\d+):/.exec(key);
    return m && cup.rounds[+m[1]] ? `GPPC Cup · ${cup.rounds[+m[1]].name}` : key;
  }
  // score table like the members see it: one row per team, one column per set
  function board(o, fullSets) {
    const labels = ["Set 1", "Set 2", fullSets ? "Set 3" : "Tie-break"].slice(0, o.sets.length);
    const row = (id, side) => `<span class="dp-team">${logo(name(id)).replace("mb-logo", "dp-logo")}<span><b>${esc(name(id))}</b><span class="note">${players(id)}</span></span></span>` +
      o.sets.map(s => `<span class="dp-g ${s[side] > s[1 - side] ? "win" : ""}">${s[side]}</span>`).join("");
    return `<div class="dp-board" style="--sets:${labels.length}"><span></span>${labels.map(l => `<span class="dp-bh">${l}</span>`).join("")}${row(o.a, 0)}${row(o.b, 1)}</div>`;
  }
  // editable copy of the score (sets from pair a's view) – tab key goes set by set
  function editBoard(o, fullSets) {
    const labels = ["Set 1", "Set 2", fullSets ? "Set 3" : "Tie-break"], at = (r, c) => `style="grid-row:${r};grid-column:${c}"`;
    return `<div class="dp-board" style="--sets:3">${labels.map((l, i) => `<span class="dp-bh" ${at(1, i + 2)}>${l}</span>`).join("")}
      <span ${at(2, 1)}><b>${esc(name(o.a))}</b></span><span ${at(3, 1)}><b>${esc(name(o.b))}</b></span>
      ${[0, 1, 2].map(i => [0, 1].map(s => `<input type="number" min="0" max="${i === 2 && !fullSets ? 99 : 7}" data-s="${i}${s}" value="${o.sets[i] ? o.sets[i][s] : ""}" ${at(s + 2, i + 2)}>`).join("")).join("")}</div>`;
  }
  const who = id => `<b>${esc(name(id))}</b>`;
  function openCard(o, cup) {
    const disputed = o.status === "disputed", other = o.by === o.a ? o.b : o.a;
    return `<div class="card dp-card ${disputed ? "dp-disputed" : "dp-waiting"}">
      <div class="dp-head"><span class="note">${esc(matchLabel(o.key, cup))}</span>
        <span class="dp-chip">${disputed ? "❗ Disputed" : `⏳ Waiting for ${esc(name(other))}`}</span></div>
      ${board(o, fullSetsOf(o.key, cup))}
      <div class="dp-facts">
        <div>📝 Entered by ${who(o.by)} · ${when(o.at)}</div>
        ${disputed ? `<div>❗ Disputed by ${who(o.disputedBy)} · ${when(o.disputedAt)}</div>
          <div class="dp-note">${o.note ? `“${esc(o.note)}”` : '<span class="note">No comment given.</span>'}</div>`
          : `<div class="note">Counts automatically 48 hours after it was entered, unless ${esc(name(other))} disputes it.</div>`}
      </div>
      ${disputed ? `<div class="dp-edit" hidden>${editBoard(o, fullSetsOf(o.key, cup))}
        <div class="dp-btns"><button class="btn" data-save-edit="${o.key}">💾 Save this score as official</button></div></div>` : ""}
      <div class="dp-btns">
        <button class="btn" data-resolve="accept" data-key="${o.key}">✅ Accept result</button>
        ${disputed ? `<button class="btn ghost" data-toggle-edit>✏️ Edit score</button>` : ""}
        <button class="btn ghost" data-resolve="reject" data-key="${o.key}">✖ Reject – teams enter it again</button>
        <button class="btn ghost small" data-photo="${o.key}">📷 Photo</button>
        ${o.link ? `<a class="btn ghost small" href="${esc(o.link)}" target="_blank" rel="noopener">Playtomic ↗</a>` : ""}
      </div>
      <div class="dp-photo" id="ph-${o.key.replace(/:/g, "_")}"></div></div>`;
  }

  function setBadge(open) {
    const n = open.filter(o => o.status === "disputed").length;
    navBtn.textContent = "❗ Disputes" + (n ? ` (${n})` : "");
    navBtn.classList.toggle("has-disputes", n > 0);
  }

  async function loadDisputes() {
    if (!api() || !get(KEY)) { $("dp-list").innerHTML = '<div class="card muted">Enter the admin key in <b>👥 Member area</b> first.</div>'; return; }
    try {
      const [{ open }, cup] = await Promise.all([call("/admin/open"), STORE.load("cup", { rounds: [] })]);
      setBadge(open);
      const disputes = open.filter(o => o.status === "disputed"), waiting = open.filter(o => o.status !== "disputed");
      $("dp-list").innerHTML = `<h3>❗ Disputed – your decision</h3>` +
        (disputes.map(o => openCard(o, cup)).join("") || '<div class="card muted">No disputes. 🎉</div>') +
        `<h3>⏳ Waiting for the opponent to confirm</h3>` +
        (waiting.map(o => openCard(o, cup)).join("") || '<div class="card muted">Nothing waiting.</div>');
    } catch (e) { $("dp-list").innerHTML = `<div class="card msg err">❌ ${esc(e.message)}</div>`; }
  }

  $("panel-disputes").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("toggleEdit" in b.dataset) { const ed = b.closest(".dp-card").querySelector(".dp-edit"); ed.hidden = !ed.hidden; return; }
    if (b.dataset.saveEdit) {
      const card = b.closest(".dp-card"), v = k => { const el = card.querySelector(`[data-s="${k}"]`); return el.value === "" ? null : +el.value; };
      const sets = [0, 1, 2].map(i => [v(`${i}0`), v(`${i}1`)]).filter(s => s[0] !== null || s[1] !== null);
      if (sets.some(s => s.includes(null))) return show("dp-msg", "❌ A set is incomplete.", false);
      if (!confirm("Make this corrected score official?")) return;
      try { await call("/admin/resolve", { key: b.dataset.saveEdit, action: "accept", sets }); show("dp-msg", "✅ Corrected score is official."); loadDisputes(); }
      catch (err) { show("dp-msg", "❌ " + err.message, false); }
      return;
    }
    if (b.dataset.resolve) {
      const accept = b.dataset.resolve === "accept";
      if (!confirm(accept ? "Make this result official?" : "Reject this result? It's removed and the teams can enter it again.")) return;
      try { await call("/admin/resolve", { key: b.dataset.key, action: b.dataset.resolve }); show("dp-msg", accept ? "✅ Result is official." : "Result rejected – the teams can enter it again."); loadDisputes(); }
      catch (err) { show("dp-msg", "❌ " + err.message, false); }
    }
    if (b.dataset.photo) {
      const box = $("ph-" + b.dataset.photo.replace(/:/g, "_"));
      if (box.innerHTML) { box.innerHTML = ""; return; }
      const res = await call(`/admin/photo?key=${encodeURIComponent(b.dataset.photo)}`, null, true);
      box.innerHTML = res.ok ? `<img src="${URL.createObjectURL(await res.blob())}" alt="Matchday photo">` : '<span class="note">No photo.</span>';
    }
    if (b.id === "dp-auto") {
      try { const r = await call("/admin/auto-confirm", {}); show("dp-msg", `✅ ${r.confirmed.length} result(s) confirmed.`); loadDisputes(); }
      catch (err) { show("dp-msg", "❌ " + err.message, false); }
    }
  });
  navBtn.addEventListener("click", loadDisputes);
  // count the open disputes on load, so they're never missed
  if (api() && get(KEY)) call("/admin/open").then(r => setBadge(r.open)).catch(() => {});
})();
