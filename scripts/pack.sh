#!/usr/bin/env bash
# ==================================================
# CYFOR Nucleus Enhancer — release packager
# Zips ONLY the runtime files into cyfor-nucleus-enhancer-<version>.zip.
# Excludes everything dev-only: oauth-proxy/ (the Cloudflare Worker source
# must never ship to users), docs/, scripts/, *.md, git files, examples.
#
# Usage:  ./scripts/pack.sh        (from the repo root)
# ==================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# End-user builds need the compiled proxy URL.
if [[ ! -f config.js ]]; then
    echo "ERROR: config.js is missing — end-user builds need the compiled proxy URL." >&2
    echo "       cp config.example.js config.js and set oauthProxyUrl, then re-run." >&2
    exit 1
fi

VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
OUT="cyfor-nucleus-enhancer-${VERSION}.zip"

rm -f "$OUT"
zip -r -q "$OUT" \
    manifest.json \
    icons/ \
    config.js \
    background.js \
    background/ \
    content/ \
    popup/ \
    manager/ \
    report/ \
    styles/ \
    lib/ \
    -x "*.md" -x "*/.DS_Store"

echo "Packaged $OUT ($(du -h "$OUT" | cut -f1)) — runtime files only:"
unzip -l "$OUT" | tail -2
