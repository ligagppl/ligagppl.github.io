// Loading and saving of /data/*.json
//  - Everyone loads the JSON files published with the website.
//  - Admins save straight into the GitHub repository via the GitHub API
//    (token stored only in the admin's own browser – see the Admin → Settings tab).
//  - Without a GitHub connection, saves stay in this browser and are downloaded as a file.

const STORE = (() => {
  const FILES = { results: "data/results.json", cup: "data/cup.json", settings: "data/settings.json", pairs: "data/pairs.json", matches: "data/matches.json", gallery: "data/gallery.json" };
  const LOCAL_KEY = key => `gppl-local-${key}`;

  function ghConfig() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem("gppl-gh") || "null"); } catch {}
    // the staging site works on the private repository (its "staging" branch); the public one only has the live site
    if (c && /gppl-staging/.test(location.hostname)) c = { ...c, repo: "gppl-site", branch: "staging" };
    return c;
  }
  function setGhConfig(cfg) {
    try {
      if (cfg) localStorage.setItem("gppl-gh", JSON.stringify(cfg));
      else localStorage.removeItem("gppl-gh");
    } catch {}
  }
  const connected = () => { const c = ghConfig(); return !!(c && c.token && c.owner && c.repo); };

  async function load(key, fallback) {
    // local test mode: this browser's own saves win when there's no GitHub connection
    if (!connected()) {
      try { const local = localStorage.getItem(LOCAL_KEY(key)); if (local) return JSON.parse(local); } catch {}
    } else {
      // admins read straight from the repository – always up to date (Pages lags ~1 minute)
      try {
        const res = await ghRequest(FILES[key], { raw: true });
        if (res.ok) return await res.json();
      } catch {}
    }
    try {
      const res = await fetch(`${FILES[key]}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch {
      return fallback;
    }
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach(b => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function ghRequest(path, options = {}) {
    const c = ghConfig();
    const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
    const { raw, ...fetchOptions } = options;
    return fetch(url + (options.method ? "" : `?ref=${encodeURIComponent(c.branch || "main")}`), {
      ...fetchOptions,
      cache: "no-store",
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: `Bearer ${c.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  }

  // tell the website (parent page) and other open tabs that data changed
  function notifyChange(key, data) {
    try { window.top.postMessage({ gppl: "data-changed", key, data }, location.origin); } catch {}
    try { localStorage.setItem("gppl-changed", JSON.stringify({ key, t: Date.now() })); } catch {}
  }

  // returns "github" or "local"
  async function save(key, data, message) {
    const text = JSON.stringify(data, null, 2) + "\n";
    if (!connected()) {
      try { localStorage.setItem(LOCAL_KEY(key), text); } catch {}
      notifyChange(key, data);
      return "local";
    }
    const c = ghConfig();
    // the staging copy of the site must never write to the live site's branch
    if (/gppl-staging/.test(location.hostname) && (c.branch || "main") !== "staging") {
      throw new Error('This is the staging site – set the GitHub branch to "staging" in Settings.');
    }
    const path = FILES[key];
    let sha;
    const current = await ghRequest(path);
    if (current.ok) sha = (await current.json()).sha;
    else if (current.status !== 404) throw new Error(`GitHub: ${current.status} ${current.statusText}`);
    const res = await ghRequest(path, {
      method: "PUT",
      body: JSON.stringify({ message: `GPPL: ${message}`, content: toBase64(text), branch: c.branch || "main", sha }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub: ${res.status} ${err.message || res.statusText}`);
    }
    notifyChange(key, data);
    return "github";
  }

  async function testConnection() {
    const res = await ghRequest(FILES.results);
    if (res.ok) return "ok";
    if (res.status === 404) return "Repository or file not found – check owner, repo and branch.";
    if (res.status === 401) return "Token not valid.";
    if (res.status === 403) return "Token has no access to this repository.";
    return `GitHub error ${res.status}`;
  }

  function clearLocal() {
    try { Object.keys(FILES).forEach(k => localStorage.removeItem(LOCAL_KEY(k))); } catch {}
  }

  // download the current data files (e.g. to upload them to GitHub by hand)
  async function downloadAll() {
    for (const key of Object.keys(FILES)) {
      const data = await load(key, key === "cup" ? { rounds: [] } : key === "settings" || key === "matches" ? {} : []);
      download(FILES[key].split("/").pop(), JSON.stringify(data, null, 2) + "\n");
    }
  }

  return { load, save, ghConfig, setGhConfig, connected, testConnection, clearLocal, downloadAll };
})();
