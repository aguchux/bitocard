"""
Udozo's mark (docs/UDOZO_SPINOFF_PLAN.md, step 4), drawn from the owner's sketch (1 November 2026): a bold navy "u"
whose right stem rises to the top, a pink bar laid across the top of the left stem (reaching out past it on the left and
most of the way over the opening), and two pink wheels sunk into the bottom of the "u", one at each lower corner. The
bar and the wheels share the pink. Replace assets/udozo/drafts/mark-placeholder.png with the designer's master when it
comes (keeping a navy and a pink, which scripts/brand-assets.py reads from the artwork) and run
python scripts/brand-assets.py.
Run from the repository root:
python scripts/udozo-mark-draft.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("assets/udozo/drafts/mark-placeholder.png")
NAVY, PINK = (7, 15, 76, 255), (255, 35, 130, 255)
CLEAR = (0, 0, 0, 0)
K = 4                      # drawn at 4x, then scaled down for smooth edges
SIZE = 1024


def P(v):
    return round(v * K)


def main():
    im = Image.new("RGBA", (P(SIZE), P(SIZE)), CLEAR)
    draw = ImageDraw.Draw(im)

    # The "u": two stems joined by a half ring.
    stem = 140
    left, right = 230, 890
    top = 190
    radius = (right - left) / 2
    centre_x = (left + right) / 2
    centre_y = 470
    inner = radius - stem
    draw.ellipse([P(left), P(centre_y - radius), P(right), P(centre_y + radius)], fill=NAVY)
    draw.ellipse([P(left + stem), P(centre_y - inner), P(right - stem), P(centre_y + inner)], fill=CLEAR)
    draw.rectangle([P(left), P(centre_y - radius), P(right), P(centre_y)], fill=CLEAR)
    draw.rectangle([P(left), P(top), P(left + stem), P(centre_y)], fill=NAVY)
    draw.rectangle([P(right - stem), P(top), P(right), P(centre_y)], fill=NAVY)

    # The bar: across the top of the left stem, past it on the left and well over the opening, level with the right stem's top.
    bar_height = 112
    bar_left, bar_right = 140, 640
    draw.rounded_rectangle([P(bar_left), P(top), P(bar_right), P(top + bar_height)], radius=P(22), fill=PINK)

    # The wheels: centred on the outside of the bottom curve at each lower corner, so half of each sinks into the "u".
    wheel = 96
    for side in (-1, 1):
        angle = math.radians(42)
        cx = centre_x + side * radius * math.sin(angle)
        cy = centre_y + radius * math.cos(angle)
        draw.ellipse([P(cx - wheel), P(cy - wheel), P(cx + wheel), P(cy + wheel)], fill=PINK)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
