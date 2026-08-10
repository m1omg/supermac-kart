#!/usr/bin/env python3
"""
Bake textures/*.jpg into js/textures.js as data: URIs.

Why: the game has to run three ways — from a web server, from GitHub
Pages, and by double-clicking index.html.  The third one is the problem.
A page opened over file:// has an opaque origin, so Chrome refuses the
image request that three.js makes (its TextureLoader asks for the file
with crossOrigin="anonymous", which no file:// URL can ever satisfy),
and browsers that do let the image through then treat it as cross-origin
pixels and refuse to upload it to WebGL.  Either way the game falls back
to its flat canvas maps and looks untextured.

A data: URI has none of those problems: no request, no origin, no CORS,
no latency, and nothing for GitHub Pages to mis-serve.  The cost is
about a third more bytes than the raw JPEG, paid once at load.

Run after regenerating the maps with seamless.py:

    python3 scripts/embed_textures.py
"""
import base64
import os

ROOT = os.path.dirname(os.path.abspath(__file__)) + '/..'
SRC = os.path.join(ROOT, 'textures')
DST = os.path.join(ROOT, 'js', 'textures.js')

HEADER = """/* ============================================================
   Surface maps, baked in as data: URIs.

   GENERATED FILE — do not edit by hand.  Regenerate with
   scripts/embed_textures.py after changing anything in textures/.

   These live here rather than being fetched from textures/ so the
   game works when index.html is opened straight off the disk: a
   file:// page cannot satisfy the CORS check three.js puts on its
   image requests, and the loaded pixels would be treated as
   cross-origin and refused by WebGL anyway.  The .jpg files are
   still the source of truth, and art.js still falls back to
   fetching them if this file is missing.
   ============================================================ */

var TextureData = {
"""

FOOTER = "};\n"


def main():
    names = sorted(f[:-4] for f in os.listdir(SRC) if f.endswith('.jpg'))
    if not names:
        raise SystemExit('no .jpg files in ' + SRC)

    total = 0
    with open(DST, 'w') as out:
        out.write(HEADER)
        for i, name in enumerate(names):
            path = os.path.join(SRC, name + '.jpg')
            with open(path, 'rb') as fh:
                blob = fh.read()
            total += len(blob)
            b64 = base64.b64encode(blob).decode('ascii')
            comma = '' if i == len(names) - 1 else ','
            out.write("  '%s': 'data:image/jpeg;base64,%s'%s\n" % (name, b64, comma))
        out.write(FOOTER)

    print('%d maps, %.0f KB of JPEG -> %.0f KB of %s'
          % (len(names), total / 1024.0,
             os.path.getsize(DST) / 1024.0, os.path.basename(DST)))


if __name__ == '__main__':
    main()
