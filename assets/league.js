// Shared league + cup logic (website, admin and draw pages)

const GPPL = (() => {
  const DAY = 86400000;
  const pairById = Object.fromEntries(LEAGUE.pairs.map(p => [p.id, p]));
  const pairName = id => (pairById[id] ? pairById[id].name : "?");
  let start = new Date(LEAGUE.startDate + "T00:00:00");
  // the league start date (Admin → League results): sets every matchday date; none = dates and Schedule hidden
  function setStartDate(iso) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(iso || "");
    if (ok) { LEAGUE.startDate = iso; start = new Date(iso + "T00:00:00"); }
    LEAGUE.datesConfirmed = LEAGUE.scheduleVisible = ok;
  }
  const fmt = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  function matchdayWindow(md) {
    const from = new Date(start.getTime() + (md - 1) * LEAGUE.matchdayLengthDays * DAY);
    const to = new Date(from.getTime() + (LEAGUE.matchdayLengthDays - 1) * DAY);
    return { from, to };
  }

  // single round-robin, circle method
  function buildFixtures(ids) {
    const list = ids.slice();
    if (list.length % 2) list.push(null);
    const n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const games = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i], b = list[n - 1 - i];
        if (a !== null && b !== null) games.push(r % 2 ? [b, a] : [a, b]);
      }
      rounds.push(games);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }
  const fixtures = buildFixtures(LEAGUE.pairs.map(p => p.id));

  const samePair = (r, a, b) => (r.a === a && r.b === b) || (r.a === b && r.b === a);
  const findResult = (results, a, b) => results.find(r => samePair(r, a, b));

  // ---------- league scoring ----------
  // 3rd set = match tie-break → counts 1–0 in games. Walkover: winner 3, loser −1.
  // walkover "both": both pairs at fault (or no team photo and not replayed) → −1 each, no winner.
  function evaluate(r) {
    if (r.walkover === "both") {
      return { winner: null, loser: null, both: true, setsW: 0, setsL: 0, gamesW: 0, gamesL: 0, ptsW: -1, ptsL: -1 };
    }
    if (r.walkover) {
      const w = r.walkover, l = w === r.a ? r.b : r.a;
      return { winner: w, loser: l, setsW: 2, setsL: 0, gamesW: 0, gamesL: 0, ptsW: 3, ptsL: -1 };
    }
    let sa = 0, sb = 0, ga = 0, gb = 0;
    r.sets.forEach(([x, y], i) => {
      if (x > y) sa++; else sb++;
      if (i === 2) { if (x > y) ga++; else gb++; } else { ga += x; gb += y; }
    });
    const aWins = sa > sb;
    const setsL = Math.min(sa, sb);
    return {
      winner: aWins ? r.a : r.b, loser: aWins ? r.b : r.a,
      setsW: Math.max(sa, sb), setsL,
      gamesW: aWins ? ga : gb, gamesL: aWins ? gb : ga,
      ptsW: setsL === 0 ? 3 : 2, ptsL: setsL === 0 ? 0 : 1,
    };
  }

  // score text from the point of view of pair `first`
  function scoreText(r, first, tieBreakThird = true) {
    if (r.walkover === "both") return "W/O (both −1)";
    if (r.walkover) return "W/O";
    const flip = first !== undefined && r.a !== first;
    return r.sets.map(([x, y], i) => {
      const [p, q] = flip ? [y, x] : [x, y];
      return tieBreakThird && i === 2 ? `[${p}-${q}]` : `${p}-${q}`;
    }).join(" ");
  }

  function computeStandings(results, ids) {
    const s = {};
    ids.forEach(id => (s[id] = { id, p: 0, w: 0, l: 0, sf: 0, sa: 0, gf: 0, ga: 0, pts: 0 }));
    results.forEach(r => {
      if (!s[r.a] || !s[r.b]) return;
      const e = evaluate(r);
      if (e.both) { // counts as played, −1 for both, no win/loss
        [s[r.a], s[r.b]].forEach(x => { x.p++; x.pts -= 1; });
        return;
      }
      const W = s[e.winner], L = s[e.loser];
      W.p++; L.p++; W.w++; L.l++;
      W.sf += e.setsW; W.sa += e.setsL; L.sf += e.setsL; L.sa += e.setsW;
      W.gf += e.gamesW; W.ga += e.gamesL; L.gf += e.gamesL; L.ga += e.gamesW;
      W.pts += e.ptsW; L.pts += e.ptsL;
    });
    return Object.values(s);
  }

  // points → head-to-head (mini table) → matches won → set diff → game diff
  function rankStandings(results) {
    const ids = LEAGUE.pairs.map(p => p.id);
    const rows = computeStandings(results, ids);
    const byPts = {};
    rows.forEach(r => (byPts[r.pts] = byPts[r.pts] || []).push(r));
    Object.values(byPts).forEach(group => {
      if (group.length < 2) return group.forEach(r => (r.h2h = 0));
      const gIds = group.map(r => r.id);
      const mini = computeStandings(results.filter(r => gIds.includes(r.a) && gIds.includes(r.b)), gIds);
      group.forEach(r => (r.h2h = mini.find(m => m.id === r.id).pts));
    });
    return rows.sort((x, y) =>
      y.pts - x.pts || y.h2h - x.h2h || y.w - x.w ||
      (y.sf - y.sa) - (x.sf - x.sa) || (y.gf - y.ga) - (x.gf - x.ga) ||
      x.id - y.id); // finally (and before any result): registration order = seed
  }

  // "19:00" + 90 minutes → "19:00–20:30" (matches are booked for 60, 90 or 120 minutes; 90 if not set)
  function timeRange(e) {
    if (!e || !e.time) return "";
    const [h, m] = e.time.split(":").map(Number), end = h * 60 + m + (+e.duration || 90);
    return `${e.time}–${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }

  // ---------- milestones ----------
  // How far a pair is with its league matches. `schedule` = dates and results waiting (private,
  // from the gatekeeper). Each milestone: by the end of matchday `md`, at least `min` matches played.
  function milestoneProgress(results, schedule, id, now = Date.now()) {
    const total = fixtures.reduce((n, g) => n + g.filter(([a, b]) => a === id || b === id).length, 0);
    const mine = fixtures.flat().filter(([a, b]) => a === id || b === id);
    const key = (a, b) => `L:${Math.min(a, b)}-${Math.max(a, b)}`;
    let played = 0, waiting = 0;
    const planned = []; // dates of scheduled matches without a result yet
    mine.forEach(([a, b]) => {
      const e = (schedule || {})[key(a, b)] || {};
      if (findResult(results, a, b)) played++;
      else if (e.pending) waiting++;
      else if (e.date) planned.push(new Date(`${e.date}T${e.time || "12:00"}:00`).getTime());
    });
    const list = ((LEAGUE.milestonesByPairs || {})[LEAGUE.pairs.length] || []).map((m, i) => {
      const deadline = matchdayWindow(m.md).to.getTime() + DAY - 1; // end of that matchday
      const required = m.min === "all" ? total : Math.min(m.min, total);
      return { n: i + 1, md: m.md, required, deadline, all: m.min === "all", passed: now > deadline };
    });
    // the next milestone still to reach (or, once all upcoming ones are reached, the next one by date)
    const next = list.find(m => !m.passed && played < m.required) || list.find(m => !m.passed) || null;
    list.forEach(m => {
      if (played >= m.required) m.status = "reached";
      else if (m.passed) m.status = "missed";
      else if (m === next) {
        const possible = played + waiting + planned.filter(t => t <= m.deadline).length;
        // "behind" only in the last matchday before the deadline – earlier there's still time to plan
        m.status = possible >= m.required ? "on-track" : m.deadline - now > LEAGUE.matchdayLengthDays * DAY ? "open" : "behind";
      } else m.status = "upcoming";
      m.missing = Math.max(0, m.required - played);
    });
    return { total, played, waiting, scheduled: planned.length, milestones: list, next };
  }

  // ---------- cup ----------
  // match: { a, b, sets: [[6,4],[3,6],[10,7]], walkover: id, winner: id }
  // 3rd set: match tie-break, except in the semi-finals and the final (3 full sets)
  const cupFullSets = round => !!round && (round.name === "Semi-finals" || round.name === "Final");
  // walkover "both": both pairs at fault → both out, nobody goes through
  function cupWinner(m) {
    if (m.walkover === "both") return null;
    if (m.walkover) return m.walkover;
    if (m.winner) return m.winner;
    if (!m.sets || !m.sets.length) return null;
    let sa = 0, sb = 0;
    m.sets.forEach(([x, y]) => (x > y ? sa++ : sb++));
    return sa >= 2 ? m.a : sb >= 2 ? m.b : null;
  }
  const cupLoser = m => { const w = cupWinner(m); return w ? (w === m.a ? m.b : m.a) : null; };
  const isDecided = m => !!cupWinner(m) || m.walkover === "both";
  const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
  const roundName = n => ({ 2: "Final", 3: "Semi-finals", 4: "Semi-finals", 5: "Quarter-finals", 6: "Quarter-finals", 7: "Quarter-finals", 8: "Quarter-finals", 16: "Round of 16" }[n] || `Round of ${n}`);
  const mainRounds = cup => (cup.rounds || []).filter(r => !r.third);
  const advancing = round => round.matches.map(cupWinner).filter(Boolean).concat(round.byes || []);

  // What should be drawn next? Used to pre-fill the draw page.
  function cupNextStage(cup) {
    const rounds = mainRounds(cup);
    if (!rounds.length) {
      return { type: "matches", name: "Round 1", entrants: LEAGUE.pairs.map(p => p.id) };
    }
    const last = rounds[rounds.length - 1];
    if (last.type === "lucky") {
      const prev = rounds.slice(0, -1).reverse().find(r => r.type === "matches");
      const entrants = advancing(prev).concat(last.lucky);
      return { type: "matches", name: roundName(entrants.length), entrants };
    }
    const pending = last.matches.filter(m => !isDecided(m));
    if (pending.length) return { type: "waiting", name: last.name, pending };
    const adv = advancing(last);
    if (adv.length === 1) return { type: "done", champion: adv[0] };
    if (adv.length === 0) return { type: "done", champion: null };
    // after the semi-finals: no draw – the two winners meet in the final
    if (adv.length === 2) return { type: "final", name: "Final", entrants: adv };
    // lucky losers only fill the quarter-finals after a round 1 with more than 8 pairs;
    // otherwise an odd number of pairs simply gets a bye in the next draw
    const isFirstRound = rounds.filter(r => r.type === "matches").length === 1;
    const firstRoundSize = last.matches.length * 2 + (last.byes || []).length;
    if (!isPow2(adv.length) && isFirstRound && firstRoundSize > 8) {
      const target = 2 ** Math.ceil(Math.log2(adv.length));
      const losers = last.matches.map(cupLoser).filter(Boolean); // pairs out by double walkover can't be lucky losers
      return { type: "lucky", name: "Lucky loser draw", entrants: losers, lucky: Math.min(target - adv.length, losers.length) };
    }
    return { type: "matches", name: roundName(adv.length), entrants: adv };
  }

  // ---------- verifiable draw (simple arithmetic – reproducible in any language) ----------
  const M32 = 4294967296; // 2^32

  // keep a–z and single spaces: "Mango  Lahore Padel!" → "mango lahore padel"
  const cleanWords = text => text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean).join(" ");

  // seed = (seed × 31 + ASCII code) mod 2^32, character by character
  function wordsToSeed(text) {
    const clean = cleanWords(text);
    let seed = 0;
    for (const c of clean) seed = (seed * 31 + c.charCodeAt(0)) % M32;
    return { clean, seed };
  }

  // Fisher–Yates with the generator state = (1664525 × state + 1013904223) mod 2^32
  function seededShuffle(seed, ids) {
    const order = ids.slice().sort((a, b) => a - b);
    const steps = [];
    let state = seed;
    for (let i = order.length - 1; i > 0; i--) {
      state = (1664525 * state + 1013904223) % M32;
      const j = state % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
      steps.push({ i, state, j, list: order.slice() });
    }
    return { start: ids.slice().sort((a, b) => a - b), order, steps };
  }

  // turn the shuffled order into the draw: matches from the front, byes at the end,
  // or – for a lucky loser draw – the first `lucky` pairs get back in
  function drawFromOrder(order, type, count) {
    if (type === "lucky") return { lucky: order.slice(0, count) };
    const matches = [];
    for (let i = 0; i < count; i++) matches.push({ a: order[i * 2], b: order[i * 2 + 1] });
    return { matches, byes: order.slice(count * 2) };
  }

  // Recompute a saved round from its words and compare with what was saved
  function verifyRound(round) {
    const { clean, seed } = wordsToSeed(round.words);
    const shuffle = seededShuffle(seed, round.entrants);
    const count = round.type === "lucky" ? round.lucky.length : round.matches.length;
    const draw = drawFromOrder(shuffle.order, round.type, count);
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    const ok = round.type === "lucky"
      ? same(draw.lucky, round.lucky)
      : round.matches.every((m, i) => m.a === draw.matches[i].a && m.b === draw.matches[i].b) && same(draw.byes, round.byes || []);
    return { ok, clean, seed, shuffle, draw };
  }

  // If the semi-finals are complete and there's no final yet, add it (semi-final 1 winner vs semi-final 2 winner).
  // Returns true if the cup was changed.
  function addFinalIfDue(cup) {
    const ns = cupNextStage(cup);
    if (ns.type !== "final") return false;
    cup.rounds.push({ name: "Final", type: "matches", matches: [{ a: ns.entrants[0], b: ns.entrants[1] }], byes: [] });
    return true;
  }

  return {
    DAY, get start() { return start; }, setStartDate, fmt, pairById, pairName, matchdayWindow, fixtures, findResult, samePair, milestoneProgress, timeRange,
    evaluate, scoreText, rankStandings, cupFullSets, cupWinner, cupLoser, cupNextStage, mainRounds, roundName, addFinalIfDue,
    cleanWords, wordsToSeed, seededShuffle, drawFromOrder, verifyRound,
  };
})();
