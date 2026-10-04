"""Generates every BitoCard logo file from the master artwork, assets/logo.png (the lowercase "b" mark).

Run from the repository root after the logo changes: python scripts/brand-assets.py (needs Pillow and NumPy).

Writes to each Next.js app's public/ folder:
  bitocard-mark.png         the "b" mark, tightly cropped, navy and pink: beside the name on light backgrounds
  bitocard-mark-light.png   the same with the navy in white (the pink kept), for navy and dark backgrounds
  bitocard-logo.png         the "b" centred in a square with room around it: favicons, app icons, push notifications
  bitocard-logo-light.png   the square logo in white and pink, for navy and dark backgrounds
  icon-192.png, icon-512.png    web app manifest icons (transparent, room around the mark)
  icon-maskable-512.png         the manifest's maskable icon: white background, the mark inside the safe zone

and to each app's app/ folder (Next.js icon file conventions, so every page gets the <link> tags):
  favicon.ico               16, 32 and 48 px, for browsers and tools that ask for /favicon.ico
  icon.svg                  the favicon for modern browsers: the normal mark, or the light one in dark mode
  icon1.png                 96 px (a multiple of 48, as search engines prefer)
  apple-icon.png            180 px on white, for iPhone and iPad home screens
"""

import base64
import io
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "logo.png"
APPS = ["storefront", "docs", "legals", "admin", "shq"]

WHITE = np.array([255, 255, 255])


def palette(rgb, alpha):
    """The artwork's navy and pink, read from its solid pixels (pink has a strong red channel), so a recoloured
    logo needs no change here."""
    solid = rgb[alpha >= 250]
    red = solid[:, 0] > 128
    return np.median(solid[~red], axis=0).round(), np.median(solid[red], axis=0).round()


MARK_HEIGHT = 512
SQUARE = 1024
# The mark's height inside the square logo; the rest is room around it (safe for round and maskable icons).
SQUARE_FILL = 0.78


def load_clean():
    """The artwork with stray near-transparent pixels removed, each pixel set to the pure navy or pink it belongs to."""
    rgba = np.asarray(Image.open(SOURCE).convert("RGBA")).astype(np.float64)
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    alpha[alpha < 4] = 0
    navy_colour, pink_colour = palette(rgb, alpha)
    pink = np.linalg.norm(rgb - pink_colour, axis=-1) < np.linalg.norm(rgb - navy_colour, axis=-1)
    colour = np.where(pink[..., None], pink_colour, navy_colour)
    ys, xs = np.nonzero(alpha > 0)
    box = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    print(f"Navy {tuple(int(v) for v in navy_colour)}, pink {tuple(int(v) for v in pink_colour)}")
    return colour[box], alpha[box], pink[box], pink_colour


def image(colour, alpha):
    return Image.fromarray(np.dstack([colour, alpha]).astype(np.uint8), "RGBA")


def light(pink, pink_colour):
    """Navy becomes white; the pink stays, so the mark reads on navy."""
    return np.where(pink[..., None], pink_colour, WHITE)


def square(mark: Image.Image):
    target = round(SQUARE * SQUARE_FILL)
    scaled = mark.resize((round(mark.width * target / mark.height), target), Image.LANCZOS)
    canvas = Image.new("RGBA", (SQUARE, SQUARE), (0, 0, 0, 0))
    canvas.paste(scaled, ((SQUARE - scaled.width) // 2, (SQUARE - scaled.height) // 2), scaled)
    return canvas


def fitted(mark: Image.Image, size: int, fill: float, background=(0, 0, 0, 0)):
    """The mark centred in a square of `size`, `fill` of its height, on a background (transparent by default)."""
    target = max(1, round(size * fill))
    scaled = mark.resize((max(1, round(mark.width * target / mark.height)), target), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


def png_data(picture: Image.Image):
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def adaptive_svg(dark: Image.Image, white: Image.Image, size=128):
    """An SVG favicon holding both marks: navy on light browser themes, white in dark mode (CSS media query)."""
    normal, light = png_data(fitted(dark, size, 0.92)), png_data(fitted(white, size, 0.92))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
        "<style>.light{display:none}@media (prefers-color-scheme:dark){.normal{display:none}.light{display:inline}}</style>"
        f'<image class="normal" width="{size}" height="{size}" href="data:image/png;base64,{normal}"/>'
        f'<image class="light" width="{size}" height="{size}" href="data:image/png;base64,{light}"/>'
        "</svg>"
    )


def write_icons(dark: Image.Image, white: Image.Image):
    """Favicons, app icons and manifest icons for every app."""
    public_files = {
        "icon-192.png": fitted(dark, 192, 0.84),
        "icon-512.png": fitted(dark, 512, 0.84),
        # Maskable: the platform crops to a circle or squircle, so the mark stays inside the central 80%.
        "icon-maskable-512.png": fitted(dark, 512, 0.56, (255, 255, 255, 255)),
    }
    favicon = fitted(dark, 48, 0.96)
    app_files = {"icon1.png": fitted(dark, 96, 0.9), "apple-icon.png": fitted(dark, 180, 0.66, (255, 255, 255, 255)).convert("RGB")}
    svg = adaptive_svg(dark, white)
    for app in APPS:
        public, app_dir = ROOT / "apps" / app / "public", ROOT / "apps" / app / "app"
        for file, picture in public_files.items():
            picture.save(public / file, optimize=True)
        for file, picture in app_files.items():
            picture.save(app_dir / file, optimize=True)
        favicon.save(app_dir / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
        (app_dir / "icon.svg").write_text(svg, encoding="utf-8")
    print(f"Wrote favicon.ico, icon.svg, icon1.png, apple-icon.png and the manifest icons to {len(APPS)} apps")


def main():
    colour, alpha, pink, pink_colour = load_clean()
    dark = image(colour, alpha)
    white = image(light(pink, pink_colour), alpha)
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
    write_icons(dark, white)


if __name__ == "__main__":
    main()
