// Loads the imported pairs (data/pairs.json, created in Admin → Pairs) before the league
// logic runs – the fixtures are built from them. Falls back to the placeholders in data.js.
// Uses a synchronous request on purpose: everything else depends on the pair list.
(function loadPairs() {
  const use = list => { if (Array.isArray(list) && list.length) LEAGUE.pairs = list; };
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
})();
