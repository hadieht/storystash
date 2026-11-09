"""Build Chrome Web Store assets into store-assets/:
   screenshot-1..4.png (1280x800) and promo-small-440x280.png.

Uses generated sample photos (no real users' content) and the extension's real
button / toast CSS and real popup, rendered with headless Chromium.
Run: python3 tools/make_store_assets.py
"""
import http.server, math, os, random, shutil, subprocess, threading, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "store-assets"
SRC = ASSETS / "src"
SNAP = Path.home() / "snap/chromium/common/storystash-shots"  # snap chromium can write here
SRC.mkdir(parents=True, exist_ok=True)
random.seed(7)


# ------------------------------------------------------------ sample photos
def grad(w, h, top, bottom):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im


def mountains(w, h, sky_top, sky_bottom, layers, sun=None):
    im = grad(w, h, sky_top, sky_bottom)
    d = ImageDraw.Draw(im)
    if sun:
        x, y, r, c = sun
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    for i, col in enumerate(layers):
        base = h * (0.45 + i * 0.13)
        pts = [(0, h)]
        for x in range(0, w + 20, 20):
            y = base - (math.sin(x / (90 + i * 40) + i) * 0.5 + 0.5) * h * 0.18 - random.random() * 8
            pts.append((x, y))
        pts.append((w, h))
        d.polygon(pts, fill=col)
    return im


def make_photos():
    p = {}
    p["sunset"] = mountains(1080, 1350, (255, 146, 84), (255, 214, 153),
                            [(150, 80, 110), (100, 52, 92), (60, 32, 70), (34, 20, 48)], (720, 520, 110, (255, 238, 190)))
    p["lake"] = mountains(1080, 1350, (120, 190, 235), (225, 242, 252),
                          [(96, 140, 170), (60, 110, 120), (40, 84, 80)], (300, 300, 70, (255, 255, 240)))
    d = ImageDraw.Draw(p["lake"])
    d.rectangle([0, 1050, 1080, 1350], fill=(70, 140, 180))
    p["night"] = mountains(1080, 1920, (14, 18, 48), (60, 50, 120),
                           [(40, 40, 90), (26, 26, 60), (14, 14, 34)], (800, 420, 60, (245, 245, 220)))
    d = ImageDraw.Draw(p["night"])
    for _ in range(160):
        x, y = random.randint(0, 1080), random.randint(0, 900)
        r = random.choice([1, 1, 2, 3])
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255))
    p["coffee"] = grad(1080, 1350, (236, 222, 205), (196, 170, 140))
    d = ImageDraw.Draw(p["coffee"])
    d.ellipse([290, 380, 790, 880], fill=(250, 248, 244))
    d.ellipse([340, 430, 740, 830], fill=(110, 70, 40))
    d.ellipse([440, 530, 640, 730], fill=(200, 160, 120))
    d.rounded_rectangle([760, 560, 880, 680], radius=50, outline=(250, 248, 244), width=26)
    p["coffee"] = p["coffee"].filter(ImageFilter.GaussianBlur(1))
    for k, im in p.items():
        im.save(SRC / f"{k}.jpg", quality=90)


# ------------------------------------------------------------ pages
DOWNLOAD_SVG = ('<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5z"/></svg>')
OK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'

BASE_CSS = """
* { box-sizing: border-box; }
body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       background: linear-gradient(135deg, #0f766e 0%, #3730a3 100%); color: #fff; display: flex; }
.copy { width: 470px; padding: 70px 40px 0 64px; }
.copy img { width: 72px; height: 72px; }
.copy h1 { font-size: 40px; line-height: 1.15; margin: 22px 0 16px; }
.copy p { font-size: 20px; line-height: 1.5; opacity: .92; margin: 0 0 14px; }
.copy .tag { display: inline-block; margin-top: 18px; padding: 6px 12px; border-radius: 99px; background: rgba(255,255,255,.16); font-size: 15px; }
.stage { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; }
.window { width: 720px; height: 700px; background: #fafafa; border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.35); overflow: hidden; color: #111; position: relative; }
.bar { height: 40px; background: #e9eaee; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.bar i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; display: block; } .bar i:nth-child(2){background:#febc2e} .bar i:nth-child(3){background:#28c840}
.bar .url { margin-left: 14px; flex: 1; height: 24px; border-radius: 6px; background: #fff; font-size: 13px; color: #666; display: flex; align-items: center; padding: 0 10px; }
.post { width: 420px; margin: 18px auto; background: #fff; border: 1px solid #e3e3e3; border-radius: 10px; overflow: hidden; }
.post .head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font-weight: 600; font-size: 14px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg,#94a3b8,#475569); }
.media { position: relative; width: 420px; height: 525px; overflow: hidden; }
.media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dots { display: flex; gap: 4px; justify-content: center; padding: 8px; } .dots b { width: 6px; height: 6px; border-radius: 50%; background: #ccc; } .dots b.on { background: #3b82f6; }
.badge { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; padding: 3px 8px; border-radius: 99px; }
.callout { position: absolute; background: #fff; color: #111; border-radius: 10px; padding: 10px 14px; font-size: 15px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.callout:after { content: ""; position: absolute; width: 14px; height: 14px; background: #fff; transform: rotate(45deg); }
.downloads { position: absolute; right: 18px; bottom: 18px; width: 470px; z-index: 5; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 10px 0; font-size: 13px; }
.downloads h4 { margin: 0 14px 6px; font-size: 13px; color: #555; }
.downloads div { display: flex; align-items: center; gap: 10px; padding: 7px 14px; }
.downloads div span.ic { width: 26px; height: 26px; border-radius: 5px; background: #e0e7ff; color: #3730a3; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: none; }
#igdl-toast { position: absolute !important; }
"""


def page(name, title, lines, tag, stage_html, extra_css=""):
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../../src/content.css"><style>{BASE_CSS}{extra_css}</style></head><body>
<div class="copy"><img src="../icon-128.png" alt=""><h1>{title}</h1>{''.join(f'<p>{l}</p>' for l in lines)}<span class="tag">{tag}</span><p style="position:absolute;bottom:22px;font-size:13px;opacity:.7">Illustration with sample images · not affiliated with Instagram</p></div>
<div class="stage">{stage_html}</div></body></html>"""
    (SRC / f"{name}.html").write_text(html)


def btn(extra="", icon=DOWNLOAD_SVG, style=""):
    return f'<button class="igdl-btn {extra}" style="{style}">{icon}</button>'


def build_pages():
    window = lambda inner, url="www.instagram.com": f'<div class="window"><div class="bar"><i></i><i></i><i></i><div class="url">{url}</div></div>{inner}</div>'

    # 1 — button on every post
    post1 = f'''<div class="post"><div class="head"><div class="avatar"></div>travel.notes</div>
      <div class="media"><img src="sunset.jpg">{btn(style="opacity:1;transform:scale(1.15)")}</div><div class="dots"><b class="on"></b></div></div>'''
    page("shot1", "One click saves the photo you see",
         ["A download button appears on every photo, video and reel in your feed.",
          "Get the largest available size, not the small preview."],
         "Largest size · JPG &amp; MP4",
         window(post1) + '<div class="callout" style="right:262px;top:224px">Click to download</div>',
         ".callout:after{right:-6px;top:14px}")

    # 2 — carousel: the exact slide
    post2 = f'''<div class="post"><div class="head"><div class="avatar"></div>travel.notes</div>
      <div class="media"><img src="lake.jpg"><span class="badge" style="top:12px;left:12px;right:auto">2 / 3</span>{btn("igdl-done", OK_SVG, "opacity:1;top:64px")}</div>
      <div class="dots"><b></b><b class="on"></b><b></b></div></div>
      <div id="igdl-toast" class="igdl-show" style="bottom:10px">Saved travel.notes_2026-11-09_14-05-07_C1a2B3c4D5e_2.jpg (1440×1800)</div>'''
    page("shot2", "Several photos? You get exactly that one",
         ["In posts with several photos, each photo has its own button.",
          "The file you save is the slide on screen – here photo 2 of 3."],
         "Per-slide downloads",
         window(post2))

    # 3 — stories + clear file names
    story = f'''<div style="position:absolute;inset:40px 0 0 0;background:#111;display:flex;align-items:center;justify-content:center">
        <div style="position:relative;width:340px;height:604px;border-radius:10px;overflow:hidden">
          <img src="night.jpg" style="width:100%;height:100%;object-fit:cover">
          <div style="position:absolute;top:8px;left:8px;right:8px;display:flex;gap:4px"><i style="flex:1;height:3px;background:#fff;border-radius:2px"></i><i style="flex:1;height:3px;background:rgba(255,255,255,.4);border-radius:2px"></i></div>
          <div style="position:absolute;top:20px;left:12px;color:#fff;font-weight:600;font-size:14px;display:flex;gap:8px;align-items:center"><span class="avatar" style="width:28px;height:28px"></span>night.sky.club · 2h</div>
          {btn("igdl-story", style="opacity:1")}
        </div></div>
      <div class="downloads"><h4>Downloads</h4>
        <div><span class="ic">JPG</span>night.sky.club_2026-11-09_02-14-33_3456789012.jpg</div>
        <div><span class="ic">MP4</span>night.sky.club_2026-11-09_01-50-12_3456780044.mp4</div>
        <div><span class="ic">JPG</span>travel.notes_2026-11-08_18-22-05_C1a2B3c4D5e_1.jpg</div></div>'''
    page("shot3", "Stories too – photos and videos",
         ["Keep the story you are watching for offline viewing, including video stories.",
          "Every file is named with the username and date, so your folder stays organised."],
         "username_date.jpg / .mp4",
         window(story, "www.instagram.com/stories/"))

    # 4 — real popup
    popup_body = (ROOT / "popup/popup.html").read_text()
    body = popup_body.split("<body>")[1].split("<script")[0]
    popup = f'''<div style="position:absolute;right:30px;top:52px;width:320px;z-index:2147483647;background:#fff;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.35);overflow:hidden">
      <div class="popup">{body}</div></div>'''
    post4 = f'''<div class="post"><div class="head"><div class="avatar"></div>coffee.mornings</div>
      <div class="media"><img src="coffee.jpg">{btn(style="opacity:1")}</div></div>'''
    page("shot4", "Your files, your way",
         ["Choose the folder, use one folder per account, and pick which date goes in the file name.",
          "No account, no ads, no tracking – settings stay on your computer."],
         "Private by design",
         window(post4 + popup),
         ".popup{font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;padding:14px 16px}"
         + (ROOT / "popup/popup.css").read_text().replace("body {", ".popup-unused {")
             .replace("\nh1 {", "\n.popup h1 {").replace("\ncode {", "\n.popup code {")
         + "</style><script>window.chrome={storage:{local:{get:async d=>d,set:async()=>{}}}};</script>"
           "<script src='../../src/utils.js'></script><script defer src='../../popup/popup.js'></script><style>")

    # promo tile 440x280
    (SRC / "promo.html").write_text("""<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:440px;height:280px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:linear-gradient(135deg,#0f766e,#3730a3);color:#fff;display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box}
img{width:104px;height:104px} h1{font-size:30px;margin:0 0 8px} p{margin:0;font-size:16px;opacity:.92;line-height:1.4}
</style></head><body><img src="../icon-512-preview.png"><div><h1>StoryStash</h1><p>Keep stories, photos &amp; videos – largest size, one click.</p></div></body></html>""")


# ------------------------------------------------------------ render
def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    os.chdir(ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), Q)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def shoot(name, out, w, h):
    SNAP.mkdir(parents=True, exist_ok=True)
    tmp = SNAP / f"{out}"
    cmd = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
           f"--window-size={w},{h}", "--virtual-time-budget=3000", f"--screenshot={tmp}",
           f"http://127.0.0.1:8799/store-assets/src/{name}.html"]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    shutil.copy(tmp, ASSETS / out)
    im = Image.open(ASSETS / out).convert("RGB")  # store wants no alpha
    im.save(ASSETS / out)
    print("wrote", ASSETS / out, im.size)


if __name__ == "__main__":
    make_photos()
    build_pages()
    srv = serve()
    for i in range(1, 5):
        shoot(f"shot{i}", f"screenshot-{i}.png", 1280, 800)
    shoot("promo", "promo-small-440x280.png", 440, 280)
    srv.shutdown()
    shutil.rmtree(SNAP, ignore_errors=True)
