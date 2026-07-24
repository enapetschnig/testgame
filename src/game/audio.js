/**
 * Ton, komplett synthetisiert — keine Audiodateien, damit das Spiel als
 * einzelnes Bundle auskommt.
 *
 * Motor: mehrere Saegezahn-Oszillatoren auf Vielfachen der Kurbelwellen-
 * frequenz, dazu ein Tiefpass, dessen Eckfrequenz mit der Last aufmacht.
 * Reifen und Fahrtwind: gefiltertes Rauschen. Aufprall: kurzer Rauschpuls.
 */

import { clamp, lerp } from '../core/utils.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let started = false;
  let muted = false;

  function noiseBuffer(seconds = 2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function start() {
    if (started) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);

    // --- Motor -----------------------------------------------------------
    const engGain = ctx.createGain();
    engGain.gain.value = 0;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.9;

    const oscs = [];
    // Zuend- und Oberwellen eines Vierzylinders
    for (const [mult, level, type] of [
      [1, 0.5, 'sawtooth'],
      [2, 0.34, 'sawtooth'],
      [3, 0.18, 'square'],
      [0.5, 0.28, 'sine'],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(lp);
      o.start();
      oscs.push({ o, mult, g });
    }
    lp.connect(engGain).connect(master);

    // Rauhigkeit: leises Rauschen mitlaufen lassen
    const engNoise = ctx.createBufferSource();
    engNoise.buffer = noiseBuffer();
    engNoise.loop = true;
    const engNoiseGain = ctx.createGain();
    engNoiseGain.gain.value = 0.05;
    const engNoiseFilter = ctx.createBiquadFilter();
    engNoiseFilter.type = 'bandpass';
    engNoiseFilter.frequency.value = 340;
    engNoise.connect(engNoiseFilter).connect(engNoiseGain).connect(engGain);
    engNoise.start();

    // --- Reifen / Fahrtwind ----------------------------------------------
    const tyre = ctx.createBufferSource();
    tyre.buffer = noiseBuffer();
    tyre.loop = true;
    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1400;
    tyreFilter.Q.value = 0.7;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    tyre.connect(tyreFilter).connect(tyreGain).connect(master);
    tyre.start();

    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer();
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    engine = { oscs, lp, engGain, tyreGain, tyreFilter, windGain, windFilter };
  }

  /** Vom Spiel jeden Frame aufgerufen. */
  function update(vehicle, dt) {
    if (!started || !engine || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = 1 - Math.exp(-8 * dt); // Glaettung

    // Kurbelwellenfrequenz aus der Drehzahl
    const base = clamp(vehicle.rpm / 60, 12, 130);
    for (const { o, mult } of engine.oscs) {
      o.frequency.setTargetAtTime(base * mult, t, 0.03);
    }

    const load = clamp(vehicle.engineLoad * 0.7 + vehicle.rpm / 9000, 0, 1);
    engine.lp.frequency.setTargetAtTime(lerp(420, 3200, load), t, 0.06);
    engine.engGain.gain.setTargetAtTime(
      vehicle.kind === 'tractor' ? 0.2 : 0.15 + load * 0.14,
      t,
      0.08,
    );

    // Reifen: Schlupf quietscht, Schotter rauscht
    const slip = vehicle.slip * clamp(vehicle.speed / 8, 0, 1);
    const gravel = vehicle.onRoad ? 0 : clamp(vehicle.speed / 30, 0, 1) * 0.5;
    engine.tyreGain.gain.setTargetAtTime(clamp(slip * 0.4 + gravel * 0.3, 0, 0.42), t, 0.05);
    engine.tyreFilter.frequency.setTargetAtTime(gravel > slip ? 620 : 1500 + slip * 900, t, 0.08);

    // Fahrtwind
    const sp = clamp(vehicle.speed / 55, 0, 1);
    engine.windGain.gain.setTargetAtTime(sp * sp * 0.3, t, 0.12);
    engine.windFilter.frequency.setTargetAtTime(lerp(260, 1300, sp), t, 0.12);
  }

  function burst({ freq = 180, dur = 0.28, gain = 0.5, type = 'noise' }) {
    if (!started || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);

    if (type === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur + 0.05);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq * 6, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, freq), t + dur);
      src.connect(f).connect(g);
      src.start(t);
      src.stop(t + dur + 0.05);
    } else {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      o.start(t);
      o.stop(t + dur);
    }
  }

  let hornOsc = null;
  function horn(on) {
    if (!started || ctx.state !== 'running') return;
    if (on && !hornOsc) {
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setTargetAtTime(0.18, t, 0.02);
      g.connect(master);
      const a = ctx.createOscillator();
      a.type = 'square';
      a.frequency.value = 420;
      const b = ctx.createOscillator();
      b.type = 'square';
      b.frequency.value = 508;
      a.connect(g);
      b.connect(g);
      a.start();
      b.start();
      hornOsc = { a, b, g };
    } else if (!on && hornOsc) {
      const t = ctx.currentTime;
      hornOsc.g.gain.setTargetAtTime(0, t, 0.03);
      const h = hornOsc;
      setTimeout(() => {
        h.a.stop();
        h.b.stop();
      }, 160);
      hornOsc = null;
    }
  }

  return {
    start,
    update,
    horn,
    crash(force) {
      burst({ freq: 90, dur: clamp(force / 22, 0.14, 0.5), gain: clamp(force / 26, 0.12, 0.55) });
    },
    ping() {
      burst({ freq: 880, dur: 0.16, gain: 0.14, type: 'sine' });
    },
    cash() {
      burst({ freq: 1320, dur: 0.1, gain: 0.12, type: 'triangle' });
      setTimeout(() => burst({ freq: 1760, dur: 0.14, gain: 0.11, type: 'triangle' }), 90);
    },
    resume() {
      if (ctx?.state === 'suspended') ctx.resume();
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.value = v ? 0 : 0.55;
    },
    get muted() {
      return muted;
    },
    get running() {
      return started && ctx?.state === 'running';
    },
  };
}
