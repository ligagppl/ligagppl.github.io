// Password for the staging site (Cloudflare Pages only – GitHub Pages ignores this folder).
// Set STAGING_PASSWORD in the Pages project settings; without it the site stays locked.
export async function onRequest({ request, env, next }) {
  const expected = env.STAGING_PASSWORD;
  const auth = request.headers.get("Authorization") || "";
  if (expected && auth.startsWith("Basic ")) {
    const [, pass = ""] = atob(auth.slice(6)).split(/:(.*)/s);
    if (pass.length === expected.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(pass), new TextEncoder().encode(expected))) {
      const res = await next();
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
