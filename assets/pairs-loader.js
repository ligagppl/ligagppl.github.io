// Loads the imported pairs (data/pairs.json, created in Admin → Pairs) before the league
// logic runs – the fixtures are built from them. Falls back to the placeholders in data.js.
// Uses a synchronous request on purpose: everything else depends on the pair list.
(function loadPairs() {
  const use = list => { if (Array.isArray(list) && list.length) { LEAGUE.pairs = list; LEAGUE.pairsImported = true; } };
  let gh = null;
  try { gh = JSON.parse(localStorage.getItem("gppl-gh") || "null"); } catch {}
  const connected = gh && gh.token && gh.owner && gh.repo;

  // local test mode (no GitHub connection): this browser's own import wins
  if (!connected) {
    try { const local = localStorage.getItem("gppl-local-pairs"); if (local) return use(JSON.parse(local)); } catch {}
  }
  try {
    const x = new XMLHttpRequest();
    if (connected) {
      // admins read straight from the repository – always up to date
      x.open("GET", `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data/pairs.json?ref=${encodeURIComponent(gh.branch || "main")}`, false);
      x.setRequestHeader("Accept", "application/vnd.github.raw+json");
      x.setRequestHeader("Authorization", `Bearer ${gh.token}`);
    } else {
      x.open("GET", `data/pairs.json?t=${Date.now()}`, false);
    }
    x.send();
    if (x.status === 200) use(JSON.parse(x.responseText));
  } catch {}

  // league start date (Admin → League results): once it's set, dates and the Schedule tab are shown
  let settings = null;
  if (!connected) { try { settings = JSON.parse(localStorage.getItem("gppl-local-settings") || "null"); } catch {} }
  if (!settings) {
    try {
      const x = new XMLHttpRequest();
      if (connected) {
        x.open("GET", `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data/settings.json?ref=${encodeURIComponent(gh.branch || "main")}`, false);
        x.setRequestHeader("Accept", "application/vnd.github.raw+json");
        x.setRequestHeader("Authorization", `Bearer ${gh.token}`);
      } else x.open("GET", `data/settings.json?t=${Date.now()}`, false);
      x.send();
      if (x.status === 200) settings = JSON.parse(x.responseText);
    } catch {}
  }
  const startDate = settings && /^\d{4}-\d{2}-\d{2}$/.test(settings.startDate || "") ? settings.startDate : null;
  if (startDate) LEAGUE.startDate = startDate;
  // With the member area, the schedule stays private until the organizers publish it (Admin → League results).
  // The admin pages always see it.
  const api = (localStorage.getItem("gppl-member-api") || LEAGUE.memberApi || "").replace(/\/+$/, "");
  const adminPage = /\/(admin|draw)\.html$/.test(location.pathname);
  LEAGUE.scheduleReleased = !api || adminPage || !!(settings && settings.scheduleReleased);
  // the league draw is shuffled with this number – public only once the schedule is released;
  // before that the admin pages fetch it from the gatekeeper
  if (settings && Number.isInteger(settings.drawSeed)) LEAGUE.drawSeed = settings.drawSeed;
  const adminKey = localStorage.getItem("gppl-member-admin");
  if (LEAGUE.drawSeed === undefined && adminPage && api && adminKey) {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", `${api}/admin/draw-seed`, false);
      x.setRequestHeader("Authorization", `Admin ${adminKey}`);
      x.send();
      const seed = x.status === 200 ? JSON.parse(x.responseText).seed : null;
      if (Number.isInteger(seed)) LEAGUE.drawSeed = seed;
    } catch {}
  }
  // With the member area, there is no league draw at all until a start date has made one (Admin → League results)
  LEAGUE.noDraw = !!api && !Number.isInteger(LEAGUE.drawSeed);
  LEAGUE.datesConfirmed = LEAGUE.scheduleVisible = !!startDate && LEAGUE.scheduleReleased;
})();
