// Runs in the PAGE (MAIN world) at document_start. Instagram's own app already
// downloads the full media data (all sizes, video files) for every post and
// story it shows. We read those responses and hand the media list to the
// content script, so we know the original files without extra requests.
(function () {
  'use strict';
  if (window.__igdlHook) return;
  window.__igdlHook = true;
  const U = window.IGDL;
  if (!U) return;

  const INTERESTING = /\/(graphql|api\/v1|api\/graphql)/;

  function publish(text) {
    try {
      const docs = U.parseJsonBodies(text);
      if (!docs.length) return;
      const items = [];
      for (const d of docs) U.collectMediaItems(d, items);
      if (items.length) window.postMessage({ __igdl: 'media', items }, location.origin);
    } catch (_) { /* never break Instagram */ }
  }

  // ---- fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (INTERESTING.test(url)) {
          p.then((res) => {
            try { res.clone().text().then(publish, () => {}); } catch (_) { /* ignore */ }
          }, () => {});
        }
      } catch (_) { /* ignore */ }
      return p;
    };
  }

  // ---- XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__igdlUrl = String(url || ''); } catch (_) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try {
      if (INTERESTING.test(this.__igdlUrl || '')) {
        this.addEventListener('load', function () {
          try {
            if (this.responseType === '' || this.responseType === 'text') publish(this.responseText);
            else if (this.responseType === 'json' && this.response) publish(JSON.stringify(this.response));
          } catch (_) { /* ignore */ }
        });
      }
    } catch (_) { /* ignore */ }
    return origSend.apply(this, arguments);
  };
})();
