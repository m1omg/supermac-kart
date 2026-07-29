# SuperMac Kart

**▶ [Play it here](https://m1omg.github.io/supermac-kart/)**

A browser kart racer in the SuperTuxKart mould, but the grid is classic
Mac mascots and hardware instead of the usual Linux/BSD crowd. Built on
three.js, real 3D, no build step.

## Running it locally

Open `index.html` in any modern browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Everything is local. three.js is vendored in `vendor/`, the surface maps
in `textures/` ship with the game, and every mascot, prop and UI element
is drawn into a canvas at load time. Nothing is fetched from the network,
so it works offline.

Opening `index.html` straight off the filesystem works too: some browsers
block the texture XHR over `file://`, and the game falls back to its
canvas-drawn surfaces automatically — flatter, but fully playable and
error-free. Serving the folder gets you the photographic surfaces.

## Controls

| Action | Keys |
| --- | --- |
| Steer | `←` `→` or `A` `D` |
| Throttle / brake | `↑` `↓` or `W` `S` |
| **Nitro** | `Space` |
| Drift | `Shift` (hold with steering; a long enough slide pays out a mini-turbo) |
| Camera | `C` — chase / far / bumper |
| Pause | `P` or `Esc` |
| Mute | `M` |
| Un-stick yourself | `R` |

Touch controls appear automatically on touch devices.

## The grid

Eight mascots, each with genuinely different handling — top speed,
acceleration, grip and nitro yield are separate ratings that scale the
physics — and each driving its own piece of Apple hardware rather than a
recoloured box:

| Mascot | Chassis | Character |
| --- | --- | --- |
| Happy Mac | compact Macintosh, smiling screen | all-rounder |
| Sad Mac | compact Macintosh, `X_X` screen | heavy, poor grip |
| Bondi | translucent iMac G3 shell + handle | quick all-rounder |
| Beachball | iMac shell, spinning ball aboard | highest top speed, lazy launch |
| Finder | a System 7 window on wheels | best grip |
| Bomb | a window with the error bomb aboard | biggest nitro, twitchy |
| Clarus | a LaserWriter, dogcow riding it | featherweight, huge grip |
| Trash Can | 2013 Mac Pro cylinder | fastest nitro recharge |

Mascots that *are* a machine drive themselves and wear their face on
their own screen. Mascots that are creatures — Clarus, the Beachball,
the Bomb — sit on top of a machine, which shows a plain System 6 desktop
instead, so no face ever appears twice on one kart.

## The circuits

Four fixed, hand-authored courses — not procedural, and not endless:

| Circuit | Difficulty | Laps |
| --- | --- | --- |
| Cupertino Coast | Rookie | 3 |
| Aqua Bay | Pro | 3 |
| System 7 Speedway | Expert | 4 |
| Silicon Ridge | Insane | 3 |

Each centreline is an authored sum of harmonics (see `DEFS` in
`js/tracks.js`) — those coefficients *are* the level design. The same
corner has the same radius, camber and braking point on every machine,
every session, and the roadside scenery is placed from a fixed seed, so
nothing about a track changes between loads.

## Nitro

Three ways to fill and spend the bar:

- **Hold `Space`** to burn stored nitro for a large speed and FOV boost.
- **RAM chip pickups** sit in rows around the lap and refill 34%.
- **Chevron boost strips** on corner exits give an instant kick plus 10%.
- **Drifting** (`Shift`) charges a mini-turbo; hold the slide long
  enough and releasing pays out a short boost and some nitro back.

The bar regenerates on its own, faster for mascots with a high nitro
rating.

## Frame-rate independence

The simulation runs on a fixed 120 Hz timestep with an accumulator; only
rendering happens per frame. Every rate in the physics is expressed per
second, and the AI runs off a seeded PRNG rather than `Math.random`, so a
given track and grid produce a bit-identical race every time.

Measured across 30/50/60/75/90/120/144/165/240 Hz with identical
scripted input over 90 s of racing, the total distance travelled varies
by **0.015%** — and that residual is just the sub-tick remainder in the
accumulator, not drift.

## Textures

The surface maps in `textures/` were generated with OpenAI's image model
through the Codex CLI's `imagegen` tool, then post-processed by
`scripts/seamless.py`: each one is measured for seam discontinuity
relative to its own natural pixel-to-pixel variation (so the metric
reports tiling quality, not how noisy the texture is), healed with an
offset cross-fade only if it actually shows a seam, then resized to 512px
and saved as JPEG. The whole set is 564 KB.

`asphalt` · `grass` · `dirt` · `beige_plastic` · `dark_metal` · `rock` · `concrete`

Lane markings are *not* baked into the asphalt — they ride on a separate
ribbon whose UV spans the road width exactly, so the grain can tile
freely underneath while the markings stay crisp and correctly placed.

## Performance

The 3-D buffer scales itself. Frame times are sampled continuously and
the render scale moves between 60% and 100% to hold 60 fps, judged on a
**median** so a single hitch can't spike it, and stepped gradually with a
cooldown so it settles instead of oscillating. Only the WebGL buffer is
scaled — the HUD is DOM and stays sharp at any scale. Device pixel ratio
is capped at 1.5, past which extra pixels cost fill rate without being
visible on a scene moving this fast.

Kart textures are shared through a cache keyed on mascot and part. Eight
karts previously rebuilt the same maps eight times over — same canvases,
same GPU uploads, same materials — which cost far more than the geometry
did.

## Layout

```
index.html        page shell + HUD markup
css/style.css     HUD, menus, touch controls
js/util.js        maths helpers, seeded PRNG, formatting
js/art.js         every texture + the mascot roster (canvas-generated)
js/tracks.js      circuit definitions, centreline sampling, banking, minimap
js/world.js       scene assembly: road ribbon, kerbs, terrain, sky, scenery
js/kart.js        kart mesh, arcade driving model, AI driver
js/audio.js       synthesised engine, nitro roar and UI sounds (WebAudio)
js/game.js        boot, menus, fixed-step race loop, HUD, results
vendor/three.js   three.js r158
textures/         generated surface maps (with canvas fallbacks)
scripts/          texture post-processing
```
