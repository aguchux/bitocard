"""
Udozo's placeholder mark (docs/UDOZO_SPINOFF_PLAN.md, step 4): a shopping cart whose basket is a bold lowercase "u", in
navy, with its handle reaching out from the top of the left stem and two pink wheels below, in the default theme's navy
and pink, until the brand's real artwork arrives. Replace assets/udozo/drafts/mark-placeholder.png with the master
(keeping a navy and a pink, which scripts/brand-assets.py reads from the artwork) and run python scripts/brand-assets.py.
Run from the repository root:
python scripts/udozo-mark-draft.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("assets/udozo/drafts/mark-placeholder.png")
NAVY, PINK = (7, 15, 76, 255), (255, 35, 130, 255)
CLEAR = (0, 0, 0, 0)
K = 4                      # drawn at 4x, then scaled down for smooth edges
SIZE = 1024


def P(v):
    return v * K


def main():
    im = Image.new("RGBA", (P(SIZE), P(SIZE)), CLEAR)
    draw = ImageDraw.Draw(im)

    # The basket: a "u" (two stems joined by a half ring), slightly wider at the top as a cart's basket is.
    stem = 150
    left, right = 250, 890
    top, bottom = 230, 760
    radius = (right - left) // 2
    centre_y = bottom - radius
    draw.ellipse([P(left), P(centre_y - radius), P(right), P(bottom)], fill=NAVY)
    inner = radius - stem
    draw.ellipse([P(left + stem), P(centre_y - inner), P(right - stem), P(centre_y + inner)], fill=CLEAR)
    draw.rectangle([P(left), P(centre_y - radius), P(right), P(centre_y)], fill=CLEAR)
    draw.rectangle([P(left), P(top), P(left + stem), P(centre_y)], fill=NAVY)
    draw.rectangle([P(right - stem), P(top), P(right), P(centre_y)], fill=NAVY)

    # The handle: from the top of the left stem out to the left, rounded at its end.
    handle = 120
    reach = 120
    draw.rectangle([P(reach + handle // 2), P(top), P(left + stem), P(top + handle)], fill=NAVY)
    draw.ellipse([P(reach), P(top), P(reach + handle), P(top + handle)], fill=NAVY)

    # The wheels: two pink discs under the basket, clear of it.
    wheel = 66
    gap = 34
    wheel_y = bottom + gap + wheel
    for cx in (left + stem // 2 + 30, right - stem // 2 - 30):
        draw.ellipse([P(cx - wheel), P(wheel_y - wheel), P(cx + wheel), P(wheel_y + wheel)], fill=PINK)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
