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
  // ["home", "rules", "schedule", "table", "cup", "participants", "gallery", "verify", "admin"]
  // Tabs not listed are hidden; #admin always stays reachable by its link.
  // Register and Participants leave the menu automatically once registration is closed (Admin → Registration)
  // or the league start date is set (Admin → League results); Participants stays reachable from Home.
  visibleTabs: ["home", "rules", "participants", "team"],

  // Member area gatekeeper (Cloudflare Worker) – empty = member area closed
  // Venues suggested first when teams set a match (My team → Set Date / Venue). Format: "Name, street, postcode city".
  // All are on Playtomic, except the PadelCity venues (they book through their own app).
  venues: [
    "PadelCity Tucherpark, Am Eisbach 5, 80538 München",
    "PadelCity Frankfurter Ring, Taunusstraße 40, 80807 München",
    "PadelCity Erding, Schollbach 17, 85435 Erding",
    "PadelCity Neufahrn (Alpha Club), Auweg 100, 85375 Neufahrn bei Freising",
    "Casa Padel Pineapple Park, Arnulfstraße 195, 80634 München",
    "Casa Padel Johanneskirchen, Musenbergstraße 40, 81929 München",
    "Lucky Star Padel @ Das Anders, Moosacher Straße 70, 80809 München",
    "Padel Seasons, Paul-Ehrlich-Weg 6, 80999 München",
    "PadelPit, Heiglhofstraße 25, 81377 München",
    "Münchner Sportclub e.V., Eberwurzstraße 28, 80935 München",
    "ESV Sportfreunde Neuaubing, Centa-Hafenbrädl-Straße 8, 81249 München",
    "Scheck Club Padel + Pickleball, Münchner Straße 15, 85774 Unterföhring",
    "TC Unterföhring, Jahnstraße 7, 85774 Unterföhring",
    "Padelon München, Verdistraße 45, 85591 Vaterstetten",
    "Padel Factoría, Zeppelinstraße 4, 85748 Garching",
    "STK Padel Campus, Am See 3, 85748 Garching",
    "Casa Padel Agrob Campus, Münchener Straße 101, 85737 Ismaning",
    "Sport Raschke, Ahornring 74, 82024 Taufkirchen",
    "Padel Garden TC Puchheim, Bürgermeister-Ertl-Straße 3, 82178 Puchheim",
    "Padel Cube (SV Ampermoching), Alternstraße 33, 85241 Hebertshausen",
    "Padel Finsing bei BattleKart, Am Steinfeld 3, 85464 Finsing",
    "TC Blau-Weiß Neufahrn, Am Sportplatz 18, 85375 Neufahrn bei Freising",
    "Padel Neufahrn, Käthe-Winkelmann-Platz 1, 85375 Neufahrn bei Freising",
  ],

  memberApi: "https://gppl-members.gppl-members.workers.dev",
  memberMode: "signin",   // "signin" = 🎾 My team only signs teams in (before the season) – "Schedule coming soon"
  // Cloudflare Turnstile site key for the My team login (public) – empty = no security check
  turnstileSiteKey: "",

  startDate: "2026-11-02",
  matchdayLengthDays: 10,
  // Dates and the Schedule tab are shown once the start date is set in Admin → League results
  // (data/settings.json → startDate, which then overrides startDate above).
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
    "Sting Smashers": { src: "img/logos/sting-smashers.svg?v=2", anim: "img/logos/sting-smashers-anim.svg?v=8" },
    "Vibora Vipers": { src: "img/logos/vibora-vipers.svg?v=2", anim: "img/logos/vibora-vipers-anim.svg?v=1" },
    "Kaantay Walay Phool": { src: "img/logos/kwp.svg?v=2", anim: "img/logos/kwp-anim.svg?v=6" },
    "Mavericks": { src: "img/logos/mavericks.svg?v=1", anim: "img/logos/mavericks-anim.svg?v=1" },
    "Racket Scientists": { src: "img/logos/racket-scientists.svg?v=1", anim: "img/logos/racket-scientists-anim.svg?v=1" },
    "Bandeja Bandits": { src: "img/logos/bandeja-bandits.svg?v=1", anim: "img/logos/bandeja-bandits-anim.svg?v=1" },
    "Patience & Placement": { src: "img/logos/patience-placement.svg?v=1", anim: "img/logos/patience-placement-anim.svg?v=2" },
    "Unforced Terrors": { src: "img/logos/unforced-terrors.svg?v=1", anim: "img/logos/unforced-terrors-anim.svg?v=1" },
    "Sheesha Torr": { src: "img/logos/sheesha-torr.svg?v=2", anim: "img/logos/sheesha-torr-anim.svg?v=2" },
    "Smashistan": { src: "img/logos/smashistan.svg?v=1", anim: "img/logos/smashistan-anim.svg?v=1" },
    "Padel to the Metal": { src: "img/logos/padel-to-the-metal.svg?v=1", anim: "img/logos/padel-to-the-metal-anim.svg?v=1" },
    "Spin Reapers": { src: "img/logos/spin-reapers.svg?v=1", anim: "img/logos/spin-reapers-anim.svg?v=1" },
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
