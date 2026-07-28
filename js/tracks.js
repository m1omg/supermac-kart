/* ============================================================
   Tracks — four fixed circuits.

   Each circuit's centreline is an authored harmonic loop:
     r(t) = R * (1 + Σ aᵢ·cos(kᵢ·t + φᵢ))
     y(t) =     Σ hᵢ·sin(kᵢ·t + ψᵢ)
   Those coefficients ARE the level design — same corners, same
   crests, same braking points on every machine, every session.
   Nothing about the layout is randomised at run time.

   Building a track produces a resampled centreline with a full
   frame (tangent / right / up), banking, curvature and arc
   length at every sample.  Everything else in the game — road
   mesh, AI racing line, lap timing, minimap — reads from that.
   ============================================================ */

var Tracks = (function () {

  var UP = new THREE.Vector3(0, 1, 0);

  /* ---------------------------------------------------------
     Visual themes
     --------------------------------------------------------- */

  var THEMES = {

    coast: {
      sky: ['#2f8fd8', '#7ec8f5', '#cfeafc', '#ffe6bf'],
      sunU: 0.72, sunV: 0.34, sunColor: '#fffdf2', sunGlowHex: '#ffdc9b',
      cloud: 'rgba(255,255,255,.85)', cloudSeed: 5, stars: false,
      fog: 0xbfe0f2, fogNear: 260, fogFar: 1500,
      road: '#4d4d55', line: '#f2f2ec', kerbA: '#e64a3c', kerbB: '#f7f7f2',
      grass: '#4f9163', ground: 0x3f7a52,
      mountain: ['#e79a5c', '#c9743f'], mountainHeight: 380, mountainRadius: 2600,
      hemiSky: 0xbfe0ff, hemiGround: 0x5d7a4a, hemiInt: 0.95,
      dir: 0xfff2d0, dirInt: 1.15, dirPos: [900, 700, 400],
      boost: '#ffd34d', night: false
    },

    aqua: {
      sky: ['#0f3f96', '#2f7fd0', '#8fd0f2', '#dff2ff'],
      sunU: 0.28, sunV: 0.28, sunColor: '#ffffff', sunGlowHex: '#bfe8ff',
      cloud: 'rgba(255,255,255,.7)', cloudSeed: 12, stars: false,
      fog: 0x9fd0ee, fogNear: 240, fogFar: 1400,
      road: '#414a56', line: '#dff2ff', kerbA: '#3f8ae0', kerbB: '#ffffff',
      grass: '#2f8f9a', ground: 0x2a808b,
      mountain: ['#4a86c4', '#2f5f96'], mountainHeight: 300, mountainRadius: 2400,
      hemiSky: 0xcfeaff, hemiGround: 0x2f6f7a, hemiInt: 1.0,
      dir: 0xf2fbff, dirInt: 1.1, dirPos: [-700, 800, 500],
      boost: '#7de3ff', night: false
    },

    platinum: {
      sky: ['#8fa2bb', '#c9cdd6', '#e8e8e2', '#f6f2e6'],
      sunU: 0.5, sunV: 0.22, sunColor: '#ffffff', sunGlowHex: '#ffffff',
      cloud: 'rgba(255,255,255,.9)', cloudSeed: 19, stars: false,
      fog: 0xdcdcd6, fogNear: 220, fogFar: 1200,
      road: '#5a5a62', line: '#efece2', kerbA: '#6b6b73', kerbB: '#d8d3c4',
      grass: '#98a08a', ground: 0x8a9280,
      mountain: ['#a8adb8', '#8b909c'], mountainHeight: 260, mountainRadius: 2200,
      hemiSky: 0xe8ecf2, hemiGround: 0x8a8f7d, hemiInt: 1.05,
      dir: 0xffffff, dirInt: 0.95, dirPos: [400, 900, -600],
      boost: '#f4d03f', night: false
    },

    night: {
      sky: ['#04050c', '#0b1024', '#1d2148', '#3a2260'],
      sunU: 0.2, sunV: 0.18, sunColor: '#eef3ff', sunGlowHex: '#7f9bff',
      cloud: 'rgba(120,150,255,.14)', cloudSeed: 27, stars: true,
      fog: 0x080b16, fogNear: 180, fogFar: 1100,
      road: '#282c36', line: '#8ea6d8', kerbA: '#2a3350', kerbB: '#7de3ff',
      grass: '#161c2c', ground: 0x121726,
      mountain: ['#2a2150', '#171233'], mountainHeight: 420, mountainRadius: 2500,
      hemiSky: 0x2a3560, hemiGround: 0x0a0d18, hemiInt: 0.7,
      dir: 0x9fb6ff, dirInt: 0.55, dirPos: [-600, 700, -500],
      boost: '#a8ff5f', night: true
    }
  };

  /* ---------------------------------------------------------
     Circuit definitions
     --------------------------------------------------------- */

  var DEFS = [
    {
      id: 'coast',
      name: 'CUPERTINO COAST',
      subtitle: 'Palm-lined and forgiving. Long straights, open corners — learn the kart here.',
      difficulty: 'ROOKIE',
      laps: 3,
      theme: 'coast',
      radius: 340,
      width: 26,
      shape: [{ k: 1, a: 0.14, p: 0.6 }, { k: 3, a: 0.17, p: 0.2 }, { k: 5, a: 0.05, p: 2.1 }],
      elev:  [{ k: 2, h: 11, p: 0.5 }, { k: 3, h: 6, p: 1.7 }],
      boosts: [0.14, 0.46, 0.77],
      pickupEvery: 190,
      seed: 1984,
      scenery: { palm: 1.0, bush: 0.8, billboard: 0.12, crt: 0.25, cone: 0.3, boulder: 0.2 }
    },

    {
      id: 'aqua',
      name: 'AQUA BAY',
      subtitle: 'Pinstriped seawall run. Quick esses either side of one long blind left.',
      difficulty: 'PRO',
      laps: 3,
      theme: 'aqua',
      radius: 330,
      width: 24,
      shape: [{ k: 2, a: 0.12, p: 0.9 }, { k: 3, a: 0.14, p: 2.4 },
              { k: 5, a: 0.10, p: 1.1 }, { k: 7, a: 0.06, p: 0.3 }],
      elev:  [{ k: 1, h: 16, p: 0.3 }, { k: 4, h: 8, p: 2.2 }],
      boosts: [0.09, 0.35, 0.58, 0.83],
      pickupEvery: 170,
      seed: 2001,
      scenery: { lamp: 0.9, crt: 0.7, billboard: 0.16, bush: 0.5, cone: 0.35, palm: 0.3 }
    },

    {
      id: 'system7',
      name: 'SYSTEM 7 SPEEDWAY',
      subtitle: 'Beige, technical and unforgiving. Six real braking zones per lap.',
      difficulty: 'EXPERT',
      laps: 4,
      theme: 'platinum',
      radius: 270,
      width: 22,
      shape: [{ k: 3, a: 0.13, p: 0.4 }, { k: 4, a: 0.10, p: 1.9 },
              { k: 6, a: 0.09, p: 0.9 }, { k: 8, a: 0.07, p: 2.6 }],
      elev:  [{ k: 2, h: 12, p: 1.2 }, { k: 5, h: 7, p: 0.4 }],
      boosts: [0.08, 0.28, 0.5, 0.71, 0.9],
      pickupEvery: 150,
      seed: 1991,
      scenery: { crt: 1.0, floppy: 0.8, boulder: 0.5, cone: 0.5, billboard: 0.14, bush: 0.3 }
    },

    {
      id: 'silicon',
      name: 'SILICON RIDGE',
      subtitle: 'Midnight fab run. Huge elevation, blind crests, one very long straight.',
      difficulty: 'INSANE',
      laps: 3,
      theme: 'night',
      radius: 390,
      width: 26,
      shape: [{ k: 1, a: 0.24, p: 1.2 }, { k: 2, a: 0.10, p: 0.2 },
              { k: 5, a: 0.11, p: 2.0 }, { k: 7, a: 0.11, p: 1.4 }],
      elev:  [{ k: 1, h: 30, p: 1.9 }, { k: 3, h: 18, p: 0.6 }, { k: 6, h: 8, p: 2.4 }],
      boosts: [0.05, 0.22, 0.42, 0.62, 0.8, 0.93],
      pickupEvery: 140,
      seed: 2024,
      scenery: { server: 1.0, lamp: 0.9, boulder: 0.4, pine: 0.5, billboard: 0.12, cone: 0.3 }
    }
  ];

  /* ---------------------------------------------------------
     Build
     --------------------------------------------------------- */

  function shapeAt(def, t) {
    var r = 1;
    for (var i = 0; i < def.shape.length; i++) {
      r += def.shape[i].a * Math.cos(def.shape[i].k * t + def.shape[i].p);
    }
    var y = 0;
    for (var j = 0; j < def.elev.length; j++) {
      y += def.elev[j].h * Math.sin(def.elev[j].k * t + def.elev[j].p);
    }
    return { r: def.radius * r, y: y };
  }

  function buildCurve(def) {
    var pts = [], N = 120;
    for (var i = 0; i < N; i++) {
      var t = (i / N) * Math.PI * 2;
      var s = shapeAt(def, t);
      pts.push(new THREE.Vector3(Math.cos(t) * s.r, s.y, Math.sin(t) * s.r));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  }

  /* Resample the curve at even arc length and build a frame per sample. */
  function buildSamples(curve, def) {
    var length = curve.getLength();
    var count = Math.max(400, Math.round(length / 2.5));   /* ~2.5 units apart */
    var raw = curve.getSpacedPoints(count);                 /* count+1 points, last == first */
    raw.length = count;

    var samples = new Array(count);
    var ds = length / count;
    var i;

    for (i = 0; i < count; i++) {
      var prev = raw[(i - 1 + count) % count];
      var next = raw[(i + 1) % count];

      var tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      var right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
      var up = new THREE.Vector3().crossVectors(right, tangent).normalize();

      samples[i] = {
        index: i,
        pos: raw[i].clone(),
        tangent: tangent,
        right: right,
        up: up,
        dist: i * ds,
        curvature: 0,
        bank: 0
      };
    }

    /* signed curvature (rad per unit length), smoothed a little */
    for (i = 0; i < count; i++) {
      var a = samples[(i - 2 + count) % count].tangent;
      var b = samples[(i + 2) % count].tangent;
      var cross = new THREE.Vector3().crossVectors(a, b);
      var angle = Math.atan2(cross.length() * Math.sign(cross.y || 1), a.dot(b));
      samples[i].curvature = angle / (4 * ds);
    }
    for (i = 0; i < count; i++) {
      var s0 = samples[(i - 3 + count) % count].curvature;
      var s1 = samples[i].curvature;
      var s2 = samples[(i + 3) % count].curvature;
      samples[i].smoothCurvature = (s0 + 2 * s1 + s2) / 4;
    }

    /* bank into the corner, then roll the frame to match */
    for (i = 0; i < count; i++) {
      var bank = THREE.MathUtils.clamp(samples[i].smoothCurvature * 42, -0.16, 0.16);
      samples[i].bank = bank;
      var q = new THREE.Quaternion().setFromAxisAngle(samples[i].tangent, bank);
      samples[i].right.applyQuaternion(q).normalize();
      samples[i].up.applyQuaternion(q).normalize();
    }

    return { samples: samples, count: count, ds: ds, length: length };
  }

  /* ---------------------------------------------------------
     Track object
     --------------------------------------------------------- */

  function Track(def) {
    this.id = def.id;
    this.name = def.name;
    this.subtitle = def.subtitle;
    this.difficulty = def.difficulty;
    this.laps = def.laps;
    this.def = def;
    this.theme = THEMES[def.theme];
    this.halfWidth = def.width / 2;
    this.kerbWidth = 2.6;
    /* Runoff past the kerb before the invisible barrier. Physics and the
       scenery placement both read this, so nothing solid is ever put
       somewhere a kart is allowed to reach. */
    this.runoff = 9;

    this.curve = buildCurve(def);
    var s = buildSamples(this.curve, def);
    this.samples = s.samples;
    this.count = s.count;
    this.ds = s.ds;
    this.length = s.length;

    /* vertical extent, used to place the ground plane and mountains */
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < this.count; i++) {
      minY = Math.min(minY, this.samples[i].pos.y);
      maxY = Math.max(maxY, this.samples[i].pos.y);
    }
    this.minY = minY;
    this.maxY = maxY;
    this.baseY = minY - 14;          /* the surrounding terrain plane */

    this.boosts = def.boosts.map(function (f) {
      return { index: Math.floor(f * s.count) % s.count, length: 16 };
    });

    /* nitro pickups: rows of three, evenly spaced round the lap */
    this.pickups = [];
    var step = Math.max(20, Math.round(def.pickupEvery / this.ds));
    for (var p = step; p < this.count - 8; p += step) {
      [-0.45, 0, 0.45].forEach(function (lane, k) {
        this.pickups.push({ index: (p + k * 2) % this.count, lane: lane, taken: 0 });
      }, this);
    }

    this.minimap = this.buildMinimapPath();
  }

  /* nearest centreline sample, searching outward from a hint */
  Track.prototype.nearest = function (pos, hint, window) {
    var count = this.count;
    var w = window || 40;
    var best = hint, bestD = Infinity;
    for (var d = -w; d <= w; d++) {
      var i = (hint + d + count * 2) % count;
      var dx = pos.x - this.samples[i].pos.x;
      var dz = pos.z - this.samples[i].pos.z;
      var dist = dx * dx + dz * dz;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  };

  Track.prototype.nearestGlobal = function (pos) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < this.count; i++) {
      var dx = pos.x - this.samples[i].pos.x;
      var dz = pos.z - this.samples[i].pos.z;
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  /* Where is `pos` relative to the ribbon?
     -> { index, offset (right of centre), along (progress 0..1), surfaceY } */
  Track.prototype.locate = function (pos, hint) {
    var i = (hint === undefined || hint === null)
      ? this.nearestGlobal(pos)
      : this.nearest(pos, hint);

    var s = this.samples[i];
    var dx = pos.x - s.pos.x, dy = pos.y - s.pos.y, dz = pos.z - s.pos.z;

    var along = dx * s.tangent.x + dz * s.tangent.z;
    var offset = dx * s.right.x + dz * s.right.z;

    var u = (s.dist + along) / this.length;
    u = u - Math.floor(u);

    return { index: i, sample: s, offset: offset, along: along, u: u };
  };

  /* Height of the driving surface at a point, including banking. */
  Track.prototype.surfaceY = function (loc) {
    var s = loc.sample;
    var next = this.samples[(loc.index + 1) % this.count];
    var t = THREE.MathUtils.clamp(loc.along / this.ds, -1, 1);
    var baseY = s.pos.y + (next.pos.y - s.pos.y) * t;
    /* the frame is already rolled into the corner, so the banked
       surface height across the width falls straight out of it */
    return baseY + loc.offset * s.right.y;
  };

  /* ---------------------------------------------------------
     Ground height off the racing surface.

     THE definition of where the verge sits, shared by the mesh
     builder in world.js, by prop placement, and by kart ride
     height.  When these disagree the karts float above (or sink
     into) the terrain you can actually see, so there is exactly
     one copy of it and everyone calls this.
     --------------------------------------------------------- */

  var VERGE = [
    { d: 0,   lift: -0.12, flat: 0    },   /* d = distance out from the kerb edge */
    { d: 26,  lift: -2.2,  flat: 0.35 },
    { d: 120, lift: -6,    flat: 0.92 }
  ];

  Track.prototype.vergeY = function (sample, offset) {
    var edge = this.halfWidth + this.kerbWidth;
    var a = Math.abs(offset);
    if (a <= edge) return sample.pos.y + offset * sample.right.y;

    var sign = offset > 0 ? 1 : -1;
    var d = a - edge;
    var baseY = this.baseY;

    function at(cp) {
      var y = sample.pos.y + sample.right.y * (sign * (edge + cp.d)) + sample.up.y * cp.lift;
      return y * (1 - cp.flat) + baseY * cp.flat;
    }

    for (var i = 0; i < VERGE.length - 1; i++) {
      if (d <= VERGE[i + 1].d) {
        var t = (d - VERGE[i].d) / (VERGE[i + 1].d - VERGE[i].d);
        return at(VERGE[i]) * (1 - t) + at(VERGE[i + 1]) * t;
      }
    }
    return at(VERGE[VERGE.length - 1]);
  };

  /* interpolated frame at progress u (0..1) */
  Track.prototype.frameAt = function (u) {
    u = u - Math.floor(u);
    var f = u * this.count;
    var i = Math.floor(f) % this.count;
    return this.samples[i];
  };

  Track.prototype.sampleAhead = function (index, steps) {
    return this.samples[(index + steps + this.count * 2) % this.count];
  };

  /* Normalised 2-D outline for the HUD minimap. */
  Track.prototype.buildMinimapPath = function () {
    var pts = [], stride = Math.max(1, Math.floor(this.count / 260));
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < this.count; i += stride) {
      var p = this.samples[i].pos;
      pts.push([p.x, p.z]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    var w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxZ - minZ);
    var scale = 1 / Math.max(w, h);
    var offX = (1 - w * scale) / 2, offZ = (1 - h * scale) / 2;

    var norm = pts.map(function (p) {
      return [(p[0] - minX) * scale + offX, (p[1] - minZ) * scale + offZ];
    });
    norm.bounds = { minX: minX, minZ: minZ, scale: scale, offX: offX, offZ: offZ };
    return norm;
  };

  /* world XZ -> minimap 0..1 (same transform as the outline) */
  Track.prototype.toMinimap = function (pos) {
    var b = this.minimap.bounds;
    return [
      (pos.x - b.minX) * b.scale + b.offX,
      (pos.z - b.minZ) * b.scale + b.offZ
    ];
  };

  /* ---------------------------------------------------------
     API
     --------------------------------------------------------- */

  var cache = {};

  function get(id) {
    if (cache[id]) return cache[id];
    var def = null;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) def = DEFS[i];
    if (!def) throw new Error('Unknown track: ' + id);
    cache[id] = new Track(def);
    return cache[id];
  }

  function list() {
    return DEFS.map(function (d) {
      return {
        id: d.id, name: d.name, subtitle: d.subtitle,
        difficulty: d.difficulty, laps: d.laps, theme: d.theme
      };
    });
  }

  /* Cheap 2-D preview of a layout for the track picker, without
     paying to build the whole track. */
  function previewPath(id, samples) {
    var def = null;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) def = DEFS[i];
    var n = samples || 200, pts = [];
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var j = 0; j < n; j++) {
      var t = (j / n) * Math.PI * 2;
      var s = shapeAt(def, t);
      var x = Math.cos(t) * s.r, z = Math.sin(t) * s.r;
      pts.push([x, z]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    var w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxZ - minZ);
    var scale = 1 / Math.max(w, h);
    var offX = (1 - w * scale) / 2, offZ = (1 - h * scale) / 2;
    return pts.map(function (p) {
      return [(p[0] - minX) * scale + offX, (p[1] - minZ) * scale + offZ];
    });
  }

  return {
    THEMES: THEMES,
    get: get,
    list: list,
    previewPath: previewPath
  };
})();
