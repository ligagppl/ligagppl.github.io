// Shareable images (WhatsApp) in the style of the live draw image:
// GPPL banner, a title, one white row per match with both team logos, a footer and the flag stripe.
const GPPLImage = (() => {
  const W = 1080, ROW = 150;
  const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const logoOf = id => {
    const p = GPPL.pairById[id], l = p && (LEAGUE.logos || {})[p.name];
    return l ? (typeof l === "string" ? l : l.src) : null;
  };
  function fit(ctx, text, maxW, size, weight = 800) {
    let s = size;
    do { ctx.font = `${weight} ${s}px Arial, sans-serif`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 16);
  }

  // rows: [{ label, a, b, center, sub }] – center: "vs" or a score, sub: small line under the teams
  async function render({ title, subtitle, rows, footer }) {
    const H = 380 + 90 + (subtitle ? 44 : 0) + rows.length * (ROW + 16) + 120;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#dfe7e0"; ctx.fillRect(0, 0, W, H);
    const banner = await loadImg("img/gppl-banner.svg");
    if (banner) ctx.drawImage(banner, 60, 40, 960, 320);
    ctx.fillStyle = "#01411c"; ctx.textAlign = "center";
    fit(ctx, title, W - 120, 50); ctx.fillText(title, W / 2, 425);
    let y = 470;
    if (subtitle) { ctx.fillStyle = "#4c5a50"; ctx.font = "600 28px Arial, sans-serif"; ctx.fillText(subtitle, W / 2, 462); y += 44; }
    const logos = {};
    await Promise.all([...new Set(rows.flatMap(r => [r.a, r.b]))].map(async id => { const s = logoOf(id); logos[id] = s ? await loadImg(s) : null; }));
    const drawLogo = (id, x, y, s) => {
      if (logos[id]) ctx.drawImage(logos[id], x, y, s, s);
      else { ctx.fillStyle = "#d7f23a"; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2.4, 0, 7); ctx.fill(); }
    };
    const name = id => GPPL.pairName(id);
    rows.forEach(r => {
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.roundRect(40, y, W - 80, ROW, 22); ctx.fill();
      ctx.fillStyle = "#6b776e"; ctx.textAlign = "left"; ctx.font = "700 22px Arial, sans-serif";
      ctx.fillText(r.label, 70, y + 32);
      const s = 80, ly = y + 42;
      drawLogo(r.a, 70, ly, s); drawLogo(r.b, W - 70 - s, ly, s);
      ctx.fillStyle = r.winner === r.a ? "#0b6b34" : "#14201a"; ctx.textAlign = "left";
      fit(ctx, name(r.a), 300, 34); ctx.fillText(name(r.a), 70 + s + 16, ly + 50);
      ctx.fillStyle = r.winner === r.b ? "#0b6b34" : "#14201a"; ctx.textAlign = "right";
      fit(ctx, name(r.b), 300, 34); ctx.fillText(name(r.b), W - 70 - s - 16, ly + 50);
      ctx.fillStyle = r.center === "vs" ? "#0b6b34" : "#14201a"; ctx.textAlign = "center";
      fit(ctx, r.center, 190, r.center === "vs" ? 30 : 28); ctx.fillText(r.center, W / 2, ly + 48);
      if (r.sub) { ctx.fillStyle = "#6b776e"; ctx.textAlign = "center"; fit(ctx, r.sub, W - 160, 21, 600); ctx.fillText(r.sub, W / 2, y + ROW - 12); }
      y += ROW + 16;
    });
    ctx.fillStyle = "#4c5a50"; ctx.textAlign = "center"; fit(ctx, footer, W - 120, 26, 600); ctx.fillText(footer, W / 2, y + 50);
    [["#01411c", 0.25], ["#ffffff", 0.25], ["#111111", 1 / 6], ["#dd0000", 1 / 6], ["#ffce00", 1 / 6]].reduce((x, [col, f]) => {
      ctx.fillStyle = col; ctx.fillRect(x, H - 16, W * f, 16); return x + W * f; }, 0);
    return new Promise(r => c.toBlob(r, "image/png"));
  }

  function download(blob, fileName) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { render, download };
})();
