// Admin → Member area: team codes, results waiting for confirmation, disputes, activity log.
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
  const players = id => (GPPL.pairById[id] ? GPPL.pairById[id].players.filter(Boolean).map(esc).join(" & ") : "");
  function logo(teamName) {
    const l = (LEAGUE.logos || {})[teamName];
    const src = l && (typeof l === "string" ? l : l.src);
    return src ? `<img class="mb-logo" src="${esc(src)}" alt="">` : `<span class="mb-logo ph" aria-hidden="true">🎾</span>`;
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
      const [{ teams }, { open }, { log }] = await Promise.all([call("/admin/teams"), call("/admin/open"), call("/admin/log")]);
      const cup = await STORE.load("cup", { rounds: [] });
      $("mb-teams").className = "mb-teams";
      $("mb-teams").innerHTML = teams.length ? teams.map(t => `<div class="mb-team ${t.hasCode ? "has-code" : ""}">
          ${logo(t.name)}<div class="mb-team-info"><span class="note">#${t.id}</span><b>${esc(t.name)}</b>
          <span class="note">${players(t.id)}</span>
          <span class="mb-team-state">${t.hasCode ? `✅ Code since ${when(t.created)}` : "No code yet"}</span>
          ${lastCode && lastCode.team === t.id ? `<span class="mb-newcode"><code class="mb-code">${lastCode.code}</code>
            <button class="btn ghost small" data-copy="${lastCode.code}">Copy</button><span class="note">Shown only now – send it privately to both players.</span></span>` : ""}
          <button class="btn ${t.hasCode ? "ghost " : ""}small" data-code="${t.id}">${t.hasCode ? "Reset code" : "Create code"}</button></div></div>`).join("")
        : "No teams yet.";
      updateBadge(open);
      $("mb-open").className = "reslist";
      $("mb-open").innerHTML = open.length ? open.map(o => `<div class="row mb-open-row"><span>${o.status === "disputed" ? "❗" : "⏳"} ${esc(matchName(o.key, cup))}<br>
          <span class="note">${esc(name(o.a))} ${score(o.sets)} ${esc(name(o.b))} · entered by ${esc(name(o.by))} ${when(o.at)}${o.note ? ` · dispute: “${esc(o.note)}”` : ""}</span></span>
          <span><button class="btn ghost small" data-photo="${o.key}">📷</button>
          <button class="btn small" data-resolve="accept" data-key="${o.key}">Accept</button>
          <button class="btn ghost small" data-resolve="reject" data-key="${o.key}">Reject</button></span></div>
          <div class="mb-photo" id="ph-${o.key.replace(/:/g, "_")}"></div>`).join("")
        : "Nothing waiting – no disputes.";
      $("mb-log").className = "reslist";
      $("mb-log").innerHTML = log.length ? log.slice(0, 60).map(l => `<div class="row"><span class="note">${when(l.at)}</span>
        <span>${l.team ? esc(name(l.team)) : l.by === "admin" ? "Admin" : "System"} · ${esc(l.action)}${l.key ? " · " + esc(matchName(l.key, cup)) : ""}${l.detail ? " · " + esc(l.detail) : ""}</span></div>`).join("")
        : "No activity yet.";
      show("mb-msg", "✅ Connected");
    } catch (e) { show("mb-msg", "❌ " + e.message, false); }
  }

  $("mb-key").value = get(KEY) || "";
  $("mb-connect").addEventListener("click", () => { set(KEY, $("mb-key").value.trim()); loadAll(); });
  $("mb-auto").addEventListener("click", async () => {
    try { const r = await call("/admin/auto-confirm", {}); show("mb-open-msg", `✅ ${r.confirmed.length} result(s) confirmed.`); loadAll(); }
    catch (e) { show("mb-open-msg", "❌ " + e.message, false); }
  });

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
    if (b.dataset.copy) { navigator.clipboard.writeText(b.dataset.copy).then(() => (b.textContent = "Copied ✓")); }
    if (b.dataset.resolve) {
      const accept = b.dataset.resolve === "accept";
      if (!confirm(accept ? "Make this result official?" : "Reject this result? The teams can then enter it again.")) return;
      try { await call("/admin/resolve", { key: b.dataset.key, action: b.dataset.resolve }); show("mb-open-msg", accept ? "✅ Result is official." : "Result rejected."); loadAll(); }
      catch (err) { show("mb-open-msg", "❌ " + err.message, false); }
    }
    if (b.dataset.photo) {
      const box = $("ph-" + b.dataset.photo.replace(/:/g, "_"));
      if (box.innerHTML) { box.innerHTML = ""; return; }
      const res = await call(`/admin/photo?key=${encodeURIComponent(b.dataset.photo)}`, null, true);
      box.innerHTML = res.ok ? `<img src="${URL.createObjectURL(await res.blob())}" alt="Matchday photo" style="max-width:100%;max-height:320px;border-radius:8px;margin:6px 0">` : '<span class="note">No photo.</span>';
    }
  });

  // the menu button shows how many results wait for the admin (disputes) – so they're never missed
  const navBtn = document.querySelector('.subnav button[data-panel="members"]');
  async function updateBadge(open) {
    try {
      if (!open) open = (await call("/admin/open")).open;
      const disputes = open.filter(o => o.status === "disputed").length;
      navBtn.textContent = "👥 Member area" + (disputes ? ` · ❗ ${disputes} dispute${disputes === 1 ? "" : "s"}` : "");
    } catch {}
  }
  navBtn.addEventListener("click", loadAll);
  if (api() && get(KEY)) updateBadge();
})();
