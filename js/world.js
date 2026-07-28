/* ============================================================
   World — turns a Track into a three.js scene: the road ribbon,
   kerbs, verges, terrain, sky dome, backdrop mountains, all the
   roadside props (instanced), boost strips, nitro pickups and
   the start/finish furniture.
   ============================================================ */

var World = (function () {

  var UP = new THREE.Vector3(0, 1, 0);

  /* ==========================================================
     Ribbon builder — used for the road, the kerbs, the verges
     and the boost strips.  Walks track samples and emits a
     two-edge strip in the sample's own banked frame.
     ========================================================== */

  function ribbon(track, o) {
    var count   = (o.count === undefined) ? track.count : o.count;
    var from    = o.from || 0;
    var closed  = (o.count === undefined);
    var rings   = count + 1;

    var pos = new Float32Array(rings * 2 * 3);
    var uv  = new Float32Array(rings * 2 * 2);
    var idx = [];

    var rnd = Util.rng(o.seed || 1);
    var vPer = o.vPerUnit || 0.05;

    /* Emit edge 0 at the smaller offset and edge 1 at the larger one.
       Callers may pass them either way round (a kerb on the left side
       runs from -hw out to -hw-kw), and the triangle winding below only
       gives upward-facing normals when the two edges are in a known
       order.  Swapping here — rather than at each call site — is what
       keeps every ribbon's front face pointing at the sky. */
    var lo = o.inner, hi = o.outer;
    var loLift = (o.innerLift || 0);
    var hiLift = (o.outerLift === undefined ? (o.innerLift || 0) : o.outerLift);
    var loFlat = (o.innerFlatten || 0), hiFlat = (o.outerFlatten || 0);
    var flipU = false;

    if (lo > hi) {
      var t0 = lo; lo = hi; hi = t0;
      t0 = loLift; loLift = hiLift; hiLift = t0;
      t0 = loFlat; loFlat = hiFlat; hiFlat = t0;
      flipU = true;
    }

    for (var i = 0; i < rings; i++) {
      var si = (from + i) % track.count;
      var s = track.samples[si];
      var v = (i * track.ds) * vPer;

      for (var e = 0; e < 2; e++) {
        var off  = e === 0 ? lo : hi;
        var lift = e === 0 ? loLift : hiLift;

        var x = s.pos.x + s.right.x * off + s.up.x * lift;
        var y = s.pos.y + s.right.y * off + s.up.y * lift;
        var z = s.pos.z + s.right.z * off + s.up.z * lift;

        /* verges settle toward the surrounding terrain instead of
           cantilevering out into space on the hilly circuits */
        var flat = e === 0 ? loFlat : hiFlat;
        if (flat > 0) {
          var bumpy = o.baseY + (rnd() - 0.5) * (o.noise || 0);
          y = y * (1 - flat) + bumpy * flat;
        }

        var k = (i * 2 + e) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;

        var t = (i * 2 + e) * 2;
        /* uPerUnit lays the texture out in world units across the strip
           rather than stretching one tile edge-to-edge — without it a
           120-unit-wide verge shows a single smeared tile. */
        uv[t] = o.uPerUnit
          ? (off - lo) * o.uPerUnit
          : (flipU ? (1 - e) : e);
        uv[t + 1] = v;
      }

      if (i < rings - 1) {
        var a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        /* CCW seen from above -> normals point up */
        idx.push(a, b, c, b, d, c);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    if (closed) geo.userData.closed = true;
    return geo;
  }

  /* ==========================================================
     Backdrop: sky dome + jagged mountain curtains
     ========================================================== */

  function buildSky(theme) {
    var tex = Art.texture(Art.sky(theme), 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    var geo = new THREE.SphereGeometry(7000, 32, 20);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, fog: false, depthWrite: false
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -100;
    return mesh;
  }

  function buildMountains(theme, baseY, seed) {
    var group = new THREE.Group();
    var layers = [
      { r: theme.mountainRadius * 1.35, h: theme.mountainHeight * 1.25, color: theme.mountain[1], cols: 140, sharp: 1.0 },
      { r: theme.mountainRadius,        h: theme.mountainHeight,        color: theme.mountain[0], cols: 110, sharp: 1.4 }
    ];

    layers.forEach(function (L, li) {
      var rnd = Util.rng(seed + li * 977);
      var verts = [], colors = [], idx = [];
      var top = new THREE.Color(L.color);
      var bottom = new THREE.Color(L.color).multiplyScalar(0.55);

      for (var j = 0; j <= L.cols; j++) {
        var a = (j / L.cols) * Math.PI * 2;
        /* deterministic jagged skyline */
        var n = 0.45
          + 0.30 * Math.abs(Math.sin(a * 3.1 + li * 2.0))
          + 0.25 * Math.abs(Math.sin(a * 7.7 + li * 1.3))
          + 0.18 * (rnd() - 0.5);
        var h = L.h * Math.pow(Math.max(0.08, n), L.sharp);

        var x = Math.cos(a) * L.r, z = Math.sin(a) * L.r;
        verts.push(x, baseY - 120, z);
        colors.push(bottom.r, bottom.g, bottom.b);
        verts.push(x, baseY + h, z);
        colors.push(top.r, top.g, top.b);

        if (j < L.cols) {
          var b0 = j * 2, t0 = j * 2 + 1, b1 = (j + 1) * 2, t1 = (j + 1) * 2 + 1;
          idx.push(b0, b1, t0, t0, b1, t1);
        }
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(idx);

      var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: true
      }));
      mesh.renderOrder = -90;
      group.add(mesh);
    });

    return group;
  }

  /* ==========================================================
     Roadside props
     ========================================================== */

  function propLibrary(theme) {
    var lib = {};

    var barkMat  = new THREE.MeshLambertMaterial({ color: 0x6b5233 });
    var leafMat  = new THREE.MeshLambertMaterial({ color: theme.night ? 0x1f4d3a : 0x2f7d3a });
    var leafMat2 = new THREE.MeshLambertMaterial({ color: theme.night ? 0x18402f : 0x3f9b4a });
    var rockMat  = new THREE.MeshLambertMaterial({
      map: Art.loadSurface('rock', Art.paint(8, 8, function (c) {
        c.fillStyle = theme.night ? '#3a3d4a' : '#8c8477'; c.fillRect(0, 0, 8, 8);
      }), 1, 1), flatShading: true });
    var plasticW = new THREE.MeshLambertMaterial({ color: 0xf2f2ec });
    var metalMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    var darkMat  = new THREE.MeshLambertMaterial({ color: 0x24262c });

    /* palm: bare trunk, umbrella of fronds */
    lib.palm = { parts: [
      { geo: new THREE.CylinderGeometry(0.45, 0.85, 13, 7), mat: barkMat, pos: [0, 6.5, 0] },
      { geo: new THREE.ConeGeometry(6.2, 3.4, 7), mat: leafMat, pos: [0, 12.2, 0], rot: [Math.PI, 0, 0] },
      { geo: new THREE.ConeGeometry(4.2, 2.2, 7), mat: leafMat2, pos: [0, 13.4, 0], rot: [Math.PI, 0.4, 0] }
    ], radius: 1.4 };

    lib.pine = { parts: [
      { geo: new THREE.CylinderGeometry(0.5, 0.7, 4, 6), mat: barkMat, pos: [0, 2, 0] },
      { geo: new THREE.ConeGeometry(3.6, 7, 8), mat: leafMat, pos: [0, 6.5, 0] },
      { geo: new THREE.ConeGeometry(2.6, 5, 8), mat: leafMat2, pos: [0, 10, 0] }
    ], radius: 1.6 };

    lib.bush = { parts: [
      { geo: new THREE.SphereGeometry(2.2, 8, 6), mat: leafMat, pos: [0, 1.4, 0], scale: [1.3, 0.8, 1.3] },
      { geo: new THREE.SphereGeometry(1.5, 8, 6), mat: leafMat2, pos: [1.6, 1.1, 0.6], scale: [1.1, 0.8, 1.1] }
    ], radius: 2.2 };

    lib.boulder = { parts: [
      { geo: new THREE.IcosahedronGeometry(2.6, 0), mat: rockMat, pos: [0, 1.6, 0], scale: [1.3, 0.9, 1.1] }
    ], radius: 2.6 };

    lib.cone = { parts: [
      { geo: new THREE.ConeGeometry(0.75, 2.1, 10), mat: new THREE.MeshLambertMaterial({ color: 0xe8551f }), pos: [0, 1.05, 0] },
      { geo: new THREE.CylinderGeometry(0.55, 0.62, 0.4, 10), mat: plasticW, pos: [0, 1.15, 0] },
      { geo: new THREE.BoxGeometry(1.7, 0.16, 1.7), mat: new THREE.MeshLambertMaterial({ color: 0xc2410c }), pos: [0, 0.08, 0] }
    ], radius: 0.9 };

    /* a CRT display on a stand, screen lit */
    var screenTex = Art.texture(Art.screenGlow('#5fc8ff'), 1, 1);
    lib.crt = { parts: [
      { geo: new THREE.BoxGeometry(4.4, 3.8, 3.4), mat: new THREE.MeshLambertMaterial({
          map: Art.loadSurface('beige_plastic', Art.paint(8, 8, function (c) {
            c.fillStyle = '#d7d3c8'; c.fillRect(0, 0, 8, 8);
          }), 1, 1) }), pos: [0, 4.6, 0] },
      { geo: new THREE.BoxGeometry(1.2, 2.8, 1.2), mat: metalMat, pos: [0, 1.4, 0] },
      { geo: new THREE.BoxGeometry(3.4, 2.6, 0.2), mat: new THREE.MeshBasicMaterial({ map: screenTex }), pos: [0, 4.7, 1.75] }
    ], radius: 2.4 };

    lib.floppy = { parts: [
      { geo: new THREE.BoxGeometry(5, 5, 0.6), mat: new THREE.MeshLambertMaterial({ color: 0x2f3a4a }), pos: [0, 3.4, 0] },
      { geo: new THREE.BoxGeometry(2.2, 1.4, 0.7), mat: new THREE.MeshLambertMaterial({ color: 0xc8ccd4 }), pos: [0, 5.2, 0] },
      { geo: new THREE.BoxGeometry(3.6, 2.2, 0.7), mat: plasticW, pos: [0, 2.8, 0] },
      { geo: new THREE.CylinderGeometry(0.25, 0.25, 2, 6), mat: metalMat, pos: [0, 0.9, 0] }
    ], radius: 2.6 };

    /* server rack for the night circuit */
    var rackTex = Art.texture(Art.screenGlow('#5fe3a0'), 1, 3);
    lib.server = { parts: [
      { geo: new THREE.BoxGeometry(4, 11, 3), mat: new THREE.MeshLambertMaterial({ color: 0x2a2f38 }), pos: [0, 5.5, 0] },
      { geo: new THREE.BoxGeometry(3.2, 9, 0.2), mat: new THREE.MeshBasicMaterial({ map: rackTex }), pos: [0, 5.6, 1.6] }
    ], radius: 2.4 };

    var lampGlow = new THREE.MeshBasicMaterial({ color: theme.night ? 0xffe9a8 : 0xfff6d8 });
    lib.lamp = { parts: [
      { geo: new THREE.CylinderGeometry(0.3, 0.42, 14, 8), mat: metalMat, pos: [0, 7, 0] },
      { geo: new THREE.BoxGeometry(3.2, 0.5, 1.2), mat: metalMat, pos: [1.4, 13.9, 0] },
      { geo: new THREE.SphereGeometry(0.8, 8, 6), mat: lampGlow, pos: [2.4, 13.5, 0], scale: [1.4, 0.6, 1] }
    ], radius: 0.9 };

    /* rainbow billboard */
    var panelTex = Art.texture(Art.billboardPanel(), 1, 1);
    panelTex.wrapS = panelTex.wrapT = THREE.ClampToEdgeWrapping;
    lib.billboard = { parts: [
      { geo: new THREE.BoxGeometry(0.8, 9, 0.8), mat: darkMat, pos: [-4, 4.5, 0] },
      { geo: new THREE.BoxGeometry(0.8, 9, 0.8), mat: darkMat, pos: [4, 4.5, 0] },
      { geo: new THREE.BoxGeometry(16, 12, 0.6), mat: darkMat, pos: [0, 13, 0] },
      { geo: new THREE.PlaneGeometry(15, 11), mat: new THREE.MeshBasicMaterial({ map: panelTex, side: THREE.DoubleSide }), pos: [0, 13, 0.4] }
    ], radius: 4 };

    return lib;
  }

  /* ==========================================================
     Build the whole scene
     ========================================================== */

  function build(track, opts) {
    opts = opts || {};
    var theme = track.theme;
    var scene = new THREE.Scene();
    var baseY = track.baseY;

    scene.background = new THREE.Color(theme.fog);
    scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);

    /* ---------- lights ---------- */
    var hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiInt);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(theme.dir, theme.dirInt);
    sun.position.set(theme.dirPos[0], theme.dirPos[1], theme.dirPos[2]);
    scene.add(sun);
    if (theme.night) {
      scene.add(new THREE.AmbientLight(0x3a4a7a, 0.35));
    }

    /* ---------- backdrop ---------- */
    scene.add(buildSky(theme));
    scene.add(buildMountains(theme, baseY, track.def.seed));

    /* ---------- ground ---------- */
    var groundTex = Art.loadSurface(theme.night ? 'dark_metal' : 'grass',
                                    Art.grass(theme), 9000 / 7, 9000 / 7);
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshLambertMaterial({ map: groundTex, color: 0xffffff })
    );
    ground.name = 'ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = baseY - 1;
    scene.add(ground);

    /* ---------- verges (grass shoulders that hug the road) ---------- */
    var hw = track.halfWidth, kw = track.kerbWidth;
    var BARRIER = track.runoff;
    var GRASS_TILE = 7;          /* world units per texture tile */
    var vergeTex = Art.loadSurface(theme.night ? 'dark_metal' : 'grass',
                                   Art.grass(theme), 1, 1);
    var vergeMat = new THREE.MeshLambertMaterial({ map: vergeTex });

    [1, -1].forEach(function (side) {
      var near = ribbon(track, {
        inner: side * (hw + kw), outer: side * (hw + kw + 26),
        innerLift: -0.12, outerLift: -2.2,
        outerFlatten: 0.35, baseY: baseY, noise: 1.2,
        uPerUnit: 1 / GRASS_TILE, vPerUnit: 1 / GRASS_TILE, seed: 31 + side
      });
      var nearMesh = new THREE.Mesh(near, vergeMat);
      nearMesh.name = 'verge-near-' + side;
      scene.add(nearMesh);

      var far = ribbon(track, {
        inner: side * (hw + kw + 26), outer: side * (hw + kw + 120),
        innerLift: -2.2, outerLift: -6,
        innerFlatten: 0.35, outerFlatten: 0.92, baseY: baseY, noise: 6,
        uPerUnit: 1 / GRASS_TILE, vPerUnit: 1 / GRASS_TILE, seed: 57 + side
      });
      var farMesh = new THREE.Mesh(far, vergeMat);
      farMesh.name = 'verge-far-' + side;
      scene.add(farMesh);
    });

    /* ---------- kerbs ---------- */
    var kerbTex = Art.texture(Art.kerb(theme), 1, 1);
    kerbTex.repeat.set(1, 1);
    var kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex });
    [1, -1].forEach(function (side) {
      var geo = ribbon(track, {
        inner: side * hw, outer: side * (hw + kw),
        innerLift: 0.06, outerLift: 0.02,
        vPerUnit: 0.16, seed: 77
      });
      var kerbMesh = new THREE.Mesh(geo, kerbMat);
      kerbMesh.name = 'kerb-' + side;
      scene.add(kerbMesh);
    });

    /* ---------- road ---------- */
    /* Surface grain comes from the photographic map, tiled freely in
       both directions; the lane markings ride on a second ribbon whose
       u spans the road width exactly, so they stay crisp and correctly
       placed no matter how the grain repeats. */
    var grainFallback = Art.paint(64, 64, function (c, cw, ch) {
      c.fillStyle = theme.road;
      c.fillRect(0, 0, cw, ch);
    });
    /* The road ribbon's v already advances 1 per 16 world units and its u
       spans the full width as 0..1, so the repeat only has to convert
       those into ~9-unit asphalt tiles. */
    var ASPHALT_TILE = 9;
    var grainTex = Art.loadSurface('asphalt', grainFallback,
                                   (hw * 2) / ASPHALT_TILE, 16 / ASPHALT_TILE);
    var roadMat = new THREE.MeshLambertMaterial({ map: grainTex });

    var roadGeo = ribbon(track, {
      inner: -hw, outer: hw, innerLift: 0, outerLift: 0,
      vPerUnit: 1 / 16, seed: 3
    });
    var road = new THREE.Mesh(roadGeo, roadMat);
    road.name = 'road';
    road.renderOrder = 1;
    scene.add(road);

    var markTex = Art.texture(Art.roadMarkings(theme), 1, 1);
    markTex.wrapS = THREE.ClampToEdgeWrapping;
    var markGeo = ribbon(track, {
      inner: -hw, outer: hw, innerLift: 0.012, outerLift: 0.012,
      vPerUnit: 1 / 16, seed: 3
    });
    var markings = new THREE.Mesh(markGeo, new THREE.MeshLambertMaterial({
      map: markTex, transparent: true, depthWrite: false
    }));
    markings.name = 'markings';
    markings.renderOrder = 2;
    scene.add(markings);

    /* ---------- boost strips ---------- */
    var boostTex = Art.texture(Art.chevron(theme.boost), 1, 3);
    var boostMat = new THREE.MeshBasicMaterial({
      map: boostTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var boostPads = [];
    track.boosts.forEach(function (b) {
      var geo = ribbon(track, {
        from: b.index, count: b.length,
        inner: -hw * 0.78, outer: hw * 0.78,
        innerLift: 0.07, outerLift: 0.07,
        vPerUnit: 1 / 18, seed: 5
      });
      var mesh = new THREE.Mesh(geo, boostMat);
      mesh.renderOrder = 3;
      scene.add(mesh);
      boostPads.push({ index: b.index, length: b.length, mesh: mesh });
    });

    /* ---------- start / finish line ---------- */
    var checkTex = Art.texture(Art.checkerBand(), 1, 1);
    checkTex.wrapS = checkTex.wrapT = THREE.ClampToEdgeWrapping;
    var lineGeo = ribbon(track, {
      from: track.count - 2, count: 3,
      inner: -hw, outer: hw, innerLift: 0.05, outerLift: 0.05,
      vPerUnit: 1 / (3 * track.ds), seed: 9
    });
    var startLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ map: checkTex }));
    startLine.renderOrder = 4;
    scene.add(startLine);

    /* gantry over the line */
    var s0 = track.samples[0];
    var gantry = new THREE.Group();
    var pillarMat = new THREE.MeshLambertMaterial({ color: 0x20242c });
    [-1, 1].forEach(function (side) {
      var p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13, 1.6), pillarMat);
      p.position.copy(s0.pos).addScaledVector(s0.right, side * (hw + 3.2));
      p.position.y += 6.5;
      gantry.add(p);
    });
    var bannerTex = Art.texture(Art.bannerPanel(track.name), 1, 1);
    bannerTex.wrapS = bannerTex.wrapT = THREE.ClampToEdgeWrapping;
    var banner = new THREE.Mesh(
      new THREE.PlaneGeometry((hw + 3.2) * 2, 5),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
    );
    banner.position.copy(s0.pos);
    banner.position.y += 12;
    banner.lookAt(banner.position.clone().addScaledVector(s0.tangent, -1));
    gantry.add(banner);
    scene.add(gantry);

    /* Grandstands flanking the line.  They live *outside* the barrier
       (which sits at hw + kw + BARRIER) so a kart can never reach them,
       and their seating is raked toward the track. */
    var crowdTex = Art.texture(Art.crowd(), 3, 1);
    var frameMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
    var roofMat = new THREE.MeshLambertMaterial({ color: 0x2f3540 });
    var seatMat = new THREE.MeshLambertMaterial({ map: crowdTex });
    var standOffset = hw + kw + BARRIER + 12;

    [-1, 1].forEach(function (side) {
      for (var g = 0; g < 2; g++) {
        var si = (track.count - 30 + g * 34) % track.count;
        var s = track.samples[si];

        var stand = new THREE.Group();
        stand.name = 'grandstand';

        /* substructure */
        var base = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 13), frameMat);
        base.position.set(0, 1.5, 0);
        stand.add(base);

        /* raked rows of spectators, stepping up and back */
        for (var row = 0; row < 4; row++) {
          var tier = new THREE.Mesh(new THREE.BoxGeometry(33, 1.9, 2.6), seatMat);
          tier.position.set(0, 3.2 + row * 1.75, 4.2 - row * 2.5);
          stand.add(tier);
        }

        /* roof on rear posts */
        var roof = new THREE.Mesh(new THREE.BoxGeometry(35, 0.5, 14), roofMat);
        roof.position.set(0, 11.4, -1.5);
        stand.add(roof);
        [-15, 15].forEach(function (px) {
          var post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), frameMat);
          post.position.set(px, 7.2, -6.5);
          stand.add(post);
        });

        /* sit it flat on the terrain, facing the racing line */
        var p = s.pos.clone().addScaledVector(s.right, side * standOffset);
        var gy = track.vergeY(s, side * standOffset);
        stand.position.set(p.x, gy, p.z);
        stand.lookAt(s.pos.x, gy, s.pos.z);
        scene.add(stand);
      }
    });

    /* ---------- scenery (instanced) ---------- */
    var lib = propLibrary(theme);
    var placements = {};
    Object.keys(lib).forEach(function (k) { placements[k] = []; });

    var weights = [];
    Object.keys(track.def.scenery).forEach(function (name) {
      if (lib[name]) weights.push({ name: name, w: track.def.scenery[name] });
    });
    var totalW = weights.reduce(function (a, b) { return a + b.w; }, 0);

    var rnd = Util.rng(track.def.seed);
    var density = opts.density === undefined ? 1 : opts.density;
    var gap = Math.max(3, Math.round(9 / density));

    for (var i = 0; i < track.count; i += gap) {
      var s = track.samples[i];
      var lanes = rnd() < 0.75 ? 1 : 2;
      for (var n = 0; n < lanes; n++) {
        var side = rnd() < 0.5 ? -1 : 1;
        var pick = rnd() * totalW, acc = 0, name = weights[0].name;
        for (var w = 0; w < weights.length; w++) {
          acc += weights[w].w;
          if (pick <= acc) { name = weights[w].name; break; }
        }

        /* Everything solid goes beyond the barrier, so a kart can never
           end up wedged inside a palm tree.  Cones are the exception:
           they line the kerb by design and are driven straight through. */
        var off = side * (hw + kw + BARRIER + 5 + rnd() * 44);
        if (name === 'cone') off = side * (hw + kw + 1.2 + rnd() * 1.5);

        var p = new THREE.Vector3()
          .copy(s.pos)
          .addScaledVector(s.right, off);
        p.y = track.vergeY(s, off);

        /* flat-faced props are turned to face the racing line */
        var yaw;
        if (name === 'billboard' || name === 'crt' || name === 'server' || name === 'floppy') {
          yaw = Math.atan2(-s.right.x * side, -s.right.z * side);
        } else {
          yaw = rnd() * Math.PI * 2;
        }

        placements[name].push({
          pos: p,
          yaw: yaw,
          scale: 0.82 + rnd() * 0.5
        });
      }
    }

    var dummy = new THREE.Object3D();
    var partMat = new THREE.Matrix4();
    var baseMat = new THREE.Matrix4();

    Object.keys(lib).forEach(function (name) {
      var list = placements[name];
      if (!list || !list.length) return;

      lib[name].parts.forEach(function (part) {
        var mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        mesh.frustumCulled = true;

        var lp = new THREE.Object3D();
        lp.position.set.apply(lp.position, part.pos || [0, 0, 0]);
        if (part.rot) lp.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
        if (part.scale) lp.scale.set(part.scale[0], part.scale[1], part.scale[2]);
        lp.updateMatrix();
        partMat.copy(lp.matrix);

        list.forEach(function (pl, k) {
          dummy.position.copy(pl.pos);
          dummy.rotation.set(0, pl.yaw, 0);
          dummy.scale.setScalar(pl.scale);
          dummy.updateMatrix();
          baseMat.multiplyMatrices(dummy.matrix, partMat);
          mesh.setMatrixAt(k, baseMat);
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      });
    });

    /* ---------- nitro pickups ---------- */
    var chipTex = Art.texture(Art.ramChip(), 1, 1);
    chipTex.wrapS = chipTex.wrapT = THREE.ClampToEdgeWrapping;
    var chipMat = new THREE.MeshBasicMaterial({ map: chipTex });
    var chipGeo = new THREE.BoxGeometry(3.4, 1.7, 0.5);
    var glowTex = Art.texture(Art.radial('rgba(125,227,255,.55)'), 1, 1);
    glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;

    var pickups = [];
    track.pickups.forEach(function (p) {
      var s = track.samples[p.index];
      var group = new THREE.Group();
      var pos = new THREE.Vector3().copy(s.pos)
        .addScaledVector(s.right, p.lane * hw)
        .addScaledVector(s.up, 1.9);
      group.position.copy(pos);

      var chip = new THREE.Mesh(chipGeo, chipMat);
      group.add(chip);

      var glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      glow.scale.set(8, 8, 1);
      group.add(glow);

      scene.add(group);
      pickups.push({ group: group, pos: pos, index: p.index, taken: 0, lane: p.lane });
    });

    /* ---------- assembled world ---------- */
    var world = {
      scene: scene,
      track: track,
      theme: theme,
      pickups: pickups,
      boostPads: boostPads,
      baseY: baseY,
      sunLight: sun,

      update: function (dt, time) {
        for (var i = 0; i < pickups.length; i++) {
          var p = pickups[i];
          p.group.rotation.y += dt * 2.2;
          if (p.taken > 0) {
            p.taken = Math.max(0, p.taken - dt);
            p.group.visible = false;
          } else {
            p.group.visible = true;
            p.group.position.y = p.pos.y + Math.sin(time * 3 + i) * 0.35;
          }
        }
        boostTex.offset.y = -time * 1.6;
      },

      /* is this segment index inside a boost strip? */
      boostAt: function (index) {
        for (var i = 0; i < boostPads.length; i++) {
          var b = boostPads[i];
          var d = (index - b.index + track.count) % track.count;
          if (d >= 0 && d < b.length) return true;
        }
        return false;
      }
    };

    return world;
  }

  return { build: build, ribbon: ribbon };
})();
