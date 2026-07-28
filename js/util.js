/* ============================================================
   Util — maths helpers shared by the track builder, the
   pseudo-3D renderer and the race simulation.
   Everything here is pure; no DOM, no state.
   ============================================================ */

var Util = (function () {

  function limit(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  /* Fractional part of `n` within a repeating span of `total`. */
  function percentRemaining(n, total) {
    return (n % total) / total;
  }

  function interpolate(a, b, percent) {
    return a + (b - a) * percent;
  }

  function easeIn(a, b, percent)  { return a + (b - a) * Math.pow(percent, 2); }
  function easeOut(a, b, percent) { return a + (b - a) * (1 - Math.pow(1 - percent, 2)); }
  function easeInOut(a, b, percent) {
    return a + (b - a) * (-Math.cos(percent * Math.PI) / 2 + 0.5);
  }

  /* Distance fog: 1 = clear, 0 = fully fogged. */
  function exponentialFog(distance, density) {
    return 1 / Math.pow(Math.E, distance * distance * density);
  }

  /* Move along a looping track, wrapping in both directions. */
  function increase(start, increment, max) {
    var result = start + increment;
    while (result >= max) result -= max;
    while (result < 0)    result += max;
    return result;
  }

  /* Do two 1-D spans overlap? `percent` shrinks the hit boxes so
     brushing past a cone is forgiving. */
  function overlap(x1, w1, x2, w2, percent) {
    var half = (percent === undefined ? 1 : percent) / 2;
    var min1 = x1 - (w1 * half), max1 = x1 + (w1 * half);
    var min2 = x2 - (w2 * half), max2 = x2 + (w2 * half);
    return !((max1 < min2) || (min1 > max2));
  }

  /* Deterministic PRNG so every "predefined" track is byte-identical
     on every load — scenery included. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Format seconds as m:ss.hh, split so the HUD can style the fraction. */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds - m * 60);
    var h = Math.floor((seconds - Math.floor(seconds)) * 100);
    return {
      main: m + ':' + (s < 10 ? '0' : '') + s,
      frac: '.' + (h < 10 ? '0' : '') + h,
      full: m + ':' + (s < 10 ? '0' : '') + s + '.' + (h < 10 ? '0' : '') + h
    };
  }

  var ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  function ordinal(n) { return ORDINALS[n - 1] || (n + 'th'); }

  /* "#rrggbb" -> "rgba(r,g,b,a)" — used for fog blends and glows. */
  function rgba(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /* Blend two hex colours; t=0 -> a, t=1 -> b. */
  function mix(a, b, t) {
    function parse(hex) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var ca = parse(a), cb = parse(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  return {
    limit: limit,
    percentRemaining: percentRemaining,
    interpolate: interpolate,
    easeIn: easeIn,
    easeOut: easeOut,
    easeInOut: easeInOut,
    exponentialFog: exponentialFog,
    increase: increase,
    overlap: overlap,
    rng: rng,
    formatTime: formatTime,
    ordinal: ordinal,
    rgba: rgba,
    mix: mix
  };
})();
