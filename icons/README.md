# icons/

Drop-in art for the mascots. Nothing here is required — the game paints
every mascot in `js/art.js` and uses those paintings whenever a file is
absent — but anything you put here wins.

## Naming

| File | Replaces |
| --- | --- |
| `<id>.svg` or `<id>.png` | the mascot's icon in the character picker |
| `<id>-face.svg` or `<id>-face.png` | the texture mapped onto its head during a race |

SVG is tried first, then PNG. The ids are the ones in the `MASCOTS`
roster in `js/art.js`:

```
happy  clarus  beachball  sad  bondi  bomb  finder  trashcan
```

So `icons/clarus.svg` replaces Clarus in the picker, and
`icons/clarus-face.png` replaces the hide wrapped around her head on
track.

## What the files should look like

Picker icons are drawn to fit, aspect preserved, on a transparent
background — square art works best, and transparency is worth keeping
because the card tints behind it.

Face textures are stretched to fill a square and then wrapped, so they
are not a head-on portrait: for the sphere and cylinder mascots
(`clarus`, `beachball`, `bomb`, `trashcan`) the image is an unrolled
skin, where the left and right edges meet round the back and the top
and bottom edges pinch to the poles. A head-on portrait used here will
look wrong on track. The box-headed mascots (`happy`, `sad`, `bondi`,
`finder`) map straight onto the front face, so a portrait is right.

## Loading

Files load asynchronously and swap themselves in when they arrive, so a
missing or slow icon never blocks the menu or a race — you just keep
seeing the painted version. A file that 404s is not an error.

## Licensing

These are yours to choose. Note that the classic Apple mascots — Happy
Mac, Sad Mac, Clarus, the Finder face, the spinning beachball, the
System Error bomb — are Apple's copyrighted artwork, and most copies
circulating online are either unlicensed or marked non-free, which
means they cannot be redistributed in a public repo. Recreations are
not automatically clear either: a pixel-perfect replica of a
copyrighted icon is a derivative work no matter who redrew it. Whatever
you add here, record where it came from and under what licence in this
file.

### Provenance

| File | Source | Licence |
| --- | --- | --- |
| _(none yet)_ | | |
