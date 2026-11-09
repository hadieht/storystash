// Auto-runner for mock.html (used with: chromium --headless --dump-dom ...?auto)
(async () => {
  if (!location.search.includes('auto')) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(600);
  const btns = () => [...document.querySelectorAll('.igdl-btn')];
  out.buttonCount = btns().length;
  out.buttonOn = btns().map((b) => { const m = b._media; return m.tagName === 'VIDEO' ? m.id : m.src.split('/').pop().split('?')[0]; });
  out.gridHasButton = !!document.querySelector('#grid').parentElement.querySelector('.igdl-btn');
  out.toasts = [];
  const photoBtns = btns().filter((b) => b._media.tagName === 'IMG');
  for (const i of [1, 3, 0, 2]) {
    photoBtns[i].click();
    await sleep(300);
    out.toasts.push(document.getElementById('igdl-toast').textContent);
  }
  // what is really under the mouse at the centre of a button (proves it is clickable)
  const onTop = (btn) => {
    const r = btn.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === btn ||
      btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  };
  out.postButtonsClickable = btns().filter((b) => b.getBoundingClientRect().top < innerHeight).map(onTop);

  // ---- feed videos covered by an invisible play/mute layer
  await fetch('/graphql/feed', { method: 'POST' }); // what Instagram's feed loads
  out.feedVideos = [];
  for (const id of ['vA', 'vB']) {
    const v = document.getElementById(id);
    v.scrollIntoView({ block: 'center' });
    await sleep(700);
    const b = btns().find((x) => x._media === v);
    const info = { id, hasButton: !!b };
    if (b) {
      info.floating = b.classList.contains('igdl-floating');
      info.clickable = onTop(b);
      const vr = v.getBoundingClientRect(), br = b.getBoundingClientRect();
      info.buttonOnVideo = br.left >= vr.left && br.right <= vr.right && br.top >= vr.top && br.bottom <= vr.bottom;
      // scroll a bit: a floating button must follow its video
      window.scrollBy(0, 40); await sleep(400);
      const vr2 = v.getBoundingClientRect(), br2 = b.getBoundingClientRect();
      info.followsScroll = Math.abs((br2.top - vr2.top) - (br.top - vr.top)) < 2;
      b.click(); await sleep(400);
      info.toast = document.getElementById('igdl-toast').textContent;
    }
    out.feedVideos.push(info);
  }
  window.scrollTo(0, 0);

  // ---- photo story
  history.pushState({}, '', '/stories/carol/3456789012345678901/');
  const s = document.createElement('section');
  s.style.cssText = 'position:fixed;inset:0;background:#000;z-index:10';
  // Instagram-like layout: media in its own stacking context + invisible tap layer above it
  const storyHtml = (inner) => '<div style="position:relative;width:400px;height:700px;margin:20px auto">' +
    '<div style="position:relative;z-index:0;width:400px;height:700px"><div style="width:400px;height:700px">' + inner + '</div></div>' +
    '<div class="taplayer" style="position:absolute;inset:0;z-index:1"></div></div>';
  s.innerHTML = storyHtml('<img id="story" src="https://x.cdninstagram.com/v/t51/STORY_KEY_n.jpg?stp=p720" style="width:400px;height:700px;display:block">');
  document.body.prepend(s);
  await sleep(1800);
  out.storyButtons = btns().length;
  out.storyButtonFloating = !!document.querySelector('.igdl-floating');
  out.storyButtonClickable = onTop(btns()[0]);
  // the OLD placement (inside the story) would be covered by the tap layer:
  const old = document.createElement('button');
  old.style.cssText = 'position:absolute;top:84px;right:12px;width:34px;height:34px;z-index:2147483000';
  document.getElementById('story').parentElement.appendChild(old);
  out.oldPlacementClickable = onTop(old);
  old.remove();
  btns()[0].click();
  await sleep(400);
  out.photoStoryToast = document.getElementById('igdl-toast').textContent;

  // ---- video story: Instagram's app fetches story data (our hook sees it), then shows a blob: video
  await fetch('/graphql/query', { method: 'POST' });
  await sleep(100);
  history.pushState({}, '', '/stories/dave.v/3999000000000000001/');
  s.innerHTML = storyHtml('<video id="vstory" src="blob:https://www.instagram.com/abc" style="width:400px;height:700px;display:block"></video>');
  await sleep(1800);
  out.videoStoryButtons = btns().length;
  out.videoStoryButtonClickable = onTop(btns()[0]);
  btns()[0].click();
  await sleep(400);
  out.videoToast = document.getElementById('igdl-toast').textContent;

  // another extension hijacked the name -> worker hands the file back, page saves it via <a download>
  const saved = [];
  HTMLAnchorElement.prototype.click = function () { saved.push({ download: this.download, blob: this.href.startsWith('blob:') }); };
  const jpgB64 = '/9j/4AAQ'; // starts with FF D8 FF
  window.chrome.runtime.sendMessage = async () => ({ ok: true, renamed: true, fallback: { name: 'dave.v_x.mp4', dataUrl: 'data:video/mp4;base64,' + jpgB64 } });
  btns()[0].click();
  await sleep(400);
  out.pageSave = saved;
  out.pageSaveToast = document.getElementById('igdl-toast').textContent;
  out.downloads = window.__downloads;
  out.apiCalls = window.__apiCalls;
  const pre = document.createElement('pre');
  pre.id = 'RESULT';
  pre.textContent = 'RESULT_JSON:' + JSON.stringify(out);
  document.body.appendChild(pre);
})();
