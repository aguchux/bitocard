"""Generates every BitoCard logo file from the master artwork, assets/logo.png (the lowercase "b" mark).

Run from the repository root after the logo changes: python scripts/brand-assets.py (needs Pillow and NumPy).

Writes to each Next.js app's public/ folder:
  bitocard-mark.png         the "b", tightly cropped, navy and pink: the letter "b" in the BitoCard name on light backgrounds
  bitocard-mark-light.png   the same with the navy in white (the pink kept), for navy and dark backgrounds
  bitocard-logo.png         the "b" centred in a square with room around it: favicons, app icons, push notifications
  bitocard-logo-light.png   the square logo in white and pink, for navy and dark backgrounds
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "logo.png"
APPS = ["storefront", "docs", "legals", "admin", "shq"]

NAVY = np.array([0, 37, 121])
PINK = np.array([252, 24, 122])
WHITE = np.array([255, 255, 255])

MARK_HEIGHT = 512
SQUARE = 1024
# The mark's height inside the square logo; the rest is room around it (safe for round and maskable icons).
SQUARE_FILL = 0.78


def load_clean():
    """The artwork with stray near-transparent pixels removed, each pixel set to the pure navy or pink it belongs to."""
    rgba = np.asarray(Image.open(SOURCE).convert("RGBA")).astype(np.float64)
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    alpha[alpha < 4] = 0
    pink = np.linalg.norm(rgb - PINK, axis=-1) < np.linalg.norm(rgb - NAVY, axis=-1)
    colour = np.where(pink[..., None], PINK, NAVY)
    ys, xs = np.nonzero(alpha > 0)
    box = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    return colour[box], alpha[box], pink[box]


def image(colour, alpha):
    return Image.fromarray(np.dstack([colour, alpha]).astype(np.uint8), "RGBA")


def light(colour, pink):
    """Navy becomes white; the pink stays, so the mark reads on navy."""
    return np.where(pink[..., None], PINK, WHITE)


def square(mark: Image.Image):
    target = round(SQUARE * SQUARE_FILL)
    scaled = mark.resize((round(mark.width * target / mark.height), target), Image.LANCZOS)
    canvas = Image.new("RGBA", (SQUARE, SQUARE), (0, 0, 0, 0))
    canvas.paste(scaled, ((SQUARE - scaled.width) // 2, (SQUARE - scaled.height) // 2), scaled)
    return canvas


def main():
    colour, alpha, pink = load_clean()
    dark = image(colour, alpha)
    white = image(light(colour, pink), alpha)
    outputs = {}
    for name, mark in (("", dark), ("-light", white)):
        tight = mark.resize((round(mark.width * MARK_HEIGHT / mark.height), MARK_HEIGHT), Image.LANCZOS)
        outputs[f"bitocard-mark{name}.png"] = tight
        outputs[f"bitocard-logo{name}.png"] = square(mark)
    for app in APPS:
        public = ROOT / "apps" / app / "public"
        public.mkdir(parents=True, exist_ok=True)
        for file, picture in outputs.items():
            picture.save(public / file, optimize=True)
    sizes = {file: picture.size for file, picture in outputs.items()}
    print(f"Wrote {', '.join(f'{file} {w}x{h}' for file, (w, h) in sizes.items())} to {len(APPS)} apps")


if __name__ == "__main__":
    main()
