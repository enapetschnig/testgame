/**
 * Eingabe: Tastatur, Gamepad und Touch — alles muendet in denselben
 * Zustand, den die Fahrzeugphysik liest.
 */

import { clamp, damp } from '../core/utils.js';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

export function createInput(target = window) {
  const down = new Set();
  const touch = { up: false, down: false, left: false, right: false, handbrake: false };
  const once = new Map();

  const state = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    /** rohe, ungeglaettete Achsen — fuer die Kamera nuetzlich */
    rawSteer: 0,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    const mapped = KEY_MAP[e.code];
    if (mapped) {
      down.add(mapped);
      e.preventDefault();
    }
    const handlers = once.get(e.code);
    if (handlers) {
      e.preventDefault();
      for (const h of handlers) h(e);
    }
  }

  function onKeyUp(e) {
    const mapped = KEY_MAP[e.code];
    if (mapped) {
      down.delete(mapped);
      e.preventDefault();
    }
  }

  function onBlur() {
    down.clear();
  }

  target.addEventListener('keydown', onKeyDown, { passive: false });
  target.addEventListener('keyup', onKeyUp, { passive: false });
  target.addEventListener('blur', onBlur);

  /** Taste einmalig belegen (z. B. Kamerawechsel). */
  function on(code, handler) {
    if (!once.has(code)) once.set(code, []);
    once.get(code).push(handler);
    return () => {
      const arr = once.get(code);
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  function bindTouch(root) {
    if (!root) return;
    const set = (key, v) => {
      if (key === 'gas') touch.up = v;
      else if (key === 'brake') touch.down = v;
      else if (key === 'hand') touch.handbrake = v;
      else touch[key] = v;
    };
    root.querySelectorAll('[data-key]').forEach((btn) => {
      const key = btn.dataset.key;
      const on = (e) => {
        e.preventDefault();
        btn.classList.add('down');
        set(key, true);
      };
      const off = (e) => {
        e.preventDefault();
        btn.classList.remove('down');
        set(key, false);
      };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    });
  }

  function pollGamepad() {
    if (!navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) {
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  function update(dt) {
    const gp = pollGamepad();

    let rawThrottle = down.has('up') || touch.up ? 1 : 0;
    let rawBrake = down.has('down') || touch.down ? 1 : 0;
    let rawSteer = (down.has('right') || touch.right ? 1 : 0) - (down.has('left') || touch.left ? 1 : 0);
    let handbrake = down.has('handbrake') || touch.handbrake;

    if (gp) {
      // Standard-Gamepad-Belegung: RT Gas, LT Bremse, linker Stick lenkt.
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      const ax = gp.axes[0] ?? 0;
      if (rt > 0.02) rawThrottle = Math.max(rawThrottle, rt);
      if (lt > 0.02) rawBrake = Math.max(rawBrake, lt);
      if (Math.abs(ax) > 0.12) rawSteer = ax;
      if (gp.buttons[0]?.pressed) handbrake = true;
    }

    // Weich anlegen, damit das Auto nicht digital zuckt.
    state.throttle = damp(state.throttle, rawThrottle, 16, dt);
    state.brake = damp(state.brake, rawBrake, 20, dt);
    state.steer = damp(state.steer, clamp(rawSteer, -1, 1), 11, dt);
    state.rawSteer = rawSteer;
    state.handbrake = handbrake;

    return state;
  }

  function dispose() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
  }

  return { state, update, on, bindTouch, dispose, isDown: (k) => down.has(k) };
}
