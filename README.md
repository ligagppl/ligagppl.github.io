# GPPL website

Static website for the GPPL – German Pakistan Padel Liga. Plain HTML/CSS/JS, so it runs on GitHub Pages or any web server.

## Files

| File | What it is |
|---|---|
| `index.html` | The website: Home, Rules, Schedule, Table, GPPC Cup, Gallery, Register, 🔒 Admin |
| `admin.html` | Organizer area: league results, cup results, live draw, settings (password protected) |
| `draw.html` | Live cup draw – used inside Admin, or on its own for a TV / screen share |
| `assets/data.js` | Settings, pairs, gallery, registration – edit by hand |
| `data/results.json` | League results – entered in Admin |
| `data/cup.json` | Cup rounds and results – created by the draw, scores entered in Admin |
| `assets/league.js` | Shared logic: fixtures, points, tiebreakers, cup progression |
| `assets/store.js` | Loading data and saving it to GitHub |
| `assets/lock.js` | Admin password |
| `assets/app.js`, `assets/style.css` | Website logic and design |

## Season workflow

1. **Before the season:** put the real pairs into `assets/data.js` (the order decides the fixture list) and set `startDate`. Delete the 3 demo results in Admin → League results (or empty `data/results.json` to `[]`).
2. **League:** after each match, an organizer enters the score in **🔒 Admin → League results**. The schedule, table and home page update automatically.
3. **Cup:**
   - **🔒 Admin → Live draw** knows what's next: round 1 (all pairs), the lucky loser draw, then quarter-finals, semi-finals and the final. It pre-selects the right pairs. After the draw, click **Save draw to the cup**.
   - Enter cup scores in **🔒 Admin → Cup results** (full sets). The next draw then picks up the winners automatically.
   - After both semi-finals, a button adds the optional **3rd-place match**.
4. **Verifiable draws:** before each draw, 3 participants each give a word. These **seed words** decide the whole draw (the balls are shown one by one, but the order is fixed by the words). They're saved with the draw, and anyone can recalculate it on the public **✅ Verify draw** tab – or with their own program, following the steps described there.

### Draw algorithm (for anyone who wants to re-implement it)

1. Clean the words: lowercase, keep only a–z and spaces, single spaces.
2. `seed = 0`; for each character: `seed = (seed × 31 + ASCII code) mod 2^32`.
3. Start list = pair IDs in the bowl, sorted ascending.
4. `state = seed`; for `i` = last index down to 1: `state = (1664525 × state + 1013904223) mod 2^32`, `j = state mod (i + 1)`, swap `i` and `j`.
5. Matches = 1st vs 2nd, 3rd vs 4th, …; byes = pairs left at the end; lucky loser draw = the first pairs in the list.

Test case: `mango lahore padel` → seed `2770641191` → pairs 1–10 → `8, 6, 4, 10, 9, 7, 3, 5, 2, 1`.

## Saving to GitHub (one-time setup per admin)

Admin → **Settings**: enter the GitHub owner, repository, branch and a **fine-grained personal access token** with *Contents: Read and write* on the website repository only. The token is stored only in that admin's browser. Saves then go straight into the repository, and the live website updates about a minute later.

Without a connection, saves stay in the browser only (for testing). "Download data files" lets you upload them by hand to the `data/` folder.

## Admin password

Set your own password before going live (the default from development must not be used):

1. In a terminal: `printf '%s' 'your-new-password' | shasum -a 256`
2. Paste the long code into `ADMIN_HASH` at the top of `assets/lock.js`.

The password keeps players out of the admin area, but it's not real security on a static site. The real protection is the GitHub token: without it, nobody can change the published data.

## Publishing on GitHub Pages

1. Create a GitHub account (or organization) called `gppl` – or any name you like.
2. Create a public repository named **`gppl.github.io`** (use your account name instead of `gppl` if different).
3. Upload all files from this folder, including the `data/` folder.
4. Repository → **Settings → Pages** → Source: *Deploy from a branch* → branch `main`, folder `/ (root)` → Save.
5. After a minute the site is live at `https://gppl.github.io`.

## Moving to your own server later

Copy the whole folder to the web root (e.g. with Caddy: `root * /var/www/gppl` + `file_server`). Saving via GitHub then no longer applies – results would need a small backend or manual uploads.

## Privacy

The site is public. Don't put phone numbers or emails in any file, and only post photos of people who agreed to it.
