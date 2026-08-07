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

Read this before adding or redistributing anything here.

The classic Apple mascots — Happy Mac, Sad Mac, Clarus, the Finder
face, the spinning beachball, the System Error bomb — are Apple's
copyrighted artwork. Most copies circulating online are either
unlicensed or marked non-free. Recreations are not automatically clear
either: a pixel-perfect replica of a copyrighted icon is a derivative
work no matter who redrew it.

The files currently here come from a repository that carries **no
licence at all**, which under copyright's default means all rights
reserved — by the author of the replicas, on top of Apple's rights in
the originals. They were added deliberately, with that understood.
Anyone forking or redistributing this project should make their own
call rather than assuming these are cleared.

### Provenance

| File | Source | Licence |
| --- | --- | --- |
| `happy.svg` | [thomasareed/Classic-Mac-icons](https://github.com/thomasareed/Classic-Mac-icons) — `svg/Happy Mac.svg` | none stated (all rights reserved) |
| `sad.svg` | [thomasareed/Classic-Mac-icons](https://github.com/thomasareed/Classic-Mac-icons) — `svg/Sad Mac.svg` | none stated (all rights reserved) |
| `clarus.svg` | [thomasareed/Classic-Mac-icons](https://github.com/thomasareed/Classic-Mac-icons) — `svg/Dogcow.svg` | none stated (all rights reserved) |
| `bomb.svg` | [thomasareed/Classic-Mac-icons](https://github.com/thomasareed/Classic-Mac-icons) — `svg/bomb.svg` | none stated (all rights reserved) |

`beachball`, `bondi`, `finder` and `trashcan` have no file here and use
the painted art in `js/art.js`. That set is classic-era only, so it has
no spinning beachball, no iMac G3 and no Finder face. It does have a
`Trash.svg`, but that is a literal wastebasket and this mascot is the
2013 cylindrical Mac Pro — using it would put an icon in the picker
that disagrees with the model on track.
