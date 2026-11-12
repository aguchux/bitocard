"""
Udozo POS's Microsoft Store listing art (Partner Center > Store listings), written to apps/udozo-pos-windows/store-art/:

- poster-9x16-1440x2160.png      9:16 Poster art (the main logo shown to Windows customers)
- box-art-1x1-2160x2160.png      1:1 Box art
- app-tile-icon-300x300.png      Store display images: 1:1 App tile icon
- tile-150x150.png, tile-71x71.png
- super-hero-16x9-3840x2160.png  16:9 Super hero art (no product title, as the Store requires)

The posters wear the POS's own dark green with udozo.com's mark in white; the small tiles are the blue disc, as the app's
own package tiles are. Run from the repository root after the logo changes: python scripts/pos-store-art.py
(needs Pillow and NumPy).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "udozo" / "logo.png"
OUT = ROOT / "apps" / "udozo-pos-windows" / "store-art"
FONTS = ROOT / "packages" / "ui" / "assets" / "fonts"

INK = (16, 35, 28)  # #10231C, the POS's rail
GREEN = (11, 122, 90)  # #0B7A5A
TILE = (25, 164, 122)  # #19A47A
MUTED = (185, 204, 195)  # #B9CCC3
BLUE = (24, 81, 116)  # #185174, the Udozo disc


def mark(colour):
    """udozo.com's mark (the u cut out of a disc), tightly cropped, in one colour."""
    source = Image.open(SOURCE).convert("RGBA")
    alpha = np.asarray(source)[..., 3]
    picture = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    picture[..., :3] = colour
    picture[..., 3] = alpha
    image = Image.fromarray(picture, "RGBA")
    return image.crop(image.getbbox())


def scaled(picture, height):
    return picture.resize((round(picture.width * height / picture.height), height), Image.LANCZOS)


def backdrop(width, height, glow_at):
    """The dark green page with a soft green glow and faint rings round the mark."""
    canvas = Image.new("RGBA", (width, height), INK + (255,))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gx, gy = glow_at
    radius = round(max(width, height) * 0.55)
    ImageDraw.Draw(glow).ellipse((gx - radius, gy - radius, gx + radius, gy + radius), fill=GREEN + (150,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(radius * 0.45)))
    rings = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(rings)
    unit = min(width, height)
    for step in range(1, 5):
        r = round(unit * (0.2 + step * 0.11))
        draw.ellipse((gx - r, gy - r, gx + r, gy + r), outline=(255, 255, 255, 22 - step * 3), width=max(2, unit // 400))
    canvas.alpha_composite(rings)
    return canvas


def font(weight, size):
    return ImageFont.truetype(str(FONTS / f"inter-latin-{weight}-normal.woff"), size)


def centred_text(canvas, y, text, face, fill):
    draw = ImageDraw.Draw(canvas)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=face)
    draw.text(((canvas.width - (right - left)) // 2 - left, y - top), text, font=face, fill=fill)
    return y + (bottom - top)


def pill(canvas, y, text, face):
    """A rounded green tag holding `text`, centred."""
    draw = ImageDraw.Draw(canvas)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=face)
    pad_x, pad_y = round(face.size * 0.9), round(face.size * 0.45)
    width, height = right - left + pad_x * 2, bottom - top + pad_y * 2
    x = (canvas.width - width) // 2
    draw.rounded_rectangle((x, y, x + width, y + height), radius=height // 2, fill=TILE)
    draw.text((x + pad_x - left, y + pad_y - top), text, font=face, fill=(255, 255, 255))
    return y + height


def poster(width, height, white):
    canvas = backdrop(width, height, (width // 2, round(height * 0.38)))
    logo = scaled(white, round(width * 0.46))
    canvas.alpha_composite(logo, ((width - logo.width) // 2, round(height * 0.38) - logo.height // 2))
    y = round(height * 0.62)
    y = centred_text(canvas, y, "Udozo POS", font(800, round(width * 0.12)), (255, 255, 255))
    y = centred_text(canvas, y + round(width * 0.05), "Point of sale for Udozo shops", font(600, round(width * 0.045)), MUTED)
    pill(canvas, y + round(width * 0.07), "One stock with udozo.com", font(600, round(width * 0.035)))
    return canvas.convert("RGB")


def box_art(size, white):
    canvas = backdrop(size, size, (size // 2, round(size * 0.4)))
    logo = scaled(white, round(size * 0.36))
    canvas.alpha_composite(logo, ((size - logo.width) // 2, round(size * 0.4) - logo.height // 2))
    y = centred_text(canvas, round(size * 0.66), "Udozo POS", font(800, round(size * 0.1)), (255, 255, 255))
    centred_text(canvas, y + round(size * 0.04), "Point of sale for Udozo shops", font(600, round(size * 0.038)), MUTED)
    return canvas.convert("RGB")


def hero(width, height, white):
    """16:9 hero: the mark on the right third, no title (the Store puts its own over the left)."""
    centre = (round(width * 0.7), height // 2)
    canvas = backdrop(width, height, centre)
    logo = scaled(white, round(height * 0.42))
    canvas.alpha_composite(logo, (centre[0] - logo.width // 2, centre[1] - logo.height // 2))
    return canvas.convert("RGB")


def tile(size, blue):
    """The blue disc on transparency, as the package's own tiles are."""
    target = round(size * 0.9)
    logo = scaled(blue, target)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    white, blue = mark((255, 255, 255)), mark(BLUE)
    files = {
        "poster-9x16-1440x2160.png": poster(1440, 2160, white),
        "box-art-1x1-2160x2160.png": box_art(2160, white),
        "super-hero-16x9-3840x2160.png": hero(3840, 2160, white),
        "app-tile-icon-300x300.png": tile(300, blue),
        "tile-150x150.png": tile(150, blue),
        "tile-71x71.png": tile(71, blue),
    }
    for name, picture in files.items():
        picture.save(OUT / name, optimize=True)
        print(f"{name}: {picture.size[0]}x{picture.size[1]}, {(OUT / name).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
