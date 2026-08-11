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
- Audio cannot exist before a user gesture, so `Sound.init()` (and therefore any music) starts on the first button click, not at boot.

## Soundtrack

`js/audio.js` sequences the retrowave score itself — there are no audio files, and there must not be. A `setInterval` wakes every 25 ms and schedules every note landing in the next 120 ms **against `ctx.currentTime`**, never against the timer's own clock; that lookahead is what keeps the groove steady through a frame hitch. Voices (kick, gated snare, hat, bass, pluck, lead, pad) are built per note and stopped, so nothing accumulates.

- `Sound.music('menu' | 'race' | 'none', circuitId)` is the only entry point; it is idempotent, so calling it with what is already playing does nothing.
- Each circuit has its own key, tempo and lead patch in `CIRCUIT` — that is what makes the four tracks distinct. The menu theme is slower and in its own key.
- Race arrangements build over their first four bars and then loop from bar 4, so the sparse intro is heard once per race.
- `Sound.duck(amount)` pulls the music under the engine (nitro, pause). It is *not* the mute path — `M` mutes everything, `B` toggles music alone.
- Gain ramps must never target 0 with `exponentialRampToValueAtTime` (it is illegal and silently kills the node); use the `decayTo` helper.
- To verify without listening: render through an `OfflineAudioContext` and measure peak/RMS/clipping, and read `Sound._song()` for the live key and tempo.

The **engine** needs three layers or it reads as a buzzer, not an engine: a harmonic stack over the firing frequency whose upper orders come up with load; fixed body resonances that the harmonics sweep past as the revs climb (that sweep *is* the growl — a filter that merely tracks pitch does not do it); and filtered intake/exhaust noise, which is most of what you hear at speed. Detuning comes from a smoothed random-walk buffer, never an LFO — anything periodic just adds a second audible tone. Karts are direct-drive, so the note climbs continuously; there are deliberately no gearshift steps.

## Camera rumble

Off-road rumble in `updateCamera` is sampled from **where the kart is**, not from the clock, and scaled by speed — so bumps arrive because you drove onto them, and coming to a stop settles the camera. It is camera-only and must never be folded into the terrain height formula (`Util.roll`), which the ground plane, the verges and `track.vergeY` all share.

The trap: **do not build it from position sines.** Driving a straight line at constant speed through a sum of position sines is algebraically a sum of sines in *time*, so it loops exactly as visibly as a clock-driven wobble — measured at 0.93 self-similarity, versus 0.14 for the hashed value noise now used. Keep lateral shake far below vertical; sideways movement is what smears the picture at speed.

## Icons vs. faces (they are different art)

`Art.icon(m, size)` draws the mascot on a **32x32 grid** with hard edges and no anti-aliasing — that grid *is* why they read as Mac icons, so never smooth them, and keep the canvas at a whole number of pixels per cell (`portrait()` floors the cell size for this reason; the CSS also sets `image-rendering: pixelated`). `Art.face(m)` is something else entirely: a wrap map stretched over a sphere or cylinder in 3-D. Seen flat it reads as stripes and blobs, which is exactly how the character picker used to look. Don't reuse one for the other's job.

## Chassis models

Each machine in `kart.js CHASSIS` is modelled at its **own true proportions** (a compact Mac really is far taller and deeper than it is wide) and the finished hull is then scaled by the `scale` its builder returns, so tall machines fit the kart and stay out of the chase camera. Change the model, not the camera. Seat positions returned by a builder are in un-scaled model space; `buildKartMesh` multiplies them.

- `profileBody(points, width, mat)` extrudes a side-on `(z, y)` silhouette sideways — use it wherever the machine is defined by its profile (the compact's sloped forehead, the LaserWriter's steps). It rotates by **-90°**, not +90°: the other sign mirrors the machine so it faces backwards, which is easy to miss.
- `THREE.LatheGeometry` turns the round ones (iMac egg, Mac Pro cylinder) from a radius/height table. Two stacked spheres never read as one iMac.

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
- **Never assign `texture.image = ...` directly on a live surface — go through `swapImage` in art.js.** Surfaces are born as a small painted canvas and get the 512px map swapped in later. three.js gives a WebGL2 texture *immutable* storage sized from its first upload (`texStorage2D`) and every later upload is a `texSubImage2D` into that box, so a bigger image is rejected with `GL_INVALID_VALUE: Offset overflows texture dimensions` and a smaller one lands in the corner. Either way the map never appears and nothing is thrown — the game just looks untextured. `swapImage` disposes on a size change so the storage is reallocated.
- README describes a design constraint worth keeping: maps must have large-scale structure (check by shrinking a texture to 32×32 — if shapes vanish, it will read as flat paint at distance). Asphalt deliberately stays fine-grained with a vertex-tint for variation.