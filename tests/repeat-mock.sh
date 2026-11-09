#!/usr/bin/env bash
# Run only the mock page N times and print the feed-video results (flakiness check).
cd "$(dirname "$0")/.."
python3 tests/cors_server.py 8765 . >/dev/null 2>&1 & S=$!
sleep 1
for i in $(seq 1 "${1:-3}"); do
  timeout 90 chromium --headless=new --no-sandbox --disable-gpu --window-size=1280,900 --virtual-time-budget=60000 \
    --dump-dom 'http://localhost:8765/tests/mock.html?auto' 2>/dev/null | grep -o 'RESULT_JSON:.*' | sed 's/RESULT_JSON://; s/<\/pre>.*//' | python3 -c "
import json,html,sys; d=json.loads(html.unescape(sys.stdin.read()))
print([(v['id'], 'clickable' if v['clickable'] else 'BLOCKED', 'floating' if v['floating'] else 'in-post') for v in d['feedVideos']])"
done
kill $S
