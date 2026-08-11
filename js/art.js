/* ============================================================
   Art — every texture in the game is painted into a canvas at
   boot, so the whole thing runs from a folder with no image
   downloads.  Also holds the mascot roster: their looks, their
   colours and their handling ratings.
   ============================================================ */

var Art = (function () {

  var maxAnisotropy = 1;

  /* Texture / no-texture switch.  When textures are turned off every
     loaded surface swaps back to its painted flat-colour fallback, so
     the game reads as clean flat racing stripes instead of photo ground.
     Toggling back on restores the photographic map (or waits for it,
     exactly like first boot).  The swap only touches the shared surface
     images — nothing is re-fetched, and every map that has landed stays
     in memory ready to go back up. */
  var texturesOn = true;

  /* Every texture handed out is kept here so the anisotropy level can be
     re-applied later.  Filtering the road and the terrain at a grazing
     angle is the single most expensive thing the fragment shader does,
     and it is the quality dial worth spending first — see setAnisotropy. */
  var allTextures = [];

  function C(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function paint(w, h, fn) {
    var c = C(w, h);
    fn(c.getContext('2d'), w, h);
    return c;
  }

  function texture(canvas, rx, ry) {
    var t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = maxAnisotropy;
    t.needsUpdate = true;
    allTextures.push(t);
    return t;
  }

  /* ==========================================================
     Photographic surface maps.

     The maps normally come from js/textures.js, which carries each
     JPEG as a data: URI.  That looks wasteful next to fetching
     textures/*.jpg, and it is by about a third — but it is the only
     form that survives all three ways the game gets played.

     Over file:// the fetched version cannot work: three.js requests
     images with crossOrigin="anonymous", and a page with an opaque
     origin can never satisfy that check, so every map fails and the
     game falls back to flat colour.  Data URIs make no request, carry
     no origin, and cannot be blocked, so they behave the same whether
     the game is served from GitHub Pages or double-clicked out of a
     folder.

     The bundle is loaded async (see index.html) so its weight never
     delays the menus from booting.  That means it can land after a race
     has already been built, so a surface takes whatever source is ready
     when it is created — the data URI if the bundle is in, else the .jpg
     file, else the painted canvas twin below — and refreshSurfaces()
     upgrades anything still on a fallback the moment the bundle arrives.
     ========================================================== */

  var loader = new THREE.TextureLoader();
  /* No CORS handshake to attempt: data URIs do not need one, and asking
     for one over file:// is what breaks the fetched maps in the first
     place.  Same-origin .jpg files do not need it either. */
  loader.setCrossOrigin(null);

  var surfaceCache = {};
  var surfaces = [];        /* every surface handed out, for late upgrades */

  function surfaceURL(name) {
    if (typeof TextureData !== 'undefined' && TextureData[name]) {
      return TextureData[name];
    }
    return 'textures/' + name + '.jpg';
  }

  /* Point a live surface at a different image.

     Assigning `.image` and setting needsUpdate is only half the job, and
     getting the other half wrong is invisible in the console but total on
     screen.  A WebGL2 texture is given *immutable* storage: three.js sizes
     it with texStorage2D on the first upload — here the 8x8 painted
     fallback — and every upload after that is a texSubImage2D into that
     fixed box.  Handing it the 512x512 photo later therefore fails with
     GL_INVALID_VALUE ("offset overflows texture dimensions"), the pixels
     are dropped on the floor, and the surface keeps showing flat paint for
     the life of the page.  Disposing releases that storage, so the next
     frame allocates it again at the new size and the map appears.

     Going the other way (photo -> small fallback, the T key) is worse than
     a dropped upload: the little canvas *fits*, so it lands in the corner
     of the big texture and leaves the rest of the photo standing.  Same
     cure, so the size check covers both directions.

     One thing this cannot survive: never `clone()` a surface texture to
     get a second repeat out of it.  A clone shares the original's Source,
     and the repeat is not part of the key the renderer caches GPU textures
     under, so the two would share one allocation that the dispose below
     can no longer free — and the flat-paint bug comes back silently.  Ask
     loadSurface for the repeat you want instead; it already keys on it. */
  function swapImage(s, img) {
    if (!img || s.tex.image === img) return;
    var cur = s.tex.image;
    if (!cur || cur.width !== img.width || cur.height !== img.height) {
      /* frees the GPU storage only — the texture object stays valid and
         every material still pointing at it re-uploads on the next frame */
      s.tex.dispose();
    }
    s.tex.image = img;
    s.tex.needsUpdate = true;
  }

  /* Load the best source available *right now* into an existing texture.
     Called once when the surface is created and again by refreshSurfaces
     if it was still on its fallback when the data-URI bundle arrived. */
  function applyImage(s) {
    loader.load(
      surfaceURL(s.name),
      function (img) {
        img.colorSpace = THREE.SRGBColorSpace;
        img.wrapS = img.wrapT = THREE.RepeatWrapping;
        img.repeat.set(s.rx || 1, s.ry || 1);
        img.anisotropy = maxAnisotropy;
        s.photo = img.image;
        s.done = true;
        /* only surface the photo if the game is currently showing textures — a
           no-texture race must not be repainted underneath */
        if (texturesOn) swapImage(s, img.image);
      },
      undefined,
      function () { /* keep the painted fallback; a later pass may still land it */ }
    );
  }

  function loadSurface(name, fallbackCanvas, rx, ry) {
    var key = name + '|' + rx + '|' + ry;
    if (surfaceCache[key]) return surfaceCache[key];

    var tex = texture(fallbackCanvas, rx, ry);
    /* Held in surfaceCache for the life of the page and shared by every
       track, so it must outlive the scene that first used it — see
       disposeScene in game.js. */
    tex.userData.shared = true;

    var s = { tex: tex, name: name, rx: rx, ry: ry, done: false,
              flat: fallbackCanvas, photo: null };
    surfaces.push(s);
    applyImage(s);

    surfaceCache[key] = tex;
    return tex;
  }

  /* Re-try every surface still showing its flat fallback.  The map bundle
     (js/textures.js) is loaded async so it never blocks the menus from
     booting, which means it can land *after* the first race was built —
     and in that race every surface would have fallen back to a flat colour
     (or, over file://, to a .jpg the browser then refused).  Without this
     second pass those surfaces would stay flat for the life of the page;
     with it, they upgrade to the real maps the instant the data arrives. */
  function refreshSurfaces() {
    for (var i = 0; i < surfaces.length; i++) {
      if (!surfaces[i].done) applyImage(surfaces[i]);
    }
  }

  /* Flip every shared surface between its photographic map and its flat
     painted twin.  Cheap: re-points the texture's image through swapImage,
     the same path applyImage uses.  off=true keeps the flat canvases; off=
     false restores the photos that have landed so far.  The ones still
     loading when textures are off surface the moment they arrive (see
     applyImage), so late bundles don't paint under a "no texture" race. */
  function setTextures(on) {
    if (on === texturesOn) return;
    texturesOn = on;
    for (var i = 0; i < surfaces.length; i++) {
      var s = surfaces[i];
      swapImage(s, on ? (s.photo || s.flat) : s.flat);
    }
  }

  function texturesActive() { return texturesOn; }

  /* Watch for the async bundle to arrive and upgrade on the spot.  If it
     never shows (bundle deleted), give up after a few seconds and leave
     the surfaces on their .jpg / painted fallbacks. */
  if (typeof TextureData === 'undefined') {
    var waited = 0;
    var poll = setInterval(function () {
      if (typeof TextureData !== 'undefined') { clearInterval(poll); refreshSurfaces(); }
      else if (++waited > 40) clearInterval(poll);
    }, 150);
  }

  /* ---------- small canvas helpers ---------- */

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function ell(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.closePath();
  }

  function noise(ctx, w, h, amount, alpha, seed) {
    var rnd = Util.rng(seed || 7);
    for (var i = 0; i < amount; i++) {
      var v = Math.floor(rnd() * 255);
      ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + alpha + ')';
      var s = 1 + rnd() * 3;
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }

  /* ==========================================================
     Mascot icons

     Drawn the way the originals were: on a 32x32 grid, one flat
     colour per cell, hard edges, no anti-aliasing anywhere.  That
     is the whole reason these read as Mac icons rather than as
     generic app art — a 32px icon that has been smoothed is just
     a small blurry picture, and the eye knows immediately.

     So nothing here uses a curve.  Every shape is laid down in
     grid cells through px/frame/frameIn, then the finished grid is
     blown up with image smoothing switched off, which keeps the
     pixels square at any card size.  Colours come from the System 7
     / Mac OS 8 palette, so the hardware keeps its real identity
     (Bondi blue stays Bondi blue, the beachball keeps its six).
     ========================================================== */

  var GRID = 32;                     /* the classic icon size */

  /* A tiny painter that snaps everything to the icon grid.  Cell
     coordinates in, pixels out. */
  function IconGrid(ctx, cell) {
    this.ctx = ctx;
    this.c = cell;
  }
  IconGrid.prototype.px = function (x, y, w, h, col) {
    if (!col) return;
    this.ctx.fillStyle = col;
    this.ctx.fillRect(Math.round(x) * this.c, Math.round(y) * this.c,
                      Math.round(w) * this.c, Math.round(h) * this.c);
  };
  /* 1-cell outline sitting *outside* the given box */
  IconGrid.prototype.frame = function (x, y, w, h, col) {
    this.px(x, y - 1, w, 1, col);
    this.px(x, y + h, w, 1, col);
    this.px(x - 1, y, 1, h, col);
    this.px(x + w, y, 1, h, col);
    /* corners */
    this.px(x - 1, y - 1, 1, 1, col);
    this.px(x + w, y - 1, 1, 1, col);
    this.px(x - 1, y + h, 1, 1, col);
    this.px(x + w, y + h, 1, 1, col);
  };
  /* 1-cell outline drawn *inside* the given box */
  IconGrid.prototype.frameIn = function (x, y, w, h, col) {
    this.px(x, y, w, 1, col);
    this.px(x, y + h - 1, w, 1, col);
    this.px(x, y, 1, h, col);
    this.px(x + w - 1, y, 1, h, col);
  };
  /* A filled disc rasterised onto the grid — pixel-stepped, never
     a smooth arc, so it keeps the chunky staircase edge. */
  IconGrid.prototype.disc = function (cx, cy, r, col, shade) {
    for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r) continue;
        this.px(x, y, 1, 1, shade ? shade(x, y, dx, dy) : col);
      }
    }
  };

  /* Classic 50% checkerboard — how a 1-bit era icon made grey, and
     still the quickest way to say "Mac" in a highlight. */
  IconGrid.prototype.dither = function (x, y, w, h, col) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        if ((i + j) % 2 === 0) this.px(x + i, y + j, 1, 1, col);
      }
    }
  };

  /* The compact Macintosh body, shared by Happy and Sad Mac.  Both
     are the same machine; only the screen and the case tint differ. */
  function compactIcon(g, pal, faceFn) {
    /* case: 20 cells wide, with the real machine's slight taper */
    g.px(6, 2, 20, 1, pal.edge);
    g.px(5, 3, 22, 22, pal.edge);
    g.px(6, 3, 20, 21, pal.case);
    /* the front is lighter than the sides, as on the real bezel */
    g.px(6, 3, 20, 1, pal.lit);
    g.px(6, 24, 20, 1, pal.shade);

    /* screen recess */
    g.px(8, 5, 16, 13, pal.edge);
    g.px(9, 6, 14, 11, pal.screen);
    faceFn(g, pal);

    /* the Apple-era vent line under the screen */
    g.px(9, 19, 6, 1, pal.shade);

    /* floppy slot */
    g.px(9, 21, 14, 2, pal.slot);
    g.px(10, 22, 12, 1, pal.edge);

    /* foot / chin */
    g.px(7, 25, 18, 2, pal.shade);
    g.px(8, 27, 16, 1, pal.edge);
  }

  var ICON = {

    happy: function (g) {
      compactIcon(g, {
        edge: '#2b2620', case: '#d8cba8', lit: '#eee2c2', shade: '#a2957a',
        screen: '#b8dcc0', slot: '#4a4238'
      }, function (g) {
        /* the smile that greeted every boot */
        g.px(12, 9, 2, 2, '#1d3a24');
        g.px(18, 9, 2, 2, '#1d3a24');
        g.px(12, 13, 8, 1, '#1d3a24');
        g.px(11, 12, 1, 1, '#1d3a24');
        g.px(20, 12, 1, 1, '#1d3a24');
      });
    },

    sad: function (g) {
      compactIcon(g, {
        edge: '#24262b', case: '#a8acb4', lit: '#c4c8d0', shade: '#787c85',
        screen: '#8fa8a0', slot: '#3a3d44'
      }, function (g) {
        /* X eyes: drawn cell by cell, the way the original was */
        [11, 18].forEach(function (ex) {
          g.px(ex, 8, 1, 1, '#1d2a24'); g.px(ex + 3, 8, 1, 1, '#1d2a24');
          g.px(ex + 1, 9, 1, 1, '#1d2a24'); g.px(ex + 2, 9, 1, 1, '#1d2a24');
          g.px(ex + 1, 10, 1, 1, '#1d2a24'); g.px(ex + 2, 10, 1, 1, '#1d2a24');
          g.px(ex, 11, 1, 1, '#1d2a24'); g.px(ex + 3, 11, 1, 1, '#1d2a24');
        });
        /* frown */
        g.px(12, 14, 8, 1, '#1d2a24');
        g.px(11, 15, 1, 1, '#1d2a24');
        g.px(20, 15, 1, 1, '#1d2a24');
      });
    },

    /* iMac G3: the translucent egg, seen head on.  The silhouette is the
       whole point — a big round CRT swelling out at the shoulders, pulled
       in under the chin, then flaring back out onto the foot.  Drawn as a
       row-by-row profile so that curve survives on 32 cells. */
    bondi: function (g) {
      var shell = '#3d9aa8', lit = '#8adfe8', deep = '#1b545f', edge = '#0e2f38';

      /* y, x, w — the silhouette is most of this icon's job.  The CRT
         mass has to own about two thirds of the height, with only a short
         chin and a small foot under it; stretch that neck and the whole
         thing turns into a goblet. */
      var body = [
        [3, 12, 8], [4, 10, 12], [5, 9, 14], [6, 8, 16], [7, 7, 18],
        [8, 7, 18], [9, 6, 20], [10, 6, 20], [11, 6, 20], [12, 6, 20],
        [13, 6, 20], [14, 6, 20], [15, 6, 20], [16, 6, 20], [17, 7, 18],
        [18, 8, 16], [19, 9, 14], [20, 10, 12], [21, 11, 10],
        [22, 11, 10], [23, 10, 12], [24, 10, 12]
      ];
      var i, r;
      for (i = 0; i < body.length; i++) {
        r = body[i];
        g.px(r[1] - 1, r[0], r[2] + 2, 1, edge);   /* outline */
        g.px(r[1], r[0], r[2], 1, shell);
      }
      /* translucency: a bright edge down one side, shadow down the other */
      for (i = 0; i < body.length; i++) {
        r = body[i];
        g.px(r[1], r[0], 2, 1, lit);
        g.px(r[1] + r[2] - 2, r[0], 2, 1, deep);
      }

      /* CRT bezel + screen, centred in the round part */
      g.px(9, 7, 14, 11, '#17303a');
      g.px(10, 8, 12, 9, '#d3e7f0');
      /* a desktop on it, not a blank pane */
      g.px(10, 8, 12, 1, '#8fa8b8');
      g.px(11, 10, 6, 1, '#4a6a80');
      g.px(11, 12, 8, 1, '#4a6a80');
      g.px(11, 14, 5, 1, '#4a6a80');

      /* the recessed carry handle on top */
      g.px(14, 2, 4, 1, edge);
      g.px(15, 3, 2, 1, lit);
    },

    /* The spinning wait cursor: six wedges, rasterised by angle so
       the boundaries land on cell edges. */
    beachball: function (g) {
      var cols = ['#e8443f', '#f3a63b', '#f7e04a', '#59c04a', '#3f8ae0', '#8a4fd0'];
      g.disc(16, 16, 13, null, function (x, y, dx, dy) {
        var a = Math.atan2(dy, dx) + Math.PI;          /* 0..2pi */
        var i = Math.floor(a / (Math.PI * 2) * 6) % 6;
        /* darken the lower half so the ball reads as round */
        return dy > 4 ? Util.mix(cols[i], '#000000', 0.22) : cols[i];
      });
      /* rim and a hard specular block, the way an icon fakes gloss */
      g.disc(16, 16, 13.9, null, function (x, y, dx, dy) {
        return (dx * dx + dy * dy > 12.4 * 12.4) ? '#2a2a30' : null;
      });
      g.px(11, 9, 3, 2, '#ffffff');
      g.px(13, 8, 2, 1, '#ffffff');
    },

    /* Clarus the dogcow, from the LaserWriter page-setup dialog:
       a white body with black patches, snout, and floppy ears. */
    clarus: function (g) {
      var K = '#1b1b1b', W = '#f6f6f0';

      /* Ears hang *below* the top of the head and clear of it, or at
         icon size they merge into one black bar across the skull. */
      g.px(5, 10, 3, 6, K);
      g.px(6, 16, 2, 2, K);
      g.px(24, 10, 3, 6, K);
      g.px(24, 16, 2, 2, K);

      /* head */
      g.px(11, 5, 10, 1, K);
      g.px(9, 6, 14, 16, K);
      g.px(10, 6, 12, 15, W);

      /* the dogcow's patches — kept off the ears and away from the eyes */
      g.px(10, 6, 3, 3, K);
      g.px(19, 7, 3, 3, K);

      /* eyes */
      g.px(12, 11, 2, 3, K);
      g.px(18, 11, 2, 3, K);

      /* snout */
      g.px(12, 15, 8, 5, K);
      g.px(13, 16, 6, 3, '#e8b0b0');
      g.px(14, 17, 1, 1, K);
      g.px(17, 17, 1, 1, K);

      /* body below the head, and the tail flicking out to the side */
      g.px(11, 22, 10, 4, K);
      g.px(12, 22, 8, 3, W);
      g.px(13, 23, 3, 2, K);
      g.px(21, 22, 2, 1, K);
      g.px(23, 21, 1, 2, K);
      /* hooves */
      g.px(12, 26, 2, 2, K);
      g.px(18, 26, 2, 2, K);
    },

    /* The System 7 bomb — the dialog nobody wanted to see. */
    bomb: function (g) {
      /* fuse and spark, behind the body */
      g.px(20, 6, 1, 3, '#8a6a3a');
      g.px(21, 4, 1, 2, '#8a6a3a');
      g.px(22, 3, 2, 2, '#ffd34d');
      g.px(23, 2, 1, 1, '#fff3b8');
      g.px(24, 4, 1, 1, '#ff9a3d');

      /* cap */
      g.px(17, 8, 4, 2, '#3a3a42');

      /* body: black, with the icon-standard hard highlight */
      g.disc(15, 19, 10, null, function (x, y, dx, dy) {
        var d = dx * dx + dy * dy;
        if (d > 9.2 * 9.2) return '#0a0a0c';
        return '#1e1e24';
      });
      g.px(10, 13, 3, 2, '#6e6e7a');
      g.px(12, 12, 2, 1, '#6e6e7a');
      g.px(9, 15, 1, 2, '#4a4a54');
    },

    /* The Finder's split face: half blue, half white, one eye each. */
    finder: function (g) {
      var blue = '#2f6fd0', pale = '#eef3fa', edge = '#16233a';

      g.px(7, 4, 18, 1, edge);
      g.px(6, 5, 20, 22, edge);
      g.px(7, 5, 9, 21, blue);
      g.px(16, 5, 9, 21, pale);

      /* eyes: reversed out of whichever half they sit on */
      g.px(11, 11, 2, 4, pale);
      g.px(19, 11, 2, 4, blue);

      /* the smile crosses the divide, swapping colour with it */
      g.px(10, 19, 6, 1, pale);
      g.px(16, 19, 6, 1, blue);
      g.px(9, 18, 1, 1, pale);
      g.px(22, 18, 1, 1, blue);

      /* centre seam */
      g.px(16, 5, 1, 21, edge);
    },

    /* Mac Pro 2013 — the black cylinder, lit from inside the throat. */
    trashcan: function (g) {
      var body = '#26262c', dark = '#101014', lit = '#4e4e5a', glow = '#7de3ff';

      /* It is a squat, fat can — drawn narrow it just reads as a post.
         Top ellipse gets two rows so the opening looks like a throat. */
      g.px(10, 5, 14, 1, dark);
      g.px(9, 6, 16, 2, dark);
      g.px(11, 6, 12, 1, glow);
      g.px(12, 7, 10, 1, '#2b6a7a');

      /* barrel: one soft gloss band down the left and a dark turn on the
         right is all the roundness a 32px can needs — a second highlight
         in the middle just reads as a seam. */
      g.px(9, 8, 16, 16, body);
      g.px(10, 8, 3, 16, lit);
      g.px(13, 8, 1, 16, '#3a3a44');
      g.px(22, 8, 3, 16, dark);

      /* base */
      g.px(9, 24, 16, 2, dark);
      g.px(10, 26, 14, 1, '#0a0a0c');
    }
  };

  /* Render a mascot's icon at any size.  The grid is drawn once at
     32x32 and blown up with smoothing off, so a 200px card and a
     32px HUD chip show the same crisp pixels. */
  function icon(m, size) {
    var cell = Math.max(1, Math.floor(size / GRID));
    var S = cell * GRID;
    var c = C(S, S);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var fn = ICON[m.id] || ICON.happy;
    fn(new IconGrid(ctx, cell));
    return c;
  }

  /* ==========================================================
     Mascot faces
     ========================================================== */

  /* Classic compact Macintosh front, filling the canvas. */
  function compactMac(ctx, S, caseTop, caseBot, faceFn) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, caseTop);
    g.addColorStop(1, caseBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = S * 0.02;
    rr(ctx, S * 0.03, S * 0.03, S * 0.94, S * 0.94, S * 0.1);
    ctx.stroke();

    /* screen */
    var sx = S * 0.15, sy = S * 0.1, sw = S * 0.7, sh = S * 0.52;
    ctx.fillStyle = '#3b3b38';
    rr(ctx, sx - S * 0.03, sy - S * 0.03, sw + S * 0.06, sh + S * 0.06, S * 0.05);
    ctx.fill();
    var sg = ctx.createLinearGradient(0, sy, 0, sy + sh);
    sg.addColorStop(0, '#d6ecdc');
    sg.addColorStop(1, '#93bfa3');
    ctx.fillStyle = sg;
    rr(ctx, sx, sy, sw, sh, S * 0.03);
    ctx.fill();

    faceFn(ctx, sx + sw / 2, sy + sh / 2, sw, sh);

    /* floppy slot + badge */
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    rr(ctx, S * 0.24, S * 0.72, S * 0.52, S * 0.05, S * 0.02);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.fillRect(S * 0.3, S * 0.86, S * 0.4, S * 0.02);
  }

  function happyFace(ctx, cx, cy, w, h) {
    ctx.fillStyle = '#14361f';
    var e = w * 0.085;
    ctx.fillRect(cx - w * 0.2 - e / 2, cy - h * 0.2, e, e * 1.6);
    ctx.fillRect(cx + w * 0.2 - e / 2, cy - h * 0.2, e, e * 1.6);
    ctx.strokeStyle = '#14361f';
    ctx.lineWidth = w * 0.065;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.02, w * 0.23, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.stroke();
  }

  function sadFace(ctx, cx, cy, w, h) {
    ctx.strokeStyle = '#14361f';
    ctx.lineWidth = w * 0.07;
    ctx.lineCap = 'round';
    var e = w * 0.09;
    [-1, 1].forEach(function (s) {
      var ex = cx + s * w * 0.2, ey = cy - h * 0.14;
      ctx.beginPath();
      ctx.moveTo(ex - e, ey - e); ctx.lineTo(ex + e, ey + e);
      ctx.moveTo(ex + e, ey - e); ctx.lineTo(ex - e, ey + e);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy + h * 0.3, w * 0.2, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
  }

  var FACE = {

    happy: function (ctx, S) { compactMac(ctx, S, '#f4e8ca', '#c9b892', happyFace); },
    sad:   function (ctx, S) { compactMac(ctx, S, '#dcdde1', '#9ba0a9', sadFace); },

    bondi: function (ctx, S) {
      var g = ctx.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, '#6fd3d8');
      g.addColorStop(1, '#1b7d8f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);

      ctx.fillStyle = 'rgba(255,255,255,.85)';
      rr(ctx, S * 0.08, S * 0.05, S * 0.84, S * 0.62, S * 0.1);
      ctx.fill();
      ctx.fillStyle = '#28353a';
      rr(ctx, S * 0.12, S * 0.08, S * 0.76, S * 0.56, S * 0.08);
      ctx.fill();
      var sg = ctx.createLinearGradient(0, 0, 0, S * 0.6);
      sg.addColorStop(0, '#a8ddff');
      sg.addColorStop(1, '#2f6ea8');
      ctx.fillStyle = sg;
      rr(ctx, S * 0.16, S * 0.12, S * 0.68, S * 0.48, S * 0.06);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = S * 0.035;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(S * 0.3, S * 0.4);
      ctx.quadraticCurveTo(S * 0.42, S * 0.2, S * 0.52, S * 0.38);
      ctx.quadraticCurveTo(S * 0.6, S * 0.5, S * 0.72, S * 0.28);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,.4)';
      rr(ctx, S * 0.36, S * 0.86, S * 0.28, S * 0.06, S * 0.03);
      ctx.fill();
    },

    finder: function (ctx, S) {
      ctx.fillStyle = '#2f6fd0';
      ctx.fillRect(0, 0, S / 2, S);
      ctx.fillStyle = '#eaf2fb';
      ctx.fillRect(S / 2, 0, S / 2, S);

      ctx.fillStyle = '#eaf2fb';
      ell(ctx, S * 0.28, S * 0.36, S * 0.075, S * 0.1); ctx.fill();
      ctx.fillStyle = '#2f6fd0';
      ell(ctx, S * 0.72, S * 0.36, S * 0.075, S * 0.1); ctx.fill();

      ctx.lineWidth = S * 0.06;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#eaf2fb';
      ctx.beginPath();
      ctx.arc(S / 2, S * 0.5, S * 0.26, 0.1 * Math.PI, 0.5 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = '#2f6fd0';
      ctx.beginPath();
      ctx.arc(S / 2, S * 0.5, S * 0.26, 0.5 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    },

    /* wraps a sphere: vertical rainbow gores = a beach ball */
    beachball: function (ctx, S) {
      var cols = ['#e8443f', '#f3a63b', '#f7e04a', '#59c04a', '#3f8ae0', '#8a4fd0'];
      var bw = S / cols.length;
      for (var i = 0; i < cols.length; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(i * bw, 0, bw + 1, S);
      }
      var g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(255,255,255,.75)');
      g.addColorStop(0.2, 'rgba(255,255,255,0)');
      g.addColorStop(0.8, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    },

    /* wraps a sphere: dogcow hide */
    clarus: function (ctx, S) {
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(0, 0, S, S);
      var rnd = Util.rng(42);
      ctx.fillStyle = '#1b1b1b';
      for (var i = 0; i < 9; i++) {
        var x = rnd() * S, y = S * (0.2 + rnd() * 0.6);
        var w = S * (0.06 + rnd() * 0.09), h = S * (0.05 + rnd() * 0.08);
        ell(ctx, x, y, w, h); ctx.fill();
      }
    },

    bomb: function (ctx, S) {
      ctx.fillStyle = '#17171b';
      ctx.fillRect(0, 0, S, S);
      var g = ctx.createRadialGradient(S * 0.35, S * 0.3, S * 0.02, S * 0.5, S * 0.5, S * 0.6);
      g.addColorStop(0, 'rgba(255,255,255,.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    },

    trashcan: function (ctx, S) {
      var g = ctx.createLinearGradient(0, 0, S, 0);
      g.addColorStop(0, '#101014');
      g.addColorStop(0.4, '#4c4c56');
      g.addColorStop(0.62, '#26262c');
      g.addColorStop(1, '#0c0c10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      ctx.fillRect(S * 0.2, 0, S * 0.05, S);
    }
  };

  /* eyes-only decals used on the spherical mascots */
  var DECAL = {
    bomb: function (ctx, S) {
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = '#fff';
      ell(ctx, S * 0.36, S * 0.46, S * 0.13, S * 0.16); ctx.fill();
      ell(ctx, S * 0.64, S * 0.46, S * 0.13, S * 0.16); ctx.fill();
      ctx.fillStyle = '#111';
      ell(ctx, S * 0.38, S * 0.49, S * 0.06, S * 0.08); ctx.fill();
      ell(ctx, S * 0.66, S * 0.49, S * 0.06, S * 0.08); ctx.fill();
    },
    clarus: function (ctx, S) {
      ctx.clearRect(0, 0, S, S);
      /* snout */
      ctx.fillStyle = '#f2f2ec';
      ell(ctx, S * 0.5, S * 0.62, S * 0.22, S * 0.16); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = S * 0.012;
      ell(ctx, S * 0.5, S * 0.62, S * 0.22, S * 0.16); ctx.stroke();
      ctx.fillStyle = '#1b1b1b';
      ell(ctx, S * 0.43, S * 0.59, S * 0.035, S * 0.045); ctx.fill();
      ell(ctx, S * 0.57, S * 0.59, S * 0.035, S * 0.045); ctx.fill();
      /* eyes */
      ctx.fillStyle = '#111';
      ell(ctx, S * 0.36, S * 0.34, S * 0.05, S * 0.065); ctx.fill();
      ell(ctx, S * 0.64, S * 0.34, S * 0.05, S * 0.065); ctx.fill();
      ctx.fillStyle = '#fff';
      ell(ctx, S * 0.375, S * 0.32, S * 0.018, S * 0.022); ctx.fill();
      ell(ctx, S * 0.655, S * 0.32, S * 0.018, S * 0.022); ctx.fill();
    }
  };

  /* back of the head — vents and ports, so overtaking looks right */
  function backPanel(ctx, S, base, dark) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (var i = 0; i < 7; i++) ctx.fillRect(S * 0.18, S * (0.12 + i * 0.055), S * 0.64, S * 0.022);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    rr(ctx, S * 0.2, S * 0.62, S * 0.24, S * 0.14, S * 0.03); ctx.fill();
    rr(ctx, S * 0.56, S * 0.62, S * 0.24, S * 0.14, S * 0.03); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(S * 0.42, S * 0.84, S * 0.16, S * 0.04);
  }

  /* ==========================================================
     Roster
     ========================================================== */

  var MASCOTS = [
    { id: 'happy', name: 'HAPPY MAC', color: '#e8dcc0', trim: '#b9a882', dot: '#ffd98a', num: 1,
      head: 'box', chassis: 'compact', rider: false, desc: 'Boots first, asks later. The balanced all-rounder.',
      top: 0.74, accel: 0.78, grip: 0.80, nitro: 0.75 },

    { id: 'clarus', name: 'CLARUS', color: '#f2f2ec', trim: '#1b1b1b', dot: '#ffffff', num: 7,
      head: 'sphere', chassis: 'laserwriter', rider: true, desc: 'Moof! Featherweight. Corners like nothing else.',
      top: 0.62, accel: 0.92, grip: 0.98, nitro: 0.80 },

    { id: 'beachball', name: 'BEACHBALL', color: '#e8443f', trim: '#f7e04a', dot: '#ff6a5e', num: 8,
      head: 'sphere', chassis: 'imac', rider: true, desc: 'Never stops spinning. Huge top end, lazy launch.',
      top: 1.00, accel: 0.50, grip: 0.60, nitro: 0.70 },

    { id: 'sad', name: 'SAD MAC', color: '#9ea2ab', trim: '#5c6069', dot: '#c3c8d2', num: 0,
      head: 'box', chassis: 'compact', rider: false, desc: 'Heavy chassis. Shrugs off contact, hates hairpins.',
      top: 0.90, accel: 0.56, grip: 0.58, nitro: 0.65 },

    { id: 'bondi', name: 'BONDI', color: '#4abec5', trim: '#ffffff', dot: '#5fe3e8', num: 3,
      head: 'box', chassis: 'imac', rider: false, desc: 'Translucent and quick. The crowd favourite.',
      top: 0.82, accel: 0.80, grip: 0.78, nitro: 0.78 },

    { id: 'bomb', name: 'BOMB', color: '#2a2a30', trim: '#ff7a3d', dot: '#8a86ff', num: 4,
      head: 'sphere', chassis: 'dialog', rider: true, desc: 'Unstable. Enormous nitro yield, twitchy steering.',
      top: 0.92, accel: 0.88, grip: 0.50, nitro: 1.00 },

    { id: 'finder', name: 'FINDER', color: '#2f6fd0', trim: '#eaf2fb', dot: '#4f9dff', num: 2,
      head: 'box', chassis: 'dialog', rider: false, desc: 'Always knows the racing line. Reliable grip.',
      top: 0.78, accel: 0.72, grip: 0.92, nitro: 0.72 },

    { id: 'trashcan', name: 'TRASH CAN', color: '#3a3a42', trim: '#7de3ff', dot: '#7de3ff', num: 6,
      head: 'cylinder', chassis: 'cylinder', rider: false, desc: 'Thermal core. Nitro refills noticeably faster.',
      top: 0.88, accel: 0.70, grip: 0.72, nitro: 0.95 }
  ];

  function mascot(id) {
    for (var i = 0; i < MASCOTS.length; i++) if (MASCOTS[i].id === id) return MASCOTS[i];
    return MASCOTS[0];
  }

  /* ==========================================================
     Kart chassis panels — the details that make each kart read
     as a specific piece of Apple hardware rather than a box.
     ========================================================== */

  /* The six-stripe badge that sat on the chin of every beige Mac.  The
     case itself is geometry now, so this is all that is left of the old
     painted side panel — and it is the part that carries the era. */
  function rainbowBadge() {
    return paint(128, 64, function (ctx, w, h) {
      var cols = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
      ctx.fillStyle = '#cfc4a4';
      ctx.fillRect(0, 0, w, h);
      var bw = w * 0.42, bh = h * 0.72, bx = w * 0.06, by = h * 0.14;
      for (var c = 0; c < cols.length; c++) {
        ctx.fillStyle = cols[c];
        ctx.fillRect(bx, by + (bh / cols.length) * c, bw, bh / cols.length + 0.5);
      }
      /* the wordmark next to it, as a suggestion rather than lettering */
      ctx.fillStyle = 'rgba(40,36,28,.55)';
      for (var i = 0; i < 3; i++) ctx.fillRect(w * 0.56, h * (0.26 + i * 0.2), w * 0.36, h * 0.08);
    });
  }

  /* Classic window title bar: six lines + close box. */
  function titleBar(accent) {
    return paint(512, 128, function (ctx, w, h) {
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#15151a';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      ctx.fillStyle = '#15151a';
      for (var i = 0; i < 6; i++) {
        ctx.fillRect(14, 16 + i * 14, w - 28, 5);
      }
      /* close box */
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(20, 18, 34, 34);
      ctx.strokeStyle = '#15151a';
      ctx.lineWidth = 5;
      ctx.strokeRect(20, 18, 34, 34);

      /* title plate */
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(w * 0.32, 10, w * 0.36, h * 0.62);
      ctx.fillStyle = accent;
      ctx.fillRect(w * 0.32, h * 0.58, w * 0.36, 6);
    });
  }

  /* LaserWriter body: beige with a paper slot and status lamps. */
  function printerPanel() {
    return paint(256, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#efe6cc');
      g.addColorStop(1, '#cbc0a2');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 700, 0.03, 21);

      ctx.fillStyle = 'rgba(0,0,0,.28)';
      rr(ctx, w * 0.1, h * 0.44, w * 0.8, h * 0.07, h * 0.03);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(0, h * 0.66, w, 3);

      ['#59c04a', '#fdb827'].forEach(function (c, i) {
        ctx.fillStyle = c;
        ell(ctx, w * (0.2 + i * 0.1), h * 0.24, w * 0.026, w * 0.026);
        ctx.fill();
      });
    });
  }

  /* ==========================================================
     Environment textures
     ========================================================== */

  /* Road surface: u spans the full width, v repeats along length,
     so edge lines and centre dashes come baked in. */
  function asphalt(theme) {
    return paint(256, 256, function (ctx, w, h) {
      ctx.fillStyle = theme.road;
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 2600, 0.05, 3);

      /* faint tyre-worn lines */
      ctx.fillStyle = 'rgba(0,0,0,.10)';
      ctx.fillRect(w * 0.24, 0, w * 0.1, h);
      ctx.fillRect(w * 0.66, 0, w * 0.1, h);

      /* solid edge lines */
      ctx.fillStyle = theme.line;
      ctx.fillRect(w * 0.035, 0, w * 0.022, h);
      ctx.fillRect(w * 0.943, 0, w * 0.022, h);

      /* centre dash — half the tile length */
      ctx.fillRect(w * 0.49, 0, w * 0.022, h * 0.5);
    });
  }

  /* What a machine shows on its screen when the mascot riding it is
     somebody else — a tidy System 6 desktop instead of a face. */
  function desktopScreen() {
    return paint(256, 192, function (ctx, w, h) {
      /* classic 50% dither desktop */
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9c9c9';
      for (var y = 0; y < h; y += 2) {
        for (var x = (y / 2) % 2; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
      }
      /* menu bar */
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(0, 0, w, h * 0.11);
      ctx.fillStyle = '#15151a';
      ctx.fillRect(0, h * 0.11, w, 2);
      var cols = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
      for (var i = 0; i < cols.length; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(w * 0.03, h * 0.018 + i * (h * 0.012), w * 0.045, h * 0.012);
      }
      /* a window and a disk icon */
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(w * 0.14, h * 0.26, w * 0.5, h * 0.5);
      ctx.strokeStyle = '#15151a';
      ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.14, h * 0.26, w * 0.5, h * 0.5);
      ctx.fillStyle = '#15151a';
      for (var b = 0; b < 5; b++) ctx.fillRect(w * 0.155, h * 0.285 + b * 5, w * 0.47, 2);
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(w * 0.76, h * 0.3, w * 0.14, h * 0.16);
      ctx.strokeRect(w * 0.76, h * 0.3, w * 0.14, h * 0.16);
    });
  }

  /* Lane markings only, on transparent — painted over the photographic
     asphalt so the road can have real grain and crisp lines at once. */
  function roadMarkings(theme) {
    return paint(256, 256, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);

      /* solid edge lines */
      ctx.fillStyle = theme.line;
      ctx.fillRect(w * 0.035, 0, w * 0.022, h);
      ctx.fillRect(w * 0.943, 0, w * 0.022, h);

      /* centre dash, half the tile */
      ctx.fillRect(w * 0.49, 0, w * 0.022, h * 0.5);

      /* faint tyre-worn darkening in the racing line */
      ctx.fillStyle = 'rgba(0,0,0,.13)';
      ctx.fillRect(w * 0.24, 0, w * 0.1, h);
      ctx.fillRect(w * 0.66, 0, w * 0.1, h);
    });
  }

  function kerb(theme) {
    return paint(64, 64, function (ctx, w, h) {
      ctx.fillStyle = theme.kerbA;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = theme.kerbB;
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(0, 0, w * 0.1, h);
    });
  }

  function grass(theme) {
    return paint(256, 256, function (ctx, w, h) {
      ctx.fillStyle = theme.grass;
      ctx.fillRect(0, 0, w, h);
      var rnd = Util.rng(11);
      for (var i = 0; i < 1800; i++) {
        ctx.fillStyle = rnd() < 0.5
          ? 'rgba(255,255,255,.05)'
          : 'rgba(0,0,0,.07)';
        var s = 2 + rnd() * 6;
        ctx.fillRect(rnd() * w, rnd() * h, s, s * 0.5);
      }
    });
  }

  function checkerBand() {
    return paint(512, 64, function (ctx, w, h) {
      var cells = 16, cw = w / cells;
      for (var x = 0; x < cells; x++) {
        for (var y = 0; y < 2; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#15151a' : '#f4f4f0';
          ctx.fillRect(x * cw, y * h / 2, cw, h / 2);
        }
      }
    });
  }

  /* boost pad: forward chevrons on transparent background */
  function chevron(color) {
    return paint(256, 256, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = w * 0.1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (var i = 0; i < 3; i++) {
        var y = h * (0.78 - i * 0.28);
        ctx.globalAlpha = 0.45 + i * 0.22;
        ctx.beginPath();
        ctx.moveTo(w * 0.16, y);
        ctx.lineTo(w * 0.5, y - h * 0.2);
        ctx.lineTo(w * 0.84, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }

  function billboardPanel() {
    return paint(512, 384, function (ctx, w, h) {
      var cols = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
      var sh = h / cols.length;
      for (var i = 0; i < cols.length; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(0, i * sh, w, sh + 1);
      }
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.font = '800 ' + Math.round(h * 0.26) + 'px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SUPERMAC', w / 2, h * 0.42);
      ctx.font = '700 ' + Math.round(h * 0.1) + 'px Helvetica, Arial, sans-serif';
      ctx.fillText('K  A  R  T', w / 2, h * 0.66);
    });
  }

  function bannerPanel(text) {
    return paint(1024, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b2230');
      g.addColorStop(1, '#0b0f18');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(0, 0, w, h * 0.06);
      ctx.fillRect(0, h * 0.94, w, h * 0.06);
      ctx.fillStyle = '#fff';
      ctx.font = '800 ' + Math.round(h * 0.4) + 'px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h * 0.52);
    });
  }

  /* Grandstand crowd.

     Drawn as overlapping shoulders-and-head silhouettes packed tightly
     and shaded back-to-front, rather than evenly spaced dots on a grid —
     a regular grid of bright circles reads as toy bricks, not people.
     Colours stay muted and desaturated so the stands sit behind the
     action instead of competing with the karts. */
  function crowd() {
    return paint(512, 256, function (ctx, w, h) {
      /* seat colour showing between people */
      ctx.fillStyle = '#3a4150';
      ctx.fillRect(0, 0, w, h);

      var rnd = Util.rng(99);
      var shirts = ['#c2665f', '#5f82c2', '#94a05c', '#c2a05c', '#8a6ba8',
                    '#d6dae0', '#4f9e8c', '#b47ba8', '#6f8296', '#c49a72'];
      var skins = ['#c99b74', '#a87a56', '#e0b591', '#8a5e3f', '#6b4630'];

      var rows = 7;
      for (var row = rows - 1; row >= 0; row--) {
        /* rows further back sit higher, smaller and darker */
        var depth = row / (rows - 1);
        var y = h * (0.94 - depth * 0.72);
        var scale = 1 - depth * 0.42;
        /* back rows sit in shade, but never so dark that the stand
           reads as an empty black slab from the track */
        var shade = 0.72 + (1 - depth) * 0.28;
        var step = w / (26 + row * 5);

        for (var x = -step; x < w + step; x += step) {
          var px = x + (rnd() - 0.5) * step * 0.55;
          var r = step * 0.34 * scale;
          if (rnd() < 0.06) continue;          /* the odd empty seat */

          var shirt = shirts[Math.floor(rnd() * shirts.length)];
          var skin = skins[Math.floor(rnd() * skins.length)];

          /* shoulders */
          ctx.fillStyle = Util.mix('#000000', shirt, shade);
          ctx.beginPath();
          ctx.ellipse(px, y + r * 1.5, r * 1.5, r * 1.4, 0, Math.PI, 0);
          ctx.fill();

          /* head */
          ctx.fillStyle = Util.mix('#000000', skin, shade);
          ctx.beginPath();
          ctx.arc(px, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* a touch of depth haze over the back rows */
      var g = ctx.createLinearGradient(0, 0, 0, h * 0.45);
      g.addColorStop(0, 'rgba(58,65,80,.45)');
      g.addColorStop(1, 'rgba(58,65,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.45);
    });
  }

  function screenGlow(color) {
    return paint(128, 128, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, color);
      g.addColorStop(1, '#0b2a4a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      for (var i = 0; i < 5; i++) ctx.fillRect(w * 0.12, h * (0.16 + i * 0.14), w * (0.6 - i * 0.08), h * 0.05);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      for (var y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    });
  }

  function ramChip() {
    return paint(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#0f7d3a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0b5c2b';
      ctx.fillRect(0, h * 0.82, w, h * 0.18);
      ctx.fillStyle = '#111';
      for (var i = 0; i < 5; i++) ctx.fillRect(w * (0.07 + i * 0.19), h * 0.2, w * 0.13, h * 0.42);
      ctx.fillStyle = '#e5c76b';
      for (var j = 0; j < 20; j++) ctx.fillRect(w * (0.03 + j * 0.049), h * 0.84, w * 0.028, h * 0.16);
      ctx.fillStyle = '#7de3ff';
      ctx.font = '800 ' + Math.round(h * 0.16) + 'px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NITRO RAM', w / 2, h * 0.14);
    });
  }

  /* ==========================================================
     Sky dome.

     The dome wraps the texture right around the horizon, so u=1 butts
     straight up against u=0.  Anything painted near an edge therefore
     has to be painted again on the far side, or it ends as a hard
     vertical seam across the sky.  wrapDraw() does exactly that: it
     runs the same drawing at x, x-w and x+w, so a cloud clipped by the
     right edge reappears continuing across the left.
     ========================================================== */

  function sky(theme) {
    var W = 1024, H = 512;
    return paint(W, H, function (ctx, w, h) {

      /* the gradient varies only vertically, so it cannot seam */
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, theme.sky[0]);
      g.addColorStop(0.42, theme.sky[1]);
      g.addColorStop(0.70, theme.sky[2]);
      g.addColorStop(1.00, theme.sky[3] || theme.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      /* paint something at x, and again wrapped round both edges */
      function wrapDraw(x, reach, draw) {
        draw(x);
        if (x + reach > w) draw(x - w);
        if (x - reach < 0) draw(x + w);
      }

      var rnd = Util.rng(theme.cloudSeed || 5);

      /* sun / moon halo */
      var sx = w * theme.sunU, sy = h * theme.sunV;
      var reach = w * 0.3;
      wrapDraw(sx, reach, function (x) {
        var sg = ctx.createRadialGradient(x, sy, 2, x, sy, reach);
        sg.addColorStop(0, theme.sunColor);
        sg.addColorStop(0.12, Util.rgba(theme.sunGlowHex, 0.75));
        sg.addColorStop(1, Util.rgba(theme.sunGlowHex, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(x - reach, sy - reach, reach * 2, reach * 2);
      });

      /* clouds */
      ctx.fillStyle = theme.cloud;
      for (var i = 0; i < 34; i++) {
        var cx = rnd() * w;
        var cy = h * (0.22 + rnd() * 0.42);
        var cw = w * (0.02 + rnd() * 0.045);
        wrapDraw(cx, cw * 2, function (x) {
          ctx.beginPath();
          ctx.ellipse(x, cy, cw, cw * 0.3, 0, 0, Math.PI * 2);
          ctx.ellipse(x + cw * 0.6, cy + cw * 0.08, cw * 0.62, cw * 0.22, 0, 0, Math.PI * 2);
          ctx.ellipse(x - cw * 0.6, cy + cw * 0.1, cw * 0.5, cw * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      if (theme.stars) {
        ctx.fillStyle = '#fff';
        for (var st = 0; st < 420; st++) {
          ctx.globalAlpha = 0.25 + rnd() * 0.75;
          ctx.fillRect(rnd() * w, rnd() * h * 0.55, 1.6, 1.6);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  /* soft round blob used for blob shadows and light pools */
  function blob(color, softness) {
    return paint(128, 128, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, color);
      g.addColorStop(softness || 0.5, Util.rgba('#000000', 0));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  function radial(color) {
    return paint(128, 128, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  /* smoke / dust puff */
  function puff() {
    return paint(128, 128, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,.85)');
      g.addColorStop(0.45, 'rgba(255,255,255,.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  /* ==========================================================
     Menu portrait (2-D, for the character picker)
     ========================================================== */

  /* The character-picker portrait is the mascot's icon, sat on a soft
     panel.  It deliberately does *not* reuse the 3-D face textures: those
     are wrap maps stretched around a sphere or a cylinder, so seen flat
     they read as stripes and blobs rather than as the machine.  The icon
     is drawn for this job, at the size and on the grid it was meant for. */
  function portrait(m, w, h) {
    return paint(w, h, function (ctx) {
      /* Left transparent on purpose: the canvas is letterboxed inside the
         card by object-fit, so any panel painted here shows up as a slab
         narrower than the card.  The icon sits straight on the card. */

      /* Snap the icon to a whole number of pixels per cell, then centre
         it — a fractional cell size is exactly what turns crisp pixel art
         back into mush.  Take the largest cell that still fits, since
         rounding down can otherwise throw away a third of the card. */
      var cell = Math.max(1, Math.floor(Math.min(w, h) * 0.98 / GRID));
      var S = cell * GRID;
      var art = icon(m, S);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(art, Math.round((w - S) / 2), Math.round((h - S) / 2));
    });
  }

  return {
    /* Applies to textures already in the scene as well as future ones,
       so the renderer can trade filtering quality at runtime.  Costs a
       re-upload, so callers are expected to change it rarely. */
    setAnisotropy: function (v) {
      if (v === maxAnisotropy) return;
      maxAnisotropy = v;
      for (var i = 0; i < allTextures.length; i++) {
        allTextures[i].anisotropy = v;
        allTextures[i].needsUpdate = true;
      }
    },
    anisotropy: function () { return maxAnisotropy; },
    texture: texture,
    loadSurface: loadSurface,
    refreshSurfaces: refreshSurfaces,
    setTextures: setTextures,
    texturesActive: texturesActive,
    paint: paint,
    canvas: C,
    roundRect: rr,

    MASCOTS: MASCOTS,
    mascot: mascot,
    face: function (m) { return paint(256, 256, function (ctx, w) { FACE[m.id](ctx, w); }); },
    rainbowBadge: rainbowBadge,
    titleBar: titleBar,
    printerPanel: printerPanel,
    decal: function (m) { return DECAL[m.id] ? paint(256, 256, function (ctx, w) { DECAL[m.id](ctx, w); }) : null; },
    back: function (m) { return paint(256, 256, function (ctx, w) { backPanel(ctx, w, m.color, Util.mix(m.color, '#000000', 0.45)); }); },
    portrait: portrait,
    icon: icon,

    asphalt: asphalt,
    roadMarkings: roadMarkings,
    desktopScreen: desktopScreen,
    kerb: kerb,
    grass: grass,
    checkerBand: checkerBand,
    chevron: chevron,
    billboardPanel: billboardPanel,
    bannerPanel: bannerPanel,
    crowd: crowd,
    screenGlow: screenGlow,
    ramChip: ramChip,
    sky: sky,
    blob: blob,
    radial: radial,
    puff: puff
  };
})();
