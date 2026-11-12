// StoryStash service worker – performs the actual file download.
importScripts('convert.js');

const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i;

// Downloads started by us -> the name we want. Kept only for the few seconds
// between chrome.downloads.download() and Chrome choosing the name.
const pendingNames = new Map();

// Chrome lets the LAST extension listening here decide the file name. Download
// managers (e.g. IDM Integration Module) can override names, which produced raw
// CDN names like "893869779_1858…_n.jpg". Answering here makes our name stick.
//
// The listener is attached ONLY while one of our own downloads is being named
// and removed right after, so StoryStash never takes part in naming any other
// download (no "another extension determined a different filename" warnings
// on other extensions for downloads that are not ours).
function onDetermineName(item, suggest) {
  const name = item.byExtensionId === chrome.runtime.id &&
    (pendingNames.get(item.url) || pendingNames.get(item.finalUrl));
  if (name) {
    pendingNames.delete(item.url);
    suggest({ filename: name, conflictAction: 'uniquify' });
  } else {
    suggest(); // not ours – no opinion
  }
  releaseNameListener();
}

function holdNameListener() {
  if (!chrome.downloads.onDeterminingFilename.hasListener(onDetermineName)) {
    chrome.downloads.onDeterminingFilename.addListener(onDetermineName);
  }
}

function releaseNameListener() {
  if (pendingNames.size === 0 && chrome.downloads.onDeterminingFilename.hasListener(onDetermineName)) {
    chrome.downloads.onDeterminingFilename.removeListener(onDetermineName);
  }
}
self.igdlNameListenerActive = () => chrome.downloads.onDeterminingFilename.hasListener(onDetermineName); // tests

async function startDownload(url, filename) {
  pendingNames.set(url, filename);
  holdNameListener();
  setTimeout(() => { pendingNames.delete(url); releaseNameListener(); }, 60000);
  try {
    return await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (err) {
    pendingNames.delete(url);
    releaseNameListener();
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseName = (p) => String(p || '').split(/[\\/]/).pop().replace(/ \(\d+\)(?=\.[^.]+$)/, '');

/** Wait until Chrome has picked the final path of a download. */
async function waitFor(id, test, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const [it] = await chrome.downloads.search({ id });
    if (!it) return null;
    if (test(it)) return it;
    await sleep(150);
  }
  return null;
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  return 'data:' + type + ';base64,' + igdlBytesToBase64(new Uint8Array(await res.arrayBuffer()));
}

/**
 * Start the download and verify Chrome really used our name. If another
 * extension replaced it, delete that copy and return the file so the content
 * script can save it with the right name from the page.
 */
async function downloadVerified(url, filename, getData) {
  try {
    return await downloadVerifiedInner(url, filename, getData);
  } finally {
    // naming is over for this file (or never happened because it was taken over)
    pendingNames.delete(url);
    releaseNameListener();
  }
}

async function downloadVerifiedInner(url, filename, getData) {
  const id = await startDownload(url, filename);
  const it = await waitFor(id, (d) => !!d.filename || d.state !== 'in_progress', 15000);
  // Download managers (IDM etc.) "take over" a download by cancelling it in
  // Chrome right after it starts. Give them a moment, then check.
  await sleep(1200);
  const [now] = await chrome.downloads.search({ id });
  const takenOver = !now || (now.state === 'interrupted' && /USER_CANCELED/i.test(now.error || ''));
  if (takenOver) {
    console.warn('[StoryStash] another download manager took over the download – saving from the page instead');
    try { await chrome.downloads.erase({ id }); } catch (_) { /* ignore */ }
    return { id, renamed: true, takenOver: true, fallback: { name: baseName(filename), dataUrl: await getData() } };
  }
  if (!it || baseName(it.filename) === baseName(filename)) return { id, renamed: false };

  console.warn('[StoryStash] another extension renamed the download to', it.filename, '- re-saving');
  await waitFor(id, (d) => d.state !== 'in_progress', 120000);
  try { await chrome.downloads.removeFile(id); } catch (_) { /* already gone */ }
  try { await chrome.downloads.erase({ id }); } catch (_) { /* ignore */ }
  return { id, renamed: true, fallback: { name: baseName(filename), dataUrl: await getData() } };
}

/** Download one item. Photos are always saved as JPEG. */
async function igdlDownload({ url, filename, isVideo }) {
  if (isVideo) {
    return Object.assign({ converted: false }, await downloadVerified(url, filename, () => fetchAsDataUrl(url)));
  }
  const jpgName = filename.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  let img;
  try {
    img = await igdlFetchAsJpeg(url);
  } catch (err) {
    console.warn('[StoryStash] JPEG conversion failed, saving original file:', err);
    const r = await downloadVerified(url, filename, () => fetchAsDataUrl(url));
    return Object.assign({ converted: false, warning: String((err && err.message) || err) }, r);
  }
  const r = await downloadVerified(img.dataUrl, jpgName, async () => img.dataUrl);
  return Object.assign({ converted: img.converted, from: img.from }, r);
}
self.igdlDownload = igdlDownload; // exposed for tests/sw-test.mjs

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'igdl:download') return false;
  (async () => {
    try {
      const url = String(message.url || '');
      const isOwnPhoto = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url) && !message.isVideo;
      if (!ALLOWED.test(url) && !isOwnPhoto) throw new Error('Refusing to download from a non-Instagram host');
      const r = await igdlDownload({ url, filename: message.filename, isVideo: !!message.isVideo });
      sendResponse(Object.assign({ ok: true }, r));
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true; // async response
});
