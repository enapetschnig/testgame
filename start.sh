#!/usr/bin/env bash
# Startet Frojach Drive unter macOS und Linux.
#
#   ./start.sh
#
# Beim ersten Mal werden die Abhaengigkeiten geholt und gebaut, das dauert
# eine Minute. Danach geht es sofort los.

set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'

  Node.js ist nicht installiert.
  Bitte von https://nodejs.org holen (LTS-Fassung) und danach erneut starten.

MSG
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "  Einmalige Einrichtung, bitte kurz warten ..."
  echo
  npm install
fi

if [ ! -f dist/index.html ]; then
  echo
  echo "  Spiel wird gebaut ..."
  echo
  npm run build
fi

exec node scripts/serve.mjs
