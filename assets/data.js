// ============================================================
//  GPPL – league settings and pairs.
//  Results and cup data live in /data/results.json and /data/cup.json
//  and are entered on the 🔒 Admin tab.
// ============================================================

const LEAGUE = {
  name: "GPPL – German Pakistan Padel Liga",
  season: "Season 1",

  // First day of matchday 1 (YYYY-MM-DD) and matchday length in days
  // Tabs shown in the menu, in this order (the first one opens by default).
  // Pre-season: only registration and rules. During the season, use e.g.:
  // ["home", "rules", "schedule", "table", "cup", "participants", "gallery", "register", "verify", "admin"]
  // Tabs not listed are hidden; #admin always stays reachable by its link.
  visibleTabs: ["register", "rules", "participants"],

  startDate: "2026-11-09",
  matchdayLengthDays: 10,
  // false = the start date isn't final yet: the website shows no dates (only "Matchday 1, 2, …").
  // Set to true once the start date is fixed.
  datesConfirmed: false,

  // Milestones per number of pairs: minimum number of matches each pair must have played
  // by the end of a matchday. min: "all" = every league match (before the finale).
  // Shown in the schedule. For other sizes, add an entry on the same model.
  // GPPC Cup windows per number of pairs: each round is played within league matchdays from–to,
  // with the draw at the start of the window. Shown in the schedule.
  cupWindowsByPairs: {
    8:  [{ from: 4, to: 5, round: "Quarter-finals" }, { from: 6, to: 7, round: "Semi-finals" }],
    12: [{ from: 6, to: 7, round: "Round 1" },
         { from: 8, to: 9, round: "Quarter-finals", draw: "lucky loser draw + quarter-final draw" },
         { from: 10, to: 11, round: "Semi-finals" }],
  },

  milestonesByPairs: {
    8:  [{ md: 3, min: 2 }, { md: 6, min: 4 }, { md: 7, min: "all" }],
    12: [{ md: 4, min: 2 }, { md: 8, min: 6 }, { md: 11, min: "all" }],
  },

  // ----------------------------------------------------------
  //  PAIRS – replace the placeholders after registration.
  //  The order here decides the fixture list.
  //  ⚠️ Don't change ids once results have been entered.
  // ----------------------------------------------------------
  pairs: [
    { id: 1,  name: "Pair 1",  players: ["Player 1A", "Player 1B"] },
    { id: 2,  name: "Pair 2",  players: ["Player 2A", "Player 2B"] },
    { id: 3,  name: "Pair 3",  players: ["Player 3A", "Player 3B"] },
    { id: 4,  name: "Pair 4",  players: ["Player 4A", "Player 4B"] },
    { id: 5,  name: "Pair 5",  players: ["Player 5A", "Player 5B"] },
    { id: 6,  name: "Pair 6",  players: ["Player 6A", "Player 6B"] },
    { id: 7,  name: "Pair 7",  players: ["Player 7A", "Player 7B"] },
    { id: 8,  name: "Pair 8",  players: ["Player 8A", "Player 8B"] },
    { id: 9,  name: "Pair 9",  players: ["Player 9A", "Player 9B"] },
    { id: 10, name: "Pair 10", players: ["Player 10A", "Player 10B"] },
  ],

  // ----------------------------------------------------------
  //  GALLERY – put images in the /img folder (keep them < 500 KB)
  // ----------------------------------------------------------
  gallery: [
    // { src: "img/kickoff-1.jpg", caption: "Kick-off evening" },
  ],

  // ----------------------------------------------------------
  //  REGISTRATION & PAYMENT
  //  formUrl: Google Form → Send → <> embed → copy the src="..." link
  // ----------------------------------------------------------
  registration: {
    open: false,
    formUrl: "",
    deadline: "TBD",
    fee: "Details coming soon",
    paymentNote: "Payment details will be shared with registered pairs.",
  },
};
