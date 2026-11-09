// Pure helper functions (no chrome.* / no DOM side effects) – shared by the
// content script and the Node unit tests.
(function (root) {
  'use strict';

  const SHORTCODE_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  const DEFAULT_SETTINGS = Object.freeze({
    dateSource: 'posted',      // 'posted' = date the photo was published, 'downloaded' = now
    folder: 'Instagram',       // sub-folder inside the Chrome downloads folder ('' = none)
    perUserFolder: false,      // Instagram/<username>/...
    useApi: true               // ask Instagram's API for the original-resolution file
  });

  /** Instagram post shortcode (e.g. "C1a2B3c4D5e") -> numeric media id string. */
  function shortcodeToMediaId(shortcode) {
    const code = String(shortcode).slice(0, 11); // longer codes = private-post suffix
    let id = 0n;
    for (const ch of code) {
      const i = SHORTCODE_ALPHABET.indexOf(ch);
      if (i < 0) throw new Error('Invalid shortcode: ' + shortcode);
      id = id * 64n + BigInt(i);
    }
    return id.toString();
  }

  /** Parse an <img srcset> into [{url, w}] */
  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(/,\s+(?=https?:|\/)/)
      .map((part) => {
        const [url, desc = ''] = part.trim().split(/\s+/);
        const m = desc.match(/^(\d+(?:\.\d+)?)([wx])$/);
        let w = 0;
        if (m) w = m[2] === 'w' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
        return { url, w };
      })
      .filter((c) => c.url);
  }

  /** Best URL that the page itself offers for an <img> (largest srcset entry). */
  function bestDomImageUrl(img) {
    const cands = parseSrcset(img.getAttribute('srcset'));
    if (cands.length) {
      cands.sort((a, b) => b.w - a.w);
      return cands[0].url;
    }
    return img.currentSrc || img.src || null;
  }

  /**
   * Stable key of a CDN file: the file name without extension/query.
   * Instagram serves every resolution of the same photo under the same file
   * name (only the `stp=` query differs), so this key links a DOM <img> to
   * the API entry of the same photo.
   */
  function mediaFileKey(url) {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
    try {
      const path = new URL(url, 'https://www.instagram.com').pathname;
      const file = path.split('/').pop() || '';
      return file.replace(/\.[a-z0-9]+$/i, '') || null;
    } catch (_) {
      return null;
    }
  }

  function largest(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list.reduce((best, c) =>
      (c.width || 0) * (c.height || 0) > (best.width || 0) * (best.height || 0) ? c : best
    );
  }

  /** Highest quality downloadable URL of an API media item (image or video). */
  function itemBestMedia(item) {
    if (!item) return null;
    if (Array.isArray(item.video_versions) && item.video_versions.length) {
      const v = largest(item.video_versions);
      return { url: v.url, isVideo: true, width: v.width, height: v.height };
    }
    const c = largest(item.image_versions2 && item.image_versions2.candidates);
    return c ? { url: c.url, isVideo: false, width: c.width, height: c.height } : null;
  }

  /** All CDN file keys an API item is known under (any resolution). */
  function itemKeys(item) {
    const keys = new Set();
    const add = (u) => { const k = mediaFileKey(u); if (k) keys.add(k); };
    ((item.image_versions2 && item.image_versions2.candidates) || []).forEach((c) => add(c.url));
    (item.video_versions || []).forEach((v) => add(v.url));
    return keys;
  }

  /** Find the item (and its 0-based index) whose files match `key`. */
  function matchItemByKey(items, key) {
    if (!key || !Array.isArray(items)) return null;
    for (let i = 0; i < items.length; i++) {
      if (itemKeys(items[i]).has(key)) return { item: items[i], index: i };
    }
    return null;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Date -> "YYYY-MM-DD_HH-mm-ss" (local time, file-system safe). */
  function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds())
    );
  }

  function sanitize(part) {
    return String(part == null ? '' : part)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  function extFromUrl(url, isVideo) {
    try {
      const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (m) return m[1].toLowerCase();
    } catch (_) { /* ignore */ }
    return isVideo ? 'mp4' : 'jpg';
  }

  /**
   * username_YYYY-MM-DD_HH-mm-ss_<id>[_<n>].<ext>
   * index is 0-based (slide number in a carousel); added as _1, _2 ... when given.
   */
  function buildFilename({ username, date, id, index, ext, settings }) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const user = sanitize(username || 'instagram') || 'instagram';
    let name = user + '_' + formatDate(date || new Date());
    if (id) name += '_' + sanitize(id);
    if (typeof index === 'number' && index >= 0) name += '_' + (index + 1);
    name += '.' + (ext || 'jpg');

    const dirs = [];
    const folder = String(s.folder || '').split(/[\\/]+/).map(sanitize).filter(Boolean);
    dirs.push(...folder);
    if (s.perUserFolder) dirs.push(user);
    return dirs.concat(name).join('/');
  }

  /** Understand the current Instagram URL. */
  function parsePath(pathname) {
    const p = String(pathname || '/');
    let m;
    if ((m = p.match(/^\/stories\/highlights\/(\d+)\/?(?:(\d+)\/?)?/))) {
      return { type: 'highlight', highlightId: m[1], storyPk: m[2] || null };
    }
    if ((m = p.match(/^\/stories\/([^/]+)\/?(?:(\d+)\/?)?/))) {
      return { type: 'story', username: decodeURIComponent(m[1]), storyPk: m[2] || null };
    }
    if ((m = p.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/))) {
      return { type: 'post', shortcode: m[1] };
    }
    return { type: null };
  }

  /** Extract a shortcode from an href like "/p/ABC/" or "https://.../reel/ABC/". */
  function shortcodeFromHref(href) {
    if (!href) return null;
    try {
      const info = parsePath(new URL(href, 'https://www.instagram.com').pathname);
      return info.type === 'post' ? info.shortcode : null;
    } catch (_) {
      return null;
    }
  }

  function bestArea(item) {
    const b = itemBestMedia(item);
    return b ? (b.width || 0) * (b.height || 0) : 0;
  }

  /** Keep only what we need from an Instagram media object (photo, video, carousel). */
  function slimItem(o, parent) {
    const user = o.user || o.owner || null;
    const slimC = (list) => (Array.isArray(list) ? list : [])
      .filter((c) => c && c.url)
      .map((c) => ({ url: c.url, width: c.width || 0, height: c.height || 0 }));
    const it = {
      pk: String(o.pk || o.id || '').split('_')[0] || null,
      code: o.code || o.shortcode || null,
      taken_at: o.taken_at || (parent && parent.taken_at) || null,
      user: {
        username: (user && user.username) || (parent && parent.user && parent.user.username) || null,
        pk: (user && (user.pk || user.id) && String(user.pk || user.id)) || (parent && parent.user && parent.user.pk) || null
      },
      image_versions2: { candidates: slimC(o.image_versions2 && o.image_versions2.candidates) },
      video_versions: slimC(o.video_versions)
    };
    if (!it.video_versions.length) delete it.video_versions;
    if (Array.isArray(o.carousel_media) && o.carousel_media.length) {
      it.carousel_media = o.carousel_media.map((c) => slimItem(c, it));
    }
    return it;
  }

  /** Walk any JSON blob Instagram sends and collect every media item in it. */
  function collectMediaItems(root, out) {
    out = out || [];
    const seen = new Set();
    const stack = [[root, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop();
      if (!node || typeof node !== 'object' || depth > 60 || seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const v of node) stack.push([v, depth + 1]);
        continue;
      }
      const hasMedia = (node.image_versions2 && node.image_versions2.candidates) ||
        (Array.isArray(node.video_versions) && node.video_versions.length) ||
        (Array.isArray(node.carousel_media) && node.carousel_media.length);
      if (hasMedia && (node.pk || node.id)) {
        out.push(slimItem(node));
        continue; // children (carousel) are inside the slim item already
      }
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object') stack.push([v, depth + 1]);
      }
    }
    return out;
  }

  /** Parse an Instagram response body (may be several JSON docs, may have for(;;); prefix). */
  function parseJsonBodies(text) {
    if (!text || typeof text !== 'string') return [];
    const t = text.replace(/^for \(;;\);/, '').trim();
    if (!t || (t[0] !== '{' && t[0] !== '[')) return [];
    try { return [JSON.parse(t)]; } catch (_) { /* maybe NDJSON */ }
    const docs = [];
    for (const line of t.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try { docs.push(JSON.parse(l)); } catch (_) { /* ignore */ }
    }
    return docs;
  }

  const api = {
    DEFAULT_SETTINGS,
    bestArea,
    slimItem,
    collectMediaItems,
    parseJsonBodies,
    shortcodeToMediaId,
    parseSrcset,
    bestDomImageUrl,
    mediaFileKey,
    itemBestMedia,
    itemKeys,
    matchItemByKey,
    formatDate,
    sanitize,
    extFromUrl,
    buildFilename,
    parsePath,
    shortcodeFromHref
  };

  root.IGDL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
