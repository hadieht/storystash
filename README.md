# StoryStash – Story & Post Saver (Chrome extension, Manifest V3)

Puts a round **⤓** button on every photo and video on instagram.com (feed, post pages, post pop-ups,
reels and stories). Click it and **that exact photo** is saved in the best quality Instagram has.

## Install (takes 1 minute)
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right switch)
3. Click **Load unpacked** and pick this folder (`insta-downloader-extension`, the one that has `manifest.json` in it)
   – or unzip `dist/storystash-v<version>.zip` first and pick the unzipped folder
4. Open / reload https://www.instagram.com (you need to be logged in)

## How it works
| Feature | How |
|---|---|
| Button on each photo | Every large photo/video gets its own button (top-right; on stories it sits under the progress bar). Avatars and profile-grid thumbnails get no button. |
| Carousels (several photos in one post) | **Each slide has its own button**, so you get the slide you are looking at, not the first one. The slide is matched to Instagram's data by file name; if that fails, by its position. |
| Stories | Only the story that is playing gets a button. The story id comes from the URL, so you get the story on screen. Highlights work too. |
| Full quality | The extension asks Instagram's own web API (using your logged-in session) for every size it has and picks the biggest one (usually 1080–1440 px wide, the original upload size Instagram keeps). If that request fails, it falls back to the biggest size the page shows, and the message says so. |
| File name | `username_YYYY-MM-DD_HH-mm-ss_<postcode>[_<slide>].jpg`, e.g. `natgeo_2026-11-09_14-05-07_C1a2B3c4D5e_2.jpg`. The date is when the post/story was **published** (you can switch to download date). |
| Where | `Downloads/Instagram/…` by default (settings are stored only on this computer). Click the extension icon to change the folder, use one folder per user, or pick which date goes in the name. |
| Videos / reels / video stories | Saved as `.mp4` in the highest quality. The extension reads the video data Instagram's own app already loaded (no extra request needed); the Instagram API is only a backup. |
| Always JPG | Every photo is checked: real JPEGs are saved byte-for-byte; WebP (or anything else) is converted to JPG at full resolution, quality 95. |
| File name protection | Other download extensions can overwrite file names (that produced names like `893869779_1858…_n.jpg`). StoryStash now claims the name itself and, after each download, checks the name Chrome actually used. If another extension replaced it, the wrong file is deleted and saved again with the right name (in that case directly in Downloads, without the sub-folder). |

## Files
```
manifest.json        MV3 manifest (downloads + storage permissions, instagram/CDN hosts only)
src/utils.js         pure helpers: shortcode→id, best size, file name, URL parsing, media JSON reader
src/page-hook.js     runs in the page: reads the post/story data Instagram downloads (fetch/XHR)
src/convert.js       WebP/PNG → JPG conversion for the service worker
src/content.js       injects buttons, works out the exact item, asks for the original file
src/content.css      button + toast styles
src/background.js    service worker – does chrome.downloads (only Instagram/CDN URLs allowed)
popup/               settings popup
icons/               16/48/128 px icons (made by tools/make_icons.py)
tests/               node unit tests + mock-Instagram browser test
```

## Tests
```
node tests/utils.test.js                         # unit tests
python3 tests/cors_server.py 8765 .              # then open:
http://localhost:8765/tests/mock.html?auto       # fake Instagram page (posts, carousel, photo + video story), prints RESULT_JSON
bash tests/sw-test.sh                            # real Chromium: naming vs. a renaming extension (both install orders), WebP→JPG
```

## Notes / limits
- If you have another download extension, remove StoryStash and **Load unpacked** it again so it is the newest one.
  Then Chrome lets it choose the name *and* the `Instagram/` folder directly.
- Instagram changes its page often. If buttons stop showing up, the code that finds them
  (`isEligible` / `attach` in `src/content.js`) is the part to update.
- Private accounts: only works for content your logged-in account is allowed to see.
- Only download content you have the right to keep. Respect creators' copyright and Instagram's Terms.

## Publishing to the Chrome Web Store
- `bash package.sh` → `dist/storystash-v<version>.zip` (runtime files only) – this is what you upload.
- `CHROMEWEBSTORE.md` – every text field, permission justification and privacy answer to paste into the dashboard.
- `store-assets/` – icon, 4 screenshots (1280×800), small promo tile. Rebuild: `python3 tools/make_store_assets.py`.
- `docs/` – home page + privacy policy for GitHub Pages (Settings → Pages → branch `main`, folder `/docs`).
- Icons: `python3 tools/make_icons.py`.
