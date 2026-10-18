// Admin password lock for the Draw and Admin pages.
// This keeps players out of the admin tools – it is not real security on a static site.
// Change the password: printf '%s' 'new-password' | shasum -a 256  → paste below.
const ADMIN_HASH = "d3f009ef9561f55f578b1cebb2769d8d305a69633f243a0dda9cda1230ac8b3f";

if (window.self !== window.top) document.documentElement.classList.add("embedded");

function requireAdmin(onUnlock) {
  const style = document.createElement("style");
  style.textContent = `
    body.locked > *:not(#lock) { display: none !important; }
    #lock { position: fixed; inset: 0; z-index: 10; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 16px; }
    #lock form { max-width: 360px; width: 100%; text-align: center; }
    #lock input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; margin: 12px 0; }
    #lock .err { color: var(--loss); min-height: 1.4em; font-size: .9rem; }
    .embedded body { background: transparent; }
    .embedded body > header, .embedded .back-link { display: none !important; }
    .embedded body > main { padding: 0 0 24px; }
    .embedded #lock { position: absolute; background: transparent; align-items: flex-start; padding-top: 40px; }`;
  document.head.appendChild(style);

  const done = () => {
    const lock = document.getElementById("lock");
    if (lock) lock.remove();
    document.body.classList.remove("locked");
    onUnlock();
  };

  let ok = false;
  try { ok = sessionStorage.getItem("gppl-admin") === ADMIN_HASH; } catch {}
  if (ok) return done();

  document.body.classList.add("locked");
  const lock = document.createElement("div");
  lock.id = "lock";
  lock.innerHTML = `
    <form class="card">
      <div style="font-size:2rem">🔒</div>
      <h2 style="margin:6px 0 0">Organizers only</h2>
      <p class="note" style="margin:4px 0 0">This area is for the league organizers.</p>
      <input type="password" placeholder="Admin password" autocomplete="current-password" autofocus>
      <div class="err"></div>
      <button class="btn" type="submit">Unlock</button>
      <p class="note back-link"><a href="index.html">← Back to the website</a></p>
    </form>`;
  document.body.prepend(lock);

  lock.querySelector("form").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = lock.querySelector("input").value.trim(); // ignore spaces/line breaks from copy & paste
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
    const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hash === ADMIN_HASH) {
      try { sessionStorage.setItem("gppl-admin", hash); } catch {}
      done();
    } else {
      lock.querySelector(".err").textContent = "Wrong password";
    }
  });
}
