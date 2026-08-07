/* ============================================================
   Art — the game's textures, plus the mascot roster: their looks,
   their colours and their handling ratings.

   Artwork comes from two places.  Image files under textures/ and
   icons/ are used when they are there; everything also has a
   canvas-painted version that stands in when a file is missing or
   still in flight.  Adding art is therefore a matter of dropping a
   file in the right folder — no code here needs to change, and
   nothing blocks on the download.
   ============================================================ */

var Art = (function () {

  var maxAnisotropy = 1;

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
     Photographic surface maps (textures/*.jpg).

     Each one has a canvas-drawn twin below, so if a file is
     missing — or the page is opened straight off the filesystem,
     where some browsers refuse the XHR — the game still renders
     correctly, just flatter.  loadSurface() hands back the
     fallback canvas texture immediately and swaps the image in
     once it arrives.
     ========================================================== */

  var loader = new THREE.TextureLoader();
  var surfaceCache = {};

  function loadSurface(name, fallbackCanvas, rx, ry) {
    var key = name + '|' + rx + '|' + ry;
    if (surfaceCache[key]) return surfaceCache[key];

    var tex = texture(fallbackCanvas, rx, ry);

    loader.load(
      'textures/' + name + '.jpg',
      function (img) {
        img.colorSpace = THREE.SRGBColorSpace;
        img.wrapS = img.wrapT = THREE.RepeatWrapping;
        img.repeat.set(rx || 1, ry || 1);
        img.anisotropy = maxAnisotropy;
        /* hand the loaded pixels to the texture already in the scene */
        tex.image = img.image;
        tex.needsUpdate = true;
      },
      undefined,
      function () { /* keep the canvas fallback */ }
    );

    surfaceCache[key] = tex;
    return tex;
  }

  /* ==========================================================
     External mascot icons (icons/*).

     Drop a file named after a mascot id — icons/happy.svg,
     icons/clarus.png — and it replaces that mascot's painted
     portrait in the picker.  icons/<id>-face.png does the same for
     the texture mapped onto the head in the race.

     Nothing waits on these.  The painted art goes up immediately
     and a file swaps itself in when it lands, so a missing or slow
     icon costs nothing but the fallback staying on screen.  SVG is
     tried first and scales to any display; PNG is the fallback.
     ========================================================== */

  var ICON_DIR = 'icons/';
  var ICON_EXTS = ['svg', 'png'];

  /* Try each extension in turn, calling back with the first that
     decodes.  Silent when none of them exist — that is the normal
     case for a mascot with no external art. */
  function loadIcon(name, onLoad) {
    var i = 0;
    (function attempt() {
      if (i >= ICON_EXTS.length) return;
      var img = new Image();
      var src = ICON_DIR + name + '.' + ICON_EXTS[i++];
      img.onload = function () { onLoad(img); };
      img.onerror = attempt;
      /* an SVG without intrinsic dimensions still needs a size to
         rasterise into; the draw call supplies it */
      img.src = src;
    })();
  }

  /* Draw `img` into a w x h box, preserving aspect and centring —
     the same fit an <img> with object-fit: contain would give. */
  function drawContained(ctx, img, w, h, pad) {
    var iw = img.naturalWidth || img.width || w;
    var ih = img.naturalHeight || img.height || h;
    var box = 1 - (pad || 0) * 2;
    var s = Math.min((w * box) / iw, (h * box) / ih);
    var dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
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
     Mascot art

     All of it is vector work drawn once into a canvas at boot, so
     detail here is paid for in load time, never in frame time.  Two
     views exist per mascot because they answer different questions:

       FACE[id]     fills the square edge to edge, because it is
                    UV-mapped onto the front of a head in the race.
       PORTRAIT[id] is the head-on icon for the picker, free to use
                    its own silhouette and transparency.

     Where the two coincide (the compact Macs, Finder) PORTRAIT just
     defers to FACE rather than keeping a second copy in sync.
     ========================================================== */

  /* ---------- shading helpers ---------- */

  /* CRT raster lines. Cheap, and the single biggest cue that a
     rectangle is a screen rather than a swatch. */
  function scanlines(ctx, x, y, w, h, step, alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,' + alpha + ')';
    for (var i = y; i < y + h; i += step) ctx.fillRect(x, i, w, step * 0.42);
    ctx.restore();
  }

  /* Darkened corners — glass curvature on a CRT, falloff on a shell. */
  function vignette(ctx, x, y, w, h, alpha) {
    var g = ctx.createRadialGradient(
      x + w / 2, y + h / 2, Math.min(w, h) * 0.18,
      x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + alpha + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  /* Diagonal specular wipe across the top-left of a rounded panel. */
  function sheen(ctx, x, y, w, h, r, alpha) {
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    var g = ctx.createLinearGradient(x, y, x + w * 0.8, y + h);
    g.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
    g.addColorStop(0.42, 'rgba(255,255,255,' + (alpha * 0.25) + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /* Shadow cast into a recess, drawn from the top and sides inward. */
  function recess(ctx, x, y, w, h, r, d) {
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    var g = ctx.createLinearGradient(0, y, 0, y + d);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, d);
    var s = ctx.createLinearGradient(x, 0, x + d, 0);
    s.addColorStop(0, 'rgba(0,0,0,.35)');
    s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s;
    ctx.fillRect(x, y, d, h);
    ctx.restore();
  }

  /* The six-stripe rainbow badge, bottom-left of every beige Mac. */
  function appleBadge(ctx, x, y, w, h) {
    var cols = ['#5fb544', '#f7d038', '#f08a25', '#d8392f', '#8a4fd0', '#3f8ae0'];
    var bh = h / cols.length;
    for (var i = 0; i < cols.length; i++) {
      ctx.fillStyle = cols[i];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y + i * bh, w, bh + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- the compact Macintosh ---------- */

  /* Front of a Macintosh Plus, filling the canvas. `faceFn` paints
     whatever the CRT is showing, in screen-local coordinates. */
  function compactMac(ctx, S, caseTop, caseBot, faceFn) {
    /* Moulded beige: vertical gradient for the form, a horizontal
       pass on top so the case reads as curved rather than flat. */
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, Util.mix(caseTop, '#ffffff', 0.22));
    g.addColorStop(0.34, caseTop);
    g.addColorStop(1, caseBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var side = ctx.createLinearGradient(0, 0, S, 0);
    side.addColorStop(0, 'rgba(255,255,255,.16)');
    side.addColorStop(0.3, 'rgba(255,255,255,0)');
    side.addColorStop(0.78, 'rgba(0,0,0,.06)');
    side.addColorStop(1, 'rgba(0,0,0,.2)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, S, S);

    /* injection-moulding seam running around the bezel */
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = S * 0.008;
    rr(ctx, S * 0.045, S * 0.04, S * 0.91, S * 0.92, S * 0.075);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    rr(ctx, S * 0.045, S * 0.046, S * 0.91, S * 0.92, S * 0.075);
    ctx.stroke();

    /* --- CRT --- */
    var sx = S * 0.155, sy = S * 0.105, sw = S * 0.69, sh = S * 0.5;
    var bo = S * 0.035;                                   /* bezel overhang */

    /* dark surround, then the recess it sits in */
    ctx.fillStyle = '#2c2c29';
    rr(ctx, sx - bo, sy - bo, sw + bo * 2, sh + bo * 2, S * 0.055);
    ctx.fill();
    recess(ctx, sx - bo, sy - bo, sw + bo * 2, sh + bo * 2, S * 0.055, S * 0.06);

    /* phosphor — a classic Mac is black-on-white, slightly green with age */
    ctx.save();
    rr(ctx, sx, sy, sw, sh, S * 0.022);
    ctx.clip();
    var sg = ctx.createLinearGradient(0, sy, 0, sy + sh);
    sg.addColorStop(0, '#eef5e8');
    sg.addColorStop(1, '#c2d4bd');
    ctx.fillStyle = sg;
    ctx.fillRect(sx, sy, sw, sh);

    faceFn(ctx, sx + sw / 2, sy + sh / 2, sw, sh);

    scanlines(ctx, sx, sy, sw, sh, S * 0.016, 0.07);
    vignette(ctx, sx, sy, sw, sh, 0.3);
    ctx.restore();

    /* glass in front of the phosphor */
    sheen(ctx, sx, sy, sw, sh, S * 0.022, 0.3);

    /* --- lower case --- */
    /* floppy slot, cut in rather than drawn on */
    var fx = S * 0.235, fy = S * 0.725, fw = S * 0.53, fh = S * 0.038;
    ctx.fillStyle = '#1b1b18';
    rr(ctx, fx, fy, fw, fh, fh * 0.45);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath();
    ctx.moveTo(fx, fy + fh + S * 0.006);
    ctx.lineTo(fx + fw, fy + fh + S * 0.006);
    ctx.stroke();
    /* eject notch */
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    rr(ctx, fx + fw * 0.82, fy + fh * 1.8, fw * 0.12, fh * 0.5, fh * 0.2);
    ctx.fill();

    appleBadge(ctx, S * 0.09, S * 0.79, S * 0.05, S * 0.1);

    /* embossed wordmark bar */
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    ctx.fillRect(S * 0.22, S * 0.88, S * 0.3, S * 0.012);
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.fillRect(S * 0.22, S * 0.892, S * 0.3, S * 0.008);
  }

  function happyFace(ctx, cx, cy, w, h) {
    var ink = '#16321d';
    /* Susan Kare's smiley: square eyes, wide arc mouth, generous
       margins. Rounded caps keep it from looking like clip art. */
    ctx.fillStyle = ink;
    var e = w * 0.075;
    rr(ctx, cx - w * 0.19 - e / 2, cy - h * 0.24, e, e * 1.5, e * 0.22); ctx.fill();
    rr(ctx, cx + w * 0.19 - e / 2, cy - h * 0.24, e, e * 1.5, e * 0.22); ctx.fill();

    ctx.strokeStyle = ink;
    ctx.lineWidth = w * 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.04, w * 0.235, 0.17 * Math.PI, 0.83 * Math.PI);
    ctx.stroke();

    /* cheeks — barely there, but they stop the face reading as a decal */
    ctx.fillStyle = 'rgba(22,50,29,.1)';
    ell(ctx, cx - w * 0.28, cy + h * 0.14, w * 0.06, h * 0.045); ctx.fill();
    ell(ctx, cx + w * 0.28, cy + h * 0.14, w * 0.06, h * 0.045); ctx.fill();
  }

  function sadFace(ctx, cx, cy, w, h) {
    var ink = '#16321d';
    ctx.strokeStyle = ink;
    ctx.lineWidth = w * 0.062;
    ctx.lineCap = 'round';
    var e = w * 0.082;
    [-1, 1].forEach(function (s) {
      var ex = cx + s * w * 0.19, ey = cy - h * 0.2;
      ctx.beginPath();
      ctx.moveTo(ex - e, ey - e); ctx.lineTo(ex + e, ey + e);
      ctx.moveTo(ex + e, ey - e); ctx.lineTo(ex - e, ey + e);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy + h * 0.26, w * 0.19, 1.18 * Math.PI, 1.82 * Math.PI);
    ctx.stroke();

    /* the hex codes the real Sad Mac printed under the frown */
    ctx.fillStyle = 'rgba(22,50,29,.8)';
    ctx.font = '600 ' + (h * 0.14).toFixed(1) + 'px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0000000F', cx, cy + h * 0.41);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /* Spinning-wait-cursor rainbow, in pinwheel order. */
  var BALL_COLS = ['#e8443f', '#f3a63b', '#f7e04a', '#59c04a', '#3f8ae0', '#8a4fd0'];

  /* Mascot skins are what the camera sits closest to, so they get the
     detail budget.  Mipmapping means the extra texels cost sampling
     bandwidth only where they are actually resolved — the fragment
     shader does the same work either way, so this buys sharpness at
     close range for VRAM rather than for frame time. */
  var MASCOT_TEX = 512;

  var FACE = {

    happy: function (ctx, S) { compactMac(ctx, S, '#f4e8ca', '#c9b892', happyFace); },
    sad:   function (ctx, S) { compactMac(ctx, S, '#dcdde1', '#9ba0a9', sadFace); },

    /* Bondi blue iMac G3 front, squared off to fill the head cube. */
    bondi: function (ctx, S) {
      /* translucent shell */
      var g = ctx.createLinearGradient(0, 0, S * 0.9, S);
      g.addColorStop(0, '#8fe4e8');
      g.addColorStop(0.45, '#3fb3c0');
      g.addColorStop(1, '#125e73');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);

      /* light scattering through the polycarbonate */
      var scat = ctx.createRadialGradient(S * 0.3, S * 0.22, S * 0.02, S * 0.42, S * 0.4, S * 0.75);
      scat.addColorStop(0, 'rgba(255,255,255,.4)');
      scat.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = scat;
      ctx.fillRect(0, 0, S, S);

      /* white inner bezel around the CRT */
      ctx.fillStyle = 'rgba(244,252,253,.92)';
      rr(ctx, S * 0.075, S * 0.055, S * 0.85, S * 0.63, S * 0.11);
      ctx.fill();

      var sx = S * 0.13, sy = S * 0.105, sw = S * 0.74, sh = S * 0.52;
      ctx.fillStyle = '#20292e';
      rr(ctx, sx - S * 0.025, sy - S * 0.025, sw + S * 0.05, sh + S * 0.05, S * 0.07);
      ctx.fill();
      recess(ctx, sx - S * 0.025, sy - S * 0.025, sw + S * 0.05, sh + S * 0.05, S * 0.07, S * 0.05);

      /* Mac OS 8 desktop, blue-grey with a happy face */
      ctx.save();
      rr(ctx, sx, sy, sw, sh, S * 0.045);
      ctx.clip();
      var sg = ctx.createLinearGradient(0, sy, 0, sy + sh);
      sg.addColorStop(0, '#9fd8f5');
      sg.addColorStop(1, '#2d6ea6');
      ctx.fillStyle = sg;
      ctx.fillRect(sx, sy, sw, sh);

      var cx = sx + sw / 2, cy = sy + sh * 0.48;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ell(ctx, cx - sw * 0.16, cy - sh * 0.13, sw * 0.055, sh * 0.1); ctx.fill();
      ell(ctx, cx + sw * 0.16, cy - sh * 0.13, sw * 0.055, sh * 0.1); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = S * 0.028;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + sh * 0.02, sw * 0.2, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();

      scanlines(ctx, sx, sy, sw, sh, S * 0.015, 0.06);
      vignette(ctx, sx, sy, sw, sh, 0.35);
      ctx.restore();
      sheen(ctx, sx, sy, sw, sh, S * 0.045, 0.32);

      /* recessed handle well and the slot-load drive below it */
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      rr(ctx, S * 0.33, S * 0.735, S * 0.34, S * 0.055, S * 0.027);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      rr(ctx, S * 0.33, S * 0.795, S * 0.34, S * 0.014, S * 0.007);
      ctx.fill();

      /* speaker grille domes */
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      [0.2, 0.8].forEach(function (p) {
        ell(ctx, S * p, S * 0.87, S * 0.085, S * 0.055); ctx.fill();
      });

      sheen(ctx, 0, 0, S, S, S * 0.02, 0.16);
    },

    /* The two-tone Finder face: one half in shadow, one in light. */
    finder: function (ctx, S) {
      var lg = ctx.createLinearGradient(0, 0, 0, S);
      lg.addColorStop(0, '#3f86e6');
      lg.addColorStop(1, '#22539f');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, S / 2, S);

      var rg = ctx.createLinearGradient(0, 0, 0, S);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(1, '#cfdcea');
      ctx.fillStyle = rg;
      ctx.fillRect(S / 2, 0, S / 2, S);

      /* soft seam so the halves meet rather than butt together */
      var seam = ctx.createLinearGradient(S * 0.46, 0, S * 0.54, 0);
      seam.addColorStop(0, 'rgba(0,0,0,0)');
      seam.addColorStop(0.5, 'rgba(0,0,0,.18)');
      seam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = seam;
      ctx.fillRect(S * 0.46, 0, S * 0.08, S);

      var ex = S * 0.225, ey = S * 0.36, erx = S * 0.072, ery = S * 0.098;
      ctx.fillStyle = '#eaf2fb';
      ell(ctx, S * 0.5 - ex, ey, erx, ery); ctx.fill();
      ctx.fillStyle = '#2b62b8';
      ell(ctx, S * 0.5 + ex, ey, erx, ery); ctx.fill();

      /* catchlights — the detail that makes the face feel drawn */
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ell(ctx, S * 0.5 + ex - erx * 0.3, ey - ery * 0.35, erx * 0.26, ery * 0.26); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ell(ctx, S * 0.5 - ex + erx * 0.3, ey - ery * 0.35, erx * 0.26, ery * 0.26); ctx.fill();

      ctx.lineWidth = S * 0.058;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#eaf2fb';
      ctx.beginPath();
      ctx.arc(S / 2, S * 0.5, S * 0.26, 0.08 * Math.PI, 0.5 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = '#2b62b8';
      ctx.beginPath();
      ctx.arc(S / 2, S * 0.5, S * 0.26, 0.5 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();

      vignette(ctx, 0, 0, S, S, 0.22);
    },

    /* Wraps a sphere, so this is the unrolled hide: vertical rainbow
       gores. The picker gets the pinwheel instead — see PORTRAIT. */
    beachball: function (ctx, S) {
      var cols = BALL_COLS;
      var bw = S / cols.length;
      for (var i = 0; i < cols.length; i++) {
        var g = ctx.createLinearGradient(i * bw, 0, (i + 1) * bw, 0);
        g.addColorStop(0, Util.mix(cols[i], '#000000', 0.22));
        g.addColorStop(0.42, Util.mix(cols[i], '#ffffff', 0.12));
        g.addColorStop(1, Util.mix(cols[i], '#000000', 0.22));
        ctx.fillStyle = g;
        ctx.fillRect(i * bw, 0, bw + 1, S);
      }
      /* poles darken as the gores converge */
      var p = ctx.createLinearGradient(0, 0, 0, S);
      p.addColorStop(0, 'rgba(0,0,0,.45)');
      p.addColorStop(0.16, 'rgba(255,255,255,.28)');
      p.addColorStop(0.5, 'rgba(255,255,255,0)');
      p.addColorStop(0.84, 'rgba(0,0,0,.12)');
      p.addColorStop(1, 'rgba(0,0,0,.5)');
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, S, S);
    },

    /* Wraps a sphere: dogcow hide. Patches are seeded so the pattern
       is identical every load, and kept off the poles where the UV
       pinch would smear them. */
    clarus: function (ctx, S) {
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(0, 0, S, S);
      var rnd = Util.rng(42);
      for (var i = 0; i < 9; i++) {
        var x = rnd() * S, y = S * (0.24 + rnd() * 0.54);
        var w = S * (0.06 + rnd() * 0.09), h = S * (0.05 + rnd() * 0.08);
        ctx.fillStyle = '#1b1b1b';
        ell(ctx, x, y, w, h); ctx.fill();
        /* a touch of fur softness at the patch edge */
        ctx.fillStyle = 'rgba(27,27,27,.35)';
        ell(ctx, x, y, w * 1.14, h * 1.14); ctx.fill();
      }
      var sh = ctx.createLinearGradient(0, 0, 0, S);
      sh.addColorStop(0, 'rgba(0,0,0,.28)');
      sh.addColorStop(0.42, 'rgba(255,255,255,.12)');
      sh.addColorStop(1, 'rgba(0,0,0,.32)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, S, S);
    },

    /* Wraps a sphere: cast-iron bomb casing. */
    bomb: function (ctx, S) {
      var base = ctx.createLinearGradient(0, 0, S, 0);
      base.addColorStop(0, '#0b0b0f');
      base.addColorStop(0.36, '#3a3a46');
      base.addColorStop(0.6, '#1a1a20');
      base.addColorStop(1, '#08080c');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, S, S);

      /* pitted iron */
      noise(ctx, S, S, 900, 0.05, 11);

      var p = ctx.createLinearGradient(0, 0, 0, S);
      p.addColorStop(0, 'rgba(0,0,0,.5)');
      p.addColorStop(0.5, 'rgba(255,255,255,.06)');
      p.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, S, S);
    },

    /* Wraps the Mac Pro cylinder: anodised aluminium, one hard
       highlight band where the curve turns toward the light. */
    trashcan: function (ctx, S) {
      var g = ctx.createLinearGradient(0, 0, S, 0);
      g.addColorStop(0, '#0a0a0e');
      g.addColorStop(0.18, '#22222a');
      g.addColorStop(0.34, '#5a5a68');
      g.addColorStop(0.44, '#7c7c8c');
      g.addColorStop(0.56, '#33333c');
      g.addColorStop(0.78, '#15151a');
      g.addColorStop(1, '#08080c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);

      /* brushed vertical grain */
      var rnd = Util.rng(19);
      for (var i = 0; i < 160; i++) {
        var x = rnd() * S;
        ctx.fillStyle = 'rgba(255,255,255,' + (rnd() * 0.035).toFixed(3) + ')';
        ctx.fillRect(x, 0, S * 0.0035, S);
      }

      /* glow spilling down from the lit throat at the top */
      var t = ctx.createLinearGradient(0, 0, 0, S * 0.3);
      t.addColorStop(0, 'rgba(125,227,255,.3)');
      t.addColorStop(1, 'rgba(125,227,255,0)');
      ctx.fillStyle = t;
      ctx.fillRect(0, 0, S, S * 0.3);
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
    return paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w, h) {
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
    return paint(1024, 256, function (ctx, w, h) {
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
    return paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w, h) {
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
    return paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w, h) {
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
     Menu portraits (2-D, for the character picker)

     Head-on icons drawn in their own silhouette.  The mascots whose
     race texture is a sphere or cylinder wrap need one of these,
     because an unrolled hide viewed flat reads as stripes rather
     than as the thing it wraps.  The rest defer to FACE.
     ========================================================== */

  /* Sphere shading applied over a circular icon: key light from the
     upper left, bounce from below, and a hard rim to lift it off the
     card background. */
  function shadeBall(ctx, cx, cy, r) {
    var sh = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.04, cx, cy, r * 1.02);
    sh.addColorStop(0, 'rgba(255,255,255,.3)');
    sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    sh.addColorStop(0.82, 'rgba(0,0,0,.22)');
    sh.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = sh;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    /* bounce light along the lower rim */
    var b = ctx.createRadialGradient(cx, cy + r * 0.75, r * 0.05, cx, cy + r * 0.6, r * 0.7);
    b.addColorStop(0, 'rgba(255,255,255,.16)');
    b.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = b;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    /* specular */
    ctx.save();
    ctx.globalAlpha = 0.5;
    var sp = ctx.createRadialGradient(
      cx - r * 0.36, cy - r * 0.42, r * 0.01,
      cx - r * 0.36, cy - r * 0.42, r * 0.34);
    sp.addColorStop(0, 'rgba(255,255,255,.95)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp;
    ell(ctx, cx - r * 0.36, cy - r * 0.42, r * 0.32, r * 0.22);
    ctx.fill();
    ctx.restore();
  }

  /* Contact shadow so an icon sits on the card instead of floating. */
  function groundShadow(ctx, cx, y, rx, ry) {
    var g = ctx.createRadialGradient(cx, y, 1, cx, y, rx);
    g.addColorStop(0, 'rgba(0,0,0,.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ell(ctx, cx, y, rx, ry);
    ctx.fill();
  }

  var PORTRAIT = {

    /* The spinning wait cursor, seen head-on: a rainbow pinwheel. */
    beachball: function (ctx, S) {
      var cx = S / 2, cy = S * 0.5, r = S * 0.45;

      groundShadow(ctx, cx, cy + r * 1.08, r * 0.9, r * 0.16);
      var n = BALL_COLS.length;
      var step = (Math.PI * 2) / n;
      var start = -Math.PI / 2 - step / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      for (var i = 0; i < n; i++) {
        ctx.fillStyle = BALL_COLS[i];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r * 1.02, start + i * step, start + (i + 1) * step);
        ctx.closePath();
        ctx.fill();
      }
      /* hairline between wedges keeps adjacent hues from muddying */
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.lineWidth = S * 0.006;
      for (var j = 0; j < n; j++) {
        var a = start + j * step;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.restore();

      shadeBall(ctx, cx, cy, r);
    },

    /* Clarus, three-quarters of a dogcow: ears, snout, the lot. */
    clarus: function (ctx, S) {
      var cx = S / 2, cy = S * 0.52, r = S * 0.4;

      groundShadow(ctx, cx, cy + r * 1.12, r * 0.95, r * 0.18);

      /* ears go down first — they sit behind the head */
      ctx.fillStyle = '#1b1b1b';
      [-1, 1].forEach(function (side) {
        ctx.save();
        ctx.translate(cx + side * r * 0.92, cy - r * 0.34);
        ctx.rotate(side * 0.55);
        ell(ctx, 0, 0, r * 0.26, r * 0.6);
        ctx.fill();
        ctx.restore();
      });

      /* head */
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      /* hide patches, placed rather than random so the face stays readable */
      ctx.fillStyle = '#1b1b1b';
      ell(ctx, cx - r * 0.66, cy - r * 0.5, r * 0.34, r * 0.28); ctx.fill();
      ell(ctx, cx + r * 0.58, cy + r * 0.44, r * 0.3, r * 0.24); ctx.fill();
      ell(ctx, cx + r * 0.2, cy - r * 0.82, r * 0.24, r * 0.18); ctx.fill();
      ctx.restore();

      /* snout */
      ctx.fillStyle = '#f3f3ed';
      ell(ctx, cx, cy + r * 0.34, r * 0.46, r * 0.32); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)';
      ctx.lineWidth = S * 0.006;
      ell(ctx, cx, cy + r * 0.34, r * 0.46, r * 0.32); ctx.stroke();
      ctx.fillStyle = '#1b1b1b';
      ell(ctx, cx - r * 0.16, cy + r * 0.27, r * 0.075, r * 0.095); ctx.fill();
      ell(ctx, cx + r * 0.16, cy + r * 0.27, r * 0.075, r * 0.095); ctx.fill();
      /* mouth line */
      ctx.strokeStyle = 'rgba(27,27,27,.7)';
      ctx.lineWidth = S * 0.012;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.4, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      /* eyes */
      ctx.fillStyle = '#111';
      ell(ctx, cx - r * 0.34, cy - r * 0.36, r * 0.115, r * 0.15); ctx.fill();
      ell(ctx, cx + r * 0.34, cy - r * 0.36, r * 0.115, r * 0.15); ctx.fill();
      ctx.fillStyle = '#fff';
      ell(ctx, cx - r * 0.3, cy - r * 0.42, r * 0.042, r * 0.052); ctx.fill();
      ell(ctx, cx + r * 0.38, cy - r * 0.42, r * 0.042, r * 0.052); ctx.fill();

      shadeBall(ctx, cx, cy, r);
    },

    /* The System Error bomb, fuse lit. */
    bomb: function (ctx, S) {
      var cx = S * 0.48, cy = S * 0.58, r = S * 0.36;

      groundShadow(ctx, cx, cy + r * 1.1, r * 0.95, r * 0.18);

      /* fuse, drawn before the body so it tucks under the rim */
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = S * 0.038;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.34, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 1.0, cy - r * 1.5, cx + r * 0.72, cy - r * 1.95);
      ctx.stroke();

      /* cap */
      ctx.fillStyle = '#4a4a54';
      rr(ctx, cx + r * 0.06, cy - r * 1.12, r * 0.56, r * 0.34, r * 0.1);
      ctx.fill();

      /* body */
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      var g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, '#3c3c48');
      g.addColorStop(0.5, '#1b1b22');
      g.addColorStop(1, '#0a0a0e');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      noise(ctx, S, S, 400, 0.05, 11);
      ctx.restore();

      shadeBall(ctx, cx, cy, r);

      /* eyes, wide and worried */
      ctx.fillStyle = '#fff';
      ell(ctx, cx - r * 0.34, cy - r * 0.1, r * 0.24, r * 0.29); ctx.fill();
      ell(ctx, cx + r * 0.34, cy - r * 0.1, r * 0.24, r * 0.29); ctx.fill();
      ctx.fillStyle = '#111';
      ell(ctx, cx - r * 0.28, cy - r * 0.02, r * 0.11, r * 0.145); ctx.fill();
      ell(ctx, cx + r * 0.4, cy - r * 0.02, r * 0.11, r * 0.145); ctx.fill();

      /* spark */
      var sx = cx + r * 0.72, sy = cy - r * 2.0;
      var sp = ctx.createRadialGradient(sx, sy, 1, sx, sy, r * 0.55);
      sp.addColorStop(0, 'rgba(255,255,235,1)');
      sp.addColorStop(0.25, 'rgba(255,211,77,.9)');
      sp.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = sp;
      ell(ctx, sx, sy, r * 0.55, r * 0.55);
      ctx.fill();
    },

    /* The 2013 Mac Pro: a black anodised cylinder with a lit throat. */
    trashcan: function (ctx, S) {
      var cw = S * 0.5, cx = (S - cw) / 2;
      var top = S * 0.2, bot = S * 0.86, ry = cw * 0.24;

      groundShadow(ctx, S / 2, bot + ry * 0.6, cw * 0.8, ry * 0.55);

      /* barrel */
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, bot);
      ctx.ellipse(cx + cw / 2, bot, cw / 2, ry, 0, Math.PI, 0, true);
      ctx.lineTo(cx + cw, top);
      ctx.ellipse(cx + cw / 2, top, cw / 2, ry, 0, 0, Math.PI, true);
      ctx.closePath();
      ctx.clip();
      FACE.trashcan(ctx, S);
      /* vertical falloff — the barrel is lit from above */
      var v = ctx.createLinearGradient(0, top, 0, bot);
      v.addColorStop(0, 'rgba(255,255,255,.1)');
      v.addColorStop(0.35, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.38)');
      ctx.fillStyle = v;
      ctx.fillRect(cx, top, cw, bot - top);
      ctx.restore();

      /* rim highlight along the silhouette */
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = S * 0.007;
      ctx.beginPath();
      ctx.moveTo(cx + ctx.lineWidth / 2, top);
      ctx.lineTo(cx + ctx.lineWidth / 2, bot);
      ctx.stroke();

      /* bottom cap */
      ctx.fillStyle = '#0a0a0e';
      ctx.beginPath();
      ctx.ellipse(cx + cw / 2, bot, cw / 2, ry, 0, 0, Math.PI);
      ctx.fill();

      /* lit throat */
      ctx.fillStyle = '#101015';
      ell(ctx, cx + cw / 2, top, cw / 2, ry);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.lineWidth = S * 0.006;
      ell(ctx, cx + cw / 2, top, cw / 2, ry);
      ctx.stroke();

      var gg = ctx.createRadialGradient(cx + cw / 2, top, 1, cx + cw / 2, top, cw * 0.6);
      gg.addColorStop(0, 'rgba(180,240,255,1)');
      gg.addColorStop(0.4, 'rgba(125,227,255,.7)');
      gg.addColorStop(1, 'rgba(125,227,255,0)');
      ctx.fillStyle = gg;
      ell(ctx, cx + cw / 2, top, cw * 0.46, ry * 0.9);
      ctx.fill();

      /* heat haze rising out of the core */
      var hz = ctx.createLinearGradient(0, top - S * 0.14, 0, top);
      hz.addColorStop(0, 'rgba(125,227,255,0)');
      hz.addColorStop(1, 'rgba(125,227,255,.22)');
      ctx.fillStyle = hz;
      ctx.fillRect(cx, top - S * 0.14, cw, S * 0.14);
    },

    /* The iMac G3, in its own egg silhouette rather than squared off. */
    bondi: function (ctx, S) {
      var cx = S / 2;

      groundShadow(ctx, cx, S * 0.93, S * 0.3, S * 0.045);

      /* shell */
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(S * 0.14, S * 0.34);
      ctx.quadraticCurveTo(S * 0.14, S * 0.08, S * 0.5, S * 0.08);
      ctx.quadraticCurveTo(S * 0.86, S * 0.08, S * 0.86, S * 0.34);
      ctx.quadraticCurveTo(S * 0.86, S * 0.62, S * 0.76, S * 0.7);
      ctx.quadraticCurveTo(S * 0.72, S * 0.78, S * 0.72, S * 0.84);
      ctx.quadraticCurveTo(S * 0.72, S * 0.9, S * 0.5, S * 0.9);
      ctx.quadraticCurveTo(S * 0.28, S * 0.9, S * 0.28, S * 0.84);
      ctx.quadraticCurveTo(S * 0.28, S * 0.78, S * 0.24, S * 0.7);
      ctx.quadraticCurveTo(S * 0.14, S * 0.62, S * 0.14, S * 0.34);
      ctx.closePath();
      ctx.clip();

      var g = ctx.createLinearGradient(S * 0.14, 0, S * 0.86, S);
      g.addColorStop(0, '#9ae9ed');
      g.addColorStop(0.4, '#3fb3c0');
      g.addColorStop(1, '#0f5468');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);

      /* light bouncing around inside the translucent plastic */
      var scat = ctx.createRadialGradient(S * 0.32, S * 0.2, S * 0.02, S * 0.45, S * 0.4, S * 0.6);
      scat.addColorStop(0, 'rgba(255,255,255,.42)');
      scat.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = scat;
      ctx.fillRect(0, 0, S, S);
      ctx.restore();

      /* white bezel */
      ctx.fillStyle = 'rgba(246,253,254,.95)';
      rr(ctx, S * 0.185, S * 0.135, S * 0.63, S * 0.45, S * 0.075);
      ctx.fill();

      /* CRT */
      var sx = S * 0.225, sy = S * 0.175, sw = S * 0.55, sh = S * 0.37;
      ctx.fillStyle = '#1d262b';
      rr(ctx, sx - S * 0.016, sy - S * 0.016, sw + S * 0.032, sh + S * 0.032, S * 0.05);
      ctx.fill();

      ctx.save();
      rr(ctx, sx, sy, sw, sh, S * 0.038);
      ctx.clip();
      var sg = ctx.createLinearGradient(0, sy, 0, sy + sh);
      sg.addColorStop(0, '#a6dcf7');
      sg.addColorStop(1, '#2b6ba4');
      ctx.fillStyle = sg;
      ctx.fillRect(sx, sy, sw, sh);

      var fx = sx + sw / 2, fy = sy + sh * 0.48;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ell(ctx, fx - sw * 0.17, fy - sh * 0.14, sw * 0.055, sh * 0.11); ctx.fill();
      ell(ctx, fx + sw * 0.17, fy - sh * 0.14, sw * 0.055, sh * 0.11); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = S * 0.024;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(fx, fy + sh * 0.02, sw * 0.2, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();

      scanlines(ctx, sx, sy, sw, sh, S * 0.013, 0.07);
      vignette(ctx, sx, sy, sw, sh, 0.38);
      ctx.restore();
      sheen(ctx, sx, sy, sw, sh, S * 0.038, 0.34);

      /* drive slot and the recessed handle well */
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      rr(ctx, S * 0.37, S * 0.63, S * 0.26, S * 0.02, S * 0.01);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      rr(ctx, S * 0.37, S * 0.652, S * 0.26, S * 0.008, S * 0.004);
      ctx.fill();

      /* speaker domes on the foot */
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      [0.38, 0.62].forEach(function (p) {
        ell(ctx, S * p, S * 0.8, S * 0.055, S * 0.04); ctx.fill();
      });

      /* gloss over the whole shell */
      ctx.save();
      ctx.globalAlpha = 0.4;
      var gl = ctx.createLinearGradient(S * 0.2, S * 0.06, S * 0.5, S * 0.5);
      gl.addColorStop(0, 'rgba(255,255,255,.75)');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.moveTo(S * 0.16, S * 0.3);
      ctx.quadraticCurveTo(S * 0.18, S * 0.1, S * 0.5, S * 0.095);
      ctx.quadraticCurveTo(S * 0.34, S * 0.16, S * 0.28, S * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  /* Portraits are painted once, at menu build, so they are supersampled
     rather than drawn at CSS resolution — on a Retina panel a 1:1 canvas
     is upscaled by the compositor and every edge goes soft.  This is the
     difference between a crisp icon and a mushy one, and it costs nothing
     at run time because nothing repaints them. */
  function portraitScale() {
    return Util.limit(window.devicePixelRatio || 1, 2, 3);
  }

  function portrait(m, w, h) {
    var ss = portraitScale();
    var c = C(Math.round(w * ss), Math.round(h * ss));
    var ctx = c.getContext('2d');
    ctx.scale(ss, ss);

    /* The background stays transparent.  `object-fit: contain` letterboxes
       this canvas inside the card, so anything painted corner to corner
       shows up as a hard-edged square sitting on the card — the icon has
       to be the only opaque thing here. */

    /* a soft pool of the mascot's own colour, faded out well inside the
       canvas edge, so the grid reads as eight distinct machines before
       you even get to the artwork */
    var pool = ctx.createRadialGradient(w / 2, h * 0.54, 1, w / 2, h * 0.54, Math.min(w, h) * 0.52);
    pool.addColorStop(0, Util.rgba(m.dot, 0.2));
    pool.addColorStop(0.6, Util.rgba(m.dot, 0.05));
    pool.addColorStop(1, Util.rgba(m.dot, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, w, h);

    var S = Math.min(w, h) * 0.82;
    var ox = (w - S) / 2, oy = (h - S) / 2;

    ctx.save();
    ctx.translate(ox, oy);

    var draw = PORTRAIT[m.id];
    if (draw) {
      draw(ctx, S);
    } else {
      /* FACE already is the head-on view for these — round the corners
         so a hardware front doesn't read as a pasted-on square. */
      groundShadow(ctx, S / 2, S * 0.99, S * 0.46, S * 0.05);
      ctx.save();
      rr(ctx, S * 0.06, 0, S * 0.88, S * 0.94, S * 0.085);
      ctx.clip();
      ctx.translate(S * 0.06, 0);
      ctx.scale(0.88, 0.94);
      FACE[m.id](ctx, S);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = S * 0.008;
      rr(ctx, S * 0.06, 0, S * 0.88, S * 0.94, S * 0.085);
      ctx.stroke();
    }
    ctx.restore();

    /* If there is a file for this mascot, it wins — repaint the canvas
       with it once it arrives.  The painted art above is what the
       player sees until then, and what they keep seeing if there is no
       file at all. */
    loadIcon(m.id, function (img) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);
      drawContained(ctx, img, w, h, 0.02);
    });

    return c;
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
    paint: paint,
    canvas: C,
    roundRect: rr,

    MASCOTS: MASCOTS,
    mascot: mascot,
    /* The head texture in the race.  icons/<id>-face.png overrides it;
       because the canvas is handed straight to a CanvasTexture, the
       swap needs the caller to flag the texture dirty — hence the
       `dirty` hook the kart builder passes in. */
    face: function (m, dirty) {
      var c = paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w) { FACE[m.id](ctx, w); });
      loadIcon(m.id + '-face', function (img) {
        var ctx = c.getContext('2d');
        ctx.clearRect(0, 0, MASCOT_TEX, MASCOT_TEX);
        ctx.drawImage(img, 0, 0, MASCOT_TEX, MASCOT_TEX);
        if (dirty) dirty();
      });
      return c;
    },
    compactSide: compactSide,
    titleBar: titleBar,
    shellPanel: shellPanel,
    printerPanel: printerPanel,
    decal: function (m) { return DECAL[m.id] ? paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w) { DECAL[m.id](ctx, w); }) : null; },
    back: function (m) { return paint(MASCOT_TEX, MASCOT_TEX, function (ctx, w) { backPanel(ctx, w, m.color, Util.mix(m.color, '#000000', 0.45)); }); },
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
