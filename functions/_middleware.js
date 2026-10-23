// Password for the staging site (Cloudflare Pages only – GitHub Pages ignores this folder).
// Set STAGING_PASSWORD in the Pages project settings; without it the site stays locked.
// Data and gallery photos come live from the staging branch (what the gatekeeper writes there),
// not from the copy uploaded with the last deploy.
const LIVE = /^\/(data\/[\w-]+\.json|img\/gallery\/[\w-]+\.jpg)$/;
const RAW = "https://raw.githubusercontent.com/ligagppl/ligagppl.github.io/staging";

async function live(path) {
  const res = await fetch(RAW + path, { cf: { cacheTtl: 0 } });
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, { headers: {
    "Content-Type": path.endsWith(".jpg") ? "image/jpeg" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  } });
}

export async function onRequest({ request, env, next }) {
  const expected = env.STAGING_PASSWORD;
  const auth = request.headers.get("Authorization") || "";
  if (expected && auth.startsWith("Basic ")) {
    const [, pass = ""] = atob(auth.slice(6)).split(/:(.*)/s);
    if (pass.length === expected.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(pass), new TextEncoder().encode(expected))) {
      const path = new URL(request.url).pathname;
      const res = LIVE.test(path) ? await live(path) : await next();
      const out = new Response(res.body, res);
      out.headers.set("X-Robots-Tag", "noindex, nofollow");
      return out;
    }
  }
  return new Response("GPPL staging – password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="GPPL staging", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
