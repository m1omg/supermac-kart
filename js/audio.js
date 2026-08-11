/* ============================================================
   Audio — everything is synthesised with WebAudio, so there are
   no sound files to ship.  Engine note tracks speed, nitro adds
   a filtered noise roar, and the UI gets classic Mac-ish blips.

   The soundtrack is sequenced here too (see "music" below): a
   retrowave arrangement built from oscillators on a scheduled
   16th-note grid, not a sample loop.  That keeps the download at
   zero bytes and lets every circuit take its own key and lead.
   ============================================================ */

var Sound = (function () {

  var ctx = null;
  var master = null;
  var engine = null;      /* { osc, sub, gain, filter } */
  var nitro  = null;      /* { src, gain, filter }      */
  var muted = false;
  var started = false;

  function init() {
    if (started) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    buildMusicBus();
    started = true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ---------- engine ---------- */

  function startEngine() {
    if (!ctx || engine) return;

    var gain = ctx.createGain();
    gain.gain.value = 0;

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;

    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;

    var sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;

    var subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start();
    sub.start();

    engine = { osc: osc, sub: sub, gain: gain, filter: filter };
  }

  function stopEngine() {
    if (!engine) return;
    try { engine.osc.stop(); engine.sub.stop(); } catch (e) { /* already stopped */ }
    engine = null;
    stopNitro();
  }

  /* rpm 0..1, load 0..1 */
  function updateEngine(rpm, load) {
    if (!engine || !ctx) return;
    var t = ctx.currentTime;
    var f = 48 + rpm * 210;
    engine.osc.frequency.setTargetAtTime(f, t, 0.05);
    engine.sub.frequency.setTargetAtTime(f / 2, t, 0.06);
    engine.filter.frequency.setTargetAtTime(500 + rpm * 2600, t, 0.08);
    engine.gain.gain.setTargetAtTime(0.05 + load * 0.1, t, 0.08);
  }

  /* ---------- nitro roar ---------- */

  function startNitro() {
    if (!ctx || nitro) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2);
    src.loop = true;

    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.8;

    var gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.06);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();

    nitro = { src: src, gain: gain, filter: filter };
  }

  function stopNitro() {
    if (!nitro || !ctx) return;
    var n = nitro;
    nitro = null;
    n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    setTimeout(function () { try { n.src.stop(); } catch (e) { /* noop */ } }, 400);
  }

  /* ---------- one-shots ---------- */

  function blip(freq, duration, type, vol) {
    if (!ctx) return;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + duration + 0.05);
  }

  function thud() {
    if (!ctx) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.3);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    src.stop(ctx.currentTime + 0.35);
  }

  /* ==========================================================
     Music

     A step sequencer on a 16th-note grid.  A timer wakes up every
     25 ms and schedules every note that falls inside the next
     120 ms, using the audio clock rather than the timer's own
     drift-prone one — the standard WebAudio lookahead trick, and
     the only way the groove survives a frame hitch during a race.

     Everything below is deterministic: the arrangement advances
     off the bar counter, never off a random number, so a circuit
     always sounds like itself.
     ========================================================== */

  var LOOKAHEAD = 0.12;   /* schedule this far ahead, in seconds */
  var TICK = 25;          /* how often the scheduler wakes, in ms */

  var musicBus = null;    /* everything musical lands here  */
  var musicGain = null;   /* the level the arrangement asks for */
  var duckGain = null;    /* pulled down while the race is loud */
  var delaySend = null;
  var verbSend = null;
  var musicOn = true;

  var song = null;        /* the running arrangement, or null */
  var timer = null;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* Exponential ramps cannot touch zero, and a hard stop clicks;
     everything that ends does it through this. */
  function decayTo(param, t, end) {
    param.exponentialRampToValueAtTime(0.0001, t + end);
  }

  function impulse(seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function buildMusicBus() {
    duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    duckGain.connect(master);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(duckGain);

    /* a gentle ceiling so a dense bar can't clip the mix */
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.18;
    comp.connect(musicGain);

    musicBus = comp;

    /* wide plate for the pad and the gated snare */
    var verb = ctx.createConvolver();
    verb.buffer = impulse(2.2, 2.6);
    var verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    verb.connect(verbOut);
    verbOut.connect(musicBus);
    verbSend = ctx.createGain();
    verbSend.gain.value = 1;
    verbSend.connect(verb);

    /* dotted-eighth delay: the sound of the genre.  Its time is set
       per arrangement, in startMusic. */
    var delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.32;
    var fb = ctx.createGain();
    fb.gain.value = 0.36;
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    var delayOut = ctx.createGain();
    delayOut.gain.value = 0.55;
    delay.connect(delayOut);
    delayOut.connect(musicBus);
    delaySend = ctx.createGain();
    delaySend.gain.value = 1;
    delaySend.connect(delay);

    musicBus.userDelay = delay;
  }

  /* ---------- voices ---------- */

  function voiceKick(t, vel) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(132, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.006);
    decayTo(g.gain, t, 0.34);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 0.38);

    /* the beater click, so it cuts through the engine */
    var n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.03);
    var nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1400;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.4, t);
    decayTo(ng.gain, t, 0.03);
    n.connect(nf); nf.connect(ng); ng.connect(musicBus);
    n.start(t); n.stop(t + 0.04);
  }

  /* Gated reverb: the snare is short, but its tail is thrown into
     the plate and then cut off mid-bloom.  That abrupt stop is the
     whole 80s drum sound. */
  function voiceSnare(t, vel) {
    var n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.4);
    var f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1100;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    decayTo(g.gain, t, 0.16);

    var body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(232, t);
    body.frequency.exponentialRampToValueAtTime(148, t + 0.09);
    var bg = ctx.createGain();
    bg.gain.setValueAtTime(vel * 0.55, t);
    decayTo(bg.gain, t, 0.11);

    var gate = ctx.createGain();
    gate.gain.setValueAtTime(0.5, t);
    gate.gain.setValueAtTime(0.5, t + 0.13);
    gate.gain.linearRampToValueAtTime(0, t + 0.145);

    n.connect(f); f.connect(g); g.connect(musicBus); g.connect(gate);
    body.connect(bg); bg.connect(musicBus);
    gate.connect(verbSend);

    n.start(t); n.stop(t + 0.2);
    body.start(t); body.stop(t + 0.14);
  }

  function voiceHat(t, vel, open) {
    var len = open ? 0.26 : 0.05;
    var n = ctx.createBufferSource();
    n.buffer = noiseBuffer(len + 0.05);
    var f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    decayTo(g.gain, t, len);
    n.connect(f); f.connect(g); g.connect(musicBus);
    n.start(t); n.stop(t + len + 0.04);
  }

  /* The driving low end: saw and square an octave apart through a
     resonant lowpass that opens a little on every note. */
  function voiceBass(t, dur, midi, vel) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.03);
    f.frequency.exponentialRampToValueAtTime(340, t + dur * 0.9);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.008);
    g.gain.setValueAtTime(vel, t + dur * 0.7);
    decayTo(g.gain, t, dur);

    var a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = mtof(midi);
    var b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = mtof(midi - 12);
    var bg = ctx.createGain();
    bg.gain.value = 0.5;

    a.connect(f); b.connect(bg); bg.connect(f);
    f.connect(g); g.connect(musicBus);
    a.start(t); a.stop(t + dur + 0.05);
    b.start(t); b.stop(t + dur + 0.05);
  }

  /* Plucked arpeggio — short, bright, and thrown into the delay so
     the repeats fill the gaps between the lead's long notes. */
  function voicePluck(t, dur, midi, vel) {
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    var o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = mtof(midi) * 1.006;

    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.005);
    decayTo(g.gain, t, dur);

    var send = ctx.createGain();
    send.gain.value = 0.5;

    o.connect(f); o2.connect(f); f.connect(g);
    g.connect(musicBus); g.connect(send); send.connect(delaySend);
    o.start(t); o.stop(t + dur + 0.05);
    o2.start(t); o2.stop(t + dur + 0.05);
  }

  /* The lead: three detuned saws, slow vibrato, long release, and
     as much delay and plate as it can carry. */
  function voiceLead(t, dur, midi, vel, patch) {
    var freq = mtof(midi);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + patch.attack);
    g.gain.setValueAtTime(vel, t + dur * 0.8);
    decayTo(g.gain, t, dur + patch.release);

    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = patch.q;
    f.frequency.setValueAtTime(patch.cut * 0.55, t);
    f.frequency.linearRampToValueAtTime(patch.cut, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(patch.cut * 0.6, t + dur + patch.release);

    var vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.2;
    var vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(dur, 0.45));
    vib.connect(vibAmt);

    var det = [-patch.detune, 0, patch.detune];
    for (var i = 0; i < det.length; i++) {
      var o = ctx.createOscillator();
      o.type = patch.wave;
      o.frequency.value = freq;
      o.detune.value = det[i];
      vibAmt.connect(o.frequency);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + patch.release + 0.1);
    }

    var dSend = ctx.createGain(); dSend.gain.value = 0.42;
    var vSend = ctx.createGain(); vSend.gain.value = 0.3;

    f.connect(g);
    g.connect(musicBus);
    g.connect(dSend); dSend.connect(delaySend);
    g.connect(vSend); vSend.connect(verbSend);

    vib.start(t);
    vib.stop(t + dur + patch.release + 0.1);
  }

  /* Wide sustained chord, filter opening across the whole bar. */
  function voicePad(t, dur, notes, vel) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(420, t);
    f.frequency.linearRampToValueAtTime(1700, t + dur * 0.6);
    f.frequency.linearRampToValueAtTime(600, t + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + dur * 0.25);
    g.gain.setValueAtTime(vel, t + dur * 0.7);
    decayTo(g.gain, t, dur + 0.5);

    for (var i = 0; i < notes.length; i++) {
      for (var d = -1; d <= 1; d += 2) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(notes[i]);
        o.detune.value = d * 7;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.6);
      }
    }

    var vSend = ctx.createGain();
    vSend.gain.value = 0.55;
    f.connect(g);
    g.connect(musicBus);
    g.connect(vSend); vSend.connect(verbSend);
  }

  /* ---------- arrangements ---------- */

  /* Natural minor, the genre's home. Chords are scale degrees
     i - VI - III - VII, which is most of retrowave by itself. */
  var PROG = [
    [0, 3, 7, 10],      /* i7   */
    [8, 12, 15, 19],    /* VI   */
    [3, 7, 10, 14],     /* III  */
    [10, 14, 17, 21]    /* VII  */
  ];

  /* Eight bars of lead, in steps from the start of the phrase.
     [step, semitone above the key root, length in steps] */
  var MELODY = [
    [0, 12, 14], [16, 15, 6], [22, 14, 8], [32, 10, 14], [48, 7, 14],
    [64, 15, 6], [70, 17, 6], [76, 19, 4], [80, 19, 14],
    [96, 17, 6], [102, 15, 6], [108, 14, 4], [112, 12, 15]
  ];

  /* Which octave the bass jumps to, per eighth note of a bar. */
  var BASS = [0, 0, 12, 0, 0, 12, 0, 12];

  /* One per circuit: a key, a tempo and a lead voice, so the four
     tracks are recognisably different pieces of the same record. */
  var CIRCUIT = {
    coast:   { root: 45, bpm: 112, patch: { wave: 'sawtooth', detune: 11, cut: 3200, q: 5, attack: 0.05, release: 0.55 } },
    aqua:    { root: 43, bpm: 106, patch: { wave: 'sawtooth', detune: 18, cut: 2400, q: 8, attack: 0.11, release: 0.8 } },
    system7: { root: 47, bpm: 118, patch: { wave: 'square',   detune: 7,  cut: 3800, q: 3, attack: 0.03, release: 0.4 } },
    silicon: { root: 41, bpm: 124, patch: { wave: 'sawtooth', detune: 24, cut: 4200, q: 9, attack: 0.02, release: 0.35 } }
  };

  var MENU_PATCH = { wave: 'sawtooth', detune: 14, cut: 2200, q: 4, attack: 0.35, release: 1.2 };

  /* ---------- the sequencer ---------- */

  function chordAt(bar) { return PROG[bar % PROG.length]; }

  /* Everything the arrangement does for one 16th note. */
  function step(s) {
    var t = s.time;
    var i = s.index;                 /* 0..15 inside the bar */
    var bar = s.bar;
    var root = s.root;
    var chord = chordAt(bar);
    var beat = s.spb * 4;            /* seconds per bar / 4 = a beat */

    /* ---- pad: one chord per bar ---- */
    if (i === 0) {
      var notes = [];
      for (var c = 0; c < chord.length; c++) notes.push(root + 12 + chord[c]);
      voicePad(t, s.spb * 16, notes, s.race ? 0.055 : 0.085);
    }

    /* ---- drums ---- */
    if (s.drums) {
      if (i % 4 === 0) voiceKick(t, i === 0 ? 0.85 : 0.72);
      /* a pickup kick into the bar, every other bar */
      if (i === 14 && bar % 2 === 1) voiceKick(t, 0.45);
      if (i === 4 || i === 12) voiceSnare(t, 0.5);
      if (i % 2 === 1) voiceHat(t, i === 7 || i === 15 ? 0.16 : 0.09, i === 15);
    }

    /* ---- bass ---- */
    if (s.bass && i % 2 === 0) {
      var oct = BASS[i / 2];
      voiceBass(t, s.spb * 1.7, root - 12 + chord[0] + oct, 0.34);
    }

    /* ---- arpeggio ---- */
    if (s.arp) {
      var tone = chord[(i + (bar % 2 ? 1 : 0)) % chord.length];
      var up = (i % 8 < 4) ? 12 : 24;
      voicePluck(t, s.spb * 1.6, root + 12 + tone + up - 12, 0.10);
    }

    /* ---- lead ---- */
    if (s.lead) {
      var phraseStep = ((bar % 8) * 16) + i;
      for (var m = 0; m < MELODY.length; m++) {
        if (MELODY[m][0] === phraseStep) {
          voiceLead(t, s.spb * MELODY[m][2], root + 12 + MELODY[m][1], 0.13, s.patch);
        }
      }
    }
  }

  function scheduler() {
    if (!song || !ctx) return;
    while (song.next < ctx.currentTime + LOOKAHEAD) {
      var i = song.step % 16;
      var bar = Math.floor(song.step / 16);

      /* The arrangement builds for its first four bars and then
         loops the full band, so the sparse intro is heard once. */
      var stage = song.race ? Math.min(4, Math.floor(bar / 4)) : 1;

      step({
        time: song.next, index: i, bar: bar, root: song.root,
        spb: song.spb, patch: song.patch, race: song.race,
        drums: song.race && stage >= 1,
        bass:  true,
        arp:   song.race ? stage >= 2 : (i % 2 === 0),
        lead:  song.race ? stage >= 3 : false
      });

      song.next += song.spb;
      song.step++;
      /* after the intro, wrap back to bar 4 so it never empties out */
      if (song.race && song.step >= 16 * 20) song.step = 16 * 4;
      if (!song.race && song.step >= 16 * 8) song.step = 0;
    }
  }

  function startMusic(kind, circuitId) {
    if (!ctx || !musicOn) return;
    var cfg = (kind === 'race' && CIRCUIT[circuitId]) ? CIRCUIT[circuitId] : null;
    var bpm = cfg ? cfg.bpm : 84;
    var spb = 60 / bpm / 4;                 /* seconds per 16th note */

    stopMusic(0.35);

    song = {
      race: kind === 'race',
      root: cfg ? cfg.root : 45,
      patch: cfg ? cfg.patch : MENU_PATCH,
      spb: spb,
      step: 0,
      next: ctx.currentTime + 0.12
    };

    /* dotted eighth, the genre's delay setting */
    musicBus.userDelay.delayTime.setValueAtTime(spb * 6, ctx.currentTime);

    var level = song.race ? 0.5 : 0.62;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.4);

    if (timer) clearInterval(timer);
    timer = setInterval(scheduler, TICK);
  }

  /* Fades out and lets the tails ring; nothing is cut mid-note. */
  function stopMusic(fade) {
    if (!ctx) return;
    song = null;
    if (timer) { clearInterval(timer); timer = null; }
    if (!musicGain) return;
    var t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(0, t + (fade === undefined ? 1.2 : fade));
  }

  /* Pull the music down without stopping it — used while the race
     is at its loudest so the engine and the hits stay readable. */
  function duck(amount, time) {
    if (!duckGain || !ctx) return;
    duckGain.gain.setTargetAtTime(amount, ctx.currentTime, time || 0.25);
  }

  var mode = 'none';        /* what the game last asked for */
  var modeTrack = null;

  function music(kind, circuitId) {
    if (kind === mode && circuitId === modeTrack) return;
    mode = kind;
    modeTrack = circuitId || null;
    if (!ctx) return;
    if (kind === 'none' || !musicOn) stopMusic(1.2);
    else startMusic(kind, circuitId);
  }

  return {
    init: function () { init(); resume(); },
    startEngine: startEngine,
    stopEngine: stopEngine,
    updateEngine: updateEngine,
    startNitro: startNitro,
    stopNitro: stopNitro,

    /* kind: 'menu' | 'race' | 'none' */
    music: music,
    duck: duck,
    _song: function () { return song; },   /* test hook */
    toggleMusic: function () {
      musicOn = !musicOn;
      if (!musicOn) stopMusic(0.6);
      else if (mode !== 'none') startMusic(mode, modeTrack);
      return musicOn;
    },
    musicEnabled: function () { return musicOn; },

    pickup:   function () { blip(880, 0.12, 'square', 0.18); setTimeout(function(){ blip(1320, 0.1, 'square', 0.14); }, 70); },
    boostPad: function () { blip(520, 0.18, 'sawtooth', 0.16); },
    countdown:function (go) { blip(go ? 1046 : 523, go ? 0.5 : 0.18, 'triangle', 0.3); },
    lap:      function () { blip(784, 0.14, 'triangle', 0.22); setTimeout(function(){ blip(1046, 0.22, 'triangle', 0.22); }, 120); },
    finish:   function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        setTimeout(function () { blip(f, 0.35, 'triangle', 0.26); }, i * 130);
      });
    },
    hit: thud,
    click:    function () { blip(660, 0.06, 'square', 0.12); },

    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    isMuted: function () { return muted; }
  };
})();
