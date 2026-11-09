// StoryStash content script – injects a download button on every story / post
// photo or video on instagram.com and downloads exactly that item.
(function () {
  'use strict';
  if (window.__igdlLoaded) return;
  window.__igdlLoaded = true;

  const U = globalThis.IGDL;
  const IG_APP_ID = '936619743392459'; // public app id used by instagram.com itself
  const BTN_CLASS = 'igdl-btn';
  const MIN_SIZE = 150; // px – ignore avatars, icons, thumbnails

  let settings = Object.assign({}, U.DEFAULT_SETTINGS);
  const infoCache = new Map(); // api path -> Promise<json>

  // ------------------------------------------- media data seen on the page
  // Filled from Instagram's own network responses (src/page-hook.js) and from
  // the JSON embedded in the HTML. Lets us find originals (incl. story videos)
  // without any extra request.
  const media = { byPk: new Map(), byCode: new Map(), byKey: new Map() };

  const CDN = /^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i;
  function cleanItem(it) {
    const keep = (list) => (list || []).filter((c) => c && typeof c.url === 'string' && CDN.test(c.url));
    if (it.image_versions2) it.image_versions2.candidates = keep(it.image_versions2.candidates);
    if (it.video_versions) it.video_versions = keep(it.video_versions);
    (it.carousel_media || []).forEach(cleanItem);
    return it;
  }

  function addItem(it) {
    if (!it || typeof it !== 'object') return;
    cleanItem(it);
    const better = (old) => !old || U.bestArea(it) >= U.bestArea(old.item || old);
    if (it.pk && better(media.byPk.get(it.pk))) media.byPk.set(it.pk, it);
    if (it.code && better(media.byCode.get(it.code))) media.byCode.set(it.code, it);
    for (const k of U.itemKeys(it)) media.byKey.set(k, { item: it, parent: null, index: null });
    (it.carousel_media || []).forEach((c, i) => {
      for (const k of U.itemKeys(c)) media.byKey.set(k, { item: c, parent: it, index: i });
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__igdl !== 'media') return;
    (e.data.items || []).forEach(addItem);
  });

  const seenScripts = new WeakSet();
  function ingestEmbeddedJson() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (seenScripts.has(s)) continue;
      seenScripts.add(s);
      const txt = s.textContent;
      if (!txt || !/image_versions2|video_versions/.test(txt)) continue;
      try {
        for (const d of U.parseJsonBodies(txt)) U.collectMediaItems(d).forEach(addItem);
      } catch (_) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- settings
  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(U.DEFAULT_SETTINGS);
      settings = Object.assign({}, U.DEFAULT_SETTINGS, stored);
    } catch (_) { /* keep defaults */ }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
  });

  // --------------------------------------------------------------------- api
  function igApi(path) {
    if (infoCache.has(path)) return infoCache.get(path);
    const p = (async () => {
      const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
      const headers = {
        'X-IG-App-ID': IG_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'X-ASBD-ID': '129477',
        'X-IG-WWW-Claim': (() => { try { return sessionStorage.getItem('www-claim-v2') || '0'; } catch (_) { return '0'; } })()
      };
      if (csrf) headers['X-CSRFToken'] = csrf;
      const res = await fetch(location.origin + path, { credentials: 'include', headers });
      if (!res.ok) throw new Error('Instagram API HTTP ' + res.status);
      return res.json();
    })();
    infoCache.set(path, p);
    p.catch(() => infoCache.delete(path));
    return p;
  }

  async function mediaInfo(mediaId) {
    const json = await igApi('/api/v1/media/' + mediaId + '/info/');
    const raw = json && json.items && json.items[0];
    if (!raw) throw new Error('Media not found');
    const item = U.slimItem(raw);
    addItem(item);
    return item;
  }

  async function reelItems(reelId) {
    const json = await igApi('/api/v1/feed/reels_media/?reel_ids=' + encodeURIComponent(reelId));
    const reel = (json.reels && json.reels[reelId]) || (json.reels_media || [])[0];
    const items = ((reel && reel.items) || []).map((r) => U.slimItem(r));
    items.forEach(addItem);
    return items;
  }


  // ------------------------------------------------------------- dom helpers
  function mediaKeyOf(el) {
    if (el.tagName === 'IMG') return U.mediaFileKey(U.bestDomImageUrl(el)) || U.mediaFileKey(el.currentSrc || el.src);
    if (el.tagName === 'VIDEO') {
      return U.mediaFileKey(el.currentSrc || el.src) || U.mediaFileKey(el.getAttribute('poster'));
    }
    return null;
  }

  function postContext(media) {
    return media.closest('article') || media.closest('[role="dialog"]') || media.closest('main') || document.body;
  }

  function shortcodeFor(media, ctx) {
    const path = U.parsePath(location.pathname);
    const inDialog = !!media.closest('[role="dialog"]');
    if (path.type === 'post' && (inDialog || !media.closest('article') || ctx.tagName !== 'ARTICLE')) {
      return path.shortcode;
    }
    // feed article: the timestamp link points to the post
    const timeLink = ctx.querySelector('a[href*="/p/"] time, a[href*="/reel/"] time');
    const a = (timeLink && timeLink.closest('a')) ||
      ctx.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    return (a && U.shortcodeFromHref(a.getAttribute('href'))) || (path.type === 'post' ? path.shortcode : null);
  }

  function domUsername(ctx) {
    const links = ctx.querySelectorAll('header a[href^="/"], a[href^="/"][role="link"]');
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
      if (m && !['explore', 'reels', 'direct', 'stories', 'accounts'].includes(m[1])) return m[1];
    }
    return null;
  }

  function domDate(ctx) {
    const t = ctx.querySelector('time[datetime]');
    const d = t ? new Date(t.getAttribute('datetime')) : null;
    return d && !isNaN(d) ? d : null;
  }

  /** The current carousel slide number if the API could not match by file. */
  function domSlideIndex(media, ctx) {
    const li = media.closest('li');
    const ul = li && li.parentElement;
    if (!ul || !ctx.contains(ul)) return null;
    // Instagram virtualises slides but keeps the real offset in translateX
    const m = (li.getAttribute('style') || '').match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
    const w = li.getBoundingClientRect().width;
    if (m && w) return Math.round(parseFloat(m[1]) / w);
    return null;
  }

  function domFallback(media, info) {
    let url = null;
    let isVideo = media.tagName === 'VIDEO';
    if (isVideo) {
      const src = media.currentSrc || media.src;
      if (src && !src.startsWith('blob:')) url = src;
    } else {
      url = U.bestDomImageUrl(media);
    }
    if (!url) throw new Error(isVideo
      ? 'This video is streamed in pieces and could not be resolved via Instagram API.'
      : 'Could not find the image URL.');
    return Object.assign({ url, isVideo, quality: 'page' }, info);
  }

  // ---------------------------------------------------------------- resolving
  /** Build the download description for an item (owner = carousel parent if any). */
  function describe(item, owner, index, base) {
    const best = U.itemBestMedia(item);
    if (!best) return null;
    const o = owner || item;
    const username = (o.user && o.user.username) || (item.user && item.user.username) || base.username;
    const takenAt = o.taken_at || item.taken_at;
    return Object.assign({ quality: 'original' }, best, {
      username,
      date: takenAt ? new Date(takenAt * 1000) : base.date,
      id: o.code || base.id || o.pk,
      index: typeof index === 'number' ? index : null
    });
  }

  function pickSlide(post, mediaEl, ctx) {
    const slides = post.carousel_media;
    let hit = U.matchItemByKey(slides, mediaKeyOf(mediaEl));
    if (!hit) {
      const idx = domSlideIndex(mediaEl, ctx);
      if (idx != null && slides[idx]) hit = { item: slides[idx], index: idx };
    }
    if (!hit && mediaEl.tagName === 'VIDEO') {
      const vids = slides.map((s, i) => ({ item: s, index: i })).filter((x) => x.item.video_versions);
      if (vids.length === 1) hit = vids[0];
    }
    return hit;
  }

  async function resolvePost(mediaEl) {
    const ctx = postContext(mediaEl);
    const shortcode = shortcodeFor(mediaEl, ctx);
    const base = { username: domUsername(ctx), date: domDate(ctx), id: shortcode, index: null };
    ingestEmbeddedJson();

    // 1) exact file match in the data Instagram already loaded (knows the slide)
    const key = mediaKeyOf(mediaEl);
    const hit = key ? media.byKey.get(key) : null;
    if (hit) {
      const r = describe(hit.item, hit.parent, hit.parent ? hit.index : null, base);
      if (r) return r;
    }

    // 2) the whole post: from page data, otherwise ask Instagram
    let post = null;
    try {
      if (shortcode) post = media.byCode.get(shortcode) || null;
      if (!post && settings.useApi && shortcode) post = await mediaInfo(U.shortcodeToMediaId(shortcode));
    } catch (e) {
      post = null;
      console.debug('[StoryStash] post lookup failed, using page image:', e && e.message);
    }
    if (post) {
      if (Array.isArray(post.carousel_media) && post.carousel_media.length) {
        const s = pickSlide(post, mediaEl, ctx);
        const r = s && describe(s.item, post, s.index, base);
        if (r) return r;
        const d = describe(post, null, null, base) || base;
        return domFallback(mediaEl, { username: d.username, date: d.date, id: d.id, index: domSlideIndex(mediaEl, ctx) });
      }
      const r = describe(post, null, null, base);
      if (r) return r;
    }
    return domFallback(mediaEl, base);
  }

  /** Find Instagram's data for the story on screen (page data first, then one request). */
  async function findStoryItem(mediaEl, path, key) {
    // 1) data Instagram already loaded: the story id is in the URL
    let item = path.storyPk ? media.byPk.get(path.storyPk) : null;
    if (!item && key) { const h = media.byKey.get(key); if (h) item = h.item; }
    if (!item && mediaEl.tagName === 'VIDEO') {
      // video stories: Instagram may show the cover image next to the <video>
      let box = mediaEl.parentElement;
      for (let i = 0; i < 3 && box && !item; i++, box = box.parentElement) {
        for (const img of box.querySelectorAll('img')) {
          const h = media.byKey.get(mediaKeyOf(img));
          if (h && h.item.video_versions) { item = h.item; break; }
        }
      }
    }
    if (item || !settings.useApi) return item;

    // 2) ask Instagram (only now, after the click)
    try {
      if (path.storyPk) {
        try { return await mediaInfo(path.storyPk); } catch (e) {
          console.debug('[StoryStash] story info failed, trying story tray:', e && e.message);
        }
      }
      let reelId = null;
      if (path.type === 'highlight') reelId = 'highlight:' + path.highlightId;
      else if (path.username) {
        // the account id is usually already known from Instagram's own page data
        for (const it of media.byPk.values()) {
          if (it.user && it.user.username === path.username && it.user.pk) { reelId = it.user.pk; break; }
        }
      }
      if (reelId) {
        const items = await reelItems(String(reelId));
        let hit = U.matchItemByKey(items, key);
        if (!hit && path.storyPk) {
          const i = items.findIndex((it) => String(it.pk) === path.storyPk);
          if (i >= 0) hit = { item: items[i], index: i };
        }
        if (hit) return hit.item;
      }
    } catch (e) {
      console.debug('[StoryStash] story API lookup failed, using page media:', e && e.message);
    }
    return null;
  }

  /** Still image of what the <video> shows right now (photo stories with music are videos). */
  async function captureFrame(video) {
    if (video.readyState < 2) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('The story is still loading – try again in a second.')), 4000);
        video.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) throw new Error('The story is still loading – try again in a second.');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    let url;
    try { url = canvas.toDataURL('image/jpeg', 0.95); } catch (_) {
      throw new Error('Instagram does not allow taking the photo from this story.');
    }
    return { url, isVideo: false, width: w, height: h, quality: 'frame' };
  }

  /**
   * opts.photo = true -> save only the picture (📷 button), never the video.
   * Photo stories with music are stored by Instagram as short videos; their
   * photo is kept as the story's image, which is what we save here.
   */
  async function resolveStory(mediaEl, opts = {}) {
    const path = U.parsePath(location.pathname);
    const section = mediaEl.closest('section') || document.body;
    const base = {
      username: path.username || domUsername(section),
      date: domDate(section),
      id: path.storyPk || path.highlightId,
      index: null
    };
    const fromItem = (item, photoOnly) => {
      const src = photoOnly ? Object.assign({}, item, { video_versions: undefined }) : item;
      const r = describe(src, null, null, base);
      if (r) r.id = item.pk || base.id;
      return r;
    };
    ingestEmbeddedJson();
    const key = mediaKeyOf(mediaEl);
    const item = await findStoryItem(mediaEl, path, key);

    if (item) {
      const r = fromItem(item, !!opts.photo);
      if (r) return r;
    }
    if (mediaEl.tagName === 'VIDEO') {
      // no file found: keep the photo that is on screen instead of failing
      const f = await captureFrame(mediaEl);
      return Object.assign(f, base, { photoFallback: !opts.photo });
    }
    return domFallback(mediaEl, base);
  }

  /** Save a file through the page (used when another extension hijacked the name). */
  function saveFromPage(dataUrl, name) {
    const comma = dataUrl.indexOf(',');
    const type = (dataUrl.slice(5, comma).split(';')[0]) || 'application/octet-stream';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const href = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  async function download(mediaEl, opts = {}) {
    const isStory = location.pathname.startsWith('/stories/');
    const r = isStory ? await resolveStory(mediaEl, opts) : await resolvePost(mediaEl);
    const date = settings.dateSource === 'downloaded' ? new Date() : (r.date || new Date());
    const filename = U.buildFilename({
      username: r.username,
      date,
      id: r.id,
      index: r.index,
      ext: r.isVideo ? U.extFromUrl(r.url, true) : 'jpg', // photos are always saved as JPEG
      settings
    });
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'igdl:download', url: r.url, filename, isVideo: !!r.isVideo });
    } catch (e) {
      if (/context invalidated|Receiving end does not exist/i.test(String(e && e.message))) {
        throw new Error('StoryStash was updated – please refresh this Instagram page (F5).');
      }
      throw e;
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Download failed');
    if (res.fallback) saveFromPage(res.fallback.dataUrl, res.fallback.name);
    return { filename: res.fallback ? res.fallback.name : filename, renamed: !!res.fallback, photoFallback: !!r.photoFallback, quality: r.quality, width: r.width, height: r.height, converted: res.converted };
  }

  // ---------------------------------------------------------------------- ui
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5z"/></svg>';
  const ICON_PHOTO =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
  const ICON_OK =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  const ICON_ERR =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>';

  function toast(text, isError) {
    let box = document.getElementById('igdl-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'igdl-toast';
      document.documentElement.appendChild(box);
    }
    box.textContent = text;
    box.classList.toggle('igdl-error', !!isError);
    box.classList.add('igdl-show');
    clearTimeout(box._t);
    box._t = setTimeout(() => box.classList.remove('igdl-show'), isError ? 5000 : 2500);
  }

  async function showFirstRunNotice() {
    try {
      const { noticeShown } = await chrome.storage.local.get('noticeShown');
      if (noticeShown) return;
      await chrome.storage.local.set({ noticeShown: true });
      setTimeout(() => toast('StoryStash: please only save content you own or have permission to keep, and respect creators\' rights.'), 2700);
    } catch (_) { /* ignore */ }
  }

  function stop(e) { e.stopPropagation(); e.stopImmediatePropagation(); }

  function hostMedia(b) {
    const host = b.parentElement;
    return host && (host.querySelector(':scope > img, :scope > video') || host.querySelector('img, video'));
  }

  function makeButton(isStory, getMedia, opts = {}) {
    const icon = opts.photo ? ICON_PHOTO : ICON_DOWNLOAD;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = BTN_CLASS + (isStory ? ' igdl-story' : '') + (opts.photo ? ' igdl-photo' : '');
    b.title = opts.photo ? 'Save only the photo (JPG)' : 'Download in the largest size';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = icon;
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'keydown']
      .forEach((ev) => b.addEventListener(ev, stop, true));
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      stop(e);
      if (b.classList.contains('igdl-busy')) return;
      const media = (getMedia || hostMedia)(b);
      if (!media) return toast('No photo or video found here', true);
      b.classList.add('igdl-busy');
      b.classList.remove('igdl-done', 'igdl-fail');
      try {
        const r = await download(media, opts);
        showFirstRunNotice();
        b.innerHTML = ICON_OK;
        b.classList.add('igdl-done');
        const size = r.width && r.height ? ' (' + r.width + '×' + r.height + ')' : '';
        toast('Saved ' + r.filename.split('/').pop() + size +
          (r.converted ? ' – converted to JPG' : '') +
          (r.photoFallback ? ' – saved the photo (this story is a photo with music)' : '') +
          (r.renamed ? ' – saved directly in Downloads (another extension blocks custom folders)' : '') +
          (r.quality === 'page' ? ' – best size shown on page' : '') +
          (r.quality === 'frame' && !r.photoFallback ? ' – taken from the story on screen' : ''));
      } catch (err) {
        console.error('[StoryStash]', err);
        b.innerHTML = ICON_ERR;
        b.classList.add('igdl-fail');
        toast('Download failed: ' + (err && err.message ? err.message : err), true);
      } finally {
        b.classList.remove('igdl-busy');
        setTimeout(() => { b.innerHTML = icon; b.classList.remove('igdl-done', 'igdl-fail'); }, 2500);
      }
    }, true);
    return b;
  }

  function isEligible(el) {
    if (el.closest('.' + BTN_CLASS)) return false;
    if (el.closest('header, nav')) return false;
    if (el.tagName === 'IMG') {
      const alt = (el.getAttribute('alt') || '').toLowerCase();
      if (alt.includes('profile picture')) return false;
      const src = el.currentSrc || el.src || '';
      if (!/cdninstagram\.com|fbcdn\.net/.test(src)) return false;
    }
    // profile / explore grid thumbnails live inside post links – skip them
    if (el.closest('a[href*="/p/"], a[href*="/reel/"]') && !el.closest('article, [role="dialog"]')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  }

  // ---- posts: a button next to each photo/video, self-correcting placement
  const mediaBtn = new WeakMap();   // media element -> its button
  const floatingPosts = new Set();  // post buttons that had to float above the page

  function postCtx(m) { return m.closest('article, [role="dialog"], main') || document.body; }

  function attach(media) {
    let btn = mediaBtn.get(media);
    if (btn && btn.isConnected) return btn;
    const host = media.parentElement;
    if (!host) return null;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    btn = makeButton(false, (b) => (b._media && b._media.isConnected ? b._media : hostMedia(b)));
    btn._media = media;
    host.appendChild(btn);
    mediaBtn.set(media, btn);
    return btn;
  }

  /**
   * 'ok' = the button is the top element under the mouse,
   * 'covered' = an Instagram layer of the same post lies on top of it
   *   (feed videos have an invisible play/mute layer),
   * 'hidden' = off-screen / hidden carousel slide / under the page header -> leave alone.
   */
  function hitState(btn) {
    const r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return 'hidden';
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'hidden';
    const list = document.elementsFromPoint(x, y);
    if (!list.length) return 'hidden';
    if (list[0] === btn || btn.contains(list[0])) return 'ok';
    if (!list.some((e) => e === btn || btn.contains(e))) return 'hidden'; // clipped away
    const ctx = btn._media ? postCtx(btn._media) : document.body;
    return ctx.contains(list[0]) ? 'covered' : 'hidden';
  }

  function placeFloating(btn, media, offset) {
    const r = media.getBoundingClientRect();
    const size = 34;
    const dialog = document.querySelector('[role="dialog"]');
    const top = r.top + offset;
    const left = r.right - size - 12;
    const hide = !media.isConnected || !r.width ||
      top < 0 || top + size > Math.min(r.bottom, innerHeight) || left < 0 || left + size > innerWidth ||
      (dialog && !dialog.contains(media)); // don't float feed buttons over an opened post
    btn.style.display = hide ? 'none' : 'flex';
    if (!hide) { btn.style.top = top + 'px'; btn.style.left = left + 'px'; }
  }

  function fixPlacement(btn) {
    if (btn.classList.contains('igdl-floating') || hitState(btn) !== 'covered') return;
    const media = btn._media;
    if (!media) return;
    const mr = media.getBoundingClientRect();
    const ctx = postCtx(media);
    // 1) move up to a positioned ancestor that still has the video's size
    let anc = btn.parentElement && btn.parentElement.parentElement;
    for (let i = 0; i < 8 && anc && anc !== ctx && ctx.contains(anc); i++, anc = anc.parentElement) {
      const ar = anc.getBoundingClientRect();
      if (ar.width > mr.width + 60 || ar.height > mr.height + 160) break; // would leave the media
      if (getComputedStyle(anc).position === 'static') continue; // never change Instagram's layout
      anc.appendChild(btn);
      if (hitState(btn) === 'ok') return;
    }
    // 2) still covered: float above the whole page and follow the media while scrolling
    btn.classList.add('igdl-floating');
    document.documentElement.appendChild(btn);
    floatingPosts.add(btn);
    placeFloating(btn, media, 64);
  }

  function placeAllFloating() {
    for (const b of floatingPosts) {
      if (!b._media || !b._media.isConnected) { b.remove(); floatingPosts.delete(b); continue; }
      placeFloating(b, b._media, 64);
    }
  }

  // ---- stories: ONE floating button on top of everything.
  // Instagram lays an invisible tap layer (pause / next story) over story
  // videos, which swallowed clicks on a button placed inside the story. A
  // fixed button attached to <html> sits above every Instagram layer.
  let storyBtn = null;
  let storyPhotoBtn = null; // 📷 next to ⤓ on video stories (photo stories with music are videos)
  let storyTarget = null;

  function largestMedia() {
    let best = null, bestArea = 0;
    for (const m of document.querySelectorAll('img, video')) {
      if (!isEligible(m)) continue;
      const r = m.getBoundingClientRect();
      const visible = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const area = r.width * r.height;
      if (visible && area > bestArea) { best = m; bestArea = area; }
    }
    return best;
  }

  function placeStoryButton() {
    if (!storyBtn) return;
    const t = storyTarget && storyTarget.isConnected ? storyTarget : null;
    if (!t) { storyBtn.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    const size = 34;
    const top = Math.min(Math.max(r.top + 84, 8), innerHeight - size - 8);
    const left = Math.min(Math.max(r.right - size - 12, 8), innerWidth - size - 8);
    storyBtn.style.display = 'flex';
    storyBtn.style.top = top + 'px';
    storyBtn.style.left = left + 'px';
    if (storyPhotoBtn) {
      const show = t.tagName === 'VIDEO';
      storyPhotoBtn.style.display = show ? 'flex' : 'none';
      if (show) { storyPhotoBtn.style.top = top + 'px'; storyPhotoBtn.style.left = Math.max(left - size - 10, 8) + 'px'; }
    }
  }

  function updateStoryButton(isStory) {
    if (!isStory) {
      if (storyBtn) { storyBtn.remove(); storyBtn = null; }
      if (storyPhotoBtn) { storyPhotoBtn.remove(); storyPhotoBtn = null; }
      storyTarget = null;
      return;
    }
    storyTarget = largestMedia();
    if (!storyBtn) {
      storyBtn = makeButton(true, () => {
        // re-check at click time: the story may have moved on
        const m = largestMedia();
        return m || storyTarget;
      });
      storyBtn.classList.add('igdl-floating');
      storyPhotoBtn = makeButton(true, () => largestMedia() || storyTarget, { photo: true });
      storyPhotoBtn.classList.add('igdl-floating');
    }
    if (!storyBtn.isConnected) document.documentElement.appendChild(storyBtn);
    if (!storyPhotoBtn.isConnected) document.documentElement.appendChild(storyPhotoBtn);
    placeStoryButton();
  }

  function scan() {
    ingestEmbeddedJson();
    const isStory = location.pathname.startsWith('/stories/');
    if (isStory) {
      // post buttons are not used on the story viewer
      document.querySelectorAll('.' + BTN_CLASS).forEach((b) => { if (b !== storyBtn && b !== storyPhotoBtn) b.remove(); });
      floatingPosts.clear();
    }
    updateStoryButton(isStory);
    if (isStory) return;
    placeAllFloating();
    for (const m of document.querySelectorAll('img, video')) {
      if (!isEligible(m)) continue;
      const b = attach(m);
      if (b) fixPlacement(b);
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    // debounce bursts of mutations; setTimeout (not rAF) so it also runs in background tabs
    setTimeout(() => {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[StoryStash] scan error', e); }
    }, 80);
  }

  loadSettings().finally(() => {
    scheduleScan();
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style']
    });
    let raf = 0;
    window.addEventListener('scroll', () => {
      scheduleScan();
      if (!raf && floatingPosts.size) raf = requestAnimationFrame(() => { raf = 0; placeAllFloating(); });
    }, { passive: true, capture: true });
    window.addEventListener('resize', scheduleScan, { passive: true });
    setInterval(scheduleScan, 1500); // catches SPA navigations and carousel swipes
    setInterval(() => { // keep floating buttons on their media
      if (storyBtn) placeStoryButton();
      if (floatingPosts.size) placeAllFloating();
    }, 250);
  });
})();
