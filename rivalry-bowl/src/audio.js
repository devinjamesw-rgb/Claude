/* Rivalry Bowl: tiny WebAudio synth for 8-bit sound effects. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const A = { ctx: null, on: true, master: null, noiseBuf: null };

  function unlock() {
    if (A.ctx || typeof window === 'undefined') {
      if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.22;
      A.master.connect(A.ctx.destination);
      const len = A.ctx.sampleRate * 0.5;
      A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
      const d = A.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      A.ctx = null;
    }
  }

  function tone(freq, t0, dur, type, vol, slideTo) {
    const c = A.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(A.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return o;
  }

  function noise(t0, dur, vol, hp) {
    const c = A.ctx;
    const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    s.buffer = A.noiseBuf;
    f.type = hp ? 'highpass' : 'lowpass';
    f.frequency.value = hp || 900;
    g.gain.setValueAtTime(vol || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(A.master);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }

  function play(name) {
    if (!A.on || !A.ctx) return;
    const t = A.ctx.currentTime + 0.01;
    switch (name) {
      case 'hut': noise(t, 0.08, 0.6); tone(140, t, 0.1, 'square', 0.3); break;
      case 'whistle': {
        const o = tone(2350, t, 0.32, 'square', 0.18);
        const lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
        lfo.frequency.value = 38; lg.gain.value = 120;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 0.34);
        break;
      }
      case 'throw': noise(t, 0.12, 0.25, 1800); break;
      case 'catch': tone(660, t, 0.05, 'square', 0.35); tone(990, t + 0.05, 0.07, 'square', 0.35); break;
      case 'juke': noise(t, 0.09, 0.5); tone(90, t, 0.1, 'triangle', 0.5); break;
      case 'swish': noise(t, 0.15, 0.2, 2500); break;
      case 'first': tone(784, t, 0.08, 'square', 0.3); tone(1046, t + 0.09, 0.12, 'square', 0.3); break;
      case 'bad': tone(392, t, 0.12, 'square', 0.3, 330); tone(262, t + 0.13, 0.25, 'square', 0.3, 196); break;
      case 'kick': noise(t, 0.07, 0.8); tone(110, t, 0.12, 'triangle', 0.6, 60); break;
      case 'td':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.16, 'square', 0.3));
        noise(t, 1.2, 0.12, 400);
        break;
      case 'final':
        [392, 523, 659, 784, 659, 1046].forEach((f, i) => tone(f, t + i * 0.12, 0.2, 'square', 0.28));
        break;
      case 'tap': tone(880, t, 0.03, 'square', 0.18); break;
    }
  }

  RB.Audio = { unlock, play, setOn: (v) => { A.on = v; }, isOn: () => A.on };
})(typeof window !== 'undefined' ? window : globalThis);
