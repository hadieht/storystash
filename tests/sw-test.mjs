// Real-Chromium test of the service worker: loads InstaSaver + a "hijacker"
// extension that renames every download (what other download extensions do),
// then asks InstaSaver's worker to save a WebP photo and an MP4.
// Expects: our names win, the WebP is saved as a real JPEG.
// Usage: node tests/sw-test.mjs <cdp-port> <download-dir> <fixture-base-url>
import { readdirSync, readFileSync } from 'node:fs';

const [port, dlDir, base] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  return { ready, close: () => ws.close(), send: (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }) };
}

let sw;
for (let i = 0; i < 30 && !sw; i++) {
  sw = (await targets()).find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
  if (!sw) await sleep(500);
}
if (!sw) { console.error('InstaSaver service worker not found'); process.exit(1); }

const browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
const b = cdp(browserWs); await b.ready;
// download folder comes from the profile Preferences (CDP download overrides would bypass extension naming)

const c = cdp(sw.webSocketDebuggerUrl); await c.ready;
const run = async (expr) => {
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const photo = await run(`igdlDownload({ url: '${base}/sample.webp', filename: 'Instagram/alice_2026-11-09_10-00-00_CODE1_2.webp', isVideo: false })`);
const video = await run(`igdlDownload({ url: '${base}/sample.mp4', filename: 'Instagram/dave.v_2026-11-08_12-26-40_3999.mp4', isVideo: true })`);
await sleep(3000);
const listenerAfter = await run('igdlNameListenerActive()');
console.log('naming listener still attached after our downloads:', listenerAfter);
const names = await run(`chrome.downloads.search({}).then(l => l.map(d => ({ file: d.filename, state: d.state, err: d.error })))`);
console.log(JSON.stringify({ names }, null, 1));

const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; e.isDirectory() ? walk(p) : files.push(p); } };
walk(dlDir);
// each file must end up EITHER saved directly with our name in Downloads/Instagram,
// OR (when another extension renamed / took it over) handed back for saving from the page.
const wrong = files.filter((f) => /HIJACKED|sample\.|download\.jpeg/.test(f));
function check(label, res, wantName, isJpeg) {
  if (res.renamed) {
    const okName = res.fallback && res.fallback.name === wantName;
    let okData = !!(res.fallback && res.fallback.dataUrl.startsWith('data:'));
    if (isJpeg && okData) okData = [...Buffer.from(res.fallback.dataUrl.split(',')[1], 'base64').subarray(0, 3)].join(',') === '255,216,255';
    console.log(`${label}: fallback (${res.takenOver ? 'taken over' : 'renamed'}) | name ok: ${okName} | data ok: ${okData}`);
    return okName && okData;
  }
  const f = files.find((x) => x.endsWith('/Instagram/' + wantName));
  let okData = !!f;
  if (isJpeg && f) okData = [...readFileSync(f).subarray(0, 3)].join(',') === '255,216,255';
  console.log(`${label}: direct | saved as Instagram/${wantName}: ${!!f} | data ok: ${okData}`);
  return okData;
}
let ok = check('photo', photo, 'alice_2026-11-09_10-00-00_CODE1_2.jpg', true) &
         check('video', video, 'dave.v_2026-11-08_12-26-40_3999.mp4', false);
ok = !!ok && wrong.length === 0;
console.log('leftover wrongly named files:', wrong.length);
if (listenerAfter) ok = false; // must not stay in other downloads' way (IDM warning)
console.log(ok ? 'SW TEST PASSED' : 'SW TEST FAILED');
b.close(); c.close();
process.exit(ok ? 0 : 1);
