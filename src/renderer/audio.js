'use strict';

function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x3fffffff - 1) * 0.9;
    }
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function env(g, t0, a, hold, r, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.setValueAtTime(peak, t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r);
  }

  function noise(t0, dur, freq, q, peak, out) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    env(g, t0, 0.005, dur * 0.3, dur * 0.7, peak);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  function shaper() {
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    ws.curve = curve;
    return ws;
  }

  function caw(t0, pitch, dur, peak) {
    const out = ctx.createGain();
    out.gain.value = 1;
    const ws = shaper();
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 1150;
    f1.Q.value = 2.2;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2500;
    f2.Q.value = 4;
    const vca = ctx.createGain();
    env(vca, t0, 0.012, dur * 0.55, dur * 0.45, peak);
    const am = ctx.createOscillator();
    am.frequency.value = 58;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.45;
    const amBias = ctx.createGain();
    amBias.gain.value = 0.55;
    am.connect(amDepth);
    amDepth.connect(amBias.gain);
    const f0 = 560 * pitch;
    for (const [type, det] of [
      ['sawtooth', 1],
      ['square', 1.008],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * 0.82 * det, t0);
      o.frequency.linearRampToValueAtTime(f0 * det, t0 + 0.045);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6 * det, t0 + dur);
      o.connect(amBias);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    amBias.connect(ws);
    ws.connect(f1);
    ws.connect(f2);
    f1.connect(vca);
    f2.connect(vca);
    vca.connect(out);
    out.connect(master);
    am.start(t0);
    am.stop(t0 + dur + 0.05);
    noise(t0, dur * 0.9, 2600, 1.2, peak * 0.35, master);
  }

  function tone(t0, freq, dur, type, peak, bend = 1) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t0 + dur);
    const g = ctx.createGain();
    env(g, t0, 0.004, dur * 0.2, dur * 0.8, peak);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const SOUNDS = {
    caw(t0) {
      caw(t0, 1, 0.3, 0.55);
    },
    chirp(t0) {
      caw(t0, 1.45, 0.12, 0.3);
    },
    flap(t0) {
      noise(t0, 0.14, 700, 0.7, 0.25, master);
    },
    crunch(t0) {
      for (let i = 0; i < 3; i++) noise(t0 + i * 0.035, 0.03, 3200 + i * 400, 2, 0.28, master);
    },
    tock(t0) {
      tone(t0, 420, 0.06, 'triangle', 0.2, 0.7);
      noise(t0, 0.03, 1800, 1.5, 0.12, master);
    },
    pickup(t0) {
      tone(t0, 1320, 0.25, 'sine', 0.22);
      tone(t0 + 0.07, 1980, 0.3, 'sine', 0.18);
    },
    drop(t0) {
      tone(t0, 300, 0.08, 'triangle', 0.22, 0.6);
    },
    thud(t0) {
      tone(t0, 180, 0.07, 'sine', 0.16, 0.6);
    },
  };

  function play(name, volume = 0.5) {
    const c = ensure();
    if (!c || !SOUNDS[name]) return;
    if (c.state === 'suspended') c.resume();
    master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), c.currentTime);
    SOUNDS[name](c.currentTime + 0.01);
  }

  return { play, unlock };
}

module.exports = { createAudio };
