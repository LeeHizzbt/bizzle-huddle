#!/usr/bin/env python3
"""Generate every app icon from ONE source image.
Swap the logo: drop a square PNG at docs/icons/source.png (>=1024px) and run:
    python3 scripts/make-icons.py
Without source.png it draws the neon text placeholder.
Outputs: docs/icons/{icon-192,icon-512,maskable-512,apple-touch-icon,source-placeholder}.png
and, if android/ exists, android mipmap launcher icons."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'docs', 'icons')
NEON = (57, 255, 20)

def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def placeholder(size=1024):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], r, fill=(11, 15, 12, 255))
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    f1, f2 = font(int(size * 0.40)), font(int(size * 0.17))
    def centered(dr, text, f, y, fill):
        w = dr.textlength(text, font=f)
        dr.text(((size - w) / 2, y), text, font=f, fill=fill)
    centered(g, 'BH', f1, size * 0.17, NEON + (255,))
    centered(g, 'v4.20', f2, size * 0.63, NEON + (255,))
    g.rounded_rectangle([size*0.06, size*0.06, size*0.94, size*0.94], int(size*0.18), outline=NEON + (255,), width=max(4, size // 64))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size / 60)))
    img.alpha_composite(glow)
    return img

def main():
    src = os.path.join(ICONS, 'source.png')
    base = Image.open(src).convert('RGBA') if os.path.exists(src) else placeholder()
    base.save(os.path.join(ICONS, 'source-placeholder.png')) if not os.path.exists(src) else None
    for name, s in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        base.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, name))
    # maskable: content inside the 80% safe zone on a solid background
    m = Image.new('RGBA', (512, 512), (11, 15, 12, 255))
    inner = base.resize((410, 410), Image.LANCZOS)
    m.alpha_composite(inner, (51, 51)); m.save(os.path.join(ICONS, 'maskable-512.png'))
    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    if os.path.isdir(res):
        for dens, s in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
            dirp = os.path.join(res, 'mipmap-' + dens)
            os.makedirs(dirp, exist_ok=True)
            ic = base.resize((s, s), Image.LANCZOS)
            ic.save(os.path.join(dirp, 'ic_launcher.png')); ic.save(os.path.join(dirp, 'ic_launcher_round.png'))
            fg = Image.new('RGBA', (int(s * 2.25), int(s * 2.25)), (0, 0, 0, 0))
            fg.alpha_composite(base.resize((int(s * 1.5), int(s * 1.5)), Image.LANCZOS), (int(s * 0.375), int(s * 0.375)))
            fg.save(os.path.join(dirp, 'ic_launcher_foreground.png'))
    print('icons written to', ICONS)

if __name__ == '__main__':
    main()
