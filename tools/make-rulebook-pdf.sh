#!/bin/sh
# Re-creates GPPL-Rulebook-Season-1.pdf from the website's rulebook.
# Run it after changing the rules (the site must be running locally, e.g. on port 8765):
#   python3 -m http.server 8765        (in the site folder, in another terminal)
#   sh tools/make-rulebook-pdf.sh
cd "$(dirname "$0")/.." || exit 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --virtual-time-budget=8000 --run-all-compositor-stages-before-draw \
  --print-to-pdf="GPPL-Rulebook-Season-1.pdf" "http://localhost:${PORT:-8765}/index.html?pdf=$(date +%s)#rules" 2>/dev/null
ls -la GPPL-Rulebook-Season-1.pdf
