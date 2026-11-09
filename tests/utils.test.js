// Unit tests for src/utils.js – run: node tests/utils.test.js
const assert = require('assert');
const U = require('../src/utils.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('shortcode -> media id', () => {
  // known pair: shortcode "B" = 1, "BA" = 64
  assert.strictEqual(U.shortcodeToMediaId('B'), '1');
  assert.strictEqual(U.shortcodeToMediaId('BA'), '64');
  // round-trip check on a realistic 11-char code
  const id = U.shortcodeToMediaId('CuE0kUjMDcK');
  assert.match(id, /^\d{18,20}$/);
  // private-post long codes are truncated to 11 chars
  assert.strictEqual(U.shortcodeToMediaId('CuE0kUjMDcKxyzABCDEF'), id);
});

t('srcset -> largest url', () => {
  const img = { getAttribute: () => 'https://a.cdninstagram.com/x_n.jpg?stp=p640 640w, https://a.cdninstagram.com/x_n.jpg?stp=p1080 1080w, https://a.cdninstagram.com/x_n.jpg?stp=p320 320w' };
  assert.ok(U.bestDomImageUrl(img).includes('p1080'));
});

t('media file key ignores size/query', () => {
  const a = U.mediaFileKey('https://scontent.cdninstagram.com/v/t51.29350-15/411_222_333_n.jpg?stp=dst-jpg_e35_p640x640&_nc_ht=x');
  const b = U.mediaFileKey('https://scontent-fra.cdninstagram.com/v/t51.29350-15/411_222_333_n.jpg?stp=dst-jpg_e35&_nc_ht=y');
  assert.strictEqual(a, '411_222_333_n');
  assert.strictEqual(a, b);
  assert.strictEqual(U.mediaFileKey('blob:https://www.instagram.com/abc'), null);
});

const carousel = [
  { image_versions2: { candidates: [
    { url: 'https://c/v/1_aaa_n.jpg?s=640', width: 640, height: 800 },
    { url: 'https://c/v/1_aaa_n.jpg?s=1440', width: 1440, height: 1800 } ] } },
  { image_versions2: { candidates: [
    { url: 'https://c/v/2_bbb_n.jpg?s=1080', width: 1080, height: 1350 },
    { url: 'https://c/v/2_bbb_n.jpg?s=320', width: 320, height: 400 } ] } },
  { image_versions2: { candidates: [{ url: 'https://c/v/3_ccc_n.jpg', width: 640, height: 640 }] },
    video_versions: [
      { url: 'https://c/v/vid_low.mp4', width: 480, height: 480 },
      { url: 'https://c/v/vid_hi.mp4', width: 1080, height: 1080 } ] }
];

t('best media picks max resolution (not first entry)', () => {
  assert.strictEqual(U.itemBestMedia(carousel[0]).url, 'https://c/v/1_aaa_n.jpg?s=1440');
  assert.strictEqual(U.itemBestMedia(carousel[1]).width, 1080);
  const v = U.itemBestMedia(carousel[2]);
  assert.strictEqual(v.isVideo, true);
  assert.strictEqual(v.url, 'https://c/v/vid_hi.mp4');
});

t('carousel: the clicked slide is matched exactly', () => {
  const hit = U.matchItemByKey(carousel, U.mediaFileKey('https://other-cdn/v/2_bbb_n.jpg?stp=p480'));
  assert.strictEqual(hit.index, 1);
  assert.strictEqual(U.matchItemByKey(carousel, 'nope'), null);
});

t('filename = username + date (+ id, slide)', () => {
  const d = new Date(2026, 10, 9, 14, 5, 7);
  assert.strictEqual(
    U.buildFilename({ username: 'nat.geo', date: d, id: 'C1a2B3c4D5e', index: 2, ext: 'jpg' }),
    'Instagram/nat.geo_2026-11-09_14-05-07_C1a2B3c4D5e_3.jpg');
  assert.strictEqual(
    U.buildFilename({ username: 'a/b', date: d, ext: 'mp4', settings: { folder: '', perUserFolder: true } }),
    'a_b/a_b_2026-11-09_14-05-07.mp4');
  assert.strictEqual(
    U.buildFilename({ username: 'x', date: d, id: '1', ext: 'jpg', settings: { folder: 'IG/Saved', perUserFolder: true } }),
    'IG/Saved/x/x_2026-11-09_14-05-07_1.jpg');
});

t('url path parsing', () => {
  assert.deepStrictEqual(U.parsePath('/p/C1a2B3c4D5e/'), { type: 'post', shortcode: 'C1a2B3c4D5e' });
  assert.deepStrictEqual(U.parsePath('/someuser/p/C1a2B3c4D5e/'), { type: 'post', shortcode: 'C1a2B3c4D5e' });
  assert.deepStrictEqual(U.parsePath('/reel/Cabc/'), { type: 'post', shortcode: 'Cabc' });
  assert.deepStrictEqual(U.parsePath('/stories/natgeo/3456789012345678901/'), { type: 'story', username: 'natgeo', storyPk: '3456789012345678901' });
  assert.deepStrictEqual(U.parsePath('/stories/highlights/17890000000000000/'), { type: 'highlight', highlightId: '17890000000000000', storyPk: null });
  assert.strictEqual(U.parsePath('/').type, null);
  assert.strictEqual(U.shortcodeFromHref('/p/XYZ/'), 'XYZ');
});

t('extension from url', () => {
  assert.strictEqual(U.extFromUrl('https://c/v/a_n.jpg?x=1', false), 'jpg');
  assert.strictEqual(U.extFromUrl('https://c/v/a.mp4', true), 'mp4');
  assert.strictEqual(U.extFromUrl('https://c/v/noext', true), 'mp4');
});

t('reads media from Instagram responses (graphql, NDJSON, for(;;))', () => {
  const body = 'for (;;);' + JSON.stringify({ data: { a: { items: [
    { pk: '9', id: '9_1', code: 'XYZ', taken_at: 5, user: { username: 'u1' },
      carousel_media: [{ pk: '10', image_versions2: { candidates: [{ url: 'https://c/v/k1_n.webp', width: 1, height: 1 }] } }] },
    { pk: '11', id: '11_1', user: { username: 'u2' }, image_versions2: { candidates: [] },
      video_versions: [{ url: 'https://c/v/v.mp4', width: 720, height: 1280 }] } ] } } }) + '\n';
  const items = [];
  U.parseJsonBodies(body).forEach((d) => U.collectMediaItems(d, items));
  assert.strictEqual(items.length, 2);
  const post = items.find((i) => i.code === 'XYZ');
  assert.strictEqual(post.carousel_media[0].user.username, 'u1'); // slide inherits owner
  assert.strictEqual(post.carousel_media[0].taken_at, 5);
  const vid = items.find((i) => i.pk === '11');
  assert.strictEqual(U.itemBestMedia(vid).isVideo, true);
  assert.deepStrictEqual(U.parseJsonBodies('{"a":1}\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

console.log(`\n${n} tests passed`);
