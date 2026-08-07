/* ============================================================
   Kart — chassis mesh, arcade driving model and the AI driver.

   The driving model is deliberately arcade: a scalar speed along
   a heading, plus a velocity heading that chases the chassis
   heading at a "grip" rate.  Letting the two diverge is what a
   drift *is*.  Every rate is expressed per second and integrated
   at a fixed 120 Hz step, so behaviour is identical on a 60 Hz
   laptop panel and a 240 Hz gaming monitor.
   ============================================================ */

var Karts = (function () {

  var TAU = Math.PI * 2;

  /* scratch objects — reused every frame so driving allocates nothing */
  var _fwd = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var _mat = new THREE.Matrix4();
  var _quat = new THREE.Quaternion();
  var _quat2 = new THREE.Quaternion();
  var _euler = new THREE.Euler();
  var _vec = new THREE.Vector3();

  /* ==========================================================
     Texture cache.

     Karts are built eight at a time and most of their maps are
     identical — the flame, the blob shadow, the smoke puff, and
     everything keyed only on the mascot.  Building them per kart
     meant dozens of redundant 256px canvases and, worse, dozens of
     separate GPU uploads and materials.  Everything goes through
     here so each distinct map exists exactly once.
     ========================================================== */

  var texCache = {};

  function cachedTex(key, make, rx, ry) {
    if (!texCache[key]) {
      var t = Art.texture(make(), rx || 1, ry || 1);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      texCache[key] = t;
    }
    return texCache[key];
  }

  /* Photographic surface map, flat mid-grey if the file is unavailable
     so a tinted material still lands on the right colour. */
  function surfMap(name, rx, ry) {
    return Art.loadSurface(name, Art.paint(8, 8, function (c, w, h) {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
    }), rx || 1, ry || 1);
  }

  function angDiff(a, b) {
    var d = (a - b + Math.PI) % TAU;
    if (d < 0) d += TAU;
    return d - Math.PI;
  }

  /* ==========================================================
     Mesh
     ========================================================== */

  function buildHead(m) {
    var group = new THREE.Group();
    var faceTex = cachedTex('face:' + m.id, function () { return Art.face(m); });

    if (m.head === 'box') {
      var backTex = cachedTex('back:' + m.id, function () { return Art.back(m); });
      var side = new THREE.MeshLambertMaterial({ color: m.color });
      var mats = [
        side, side,                                             /* +x, -x */
        new THREE.MeshLambertMaterial({ color: Util.mix(m.color, '#ffffff', 0.2) }), /* top */
        new THREE.MeshLambertMaterial({ color: Util.mix(m.color, '#000000', 0.4) }), /* bottom */
        new THREE.MeshLambertMaterial({ map: faceTex }),        /* +z = forward */
        new THREE.MeshLambertMaterial({ map: backTex })         /* -z = what you see when overtaking */
      ];
      var box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.5), mats);
      group.add(box);

    } else if (m.head === 'sphere') {
      var sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 32, 22),
        new THREE.MeshLambertMaterial({ map: faceTex })
      );
      group.add(sphere);

      var decalCanvas = Art.decal(m);
      if (decalCanvas) {
        var dTex = Art.texture(decalCanvas, 1, 1);
        dTex.wrapS = dTex.wrapT = THREE.ClampToEdgeWrapping;
        var decal = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 1.5),
          new THREE.MeshLambertMaterial({ map: dTex, transparent: true, depthWrite: false })
        );
        decal.position.set(0, 0.05, 0.9);
        group.add(decal);
      }

      if (m.id === 'clarus') {
        /* floppy ears */
        var earMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
        [-1, 1].forEach(function (s) {
          var ear = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), earMat);
          ear.position.set(s * 0.85, 0.25, 0.05);
          ear.scale.set(0.45, 1.25, 0.7);
          ear.rotation.z = s * 0.5;
          group.add(ear);
        });
      }
      if (m.id === 'bomb') {
        var fuse = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.1, 0.9, 10),
          new THREE.MeshLambertMaterial({ color: 0x8a6a3a })
        );
        fuse.position.set(0.3, 1.1, -0.15);
        fuse.rotation.z = -0.5;
        group.add(fuse);
        var spark = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd34d })
        );
        spark.position.set(0.62, 1.5, -0.15);
        group.add(spark);
        group.userData.spark = spark;
      }

    } else { /* cylinder — the Mac Pro */
      var cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.78, 2, 32, 1, true),
        new THREE.MeshLambertMaterial({ map: faceTex })
      );
      group.add(cyl);
      var throat = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 32),
        new THREE.MeshBasicMaterial({ color: 0x5abeff })
      );
      throat.rotation.x = -Math.PI / 2;
      throat.position.y = 1.0;
      group.add(throat);
    }

    return group;
  }

  /* ==========================================================
     Chassis — each mascot drives its own hardware, not a
     recoloured box.  Every builder returns the seat height so
     the head sits correctly on top of whatever shape it made.
     ========================================================== */

  /* The image on a machine's screen: its own face when the machine is
     the mascot, otherwise a plain desktop, so a rider's face never
     appears twice on the same kart. */
  function screenTexture(m) {
    return m.rider
      ? cachedTex('desktop', function () { return Art.desktopScreen(); })
      : cachedTex('face:' + m.id, function () { return Art.face(m); });
  }

  var CHASSIS = {

    /* The 1984 compact Macintosh: tapered beige case, sloped
       front bezel, floppy slot, carry handle recess. */
    compact: function (g, m, mats) {
      var sideTex = cachedTex('side:' + m.id, function () { return Art.compactSide(m.color); });
      var caseMat = new THREE.MeshLambertMaterial({ map: sideTex });

      /* main case, narrower at the top like the real thing */
      var body = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.5, 2.3, 4, 1), caseMat);
      body.rotation.y = Math.PI / 4;
      body.position.set(0, 1.32, -0.25);
      body.scale.set(1, 1, 1.42);
      g.add(body);

      /* sloped front bezel */
      var bezel = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.5, 0.42), mats.dark);
      bezel.position.set(0, 1.42, 1.28);
      bezel.rotation.x = -0.16;
      g.add(bezel);

      var screen = new THREE.Mesh(
        new THREE.PlaneGeometry(1.62, 1.24),
        new THREE.MeshBasicMaterial({ map: screenTexture(m) })
      );
      screen.position.set(0, 1.44, 1.51);
      screen.rotation.x = -0.16;
      g.add(screen);

      /* floppy slot */
      var slot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.1), mats.slot);
      slot.position.set(0, 0.72, 1.44);
      g.add(slot);

      return { seatY: 2.5, seatZ: -0.5, wing: true };
    },

    /* iMac G3: translucent curved shell over a bright core. */
    imac: function (g, m, mats) {
      var shellTex = cachedTex('shell:' + m.id, function () { return Art.shellPanel(m.color); });

      /* opaque inner body so the shell has something to sit over */
      var core = new THREE.Mesh(
        new THREE.SphereGeometry(1.15, 28, 20),
        new THREE.MeshLambertMaterial({ color: 0xf2f2ec })
      );
      core.scale.set(1, 0.92, 1.35);
      core.position.set(0, 1.25, -0.1);
      g.add(core);

      var shell = new THREE.Mesh(
        new THREE.SphereGeometry(1.3, 32, 24),
        new THREE.MeshPhongMaterial({
          map: shellTex, transparent: true, opacity: 0.62,
          shininess: 90, specular: 0x9fdfff, depthWrite: false
        })
      );
      shell.scale.set(1, 0.95, 1.38);
      shell.position.set(0, 1.25, -0.1);
      shell.renderOrder = 2;
      g.add(shell);

      /* CRT face */
      var screen = new THREE.Mesh(
        new THREE.CircleGeometry(0.92, 32),
        new THREE.MeshBasicMaterial({ map: screenTexture(m) })
      );
      screen.position.set(0, 1.3, 1.62);
      g.add(screen);

      /* the iMac's carry handle */
      var handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.09, 10, 24, Math.PI),
        new THREE.MeshPhongMaterial({
          color: m.color, transparent: true, opacity: 0.75, shininess: 80
        })
      );
      handle.position.set(0, 2.16, -0.95);
      handle.rotation.set(0, 0, 0);
      g.add(handle);

      return { seatY: 2.35, seatZ: -0.9, wing: true };
    },

    /* A System 7 window on wheels: white panel, striped title
       bar, close box.  Finder and the Bomb both ride one. */
    dialog: function (g, m, mats) {
      var barTex = cachedTex('bar:' + m.id, function () { return Art.titleBar(m.trim); });

      var win = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 2.9), mats.paper);
      win.position.set(0, 1.25, -0.15);
      g.add(win);

      /* black window outline */
      var edge = new THREE.Mesh(
        new THREE.BoxGeometry(2.38, 1.68, 2.98),
        new THREE.MeshBasicMaterial({ color: 0x15151a, side: THREE.BackSide })
      );
      edge.position.copy(win.position);
      g.add(edge);

      /* title bar across the front */
      var bar = new THREE.Mesh(
        new THREE.PlaneGeometry(2.24, 0.62),
        new THREE.MeshBasicMaterial({ map: barTex })
      );
      bar.position.set(0, 1.72, 1.31);
      g.add(bar);

      /* window content area */
      var content = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 0.82),
        new THREE.MeshBasicMaterial({ map: screenTexture(m) })
      );
      content.position.set(0, 1.03, 1.31);
      g.add(content);

      /* scroll bar down the side */
      var scroll = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.2, 0.26), mats.dark);
      scroll.position.set(1.16, 1.15, 0.2);
      g.add(scroll);

      return { seatY: 2.15, seatZ: -0.8, wing: true };
    },

    /* 2013 Mac Pro: the black cylinder, laid along the kart. */
    cylinder: function (g, m, mats) {
      var skinTex = cachedTex('skin:' + m.id, function () { return Art.face(m); }, 1, 3);
      var can = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 3.0, 32, 1, true),
        new THREE.MeshPhongMaterial({ map: skinTex, shininess: 110, specular: 0x555a66 })
      );
      can.rotation.x = Math.PI / 2;
      can.position.set(0, 1.2, -0.2);
      g.add(can);

      /* closed nose, open glowing exhaust throat at the back */
      var nose = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), mats.dark);
      nose.position.set(0, 1.2, 1.3);
      g.add(nose);

      var throat = new THREE.Mesh(
        new THREE.CircleGeometry(1.02, 32),
        new THREE.MeshBasicMaterial({ color: 0x0b0b10 })
      );
      throat.position.set(0, 1.2, -1.7);
      throat.rotation.y = Math.PI;
      g.add(throat);

      var glowTex = cachedTex('glow:cyan', function () { return Art.radial('rgba(125,227,255,.9)'); });
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      glow.position.set(0, 1.2, -1.76);
      glow.scale.set(2.4, 2.4, 1);
      g.add(glow);

      return { seatY: 2.42, seatZ: -0.3, wing: false };
    },

    /* LaserWriter — Clarus the dogcow came from a print dialog,
       so of course the dogcow drives the printer. */
    laserwriter: function (g, m, mats) {
      var panelTex = cachedTex('printer', function () { return Art.printerPanel(); });
      var caseMat = new THREE.MeshLambertMaterial({ map: panelTex });

      var body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.35, 3.1), caseMat);
      body.position.set(0, 1.1, -0.2);
      g.add(body);

      /* stepped top cover */
      var lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 2.0), caseMat);
      lid.position.set(0, 1.95, -0.5);
      g.add(lid);

      /* paper tray angled out of the front */
      var tray = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.5), mats.paper);
      tray.position.set(0, 1.42, 1.5);
      tray.rotation.x = 0.34;
      g.add(tray);

      /* a sheet mid-print, with the dogcow's own face on it */
      var faceTex = cachedTex('face:' + m.id, function () { return Art.face(m); });
      var sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 1.0),
        new THREE.MeshLambertMaterial({ map: faceTex, side: THREE.DoubleSide })
      );
      sheet.position.set(0, 1.62, 1.42);
      sheet.rotation.x = -1.24;
      g.add(sheet);

      /* output slot */
      var slot = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.08), mats.slot);
      slot.position.set(0, 1.72, 1.31);
      g.add(slot);

      return { seatY: 2.32, seatZ: -0.9, wing: false };
    }
  };

  function buildKartMesh(m) {
    var g = new THREE.Group();

    /* The chassis panels are their own hand-drawn art; these are the
       parts every kart shares.  Each is a real map multiplied by the
       mascot's colour, so a Bondi frame and a Platinum one are the same
       moulded plastic in two colours rather than two flat fills. */
    var plastic = surfMap('beige_plastic', 2, 2);
    var mats = {
      body:  new THREE.MeshLambertMaterial({ map: plastic, color: m.color }),
      dark:  new THREE.MeshLambertMaterial({ map: surfMap('dark_metal', 2, 2),
                                             color: Util.mix(m.color, '#000000', 0.55) }),
      trim:  new THREE.MeshLambertMaterial({ map: plastic, color: m.trim }),
      tyre:  new THREE.MeshLambertMaterial({ map: surfMap('rubber', 2, 1), color: 0x8f8f96 }),
      rim:   new THREE.MeshLambertMaterial({ map: surfMap('dark_metal', 1, 1), color: 0xe4e8f0 }),
      paper: new THREE.MeshLambertMaterial({ map: plastic, color: 0xf4f4ef }),
      slot:  new THREE.MeshLambertMaterial({ map: surfMap('dark_metal', 1, 1), color: 0x50525c })
    };

    /* shared go-kart underpinnings */
    var pan = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 4.4), mats.dark);
    pan.position.y = 0.42;
    g.add(pan);

    var bumper = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 0.4), mats.trim);
    bumper.position.set(0, 0.62, 2.5);
    g.add(bumper);

    [-1, 1].forEach(function (s) {
      var pod = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 2.6), mats.dark);
      pod.position.set(s * 1.32, 0.62, -0.1);
      g.add(pod);
    });

    /* the hardware itself */
    var spec = (CHASSIS[m.chassis] || CHASSIS.compact)(g, m, mats);
    var body = pan;

    /* Only creatures ride; a machine that IS the mascot drives itself. */
    var head = null;
    if (m.rider) {
      head = buildHead(m);
      head.scale.setScalar(0.82);
      head.position.set(0, spec.seatY, spec.seatZ);
      g.add(head);

      /* a seat back for the rider to sit against */
      var seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.24), mats.dark);
      seat.position.set(0, spec.seatY - 0.5, spec.seatZ - 0.55);
      g.add(seat);
    }

    if (spec.wing) {
      var wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.7), mats.trim);
      wing.position.set(0, 1.62, -2.15);
      g.add(wing);
      [-1, 1].forEach(function (s) {
        var strut = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), mats.dark);
        strut.position.set(s * 0.95, 1.22, -2.15);
        g.add(strut);
      });
    }

    /* wheels */
    var wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.55, 22);
    var rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.58, 14);
    var wheels = { front: [], rear: [] };
    [[-1.35, 1.5, 'front'], [1.35, 1.5, 'front'], [-1.4, -1.6, 'rear'], [1.4, -1.6, 'rear']]
      .forEach(function (w) {
        var pivot = new THREE.Group();
        pivot.position.set(w[0], 0.62, w[1]);
        var tyre = new THREE.Mesh(wheelGeo, mats.tyre);
        tyre.rotation.z = Math.PI / 2;
        pivot.add(tyre);
        var rim = new THREE.Mesh(rimGeo, mats.rim);
        rim.rotation.z = Math.PI / 2;
        pivot.add(rim);
        pivot.userData.tyre = tyre;
        pivot.userData.rim = rim;
        g.add(pivot);
        wheels[w[2]].push(pivot);
      });

    /* exhaust flames */
    var flameTex = cachedTex('flame', function () { return Art.radial('rgba(255,214,120,.95)'); });
    var flames = [];
    [-0.6, 0.6].forEach(function (x) {
      var f = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      f.position.set(x, 0.85, -2.5);
      f.scale.set(2.2, 2.2, 1);
      f.visible = false;
      g.add(f);
      flames.push(f);
    });

    /* blob shadow */
    var shadowTex = cachedTex('shadow', function () { return Art.blob('rgba(0,0,0,.55)', 0.55); });
    var shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 6),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    g.add(shadow);

    g.userData = { wheels: wheels, flames: flames, head: head, shadow: shadow, body: body };
    return g;
  }

  /* ==========================================================
     Kart
     ========================================================== */

  function Kart(opts) {
    var m = opts.mascot;
    this.mascot = m;
    this.track = opts.track;
    this.isPlayer = !!opts.isPlayer;
    this.name = m.name;
    this.color = m.dot;

    /* handling, derived from the mascot's ratings */
    this.maxSpeed  = 46 + m.top * 26;          /* units (metres) per second */
    this.accelRate = 13 + m.accel * 13;
    this.brakeRate = 46;
    this.dragRate  = 7;
    this.turnRate  = 1.75 + m.grip * 0.95;     /* radians per second        */
    this.gripRate  = 4.6 + m.grip * 5.2;       /* how fast velocity follows */
    /* Nitro is a resource, not a cooldown: nothing refills it on its own.
       The rating buys you a bigger yield per RAM chip and a slower burn,
       so a high-nitro mascot gets more laps out of the same pickups. */
    this.nitroYield = 26 + m.nitro * 16;       /* per chip                 */
    this.nitroDrain = 31 - m.nitro * 7;        /* percent per second       */
    this.nitroMin   = 8;                       /* needed to light it up    */

    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.velAngle = 0;
    this.speed = 0;
    this.slip = 0;

    this.sampleIdx = 0;
    this.offset = 0;
    this.u = 0;
    this.lastU = 0;
    this.lap = 0;
    this.totalProgress = 0;
    this.onRoad = true;
    this.airborne = 0;

    this.nitro = 0;
    this.nitroGained = 0;      /* last credit, for the HUD to announce */
    this.boost = 0;
    this.driftCharge = 0;
    this.drifting = false;
    this.miniTurbo = 0;
    this.vy = 0;
    this.avoid = 0;
    this.lastSteer = 0;
    this.accelSmoothed = 0;
    this.burning = false;
    this.onPad = false;

    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.lastLapStart = 0;
    this.bestLap = 0;

    this.speedScale = 1;
    this.time = 0;

    /* AI personality.  Driven by a seeded generator, never Math.random:
       the simulation has to be reproducible for a given track and grid,
       otherwise identical input can produce different races. */
    this.ai = !opts.isPlayer;
    this.aiLane = opts.lane === undefined ? 0 : opts.lane;
    this.aiSkill = opts.skill === undefined ? 0.9 : opts.skill;
    this.rnd = Util.rng((opts.seed === undefined ? 1 : opts.seed) * 7919 + m.num * 131 + 17);
    this.aiPhase = this.rnd() * TAU;
    this.aiNitroCooldown = 1 + this.rnd() * 4;

    this.mesh = buildKartMesh(m);
    this.wheelSpin = 0;
    this.steerVisual = 0;

    /* smoke pool */
    var puffTex = cachedTex('puff', function () { return Art.puff(); });
    this.smoke = [];
    for (var i = 0; i < 7; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: puffTex, transparent: true, depthWrite: false, opacity: 0
      }));
      sp.scale.set(2, 2, 1);
      sp.visible = false;
      this.smoke.push({ sprite: sp, life: 0 });
    }
    this.smokeIdx = 0;
  }

  /* The only way the bar ever goes up.  Returns what was actually
     credited, so a hit on a full bar doesn't announce itself. */
  Kart.prototype.gainNitro = function (amount) {
    var before = this.nitro;
    this.nitro = Math.min(100, this.nitro + amount);
    var got = this.nitro - before;
    if (got > 0) this.nitroGained += got;
    return got;
  };

  /* place on the grid, behind the start line */
  Kart.prototype.placeOnGrid = function (rowsBack, lane) {
    var track = this.track;
    var back = Math.round(rowsBack * 9 / track.ds);
    var idx = (track.count - back) % track.count;
    var s = track.samples[idx];

    this.pos.copy(s.pos).addScaledVector(s.right, lane * track.halfWidth * 0.55);
    this.pos.y = s.pos.y;
    this.heading = Math.atan2(s.tangent.x, s.tangent.z);
    this.velAngle = this.heading;
    this.speed = 0;
    this.sampleIdx = idx;
    this.lap = 0;
    var loc = track.locate(this.pos, idx);
    this.u = loc.u;
    this.lastU = loc.u;
    this.totalProgress = this.u;
    this.nitro = 0;
    this.boost = 0;
    this.finished = false;
    this.lapTimes = [];
    this.bestLap = 0;
    this.syncMesh(0);
  };

  /* respawn on the centreline after getting stuck */
  Kart.prototype.rescue = function () {
    var track = this.track;
    var idx = track.nearestGlobal(this.pos);
    var s = track.samples[idx];
    this.pos.copy(s.pos);
    this.pos.y = s.pos.y;
    this.heading = Math.atan2(s.tangent.x, s.tangent.z);
    this.velAngle = this.heading;
    this.speed = 0;
    this.slip = 0;
    this.sampleIdx = idx;
    var loc = track.locate(this.pos, idx);
    this.lastU = loc.u;
    this.u = loc.u;
  };

  /* ---------- AI ---------- */

  Kart.prototype.driveAI = function (dt, world, referenceProgress) {
    var track = this.track;

    /* aim at a point down the road, on this driver's preferred line */
    var ahead = Math.max(4, Math.round((9 + this.speed * 0.55) / track.ds));
    var target = track.sampleAhead(this.sampleIdx, ahead);
    var lane = this.aiLane + Math.sin(this.time * 0.35 + this.aiPhase) * 0.16;

    /* tuck into the apex on the corners */
    var curv = target.smoothCurvature;
    lane -= THREE.MathUtils.clamp(curv * 26, -0.55, 0.55);
    lane = THREE.MathUtils.clamp(lane, -0.82, 0.82);

    /* Chips are the only refill, so a driver running dry goes and gets
       one — but only leans toward it, never abandons the racing line.
       world.pickups is in a fixed order and `taken` is simulation state,
       so this stays as deterministic as the rest of the AI. */
    if (this.nitro < 45) {
      var want = null, wantD = 1e9;
      for (var q = 0; q < world.pickups.length; q++) {
        var pk = world.pickups[q];
        if (pk.taken > 0) continue;
        var dq = (pk.index - this.sampleIdx + track.count) % track.count;
        if (dq < 6 || dq > ahead + 26) continue;
        if (dq < wantD) { wantD = dq; want = pk; }
      }
      if (want) {
        var pull = 0.55 * (1 - this.nitro / 45);
        lane += THREE.MathUtils.clamp(want.lane - lane, -pull, pull);
        lane = THREE.MathUtils.clamp(lane, -0.82, 0.82);
      }
    }

    var tp = _vec.copy(target.pos)
      .addScaledVector(target.right, lane * track.halfWidth);

    var desired = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z);
    /* negated to match the steer convention in step(): + is screen-right */
    var steer = THREE.MathUtils.clamp(-angDiff(desired, this.heading) * 2.4, -1, 1);

    /* How fast can we be *here*, given everything between here and
       the next slow corner?  For each point down the road: the speed
       that corner supports, grown back by how much braking distance
       we still have.  The lowest answer wins. */
    var lateralGrip = (16 + this.mascot.grip * 13) * this.aiSkill;
    var brakeDecel = 30;
    var scanTo = Math.max(8, Math.round((this.speed * 1.15 + 30) / track.ds));
    var cornerMax = this.maxSpeed * this.aiSkill;
    var worst = 0;

    for (var i = 3; i < scanTo; i += 3) {
      var s2 = track.sampleAhead(this.sampleIdx, i);
      var c = Math.abs(s2.smoothCurvature);
      if (i < 26 && c > worst) worst = c;
      if (c < 1e-5) continue;
      var vCorner = Math.sqrt(lateralGrip / c);
      var allowed = Math.sqrt(vCorner * vCorner + 2 * brakeDecel * (i * track.ds));
      if (allowed < cornerMax) cornerMax = allowed;
    }

    var throttle = this.speed < cornerMax ? 1 : 0;
    var brake = this.speed > cornerMax * 1.06 ? 1 : 0;

    /* keep off each other's rear wing */
    steer = THREE.MathUtils.clamp(steer + this.avoid, -1, 1);
    this.avoid *= Math.exp(-2.5 * dt);

    /* Nitro on the fast bits.  With a finite bar the AI spends what it
       has rather than waiting for a refill that never comes: it lights
       up once it holds roughly one chip's worth. */
    this.aiNitroCooldown -= dt;
    var straight = worst < 0.004 && this.speed > cornerMax * 0.9;
    var nitro = straight && this.aiNitroCooldown <= 0 &&
                (this.nitroLit ? this.nitro > 0 : this.nitro >= this.nitroYield * 0.8);
    if (!nitro && this.nitro < this.nitroMin) this.aiNitroCooldown = 1 + this.rnd() * 2;

    /* Rubber band, measured against the player rather than the
       leader: anyone ahead of them eases off a little, anyone behind
       pushes a little.  Keeps the race happening *around* the player
       instead of somewhere over the horizon. */
    var gapUnits = (referenceProgress - this.totalProgress) * track.length;
    this.speedScale = 1 + THREE.MathUtils.clamp(gapUnits / 700, -0.09, 0.16);

    return {
      throttle: throttle,
      brake: brake,
      steer: steer,
      nitro: nitro,
      drift: Math.abs(steer) > 0.8 && this.speed > this.maxSpeed * 0.55
    };
  };

  /* ---------- one physics step ---------- */

  Kart.prototype.step = function (dt, input, world, raceTime) {
    var track = this.track;
    this.time += dt;

    if (this.finished) {
      input = { throttle: 0.35, brake: 0, steer: input ? input.steer * 0.4 : 0, nitro: false, drift: false };
    }

    this.lastSteer = input.steer;
    var speedBefore = this.speed;

    var loc = track.locate(this.pos, this.sampleIdx);
    this.sampleIdx = loc.index;
    this.offset = loc.offset;
    var s = loc.sample;

    var edge = track.halfWidth + track.kerbWidth;
    this.onRoad = Math.abs(loc.offset) < edge;

    /* ---- nitro ----
       Nothing here adds to the bar.  It is filled only by RAM chips and
       by knocking into someone (see gainNitro), which is what makes it
       worth going out of your way for either.  A minimum charge is
       needed to light it, so the last sliver can't be tapped forever. */
    var burning = false;
    if (input.nitro && !this.finished &&
        (this.nitroLit ? this.nitro > 0 : this.nitro >= this.nitroMin)) {
      this.nitro = Math.max(0, this.nitro - this.nitroDrain * dt);
      this.boost = Math.max(this.boost, 0.12);
      burning = true;
    }
    this.nitroLit = burning;
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt);
    this.burning = burning || this.boost > 0.02;

    /* ---- longitudinal ---- */
    var surface = this.onRoad ? 1 : 0.58;
    var boosting = this.burning;
    var maxS = this.maxSpeed * surface * this.speedScale * (boosting ? 1.34 : 1);

    /* Coasting and surface drag decay speed toward a standstill; they
       must never push it through zero, or a kart left alone on the grid
       quietly accelerates backwards. Reverse is only ever entered by
       holding the brake. */
    function decay(speed, amount) {
      if (speed > 0) return Math.max(0, speed - amount);
      if (speed < 0) return Math.min(0, speed + amount);
      return 0;
    }

    if (input.throttle > 0) {
      var pull = this.accelRate * (boosting ? 2.1 : 1) * input.throttle;
      this.speed += pull * (1 - this.speed / Math.max(6, maxS)) * dt;
    } else if (!input.brake) {
      this.speed = decay(this.speed, this.dragRate * dt);
    }
    if (input.brake) {
      this.speed -= this.brakeRate * dt;
    }
    if (!this.onRoad) {
      this.speed = decay(this.speed, 9 * dt);
      if (this.speed > maxS) this.speed -= 26 * dt;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -9, this.maxSpeed * 1.5);

    /* ---- steering ---- */
    var speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 7, 0, 1);
    var fast = THREE.MathUtils.clamp(this.speed / this.maxSpeed, 0, 1.4);
    var turn = this.turnRate * (1 - 0.3 * fast) * speedFactor;

    this.drifting = !!input.drift && Math.abs(input.steer) > 0.15 && this.speed > this.maxSpeed * 0.35;
    if (this.drifting) turn *= 1.42;

    /* steer > 0 means "turn right as the player sees it".  Heading is a
       compass yaw measured from +Z toward +X, which under a chase camera
       looking down +Z runs the opposite way on screen — hence the minus. */
    this.heading -= input.steer * turn * dt * (this.speed < 0 ? -1 : 1);

    /* ---- grip: velocity heading chases chassis heading ---- */
    var grip = this.gripRate;
    if (this.drifting) grip = 2.0;
    if (!this.onRoad) grip *= 0.5;
    var d = angDiff(this.heading, this.velAngle);
    this.velAngle += d * (1 - Math.exp(-grip * dt));
    this.slip = angDiff(this.heading, this.velAngle);

    /* sliding scrubs speed */
    this.speed *= Math.exp(-Math.abs(this.slip) * 0.55 * dt);

    /* ---- drift charge -> mini turbo ---- */
    if (this.drifting && Math.abs(this.slip) > 0.12) {
      this.driftCharge += dt;
    } else if (this.driftCharge > 0) {
      if (this.driftCharge > 0.85) {
        /* pays out in speed only — the bar is fed by chips and contact */
        this.boost = Math.max(this.boost, 0.55 + Math.min(0.7, this.driftCharge * 0.25));
        this.miniTurbo = 0.6;
      }
      this.driftCharge = 0;
    }
    if (this.miniTurbo > 0) this.miniTurbo -= dt;

    /* ---- integrate ---- */
    this.pos.x += Math.sin(this.velAngle) * this.speed * dt;
    this.pos.z += Math.cos(this.velAngle) * this.speed * dt;

    /* ---- barriers ---- */
    var loc2 = track.locate(this.pos, this.sampleIdx);
    this.sampleIdx = loc2.index;
    var wall = track.halfWidth + track.kerbWidth + track.runoff;
    this.hitWall = false;
    if (Math.abs(loc2.offset) > wall) {
      var over = Math.abs(loc2.offset) - wall;
      var sign = loc2.offset > 0 ? 1 : -1;
      this.pos.addScaledVector(loc2.sample.right, -sign * over);

      var tangentAngle = Math.atan2(loc2.sample.tangent.x, loc2.sample.tangent.z);

      /* Scrub speed by how squarely we arrived, not by a flat factor —
         this runs every tick, so a constant multiplier would bleed all
         speed away the moment a kart leaned on the barrier.  Glancing
         contact costs almost nothing; a head-on hit costs a lot. */
      var into = angDiff(this.velAngle, tangentAngle) * sign;
      if (into > 0) {
        var impact = Math.min(1, into / (Math.PI * 0.5));
        this.speed *= 1 - 0.55 * impact * impact;
        this.hitWall = impact > 0.2;
      }

      /* then slide along the wall instead of sticking to it */
      this.velAngle = tangentAngle;
      this.heading += angDiff(tangentAngle, this.heading) * (1 - Math.exp(-8 * dt));
      this.speed *= Math.exp(-1.8 * dt);   /* continuous scrape */

      loc2 = track.locate(this.pos, this.sampleIdx);
    }

    this.offset = loc2.offset;
    this.onRoad = Math.abs(loc2.offset) < edge;

    /* ---- ride height ---- */
    var groundY;
    if (this.onRoad) {
      groundY = track.surfaceY(loc2);
    } else {
      /* Off the racing surface, sit on the verge exactly where world.js
         built it — anything else leaves the kart hovering over, or buried
         in, the terrain the player can see. */
      groundY = track.vergeY(loc2.sample, loc2.offset);
      /* blend the along-segment slope back in, which vergeY doesn't carry */
      var nextS = track.samples[(loc2.index + 1) % track.count];
      var tAlong = THREE.MathUtils.clamp(loc2.along / track.ds, -1, 1);
      groundY += (nextS.pos.y - loc2.sample.pos.y) * tAlong;
    }

    /* crests throw the kart into the air; gravity brings it back */
    if (this.pos.y > groundY + 0.05) {
      this.vy = (this.vy || 0) - 34 * dt;
      this.pos.y += this.vy * dt;
      this.airborne += dt;
      if (this.pos.y <= groundY) { this.pos.y = groundY; this.vy = 0; this.airborne = 0; }
    } else {
      var climb = (groundY - this.pos.y) / Math.max(dt, 1e-4);
      if (climb < -26 && this.speed > 18) {
        /* leaving a crest faster than the road drops away */
        this.vy = 0;
        this.pos.y += climb * dt * 0.55;
        this.airborne += dt;
      } else {
        this.pos.y = groundY;
        this.vy = 0;
        this.airborne = 0;
      }
    }

    /* ---- boost pads ---- */
    if (this.onRoad && world.boostAt(loc2.index)) {
      if (!this.onPad) {
        this.onPad = true;
        this.boost = Math.max(this.boost, 0.95);
        this.justBoosted = true;
      }
    } else {
      this.onPad = false;
    }

    /* ---- pickups ---- */
    for (var i = 0; i < world.pickups.length; i++) {
      var p = world.pickups[i];
      if (p.taken > 0) continue;
      var di = Math.abs((p.index - loc2.index + track.count) % track.count);
      if (di > 6 && di < track.count - 6) continue;
      var dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      if (dx * dx + dz * dz < 9) {
        p.taken = 7;
        var got = this.gainNitro(this.nitroYield);
        if (got > 0) this.justPicked = got;
      }
    }

    /* ---- lap bookkeeping ---- */
    var u = loc2.u;
    var du = u - this.lastU;
    if (du < -0.5) {
      this.lap++;
      if (this.lap > 1) {
        var lapTime = raceTime - this.lastLapStart;
        this.lapTimes.push(lapTime);
        if (!this.bestLap || lapTime < this.bestLap) this.bestLap = lapTime;
      }
      this.lastLapStart = raceTime;
      this.justCrossedLine = true;
    } else if (du > 0.5) {
      this.lap--;
    }
    this.lastU = u;
    this.u = u;
    this.totalProgress = this.lap + u;

    /* smoothed longitudinal g, used for the chassis pitch */
    var accelNow = (this.speed - speedBefore) / Math.max(dt, 1e-4);
    this.accelSmoothed += (accelNow - this.accelSmoothed) * (1 - Math.exp(-6 * dt));

    return this;
  };

  /* ---------- kart vs kart ---------- */

  Kart.prototype.collide = function (other, dt) {
    var dx = other.pos.x - this.pos.x;
    var dz = other.pos.z - this.pos.z;
    var d2 = dx * dx + dz * dz;
    var minD = 3.4;
    if (d2 > minD * minD || d2 < 1e-6) return false;

    var d = Math.sqrt(d2);
    var push = (minD - d) / 2;
    var nx = dx / d, nz = dz / d;

    this.pos.x -= nx * push; this.pos.z -= nz * push;
    other.pos.x += nx * push; other.pos.z += nz * push;

    /* Cost is based on the closing speed along the contact normal and
       scaled by dt.  Contact is resolved every tick, so a fixed
       multiplier here would bring two karts running side by side to a
       dead stop within a second of touching. */
    var vaN = Math.sin(this.velAngle) * nx + Math.cos(this.velAngle) * nz;
    var vbN = Math.sin(other.velAngle) * nx + Math.cos(other.velAngle) * nz;
    var intoA = this.speed * vaN;        /* >0: this kart drove into it  */
    var intoB = -other.speed * vbN;      /* >0: the other one did        */
    var closing = Math.max(0, intoA + intoB);

    /* heavier mascots shrug contact off better */
    var mine = 1.6 - this.mascot.grip * 0.5;
    this.speed = Math.max(0, this.speed - closing * mine * dt * 2.2);
    other.speed = Math.max(0, other.speed - closing * 0.9 * dt * 1.4);

    /* Whoever drove into the contact harvests nitro from it, scaled by
       dt and by the closing speed — so it reads as an impulse.  Contact
       equalises the two speeds within a few ticks, which caps what a
       single shove can be worth without needing an explicit cooldown. */
    if (closing > 1.5) {
      var reward = closing * dt * 2.6;
      if (intoA >= intoB) this.gainNitro(reward);
      else other.gainNitro(reward);
    }

    if (this.ai) this.avoid += nx * 0.9 * dt;
    if (other.ai) other.avoid -= nx * 0.9 * dt;

    return closing > 6;   /* only a real knock is worth a sound + shake */
  };

  /* ---------- visuals ---------- */

  Kart.prototype.syncMesh = function (dt) {
    var track = this.track;
    var s = track.samples[this.sampleIdx];
    var mesh = this.mesh;

    mesh.position.copy(this.pos);

    /* sit on the banked surface: build a basis from the road frame */
    var up = s.up;
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _fwd.addScaledVector(up, -_fwd.dot(up));
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1); else _fwd.normalize();
    _right.crossVectors(up, _fwd);

    _mat.makeBasis(_right, up, _fwd);
    _quat.setFromRotationMatrix(_mat);

    /* lean out of the drift, squat under power */
    var roll = -this.slip * 0.3;
    var pitch = THREE.MathUtils.clamp(-this.accelSmoothed * 0.012, -0.09, 0.09);
    _euler.set(pitch, 0, roll);
    _quat.multiply(_quat2.setFromEuler(_euler));
    mesh.quaternion.slerp(_quat, dt > 0 ? 1 - Math.exp(-18 * dt) : 1);

    /* wheels */
    this.wheelSpin += this.speed * dt * 1.6;
    var w = mesh.userData.wheels;
    this.steerVisual += ((this.lastSteer || 0) * 0.5 - this.steerVisual) * (dt > 0 ? 1 - Math.exp(-14 * dt) : 1);
    w.front.forEach(function (p) {
      p.rotation.y = -this.steerVisual;
      p.userData.tyre.rotation.x = this.wheelSpin;
      p.userData.rim.rotation.x = this.wheelSpin;
    }, this);
    w.rear.forEach(function (p) {
      p.userData.tyre.rotation.x = this.wheelSpin;
      p.userData.rim.rotation.x = this.wheelSpin;
    }, this);

    /* flames */
    var flameOn = this.burning;
    mesh.userData.flames.forEach(function (f, i) {
      f.visible = flameOn;
      if (flameOn) {
        var pulse = 1.6 + Math.sin(this.time * 40 + i * 2) * 0.5 + this.boost * 0.8;
        f.scale.set(pulse, pulse, 1);
        f.material.opacity = 0.75 + Math.random() * 0.25;
      }
    }, this);

    /* bomb's fuse sparks harder the faster it goes */
    var spark = mesh.userData.head && mesh.userData.head.userData.spark;
    if (spark) {
      var sc = 1 + Math.sin(this.time * 22) * 0.25 + (this.speed / this.maxSpeed) * 0.5;
      spark.scale.setScalar(sc);
    }

    /* shadow shrinks when airborne */
    var lift = Math.max(0, this.pos.y - (track.surfaceY({
      sample: s, index: this.sampleIdx, along: 0,
      offset: THREE.MathUtils.clamp(this.offset, -track.halfWidth, track.halfWidth)
    })));
    var shrink = THREE.MathUtils.clamp(1 - lift * 0.12, 0.35, 1);
    mesh.userData.shadow.scale.setScalar(shrink);
    mesh.userData.shadow.material.opacity = 0.75 * shrink;
  };

  /* smoke when sliding or off in the dirt */
  Kart.prototype.emitSmoke = function (dt, scene, theme) {
    var sliding = Math.abs(this.slip) > 0.22 && this.speed > 12;
    var dirt = !this.onRoad && this.speed > 8;

    if ((sliding || dirt) && Math.random() < dt * 34) {
      var s = this.smoke[this.smokeIdx];
      this.smokeIdx = (this.smokeIdx + 1) % this.smoke.length;
      if (!s.sprite.parent) scene.add(s.sprite);
      s.sprite.position.copy(this.pos);
      s.sprite.position.x -= Math.sin(this.heading) * 2;
      s.sprite.position.z -= Math.cos(this.heading) * 2;
      s.sprite.position.y += 0.4;
      s.life = 0.75;
      s.dirt = dirt;
      s.sprite.material.color.set(dirt ? 0xa08b60 : 0xffffff);
    }

    for (var i = 0; i < this.smoke.length; i++) {
      var p = this.smoke[i];
      if (p.life > 0) {
        p.life -= dt;
        p.sprite.visible = true;
        var t = Math.max(0, p.life / 0.75);
        p.sprite.material.opacity = t * 0.5;
        var sc = 2 + (1 - t) * 4;
        p.sprite.scale.set(sc, sc, 1);
        p.sprite.position.y += dt * 1.6;
      } else if (p.sprite.visible) {
        p.sprite.visible = false;
      }
    }
  };

  Kart.prototype.speedKmh = function () { return Math.max(0, this.speed) * 3.6; };

  return {
    Kart: Kart,
    buildKartMesh: buildKartMesh,
    angDiff: angDiff
  };
})();
