# AGENTS.md

Browser kart racer (three.js r158). No build step, no package.json, no tests, no lint, no CI. Verification is manual in a browser.

## Running / verifying

- Serve the folder with `python3 -m http.server 8000`, or just open `index.html` directly from disk (it works over `file://` by design).
- There are no test commands. After JS changes, load the page and look at the browser console. There is a user-facing perf readout: press `V` to toggle a stats overlay (`renderer.info`).
- Do not add external dependencies or modify `vendor/three.min.js`; everything is vendored and the game must work offline and over `file://`.

## Script load order matters (index.html)

Scripts are plain globals with no modules; order is the dependency graph and each file wraps in an IIFE exposing one global (`Util`, `Art`, `Tracks`, `World`, `Kart`, `Game`). Notables:

- `js/textures.js` is loaded with `async` **on purpose** — game.js must keep working before `TextureData` lands (it falls back to `textures/*.jpg` or painted canvases).
- game.js wires menus on `DOMContentLoaded`; anything that waits on it must not block it.
- New script files must be added before `game.js` unless they are async-safe.

## Code style

- ES5: `var`, function closures, IIFE modules. No modules, no `import`, no classes in the game code. Match this.
- Determinism is a core invariant: physics is a fixed 1/120 s timestep with accumulator, and the AI/scenery run off `Util.rng(seed)` — never introduce `Math.random` or non-deterministic iteration into race logic. Every rate is expressed per second.
- Terrain heights are a **single shared formula**: the off-track ribbons in world.js, `track.vergeY` (karts, props, grandstands) and the displaced ground plane all blend toward `baseY + Util.ROLL * Util.roll(x, z)`. `Util.roll` is a smooth position-based function on purpose (no per-vertex randomness — random displacement is what tore the shared ribbon seams and made the terrain jagged). Changing heights or the roll means changing all three places consistently, or karts float/sink and meshes tear.
- HUD is DOM, not canvas; only the WebGL buffer is scaled.

## Texture pipeline (the generated file trap)

- `js/textures.js` is **generated — never edit by hand**. It is ~1.2 MB of base64 data: URIs.
- Chain: raw PNGs (default `_gen/` next to `scripts/`) → `scripts/seamless.py` (heals seams only if `seam_ratio > 2.5`, resizes to 512px, writes `textures/*.jpg`) → `python3 scripts/embed_textures.py` (bakes `textures/` into `js/textures.js`, which is what the game reads).
- After touching anything in `textures/`, always rerun `embed_textures.py`. `seamless.py` reads a default list of 7 names unless you pass names as args, and honors `TEXTURE_SRC` env var.
- Both scripts need Python 3 with numpy + Pillow (not declared anywhere).
- README describes a design constraint worth keeping: maps must have large-scale structure (check by shrinking a texture to 32×32 — if shapes vanish, it will read as flat paint at distance). Asphalt deliberately stays fine-grained with a vertex-tint for variation.