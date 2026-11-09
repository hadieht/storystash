# Chrome Web Store Listing — StoryStash – Story & Post Saver

> Last Updated: 2026-11-09
> Copy-paste source for the Chrome Web Store Developer Dashboard.
> Upload file: `dist/storystash-v1.4.0.zip` (built by `bash package.sh`).

## Store Listing  (Dashboard → Store listing)

**Extension Name**
StoryStash – Story & Post Saver

**Short Description** (= manifest description, 129/132 chars)
Adds a download button to Instagram™ stories, photos and videos and saves the largest available size, named by username and date.

**Detailed Description** (paste as-is; the store shows plain text)
```
StoryStash lets you keep Instagram™ posts and stories for personal offline viewing. It adds a small download button to photos, videos and stories on instagram.com, so you can save the exact item you are looking at with one click.

WHAT IT DOES
• A download button on post photos, videos, reels and the story you are watching.
• Posts with several photos: each photo has its own button, so you save the one on screen, not just the first one.
• Largest available size: StoryStash saves the biggest version Instagram provides instead of the small preview.
• Photos are saved as JPG (WebP images are converted on your computer). Videos are saved as MP4.
• Clear file names: username_date_time_postcode.jpg – for example travel.notes_2026-11-09_14-05-07_C1a2B3c4D5e_2.jpg.
• Your choice of date (when it was posted or when you downloaded it), download folder and one folder per account.

HOW TO USE
1. Install StoryStash and open instagram.com in Chrome.
2. Press the round download button on a photo, video or story.
3. The file appears in your Downloads folder (inside "Instagram" by default).
Click the StoryStash icon in the toolbar to change the folder or file-name options.

PRIVACY
No account, no ads, no analytics, no tracking. Everything StoryStash reads on instagram.com is handled only on your computer and is never sent to the developer or anyone else. Settings are stored only on your computer. The only network requests go to Instagram itself, to fetch the item you chose to save.

PLEASE NOTE
Only save content you own or have permission to keep, and respect creators' rights and Instagram's Terms of Use. StoryStash only works for content your own Instagram account can already see, and saves one item per click.
StoryStash is an independent project and is not affiliated with, endorsed or sponsored by Instagram or Meta Platforms, Inc. Instagram is a trademark of Meta Platforms, Inc.

Support: hadi.ehterami@gmail.com
```

**Category**: Photos
**Language**: English

## Privacy practices  (Dashboard → Privacy)

**Single Purpose**
Save the photo, video or story the user chooses on instagram.com to their computer, in the largest size Instagram provides and with a file name made of the account's username and the date.

### Permission justifications
| Permission | Type | Justification (paste in the matching field) |
|---|---|---|
| downloads | permissions | Saves the photo or video the user clicked to their Downloads folder with a clear name (username_date.jpg/mp4), and checks the final file name so it can be corrected if another extension renamed it. |
| storage | permissions | Remembers the user's four settings from the popup (date style, folder name, folder per account, "ask Instagram for the largest file" option) locally on the device. |
| content script on https://www.instagram.com/* | content_scripts | Shows the download button on Instagram stories, posts and reels and finds the largest file of the item the user clicked. (No separate host permission is requested for instagram.com.) |
| https://*.cdninstagram.com/* | host_permissions | Instagram serves its photos and videos from this domain; the extension fetches the chosen file from here to save it and to convert WebP photos to JPG on the user's computer. |
| https://*.fbcdn.net/* | host_permissions | Some Instagram photos and videos are served from this Meta content domain; needed for the same reason as cdninstagram.com. |

**Are you using remote code?** No, I am not using remote code. (All JavaScript is inside the package; nothing is loaded from external servers or evaluated at runtime.)

### Data usage (the checkbox form)
Google counts data that is only *handled on the device* as something to disclose (User Data FAQ:
https://developer.chrome.com/docs/webstore/program-policies/user-data-faq). Tick:
- [x] **Personally identifiable information** – Instagram usernames of the accounts whose posts are saved (used for the file name).
- [x] **Authentication information** – Instagram's CSRF security token is read from the page and sent back to instagram.com with the single lookup request after a click.
- [x] **Website content** – media addresses, usernames and dates that Instagram's page receives.
Leave all others unticked (health, financial, personal communications, location, web history, user activity).

Explanation to paste if asked: "All of this is handled only on the user's device to find and name the file the user chose to save; it is never transmitted to the developer or any third party. The only network requests go to Instagram's own servers for the item the user clicked. Settings are kept in chrome.storage.local (not synced)."

Certifications → tick all three:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**: `https://hadieht.github.io/storystash/privacy.html` ✅ live (source: `docs/privacy.html`)

## Graphics & Assets  (store-assets/)
| Asset | Size | Status | File |
|---|---|---|---|
| Store icon | 128×128 PNG | ✅ | store-assets/icon-128.png |
| Screenshot 1 – button on every photo | 1280×800 | ✅ | store-assets/screenshot-1.png |
| Screenshot 2 – exact slide of multi-photo post | 1280×800 | ✅ | store-assets/screenshot-2.png |
| Screenshot 3 – stories + file names | 1280×800 | ✅ | store-assets/screenshot-3.png |
| Screenshot 4 – settings popup | 1280×800 | ✅ | store-assets/screenshot-4.png |
| Small promo tile | 440×280 | ✅ | store-assets/promo-small-440x280.png |
| Marquee promo tile | 1400×560 | optional – not made | |

Screenshots use generated sample images and fictional account names (no real users' content). Rebuild with `python3 tools/make_store_assets.py`.

## Distribution
**Visibility**: Public
**Regions**: All regions
**Pricing**: Free – no in-app purchases, no ads

## Developer Info
**Publisher name**: Hadi Ehterami
**Contact email**: hadi.ehterami@gmail.com (must be verified in the dashboard → Account)
**Support**: hadi.ehterami@gmail.com or https://github.com/hadieht/storystash/issues
**Homepage**: `https://hadieht.github.io/storystash/` (source: `docs/index.html`)

## Version History
| Version | Date | Changes | Status |
|---|---|---|---|
| 1.4.0 | 2026-11-09 | First store release: StoryStash name & icon, local-only settings, privacy policy, policy-review fixes (data disclosure, Limited Use, no profile lookup, CDN-only URLs, one-time rights notice) | Draft |

## Review Notes
### Known risks / limitations
- Instagram changes its website often; buttons may need updates after Instagram redesigns.
- Media-downloader extensions get extra scrutiny for copyright and trademark. Mitigations in place: neutral name and icon, "not affiliated" notice in listing, popup and website, a "only save content you have the right to keep" notice, works only on content the user's own account can see, no bulk or automated downloading (one click = one file).
- Name/description mention "Instagram™" only to describe compatibility (nominative use), never as part of the extension name.
- Code notes for reviewers: src/page-hook.js wraps fetch/XHR on instagram.com read-only (it never changes requests or responses) to see the media list Instagram's page loads; code is not minified or obfuscated.
- Screenshots are illustrations made with generated sample images and fictional account names; the download button and messages are the extension's real button and messages.

### Rejection History
(none yet)
