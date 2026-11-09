#!/usr/bin/env bash
# Builds the clean ZIP to upload to the Chrome Web Store: dist/storystash-v<version>.zip
# Only runtime files are included (no tests, tools, docs, store assets).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/storystash-v${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -qr "$OUT" manifest.json src popup icons -x "*.DS_Store" "*/Thumbs.db"
echo "Packaged $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT"
