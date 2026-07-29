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

**Nitro is a resource you have to go and get.** Nothing refills the bar
on its own, and you start the race with it empty. There are exactly two
ways to put anything in it:

- **RAM chip pickups**, in staggered rows of three around the lap. One
  chip is worth 26–42% depending on the mascot's nitro rating.
- **Contact.** Barge into a rival and whoever drove into the hit
  harvests nitro from it, in proportion to the closing speed. Trading
  paint is now a way to refuel.

Spending it: hold `Space`. It drains at 24–31% a second, so a chip buys
you a little over a second of boost. The bar needs 8% before it will
light at all, so the last sliver can't be tapped indefinitely.

Chevron **boost strips** and drift **mini-turbos** still exist, but they
pay out in speed only — they no longer feed the bar. The AI plays by
exactly the same rules, and will lean off the racing line to pick up a
chip when it is running dry.

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
and saved as JPEG.

`asphalt` · `grass` · `dirt` · `rock` · `concrete` · `bark` · `foliage` ·
`rubber` · `beige_plastic` · `dark_metal` · `circuit_board`

Every surface in the world is mapped: road, kerb runoff, verges, cliffs,
tree trunks and canopies, cones, monitors, floppies, server racks,
grandstand concrete and roof steel, and on the karts themselves the
plastics, the wheel rims and the tyres. The only things left as flat
colour are the ones a photograph would ruin — lamp glass, screen glow,
fuse sparks.

**Why the first attempt looked untextured.** The maps were all uniform
fine grain. Fine grain is exactly what the mip chain averages away, so
past a few metres every surface collapsed to one flat colour — mapped,
but indistinguishable from paint. The fix was to regenerate the terrain
maps with deliberate *large-scale* structure — mown stripes, gravel
drifts, slab fractures, staining — and to check each one by shrinking it
to 32×32: if you can still see light and dark shapes at that size, the
structure survives distance.

Two more things follow from the same problem. Tile sizes are set from
the real size of the surface (the cliff curtains had one rock tile
stretched across 500 units, which is why they read as flat paint), and
the terrain ribbons carry a slow vertex-colour tint — a swing of light
and dark tens of metres across, on three periods that don't divide into
each other or into the tile size. It costs no memory and no fill, it
restores the large scale that distance erases, and it hides the repeat.

Asphalt is the deliberate exception: it keeps a fine, near-uniform grain,
because any feature you could pick out on a road repeats every tile and
turns a straight into wallpaper. Its variation comes from the vertex
tint alone. Lane markings are not baked into it either — they ride on a
separate ribbon whose UV spans the road width exactly, so the grain can
tile freely underneath while the markings stay crisp and correctly
placed.

## Performance

The brief was to go faster *without* looking worse, so the work started
by measuring rather than guessing. Two findings drove it.

**Anisotropic filtering was the single biggest cost in the frame.**
Dropping it from 8× to 1× cut fragment time by 40% on its own — the road,
the verges and the ground are all viewed at a grazing angle, which is
precisely the case anisotropy pays for. So it became the first quality
dial rather than a fixed setting: it now defaults to 4× (visually
indistinguishable from 8× on a surface moving at 200 km/h, roughly half
the cost) and, when frames get slow, the renderer gives up filtering
*before* it gives up resolution, and restores it last. Losing a level of
anisotropy is nearly invisible; losing 40% of your pixels is not. The
net effect is that the game now holds **full render scale** where it
previously fell back to 90%, at a **36% lower cost per pixel** — faster
and sharper at the same time.

**The backdrop was being drawn first and thrown away.** The sky dome and
the mountain curtains rendered before everything else, so every sky pixel
was textured and then painted over by the ground, the terrain and the
road. They are now drawn *last* in the opaque pass with the depth test on
and depth writes off, so only the pixels that actually survive to the
horizon are ever shaded. The ground plane moved after the verges for the
same reason. Identical image, far fewer fragments.

Beyond that: the road markings ribbon is road-sized but mostly empty, so
it uses `alphaTest` to discard blank fragments before blending rather
than compositing a transparent pixel over the asphalt; and kart textures
are shared through a cache keyed on mascot and part, because eight karts
were rebuilding the same maps eight times over — same canvases, same GPU
uploads, same materials — which cost far more than the geometry did.

Underneath it all the buffer still scales itself. Frame times are sampled
continuously and the render scale moves between 60% and 100% to hold
60 fps, judged on a **median** so a single hitch can't spike it, and
stepped gradually with a cooldown so it settles instead of oscillating.
Only the WebGL buffer is scaled — the HUD is DOM and stays sharp at any
scale. Device pixel ratio is capped at 1.5, past which extra pixels cost
fill rate without being visible on a scene moving this fast.

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
