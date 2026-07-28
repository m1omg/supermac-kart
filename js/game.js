/* ============================================================
   Game — boot, menus, the race loop and the HUD.

   Timing model: real elapsed time is accumulated and consumed in
   fixed 1/120 s physics steps, with rendering interpolated on top
   at whatever rate the display runs.  Nothing in the simulation
   is per-frame, so a 60 Hz laptop and a 240 Hz monitor produce
   identical lap times.
   ============================================================ */

var Game = (function () {

  var STEP = 1 / 120;       /* physics tick */
  var MAX_FRAME = 0.25;     /* never simulate more than this per frame */
  var MAX_STEPS = 16;       /* ticks per frame before we stop chasing */

  var renderer, camera, canvas;
  var world = null, track = null;
  var karts = [], player = null;

  var state = 'menu';       /* menu | countdown | racing | finished | paused | results */
  var raceTime = 0, countdown = 0, finishDelay = 0;
  var accumulator = 0, lastFrame = 0, clockTime = 0;
  var shake = 0;

  var chosenMascot = 'happy';
  var chosenTrack = 'coast';

  var camMode = 0;
  var CAM_MODES = [
    { name: 'CHASE', dist: 9.5, height: 4.2, look: 9, fov: 64 },
    { name: 'FAR',   dist: 14,  height: 6.0, look: 11, fov: 68 },
    { name: 'HOOD',  dist: 1.2, height: 2.6, look: 12, fov: 72 }
  ];

  var camPos = new THREE.Vector3();
  var camLook = new THREE.Vector3();
  var _v = new THREE.Vector3();
  var _v2 = new THREE.Vector3();

  /* ---------- input ---------- */

  var keys = {};
  var touch = { left: false, right: false, nitro: false, brake: false, active: false };
  var steerSmooth = 0;

  var el = {};

  /* ==========================================================
     Boot
     ========================================================== */

  function boot() {
    canvas = document.getElementById('screen');

    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    Art.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

    camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 14000);

    cacheElements();
    buildMenus();
    bindInput();
    resize();
    window.addEventListener('resize', resize);

    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function cacheElements() {
    ['hud', 'menu', 'titleScreen', 'charScreen', 'trackScreen', 'pauseScreen', 'resultScreen',
     'lapNow', 'lapTotal', 'timeMain', 'timeFrac', 'posNum', 'posOrd', 'gapVal',
     'standings', 'nitroFill', 'minimap', 'speedo', 'centerMsg', 'popup',
     'charGrid', 'charStats', 'trackGrid', 'resultBoard', 'resultTitle', 'touch']
      .forEach(function (id) { el[id] = document.getElementById(id); });

    el.mapCtx = el.minimap.getContext('2d');
    el.speedCtx = el.speedo.getContext('2d');
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ==========================================================
     Menus
     ========================================================== */

  function buildMenus() {
    /* --- characters --- */
    Art.MASCOTS.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'card' + (m.id === chosenMascot ? ' sel' : '');
      card.dataset.id = m.id;

      var pic = Art.portrait(m, 220, 200);
      pic.style.borderRadius = '10px';
      card.appendChild(pic);

      var name = document.createElement('div');
      name.className = 'cname';
      name.textContent = m.name;
      card.appendChild(name);

      card.addEventListener('click', function () {
        chosenMascot = m.id;
        Sound.click();
        Array.prototype.forEach.call(el.charGrid.children, function (c) {
          c.classList.toggle('sel', c.dataset.id === m.id);
        });
        showStats(m);
      });

      el.charGrid.appendChild(card);
    });
    showStats(Art.mascot(chosenMascot));

    /* --- tracks --- */
    Tracks.list().forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'card' + (t.id === chosenTrack ? ' sel' : '');
      card.dataset.id = t.id;

      card.appendChild(trackPreview(t));

      var name = document.createElement('div');
      name.className = 'cname';
      name.textContent = t.name;
      card.appendChild(name);

      var desc = document.createElement('div');
      desc.className = 'cdesc';
      desc.textContent = t.subtitle;
      card.appendChild(desc);

      var flag = document.createElement('span');
      flag.className = 'cflag';
      flag.textContent = t.difficulty + ' · ' + t.laps + ' LAPS';
      card.appendChild(flag);

      card.addEventListener('click', function () {
        chosenTrack = t.id;
        Sound.click();
        Array.prototype.forEach.call(el.trackGrid.children, function (c) {
          c.classList.toggle('sel', c.dataset.id === t.id);
        });
      });

      el.trackGrid.appendChild(card);
    });

    /* --- buttons --- */
    function go(id, fn) { document.getElementById(id).addEventListener('click', fn); }

    go('btnStart', function () {
      Sound.init(); Sound.click();
      screenTo('charScreen');
    });
    go('btnCharBack', function () { Sound.click(); screenTo('titleScreen'); });
    go('btnCharNext', function () { Sound.click(); screenTo('trackScreen'); });
    go('btnTrackBack', function () { Sound.click(); screenTo('charScreen'); });
    go('btnGo', function () { Sound.click(); startRace(); });
    go('btnResume', function () { Sound.click(); togglePause(false); });
    go('btnRestart', function () { Sound.click(); startRace(); });
    go('btnQuit', function () { Sound.click(); quitToMenu(); });
    go('btnAgain', function () { Sound.click(); startRace(); });
    go('btnMenu', function () { Sound.click(); quitToMenu(); });
  }

  function showStats(m) {
    var rows = [
      ['TOP SPEED', m.top], ['ACCEL', m.accel], ['GRIP', m.grip], ['NITRO', m.nitro]
    ];
    el.charStats.innerHTML =
      '<div class="cdesc" style="margin-bottom:.6em">' + m.desc + '</div>' +
      rows.map(function (r) {
        return '<div class="statRow"><span>' + r[0] + '</span>' +
               '<span class="meter"><span style="width:' + Math.round(r[1] * 100) + '%"></span></span></div>';
      }).join('');
  }

  function trackPreview(t) {
    /* Wide canvas so the card can cap its height without cropping, and
       the outline is drawn into a centred square so the circuit's real
       proportions survive. */
    var W = 320, H = 150;
    var c = Art.canvas(W, H);
    var ctx = c.getContext('2d');
    var pts = Tracks.previewPath(t.id, 240);
    var theme = Tracks.THEMES[t.theme];

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.sky[1]);
    g.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var pad = 14;
    var box = Math.min(W, H) - pad * 2;
    var ox = (W - box) / 2, oy = (H - box) / 2;
    function P(p) { return [ox + p[0] * box, oy + p[1] * box]; }

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 13;
    ctx.beginPath();
    pts.forEach(function (p, i) { var q = P(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = theme.road;
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 7]);
    ctx.stroke();
    ctx.setLineDash([]);

    var s = P(pts[0]);
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
    ctx.fill();

    c.style.borderRadius = '10px';
    return c;
  }

  function screenTo(id) {
    ['titleScreen', 'charScreen', 'trackScreen', 'pauseScreen', 'resultScreen'].forEach(function (s) {
      el[s].classList.toggle('hidden', s !== id);
    });
    el.menu.classList.remove('hidden');
  }

  function hideMenu() { el.menu.classList.add('hidden'); }

  /* ==========================================================
     Race setup
     ========================================================== */

  function startRace() {
    hideMenu();
    el.hud.classList.remove('hidden');
    flashCenter('BUILDING CIRCUIT');

    /* let the browser paint the message before the (brief) build */
    setTimeout(function () {
      buildRace();
      state = 'countdown';
      countdown = 3.999;
      raceTime = 0;
      accumulator = 0;
      lastFrame = performance.now();
      Sound.init();
      Sound.startEngine();
    }, 30);
  }

  function buildRace() {
    if (world) {
      disposeScene(world.scene);
      world = null;
    }

    track = Tracks.get(chosenTrack);
    world = World.build(track, {});

    /* grid: player starts at the back, as tradition demands */
    var roster = Art.MASCOTS.slice();
    var chosen = Art.mascot(chosenMascot);
    roster = roster.filter(function (m) { return m.id !== chosen.id; });

    karts = [];
    var order = [chosen].concat(roster);           /* 8 karts */
    var gridSize = order.length;

    for (var i = 0; i < gridSize; i++) {
      var m = order[i];
      var isPlayer = (i === 0);
      /* player at the back of the grid, AI ahead of them */
      var gridSlot = isPlayer ? gridSize - 1 : i - 1;

      var k = new Karts.Kart({
        mascot: m,
        track: track,
        isPlayer: isPlayer,
        seed: i + 1,
        lane: ((gridSlot % 2) ? 0.42 : -0.42) * 0.8,
        skill: 0.87 + (gridSize - gridSlot) * 0.012
      });

      k.placeOnGrid(1 + Math.floor(gridSlot / 2), (gridSlot % 2) ? 0.45 : -0.45);
      world.scene.add(k.mesh);
      karts.push(k);
      if (isPlayer) player = k;
    }

    /* the player's own kart shouldn't block their view of the road */
    player.mesh.userData.shadow.material.opacity = 0.7;

    camMode = 0;
    positionCameraBehind(player, true);
    updateStandings(true);
    buildStandingRows();
    el.lapTotal.textContent = '/' + track.laps;
    el.lapNow.textContent = '1';
    shake = 0;
  }

  function disposeScene(scene) {
    scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  function quitToMenu() {
    state = 'menu';
    Sound.stopEngine();
    el.hud.classList.add('hidden');
    el.touch.classList.add('hidden');
    screenTo('titleScreen');
  }

  /* ==========================================================
     Input
     ========================================================== */

  var KEYMAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'nitro',
    ShiftLeft: 'drift', ShiftRight: 'drift'
  };

  function bindInput() {
    window.addEventListener('keydown', function (e) {
      var k = KEYMAP[e.code];
      if (k) { keys[k] = true; e.preventDefault(); }

      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (state === 'racing' || state === 'countdown') togglePause(true);
        else if (state === 'paused') togglePause(false);
      }
      if (e.code === 'KeyM') {
        var muted = Sound.toggleMute();
        popup(muted ? 'SOUND OFF' : 'SOUND ON');
      }
      if (e.code === 'KeyC' && (state === 'racing' || state === 'countdown')) {
        camMode = (camMode + 1) % CAM_MODES.length;
        popup('CAMERA · ' + CAM_MODES[camMode].name);
      }
      if (e.code === 'KeyR' && state === 'racing') {
        player.rescue();
        popup('BACK ON TRACK');
      }
    });

    window.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.code];
      if (k) { keys[k] = false; e.preventDefault(); }
    });

    window.addEventListener('blur', function () {
      keys = {};
      if (state === 'racing') togglePause(true);
    });

    /* touch */
    if ('ontouchstart' in window) {
      touch.active = true;
      el.touch.classList.remove('hidden');
      [['tLeft', 'left'], ['tRight', 'right'], ['tNitro', 'nitro'], ['tBrake', 'brake']]
        .forEach(function (pair) {
          var node = document.getElementById(pair[0]);
          var set = function (v) {
            return function (e) { touch[pair[1]] = v; e.preventDefault(); };
          };
          node.addEventListener('touchstart', set(true), { passive: false });
          node.addEventListener('touchend', set(false), { passive: false });
          node.addEventListener('touchcancel', set(false), { passive: false });
        });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === 'racing') togglePause(true);
    });
  }

  var pausedFrom = 'racing';

  function togglePause(on) {
    if (on && (state === 'racing' || state === 'countdown')) {
      pausedFrom = state;
      state = 'paused';
      Sound.stopNitro();
      screenTo('pauseScreen');
    } else if (!on && state === 'paused') {
      state = pausedFrom;
      hideMenu();
      /* discard the wall-clock time spent in the menu */
      lastFrame = performance.now();
      accumulator = 0;
    }
  }

  function readInput(dt) {
    var steerTarget = 0;
    if (keys.left || touch.left) steerTarget -= 1;
    if (keys.right || touch.right) steerTarget += 1;

    /* smooth the digital keys into something a kart can use */
    steerSmooth += (steerTarget - steerSmooth) * (1 - Math.exp(-11 * dt));

    var throttle = (keys.up || (touch.active && !touch.brake)) ? 1 : 0;
    var brake = (keys.down || touch.brake) ? 1 : 0;

    return {
      throttle: throttle,
      brake: brake,
      steer: steerSmooth,
      nitro: !!(keys.nitro || touch.nitro),
      drift: !!keys.drift
    };
  }

  var FROZEN = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };

  /* ==========================================================
     Main loop
     ========================================================== */

  function loop(now) {
    requestAnimationFrame(loop);

    var frame = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!isFinite(frame) || frame < 0) frame = 0;
    frame = Math.min(frame, MAX_FRAME);
    clockTime += frame;

    if (state === 'menu') return;
    if (state === 'paused' || state === 'results') { renderFrame(0); return; }

    /* Consume real time in fixed steps. The cap covers a frame as slow
       as ~8 fps before the sim starts lagging real time; past that we
       drop the debt rather than spiral. */
    accumulator += frame;
    var steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS) {
      fixedUpdate(STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;

    renderFrame(frame);
  }

  function fixedUpdate(dt) {
    if (state === 'countdown') {
      var before = Math.ceil(countdown);
      countdown -= dt;
      var after = Math.ceil(countdown);
      if (after !== before) {
        if (after >= 1) { flashCenter(String(after)); Sound.countdown(false); }
        else if (after === 0) { flashCenter('GO!'); Sound.countdown(true); }
      }
      if (countdown <= 0) { state = 'racing'; raceTime = 0; }
    }

    var racing = (state === 'racing' || state === 'finished');
    if (racing) raceTime += dt;

    /* the AI rubber-bands around the player, not around the leader */
    var reference = player.totalProgress;

    for (var i = 0; i < karts.length; i++) {
      var k = karts[i];
      var input;
      if (!racing) {
        /* revving on the grid, but going nowhere */
        input = FROZEN;
      } else if (k.isPlayer) {
        input = readInput(dt);
      } else {
        input = k.driveAI(dt, world, reference);
      }
      k.step(dt, input, world, raceTime);
    }

    /* contact */
    for (i = 0; i < karts.length; i++) {
      for (var j = i + 1; j < karts.length; j++) {
        if (karts[i].collide(karts[j], dt)) {
          if (karts[i].isPlayer || karts[j].isPlayer) {
            shake = Math.max(shake, 0.35);
            Sound.hit();
          }
        }
      }
    }

    if (racing) handleRaceEvents(dt);
  }

  function handleRaceEvents(dt) {
    /* player feedback */
    if (player.justPicked) {
      player.justPicked = false;
      Sound.pickup();
      popup('NITRO +34');
    }
    if (player.justBoosted) {
      player.justBoosted = false;
      Sound.boostPad();
      popup('BOOST!');
      shake = Math.max(shake, 0.25);
    }
    if (player.miniTurbo > 0.55) {
      player.miniTurbo = 0;
      popup('MINI-TURBO!');
      Sound.boostPad();
    }
    if (player.hitWall) {
      shake = Math.max(shake, 0.3);
    }

    /* laps + finishing */
    for (var i = 0; i < karts.length; i++) {
      var k = karts[i];
      if (k.justCrossedLine) {
        k.justCrossedLine = false;
        if (k.isPlayer && !k.finished) {
          if (k.lap > track.laps) { /* handled below */ }
          else if (k.lap === track.laps) flashCenter('FINAL LAP');
          else if (k.lap > 1) flashCenter('LAP ' + k.lap);
          if (k.lap > 1 && k.lap <= track.laps) Sound.lap();
        }
      }
      if (!k.finished && k.lap > track.laps) {
        k.finished = true;
        k.finishTime = raceTime;
        k.finishPlace = karts.filter(function (o) { return o.finished; }).length;
        if (k.isPlayer) {
          Sound.finish();
          Sound.stopNitro();
          flashCenter(Util.ordinal(k.finishPlace));
          state = 'finished';
          finishDelay = 3.2;
        }
      }
    }

    if (state === 'finished') {
      finishDelay -= dt;
      if (finishDelay <= 0) showResults();
    }
  }

  /* ==========================================================
     Camera
     ========================================================== */

  function positionCameraBehind(k, snap) {
    var mode = CAM_MODES[camMode];
    var s = track.samples[k.sampleIdx];
    _v.set(Math.sin(k.heading), 0, Math.cos(k.heading));

    camPos.copy(k.pos).addScaledVector(_v, -mode.dist).addScaledVector(s.up, mode.height);
    camLook.copy(k.pos).addScaledVector(_v, mode.look).addScaledVector(s.up, 1.4);

    if (snap) {
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }
  }

  function updateCamera(dt) {
    var mode = CAM_MODES[camMode];
    var s = track.samples[player.sampleIdx];

    _v.set(Math.sin(player.heading), 0, Math.cos(player.heading));
    /* trail slightly wide of a drift so the slide reads on screen */
    _v2.set(Math.sin(player.velAngle), 0, Math.cos(player.velAngle));
    _v.lerp(_v2, 0.35).normalize();

    camPos.copy(player.pos)
      .addScaledVector(_v, -mode.dist)
      .addScaledVector(s.up, mode.height);

    camLook.copy(player.pos)
      .addScaledVector(_v, mode.look)
      .addScaledVector(s.up, 1.4);

    var follow = 1 - Math.exp(-7.5 * dt);
    camera.position.lerp(camPos, follow);

    /* shake from contact and from running wide onto the dirt */
    var rough = (!player.onRoad ? 0.28 : 0) + shake;
    if (rough > 0.001) {
      var amp = rough * 0.45;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
      camera.position.z += (Math.random() - 0.5) * amp;
    }
    shake = Math.max(0, shake - dt * 1.6);

    camera.lookAt(camLook);

    /* speed and nitro widen the lens */
    var frac = THREE.MathUtils.clamp(player.speed / player.maxSpeed, 0, 1.3);
    var targetFov = mode.fov + frac * 7 + (player.burning ? 9 : 0);
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-5 * dt));
    camera.updateProjectionMatrix();
  }

  /* ==========================================================
     Render
     ========================================================== */

  function renderFrame(dt) {
    if (!world) return;

    for (var i = 0; i < karts.length; i++) {
      karts[i].syncMesh(dt);
      karts[i].emitSmoke(dt, world.scene, world.theme);
    }

    world.update(dt, clockTime);
    updateCamera(dt);

    /* engine note follows the player */
    var rpm = THREE.MathUtils.clamp(Math.abs(player.speed) / player.maxSpeed, 0, 1.3);
    Sound.updateEngine(rpm, state === 'racing' ? (keys.up || touch.active ? 0.9 : 0.4) : 0.25);
    if (player.burning) Sound.startNitro(); else Sound.stopNitro();

    renderer.render(world.scene, camera);
    updateHUD();
  }

  /* ==========================================================
     HUD
     ========================================================== */

  var standingRows = [];
  var lastLapShown = -1;

  function buildStandingRows() {
    el.standings.innerHTML = '';
    standingRows = karts.map(function () {
      var row = document.createElement('div');
      row.className = 'stRow';
      row.innerHTML = '<span class="stPos"></span><span class="stDot"></span><span class="stName"></span>';
      el.standings.appendChild(row);
      return {
        node: row,
        pos: row.querySelector('.stPos'),
        dot: row.querySelector('.stDot'),
        name: row.querySelector('.stName')
      };
    });
  }

  var order = [];

  function updateStandings() {
    order = karts.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    for (var i = 0; i < order.length; i++) order[i].place = i + 1;
  }

  function updateHUD() {
    updateStandings();

    /* lap + clock */
    var lap = THREE.MathUtils.clamp(player.lap, 1, track.laps);
    if (lap !== lastLapShown) {
      el.lapNow.textContent = String(lap);
      lastLapShown = lap;
    }
    var t = Util.formatTime(raceTime);
    el.timeMain.textContent = t.main;
    el.timeFrac.textContent = t.frac;

    /* position */
    el.posNum.textContent = String(player.place);
    el.posOrd.textContent = Util.ordinal(player.place).replace(/^\d+/, '');

    /* gap to the kart ahead (or behind, when leading) */
    var idx = player.place - 1;
    var other = idx > 0 ? order[idx - 1] : order[1];
    if (other) {
      var d = Math.abs(other.totalProgress - player.totalProgress) * track.length;
      var ref = Math.max(12, player.speed);
      var secs = d / ref;
      el.gapVal.textContent = (idx > 0 ? '+' : '-') + secs.toFixed(2);
    } else {
      el.gapVal.textContent = '--';
    }

    /* standings list */
    for (var i = 0; i < order.length; i++) {
      var k = order[i], row = standingRows[i];
      if (!row) continue;
      var ord = Util.ordinal(i + 1);
      var num = ord.replace(/[a-z]+$/, ''), suf = ord.replace(/^\d+/, '');
      row.pos.innerHTML = num + '<i>' + suf + '</i>';
      row.dot.style.color = k.color;
      row.name.textContent = k.name;
      row.node.classList.toggle('me', k.isPlayer);
    }

    /* nitro */
    el.nitroFill.style.width = player.nitro.toFixed(1) + '%';
    el.nitroFill.classList.toggle('low', player.nitro < 12);
    el.nitroFill.classList.toggle('burn', player.burning);

    drawMinimap();
    drawSpeedo();
  }

  function drawMinimap() {
    var ctx = el.mapCtx, W = el.minimap.width, H = el.minimap.height;
    ctx.clearRect(0, 0, W, H);

    var pad = 16, w = W - pad * 2, h = H - pad * 2;
    var pts = track.minimap;

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pad + pts[i][0] * w, y = pad + pts[i][1] * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.72)';
    ctx.lineWidth = 5;
    ctx.stroke();

    /* start line */
    var s0 = track.toMinimap(track.samples[0].pos);
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pad + s0[0] * w, pad + s0[1] * h, 5, 0, Math.PI * 2);
    ctx.stroke();

    /* karts */
    for (var k = 0; k < karts.length; k++) {
      var kart = karts[k];
      var p = track.toMinimap(kart.pos);
      var px = pad + p[0] * w, py = pad + p[1] * h;
      ctx.fillStyle = kart.color;
      ctx.beginPath();
      ctx.arc(px, py, kart.isPlayer ? 5.5 : 3.6, 0, Math.PI * 2);
      ctx.fill();
      if (kart.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawSpeedo() {
    var ctx = el.speedCtx, W = el.speedo.width, H = el.speedo.height;
    ctx.clearRect(0, 0, W, H);

    var cx = W / 2, cy = H * 0.72, r = Math.min(W, H) * 0.52;
    var a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;
    var maxKmh = 300;
    var frac = THREE.MathUtils.clamp(player.speedKmh() / maxKmh, 0, 1);

    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();

    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#7fc4ff');
    g.addColorStop(0.6, '#ffd34d');
    g.addColorStop(1, '#ff5a3c');
    ctx.strokeStyle = g;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    ctx.stroke();

    /* ticks */
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 2;
    for (var i = 0; i <= 6; i++) {
      var a = a0 + (a1 - a0) * (i / 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
    }

    /* Needle: drawn as a short pointer riding just inside the arc, so it
       never crosses the digits in the middle of the dial. */
    var na = a0 + (a1 - a0) * frac;
    ctx.strokeStyle = player.burning ? '#ffd34d' : '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * (r - 26), cy + Math.sin(na) * (r - 26));
    ctx.lineTo(cx + Math.cos(na) * (r - 6), cy + Math.sin(na) * (r - 6));
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 38px Helvetica, Arial, sans-serif';
    ctx.fillText(String(Math.round(player.speedKmh())), cx, cy + 2);
    ctx.font = '700 12px Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText('KM/H', cx, cy + 20);
  }

  /* ---------- messages ---------- */

  function flashCenter(text) {
    el.centerMsg.textContent = text;
    el.centerMsg.classList.remove('show');
    void el.centerMsg.offsetWidth;      /* restart the animation */
    el.centerMsg.classList.add('show');
  }

  function popup(text) {
    el.popup.textContent = text;
    el.popup.classList.remove('show');
    void el.popup.offsetWidth;
    el.popup.classList.add('show');
  }

  /* ==========================================================
     Results
     ========================================================== */

  function showResults() {
    state = 'results';
    Sound.stopNitro();

    /* project the rest of the field onto a plausible finishing order */
    updateStandings();

    el.resultTitle.textContent =
      player.place === 1 ? 'WINNER' : Util.ordinal(player.place) + ' PLACE';

    el.resultBoard.innerHTML = order.map(function (k, i) {
      var time;
      if (k.finished) {
        time = Util.formatTime(k.finishTime).full;
      } else {
        /* still out on track — quote the gap to the leader instead */
        var behind = (order[0].totalProgress - k.totalProgress) * track.length;
        time = '+' + (behind / Math.max(20, k.maxSpeed)).toFixed(2) + 's';
      }
      return '<div class="bRow' + (k.isPlayer ? ' me' : '') + '">' +
             '<span class="bPos">' + Util.ordinal(i + 1) + '</span>' +
             '<span class="stDot" style="color:' + k.color + '"></span>' +
             '<span>' + k.name + '</span>' +
             '<span class="bTime">' + time + '</span>' +
             '</div>';
    }).join('') +
      '<div class="bRow"><span class="bPos">BEST</span><span></span>' +
      '<span>YOUR FASTEST LAP</span><span class="bTime">' +
      (player.bestLap ? Util.formatTime(player.bestLap).full : '--:--') + '</span></div>';

    screenTo('resultScreen');
    el.hud.classList.add('hidden');
    Sound.stopEngine();
  }

  return { boot: boot };
})();

window.addEventListener('load', Game.boot);
