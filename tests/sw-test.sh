#!/usr/bin/env bash
# Real-Chromium test of the service worker (naming vs. a hijacking extension, WebP->JPG).
# Needs: chromium, node >= 22, python3. Serves fixtures on :8765.
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
B="${HOME}/snap/chromium/common/igtest"   # snap chromium can only read/write here
rm -rf "$B"; mkdir -p "$B"; cp -r "$SRC" "$B/ext"
python3 "$SRC/tests/cors_server.py" 8765 "$SRC" >/dev/null 2>&1 & SRV=$!
sleep 1
status=0
run() {
  echo "=== load order: $1"
  rm -rf "$B/prof" "$B/dl"; mkdir -p "$B/prof/Default" "$B/dl"
  printf '{"download":{"default_directory":"%s","prompt_for_download":false,"directory_upgrade":true}}' "$B/dl" > "$B/prof/Default/Preferences"
  chromium --headless=new --no-sandbox --disable-gpu --user-data-dir="$B/prof" \
    --disable-extensions-except="$1" --load-extension="$1" --remote-debugging-port=9333 about:blank >"$B/log" 2>&1 &
  CH=$!
  sleep 6
  node "$SRC/tests/sw-test.mjs" 9333 "$B/dl" http://127.0.0.1:8765/tests/fixtures || status=1
  kill $CH 2>/dev/null; wait $CH 2>/dev/null; sleep 1
}
for mode in rename empty takeover; do
  echo "##### hijacker mode: $mode"
  if [ $mode = empty ]; then
    echo 'chrome.downloads.onDeterminingFilename.addListener((item, suggest) => { suggest(); });' > "$B/ext/tests/hijacker/bg.js"
  fi
  if [ $mode = takeover ]; then
    # like IDM: cancels http(s) downloads in Chrome to download them itself
    echo 'chrome.downloads.onCreated.addListener((d) => { if (/^https?:/.test(d.url)) chrome.downloads.cancel(d.id); });' > "$B/ext/tests/hijacker/bg.js"
  fi
  run "$B/ext/tests/hijacker,$B/ext"
  run "$B/ext,$B/ext/tests/hijacker"
done
kill $SRV
rm -rf "$B"
exit $status
