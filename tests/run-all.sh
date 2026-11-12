#!/usr/bin/env bash
# Runs every test: unit, mock Instagram page, real-Chromium worker test, extension load check.
set -u
cd "$(dirname "$0")/.."
SCR="${TMPDIR:-/tmp}"
fail=0
for f in src/*.js popup/*.js; do node --check "$f" || { echo "FAIL syntax $f"; fail=1; }; done
node tests/utils.test.js | tail -1 || fail=1

python3 tests/cors_server.py 8765 . >/dev/null 2>&1 & SRV=$!
sleep 1
timeout 90 chromium --headless=new --no-sandbox --disable-gpu --window-size=1280,900 --virtual-time-budget=60000 \
  --dump-dom 'http://localhost:8765/tests/mock.html?auto' 2>/dev/null > "$SCR/dom.html"
kill $SRV
grep -o 'RESULT_JSON:.*' "$SCR/dom.html" | sed 's/RESULT_JSON://; s/<\/pre>.*//' | python3 -c "
import json,html,sys; d=json.loads(html.unescape(sys.stdin.read()))
checks = {
 'post buttons': d['buttonCount']==6, 'grid skipped': not d['gridHasButton'],
 'carousel exact slides': [t.split('_')[-1].split(' ')[0] for t in d['toasts'] if 'CAROUSEL' in t]==['2.jpg','1.jpg','3.jpg'],
 'feed videos clickable+saved': all(v['clickable'] and v['toast'].startswith('Saved') and '.mp4' in v['toast'] for v in d['feedVideos']),
 'photo story': d['storyButtonClickable'] and d['photoStoryToast'].startswith('Saved carol'),
 'video story': d['videoStoryButtonClickable'] and '.mp4' in d['videoToast'],
 'rename fallback': d['pageSave'][0]['download']=='dave.v_x.mp4',
 'photo button on video story': d['photoButtonClickable'] and d['photoOnlyDownload']['filename'].endswith('.jpg') and not d['photoOnlyDownload']['isVideo'],
 'music photo story saves photo': d['musicStoryDownload']['isJpegData'] and d['musicStoryDownload']['filename'].endswith('.jpg') and 'photo with music' in d['musicStoryToast']}
bad=[k for k,v in checks.items() if not v]
for k,v in checks.items(): print(('PASS ' if v else 'FAIL ')+'mock: '+k)
sys.exit(1 if bad else 0)" || fail=1

bash tests/sw-test.sh > "$SCR/sw.log" 2>&1 || fail=1
echo "worker tests passed: $(grep -c 'SW TEST PASSED' "$SCR/sw.log")/6"

B="$HOME/snap/chromium/common/igload"; rm -rf "$B"; mkdir -p "$B/prof"; cp -r . "$B/ext"
chromium --headless=new --no-sandbox --disable-gpu --user-data-dir="$B/prof" --disable-extensions-except="$B/ext" \
  --load-extension="$B/ext" --remote-debugging-port=9334 about:blank >"$B/log" 2>&1 & CH=$!
sleep 6
if curl -s localhost:9334/json/list | grep -q 'background.js'; then echo "PASS extension loads in Chromium"; else echo "FAIL extension load"; fail=1; fi
kill $CH; wait $CH 2>/dev/null; rm -rf "$B"
[ $fail = 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $fail
