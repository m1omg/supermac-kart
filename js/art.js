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

  /* Compact Mac side: vents, rainbow badge, moulded seam. */
  function compactSide(base) {
    return paint(256, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, Util.mix(base, '#ffffff', 0.14));
      g.addColorStop(1, Util.mix(base, '#000000', 0.18));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 900, 0.035, 12);

      /* case seam */
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(0, h * 0.62, w, 2);

      /* louvred vents */
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      for (var i = 0; i < 9; i++) {
        rr(ctx, w * 0.12, h * (0.1 + i * 0.045), w * 0.4, h * 0.018, h * 0.009);
        ctx.fill();
      }

      /* six-stripe rainbow badge */
      var cols = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
      var bx = w * 0.68, by = h * 0.72, bw = w * 0.2, bh = h * 0.16;
      for (var c = 0; c < cols.length; c++) {
        ctx.fillStyle = cols[c];
        ctx.fillRect(bx, by + (bh / cols.length) * c, bw, bh / cols.length + 0.5);
      }
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

  /* Translucent iMac shell: coloured, with a lighter inner glow. */
  function shellPanel(tint) {
    return paint(256, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, Util.mix(tint, '#ffffff', 0.42));
      g.addColorStop(0.5, tint);
      g.addColorStop(1, Util.mix(tint, '#000000', 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      /* internals hinted through the plastic */
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (var i = 0; i < 5; i++) {
        rr(ctx, w * 0.14, h * (0.2 + i * 0.13), w * 0.72, h * 0.06, h * 0.03);
        ctx.fill();
      }
      var s = ctx.createLinearGradient(0, 0, 0, h);
      s.addColorStop(0, 'rgba(255,255,255,.5)');
      s.addColorStop(0.25, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, w, h);
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

  /* spherical shading pass, so a flat wrap texture reads as a ball */
  function shadeRound(ctx, S) {
    var sh = ctx.createRadialGradient(S * 0.35, S * 0.32, S * 0.05, S * 0.5, S * 0.5, S * 0.62);
    sh.addColorStop(0, 'rgba(255,255,255,.25)');
    sh.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function portrait(m, w, h) {
    return paint(w, h, function (ctx) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, Util.rgba('#ffffff', 0.1));
      g.addColorStop(1, Util.rgba('#000000', 0.18));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      var S = Math.min(w, h) * 0.72;
      var ox = (w - S) / 2, oy = (h - S) / 2;

      ctx.save();
      ctx.translate(ox, oy);

      if (m.head === 'sphere') {
        /* Clarus's ears sit behind the head, so they go down first. */
        if (m.id === 'clarus') {
          ctx.fillStyle = '#1b1b1b';
          [-1, 1].forEach(function (side) {
            ctx.save();
            ctx.translate(S * (0.5 + side * 0.4), S * 0.34);
            ctx.rotate(side * 0.5);
            ell(ctx, 0, 0, S * 0.12, S * 0.26);
            ctx.fill();
            ctx.restore();
          });
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
        ctx.clip();
        FACE[m.id](ctx, S);
        ctx.restore();

        if (DECAL[m.id]) DECAL[m.id](ctx, S);
        shadeRound(ctx, S);

      } else if (m.head === 'cylinder') {
        /* a can, not a ball — otherwise the Mac Pro is unrecognisable */
        var cw = S * 0.62, cx = (S - cw) / 2;
        var top = S * 0.14, bot = S * 0.9, ry = cw * 0.22;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, bot);
        ctx.ellipse(cx + cw / 2, bot, cw / 2, ry, 0, Math.PI, 0, true);
        ctx.lineTo(cx + cw, top);
        ctx.ellipse(cx + cw / 2, top, cw / 2, ry, 0, 0, Math.PI, true);
        ctx.closePath();
        ctx.clip();
        FACE[m.id](ctx, S);
        ctx.restore();

        /* lit throat at the top */
        ctx.fillStyle = '#15151a';
        ell(ctx, cx + cw / 2, top, cw / 2, ry);
        ctx.fill();
        var gg = ctx.createRadialGradient(cx + cw / 2, top, 1, cx + cw / 2, top, cw * 0.55);
        gg.addColorStop(0, 'rgba(125,227,255,.95)');
        gg.addColorStop(1, 'rgba(125,227,255,0)');
        ctx.fillStyle = gg;
        ell(ctx, cx + cw / 2, top, cw * 0.44, ry * 0.85);
        ctx.fill();

      } else {
        FACE[m.id](ctx, S);
      }
      ctx.restore();
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
    compactSide: compactSide,
    titleBar: titleBar,
    shellPanel: shellPanel,
    printerPanel: printerPanel,
    decal: function (m) { return DECAL[m.id] ? paint(256, 256, function (ctx, w) { DECAL[m.id](ctx, w); }) : null; },
    back: function (m) { return paint(256, 256, function (ctx, w) { backPanel(ctx, w, m.color, Util.mix(m.color, '#000000', 0.45)); }); },
    portrait: portrait,

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
