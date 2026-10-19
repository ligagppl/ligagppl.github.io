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
  //  PAIRS – imported in 🔒 Admin → Pairs (saved in /data/pairs.json).
  //  Empty until the first import.
  // ----------------------------------------------------------
  pairs: [],

  // ----------------------------------------------------------
  //  TEAM LOGOS – by team name (exactly as registered), files in /img/logos
  //  src = still logo, anim = animated version played on hover / tap
  // ----------------------------------------------------------
  logos: {
    "Sting Smashers": { src: "img/logos/sting-smashers.svg?v=2", anim: "img/logos/sting-smashers-anim.svg?v=5" },
    "Vibora Vipers": { src: "img/logos/vibora-vipers.svg?v=2", anim: "img/logos/vibora-vipers-anim.svg?v=1" },
    "Kaantay Walay Phool": { src: "img/logos/kwp.svg?v=2", anim: "img/logos/kwp-anim.svg?v=4" },
  },

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
