"""Generate StoryStash icons: icons/icon-{16,32,48,128}.png (+ store-assets/icon-128.png).

Design: teal -> indigo rounded tile, white download arrow dropping into a tray.
Deliberately NOT Instagram's colours/shape (trademark rules of the Chrome Web Store).
The 128px icon keeps 16px transparent padding as recommended by Google.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

S = 512  # supersampled canvas
TOP, BOTTOM = (20, 184, 166), (79, 70, 229)  # teal -> indigo


def tile(size_px: int, pad_ratio: float) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pad = int(S * pad_ratio)
    box = S - 2 * pad
    grad = Image.new("RGB", (box, box))
    gp = grad.load()
    for y in range(box):
        for x in range(box):
            t = (x * 0.35 + y) / (box * 1.35)
            gp[x, y] = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    mask = Image.new("L", (box, box), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, box - 1, box - 1], radius=int(box * 0.24), fill=255)
    img.paste(grad, (pad, pad), mask)

    d = ImageDraw.Draw(img)
    cx = S // 2
    u = box / 100.0
    oy = pad
    white = (255, 255, 255, 255)
    # arrow shaft + head
    d.rounded_rectangle([cx - 6 * u, oy + 16 * u, cx + 6 * u, oy + 50 * u], radius=6 * u, fill=white)
    d.polygon([(cx - 21 * u, oy + 40 * u), (cx + 21 * u, oy + 40 * u), (cx, oy + 62 * u)], fill=white)
    # tray (U shape)
    lw = 9 * u
    left, right, top, bottom = cx - 31 * u, cx + 31 * u, oy + 60 * u, oy + 82 * u
    d.rounded_rectangle([left, bottom - lw, right, bottom], radius=lw / 2, fill=white)
    d.rounded_rectangle([left, top, left + lw, bottom], radius=lw / 2, fill=white)
    d.rounded_rectangle([right - lw, top, right, bottom], radius=lw / 2, fill=white)
    return img.resize((size_px, size_px), Image.LANCZOS)


if __name__ == "__main__":
    for s, pad in ((16, 0.0), (32, 0.02), (48, 0.04), (128, 16 / 128)):
        p = OUT / f"icon-{s}.png"
        tile(s, pad).save(p)
        print("wrote", p)
    assets = ROOT / "store-assets"
    assets.mkdir(exist_ok=True)
    tile(128, 16 / 128).save(assets / "icon-128.png")
    tile(512, 0.0).save(assets / "icon-512-preview.png")
    print("wrote", assets / "icon-128.png")
