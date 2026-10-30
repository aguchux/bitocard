"""
Udozo's placeholder mark (docs/UDOZO_SPINOFF_PLAN.md, step 4): a bold lowercase "u" in navy with a pink bar at the foot
of its right stem, in the default theme's navy and pink, until the brand's real artwork arrives. Replace
assets/udozo/drafts/mark-placeholder.png with the master (keeping a navy and a pink, which scripts/brand-assets.py reads
from the artwork) and run python scripts/brand-assets.py. Run from the repository root:
python scripts/udozo-mark-draft.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("assets/udozo/drafts/mark-placeholder.png")
NAVY, PINK = (7, 15, 76, 255), (255, 35, 130, 255)
K = 4                      # drawn at 4x, then scaled down for smooth edges
SIZE = 1024


def P(v):
    return v * K


def main():
    im = Image.new("RGBA", (P(SIZE), P(SIZE)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    stem = 190                       # stem width
    left, right = 192, 832           # the u's outer left and right edges
    top, bottom = 160, 864           # the stems' tops and the bowl's lowest point
    radius = (right - left) // 2     # the bowl: a half ring joining the stems
    centre_y = bottom - radius
    # The bowl: a full ring, its upper half then covered by the stems' gap.
    draw.ellipse([P(left), P(centre_y - radius), P(right), P(bottom)], fill=NAVY)
    inner = radius - stem
    draw.ellipse([P(left + stem), P(centre_y - inner), P(right - stem), P(centre_y + inner)], fill=(0, 0, 0, 0))
    draw.rectangle([P(left), P(centre_y - radius), P(right), P(centre_y)], fill=(0, 0, 0, 0))
    # The stems, from the top down to the bowl's middle.
    draw.rectangle([P(left), P(top), P(left + stem), P(centre_y)], fill=NAVY)
    draw.rectangle([P(right - stem), P(top), P(right), P(centre_y)], fill=NAVY)
    # The right stem runs on to the baseline, its foot the pink bar below a thin gap.
    gap, cap = 18, 96
    draw.rectangle([P(right - stem), P(centre_y), P(right), P(bottom)], fill=(0, 0, 0, 0))
    draw.rectangle([P(right - stem), P(centre_y), P(right), P(bottom - cap - gap)], fill=NAVY)
    draw.rectangle([P(right - stem), P(bottom - cap), P(right), P(bottom)], fill=PINK)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
