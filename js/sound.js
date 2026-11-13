/* Табла — звукови ефекти, синтезирани с Web Audio (без звукови файлове). */
(function () {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;

  function ac() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  // браузърът пуска звук само след действие на потребителя
  function unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  function ready() {
    if (!enabled) return null;
    const c = ac();
    if (!c || c.state !== 'running') return null;
    return c;
  }

  // кратък шумов импулс през филтър — тракане на дърво или кост
  function knock(c, t, { freq = 900, q = 4, gain = 0.6, dur = 0.06, type = 'bandpass' } = {}) {
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }
  // тон с бързо затихване — тялото на удара
  function tone(c, t, { f0 = 200, f1 = 120, gain = 0.4, dur = 0.12, type = 'sine' } = {}) {
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  const S = {
    // пул се поставя на точка
    move(delay = 0) {
      const c = ready(); if (!c) return;
      const t = c.currentTime + delay;
      knock(c, t, { freq: rnd(1100, 1400), q: 3, gain: 0.5, dur: 0.05 });
      tone(c, t, { f0: rnd(260, 300), f1: 160, gain: 0.35, dur: 0.09 });
    },
    // заровете се търкалят и спират
    dice() {
      const c = ready(); if (!c) return;
      let t = c.currentTime;
      const n = 7 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const fade = 1 - i / n;
        knock(c, t, { freq: rnd(2200, 3600), q: 6, gain: 0.25 + 0.4 * fade, dur: 0.035 });
        if (Math.random() < 0.5) knock(c, t + rnd(0.01, 0.025), { freq: rnd(1800, 3000), q: 6, gain: 0.2 * fade + 0.1, dur: 0.03 });
        t += rnd(0.03, 0.07) + i * 0.012;
      }
    },
    // удар: пул срещу пул и тупване на бара
    hit(delay = 0) {
      const c = ready(); if (!c) return;
      const t = c.currentTime + delay;
      knock(c, t, { freq: 1500, q: 2.5, gain: 0.8, dur: 0.06 });
      tone(c, t, { f0: 330, f1: 180, gain: 0.4, dur: 0.1 });
      knock(c, t + 0.07, { freq: 1900, q: 3, gain: 0.55, dur: 0.05 });
      tone(c, t + 0.16, { f0: 140, f1: 60, gain: 0.7, dur: 0.22 });
      knock(c, t + 0.16, { freq: 400, q: 1, gain: 0.5, dur: 0.12, type: 'lowpass' });
    },
    // изваждане: плъзгане и светъл звън
    bearoff(delay = 0) {
      const c = ready(); if (!c) return;
      const t = c.currentTime + delay;
      knock(c, t, { freq: 2500, q: 0.8, gain: 0.18, dur: 0.16 });
      tone(c, t + 0.06, { f0: 880, f1: 870, gain: 0.22, dur: 0.35, type: 'triangle' });
      tone(c, t + 0.13, { f0: 1320, f1: 1310, gain: 0.16, dur: 0.4, type: 'triangle' });
    },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
  };
  window.TablaSound = S;
})();
