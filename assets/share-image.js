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

  // rows: [{ label, a, b, center, sub, subSmall }] – center: "vs" or a score, sub: line under the teams (subSmall: small and grey)
  // quiet: the subtitle small and grey (e.g. "from <team>")
  // cups: small 🏆 next to each row's winner (on the score side)
  async function render({ title, subtitle, rows, footer, big, quiet, cups }) {
    const sub = big && !quiet; // large dark subtitle
    const H = 380 + 90 + (subtitle ? (sub ? 64 : 44) : 0) + rows.length * (ROW + (big ? 40 : 16)) + 120;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#dfe7e0"; ctx.fillRect(0, 0, W, H);
    const banner = await loadImg("img/gppl-banner.svg");
    if (banner) ctx.drawImage(banner, 60, 40, 960, 320);
    ctx.fillStyle = "#01411c"; ctx.textAlign = "center";
    fit(ctx, title, W - 120, 50); ctx.fillText(title, W / 2, 425);
    let y = 470;
    if (subtitle) {
      ctx.fillStyle = sub ? "#14201a" : quiet ? "#7a857d" : "#4c5a50"; fit(ctx, subtitle, W - 120, sub ? 38 : quiet ? 26 : 28, sub ? 800 : 600);
      ctx.fillText(subtitle, W / 2, sub ? 478 : 462); y += sub ? 64 : 44;
    }
    const logos = {};
    await Promise.all([...new Set(rows.flatMap(r => [r.a, r.b]))].map(async id => { const s = logoOf(id); logos[id] = s ? await loadImg(s) : null; }));
    const drawLogo = (id, x, y, s) => {
      if (logos[id]) ctx.drawImage(logos[id], x, y, s, s);
      else { ctx.fillStyle = "#d7f23a"; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2.4, 0, 7); ctx.fill(); }
    };
    const name = id => GPPL.pairName(id);
    const rowH = ROW + (big ? 24 : 0);
    rows.forEach(r => {
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.roundRect(40, y, W - 80, rowH, 22); ctx.fill();
      ctx.fillStyle = "#6b776e"; ctx.textAlign = "left"; ctx.font = "700 22px Arial, sans-serif";
      ctx.fillText(r.label, 70, y + 32);
      const s = 80, ly = y + 42;
      drawLogo(r.a, 70, ly, s); drawLogo(r.b, W - 70 - s, ly, s);
      // the score first, so the team names can use the space left beside it
      fit(ctx, r.center, 190, r.center === "vs" ? 30 : 28);
      const CUP = cups && r.winner ? 40 : 0; // room for the trophy
      const centerFont = ctx.font, nameW = Math.min(300, W / 2 - 70 - s - 16 - ctx.measureText(r.center).width / 2 - 24);
      const cup = (x, align) => { ctx.font = "28px Arial, sans-serif"; ctx.textAlign = align; ctx.fillText("🏆", x, ly + 50); };
      // the winner's name in gold (a dark gold gradient, readable on white)
      const gold = () => { const g = ctx.createLinearGradient(0, ly + 20, 0, ly + 56); g.addColorStop(0, "#d9a521"); g.addColorStop(0.5, "#b8860b"); g.addColorStop(1, "#8a6208"); return g; };
      ctx.fillStyle = r.winner === r.a ? gold() : "#14201a"; ctx.textAlign = "left";
      fit(ctx, name(r.a), nameW - (r.winner === r.a ? CUP : 0), 34); ctx.fillText(name(r.a), 70 + s + 16, ly + 50);
      if (CUP && r.winner === r.a) cup(70 + s + 16 + ctx.measureText(name(r.a)).width + 10, "left");
      ctx.fillStyle = r.winner === r.b ? gold() : "#14201a"; ctx.textAlign = "right";
      fit(ctx, name(r.b), nameW - (r.winner === r.b ? CUP : 0), 34); ctx.fillText(name(r.b), W - 70 - s - 16, ly + 50);
      if (CUP && r.winner === r.b) cup(W - 70 - s - 16 - ctx.measureText(name(r.b)).width - 10, "right");
      ctx.fillStyle = r.center === "vs" ? "#0b6b34" : "#14201a"; ctx.textAlign = "center";
      ctx.font = centerFont; ctx.fillText(r.center, W / 2, ly + 48);
      if (r.sub) { const loud = big && !r.subSmall; ctx.fillStyle = loud ? "#14201a" : "#6b776e"; ctx.textAlign = "center"; fit(ctx, r.sub, W - 160, loud ? 27 : 22, loud ? 700 : 600); ctx.fillText(r.sub, W / 2, y + rowH - (big ? 22 : 12)); }
      y += rowH + 16;
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

  // one scheduled match: who, when and where (to post in the WhatsApp group)
  function matchImage({ label, a, b, e }) {
    const day = new Date(e.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    // the date is the headline; cup matches name their round underneath (league matches need no label)
    return render({
      title: `📅 ${day}${e.time ? " · " + GPPL.timeRange(e) : ""}`,
      subtitle: /cup/i.test(label) ? `🏆 ${label}` : "",
      rows: [{ label: "", a, b, center: "vs", sub: e.court ? `📍 ${e.court}` : "" }], big: true,
      footer: "Schedule, table & results: ligagppl.github.io",
    });
  }

  // score of a result from pair a's view, the winner, and a walkover/both-out note
  function resultRow(label, r, a, b, fullSets) {
    if (r.walkover === "both") return { label, a, b, center: "W/O", sub: "Both pairs at fault", winner: null };
    if (r.walkover) return { label, a, b, center: "W/O", sub: `${GPPL.pairName(r.walkover)} win by walkover`, winner: r.walkover };
    const sets = r.a === a ? r.sets : r.sets.map(([x, y]) => [y, x]);
    let wa = 0; sets.forEach(([x, y]) => (x > y ? wa++ : 0));
    return { label, a, b, center: sets.map(([x, y], i) => (i === 2 && !fullSets ? `[${x}-${y}]` : `${x}-${y}`)).join("  "), winner: wa >= 2 ? a : b };
  }

  // one confirmed match: 🏆 winner banner
  // sharedBy: the team sharing it (My team) – when the losers share, the image congratulates the winners from them
  function winnerImage({ label, r, a, b, fullSets, sharedBy }) {
    const row = resultRow("", r, a, b, fullSets);
    const fromLoser = !!sharedBy && !!row.winner && row.winner !== sharedBy;
    return render({
      title: !row.winner ? "🤝 No winner" : fromLoser ? `👏 Congrats, ${GPPL.pairName(row.winner)}!` : `🏆 ${GPPL.pairName(row.winner)} win!`,
      subtitle: fromLoser ? `from ${GPPL.pairName(sharedBy)}` : "", quiet: true, big: true,
      rows: [{ ...row, sub: [row.sub, label].filter(Boolean).join(" · "), subSmall: true }], // matchday / cup round small under the score
      footer: "Schedule, table & results: ligagppl.github.io",
    });
  }

  // several confirmed results in one image (the admin's results update)
  // since: the day of the last shared update (empty for the first one)
  function resultsImage(items, subtitle, since) {
    return render({
      title: since ? `Results since ${since}` : "Results so far",
      subtitle, cups: true,
      rows: items.map(it => resultRow(it.label.toUpperCase(), it.r, it.a, it.b, it.fullSets)),
      footer: "Table & all results: ligagppl.github.io",
    });
  }

  // device share menu (phone, Safari, Chrome) → WhatsApp → choose the chat; otherwise save the file
  async function share(blob, fileName, onNeedsTap) {
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return "shared"; }
      catch (err) { if (err.name === "NotAllowedError") { onNeedsTap && onNeedsTap(); return "tap"; } return "cancelled"; }
    }
    download(blob, fileName);
    return "downloaded";
  }

  return { render, download, matchImage, winnerImage, resultsImage, share };
})();
