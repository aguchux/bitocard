"""
Draft Afrippa marks (a lowercase "a") drawn from BitoCard's "b" mark's own geometry and colours (assets/logo.png):
the same bowl, counter, pink arrow wedge and its cut lines, and the pink bar, but with the stem on the right at the
bowl's height, so nothing rises above the bowl and it reads as a small "a", never a "d".
  C (mark-c-single.png): a single-storey "a": the stem from the bowl's top to the baseline, the pink bar its foot.
Drafts only: the approved mark is redrawn as a vector. Run from the repository root:
python scripts/afrippa-mark-draft.py
"""
import math
from PIL import Image, ImageDraw

OUT = "assets/afrippa/drafts/"
NAVY, PINK = (0, 43, 134, 255), (255, 20, 108, 255)
K = 4                      # drawn at 4x, then scaled down for smooth edges
N = 1254 * K


def P(v):
    return v * K


# The b mark's measurements (pixels of the 1254 px master): bowl and counter radii, stem width, gaps.
R, r = 343, 184            # outer and inner radius of the bowl
STEM = 219                 # stem width
GAP = 14                   # the white gap under the cap and along the arrow's cuts
CAP = 86                   # the cap's height
WEDGE = 25                 # half-angle of the pink arrow, degrees
CUT = 29                   # half-angle of the cut in the bowl around it


def bowl(draw, cx, cy):
    draw.ellipse([P(cx - R), P(cy - R), P(cx + R), P(cy + R)], fill=NAVY)
    draw.ellipse([P(cx - r), P(cy - r), P(cx + r), P(cy + r)], fill=(0, 0, 0, 0))


def arrow(im, cx, cy):
    """The cut on the bowl's left and the pink arrow in it, pointing right into the counter."""
    ax, ay = cx - 10, cy               # the arrow's point, just inside the counter's centre
    far = 2 * (R + 60)

    def wedge(draw, half, colour):
        a1, a2 = math.radians(180 - half), math.radians(180 + half)
        pts = [(ax, ay), (ax + far * math.cos(a1), ay - far * math.sin(a1)), (ax + far * math.cos(a2), ay - far * math.sin(a2))]
        draw.polygon([(P(x), P(y)) for x, y in pts], fill=colour)

    wedge(ImageDraw.Draw(im), CUT, (0, 0, 0, 0))
    # The pink arrow stays inside the bowl's outer circle (it is part of the ring).
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    wedge(ImageDraw.Draw(layer), WEDGE, PINK)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse([P(cx - R), P(cy - R), P(cx + R), P(cy + R)], fill=255)
    clipped = Image.new("RGBA", im.size, (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), mask)
    im.alpha_composite(clipped)
    return im


def finish(im, name):
    small = im.resize((1254, 1254), Image.LANCZOS)
    box = small.getbbox()
    out = Image.new("RGBA", (1254, 1254), (0, 0, 0, 0))
    part = small.crop(box)
    out.paste(part, ((1254 - part.width) // 2, (1254 - part.height) // 2))
    out.save(OUT + name)
    return out


def single():
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = 560, 627
    bowl(d, cx, cy)
    sx = cx + R - STEM + 15            # the stem's left edge, as far right as the b's stem was left
    d.rectangle([P(sx), P(cy - R), P(sx + STEM), P(cy + R)], fill=NAVY)
    d.ellipse([P(cx - r), P(cy - r), P(cx + r), P(cy + r)], fill=(0, 0, 0, 0))
    # The pink bar: the foot of the stem, on the baseline, with the white gap above it running across the stem.
    d.rectangle([P(sx), P(cy + R - CAP), P(sx + STEM), P(cy + R)], fill=PINK)
    d.rectangle([P(sx), P(cy + R - CAP - GAP), P(sx + STEM), P(cy + R - CAP)], fill=(0, 0, 0, 0))
    return finish(arrow(im, cx, cy), "mark-c-single.png")


def light(mark):
    """For navy and dark backgrounds: navy turned white, pink kept (as bitocard-mark-light.png)."""
    out = mark.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r_, g, b, a = px[x, y]
            if a and b > r_:
                px[x, y] = (255, 255, 255, a)
    return out


if __name__ == "__main__":
    c = single()
    small = c.resize((160, 160), Image.LANCZOS)
    sheet = Image.new("RGBA", (1254 * 2, 1254), (255, 255, 255, 255))
    sheet.alpha_composite(c, (0, 0))
    dark = Image.new("RGBA", (1254, 1254), NAVY)
    dark.alpha_composite(light(c))
    sheet.alpha_composite(dark, (1254, 0))
    for i, size in enumerate((160, 96, 48)):
        sheet.alpha_composite(c.resize((size, size), Image.LANCZOS), (40 + sum((160, 96, 48)[:i]) + 20 * i, 1254 - 200))
    sheet.convert("RGB").resize((1254, 627)).save(OUT + "mark-options.png")
