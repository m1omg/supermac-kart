#!/usr/bin/env python3
"""
Take the generated textures, force them to tile seamlessly, and emit
web-sized JPEGs into the project.

The model produces near-tileable images but the edges rarely match
exactly, which shows up as a hard grid across the road.  The fix is an
offset-and-cross-fade: wrap the image by half, then blend the seam that
lands in the middle with the original, feathered over a band.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

SRC = os.environ.get('TEXTURE_SRC', os.path.dirname(os.path.abspath(__file__)) + '/../_gen')
DST = os.path.dirname(os.path.abspath(__file__)) + '/../textures'
os.makedirs(DST, exist_ok=True)

SIZE = 512          # plenty at the scale these are viewed
QUALITY = 86
BAND = 0.22         # fraction of the image used for the cross-fade


def feather(n, band):
    """1 in the middle, ramping to 0 at both edges over `band`."""
    w = max(2, int(n * band))
    ramp = np.linspace(0.0, 1.0, w)
    m = np.ones(n)
    m[:w] = ramp
    m[-w:] = ramp[::-1]
    return m


def make_seamless(img):
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]

    # roll by half so the original edges meet in the centre
    rolled = np.roll(np.roll(a, w // 2, axis=1), h // 2, axis=0)

    # weight the rolled copy so it dominates where the old seam was
    mx = 1.0 - feather(w, BAND)
    my = 1.0 - feather(h, BAND)
    weight = np.maximum(mx[None, :], my[:, None])[:, :, None]

    out = a * (1.0 - weight) + rolled * weight
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def seam_ratio(img):
    """Seam discontinuity measured against the texture's own natural
    pixel-to-pixel variation.  ~1 means the wrap is as smooth as any
    other pixel boundary; a raw difference would just report how noisy
    the texture is, not whether it tiles."""
    a = np.asarray(img).astype(np.float32)
    sx = np.abs(a[:, 0] - a[:, -1]).mean()
    nx = np.abs(a[:, 1] - a[:, 0]).mean()
    sy = np.abs(a[0, :] - a[-1, :]).mean()
    ny = np.abs(a[1, :] - a[0, :]).mean()
    return (sx / max(nx, 1e-6) + sy / max(ny, 1e-6)) / 2


def process(name):
    src = os.path.join(SRC, name + '.png')
    if not os.path.exists(src):
        return None
    img = Image.open(src).convert('RGB')
    before = seam_ratio(img)

    # Only heal textures that actually show a seam - the blend costs a
    # little detail, so there is no sense paying for it when the model
    # already produced a clean wrap.
    fixed = before > 2.5
    if fixed:
        img = make_seamless(img)
    after = seam_ratio(img)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    out = os.path.join(DST, name + '.jpg')
    img.save(out, 'JPEG', quality=QUALITY, optimize=True)
    kb = os.path.getsize(out) / 1024
    print(f'  {name:14s} {before:6.2f} -> {after:5.2f}  {"healed" if fixed else "as-is ":6s} {kb:6.1f} KB')
    return out


if __name__ == '__main__':
    names = sys.argv[1:] or ['asphalt', 'grass', 'dirt', 'beige_plastic',
                             'dark_metal', 'rock', 'concrete']
    print('texture         seam ratio (1.0 = invisible)      size')
    made = [n for n in names if process(n)]
    print(f'\n{len(made)}/{len(names)} written to {DST}')
