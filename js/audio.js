/* ============================================================
   Audio — everything is synthesised with WebAudio, so there are
   no sound files to ship.  Engine note tracks speed, nitro adds
   a filtered noise roar, and the UI gets classic Mac-ish blips.
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

  return {
    init: function () { init(); resume(); },
    startEngine: startEngine,
    stopEngine: stopEngine,
    updateEngine: updateEngine,
    startNitro: startNitro,
    stopNitro: stopNitro,

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
