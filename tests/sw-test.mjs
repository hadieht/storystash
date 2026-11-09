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
const names = await run(`chrome.downloads.search({}).then(l => l.map(d => ({ file: d.filename, state: d.state, err: d.error })))`);
console.log(JSON.stringify({ names }, null, 1));

const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; e.isDirectory() ? walk(p) : files.push(p); } };
walk(dlDir);
let ok;
const wrong = files.filter((f) => /HIJACKED|sample\.|download\.jpeg/.test(f));
if (photo.renamed || video.renamed) {
  // another extension won the naming: bad copies must be deleted and the file handed back for page save
  const pj = photo.fallback && photo.fallback.dataUrl.startsWith('data:image/jpeg;base64,');
  const magic = pj ? [...Buffer.from(photo.fallback.dataUrl.split(',')[1], 'base64').subarray(0, 3)] : [];
  console.log('mode: fallback | photo name:', photo.fallback && photo.fallback.name, '| video name:', video.fallback && video.fallback.name);
  console.log('fallback jpg magic FF D8 FF:', magic.join(',') === '255,216,255', '| leftover wrong files:', wrong.length);
  ok = pj && magic.join(',') === '255,216,255' && photo.fallback.name === 'alice_2026-11-09_10-00-00_CODE1_2.jpg' &&
       video.fallback && video.fallback.name === 'dave.v_2026-11-08_12-26-40_3999.mp4' && wrong.length === 0;
} else {
  const jpg = files.find((f) => f.endsWith('/Instagram/alice_2026-11-09_10-00-00_CODE1_2.jpg'));
  const mp4 = files.find((f) => f.endsWith('/Instagram/dave.v_2026-11-08_12-26-40_3999.mp4'));
  const head = jpg ? [...readFileSync(jpg).subarray(0, 3)] : [];
  console.log('mode: direct | jpg magic FF D8 FF:', head.join(',') === '255,216,255');
  ok = !!jpg && head.join(',') === '255,216,255' && !!mp4 && wrong.length === 0;
}
console.log(ok ? 'SW TEST PASSED' : 'SW TEST FAILED');
b.close(); c.close();
process.exit(ok ? 0 : 1);
