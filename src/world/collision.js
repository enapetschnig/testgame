/**
 * Kollision mit Hauswaenden.
 *
 * Alle Grundrisskanten landen in einem Gitter. Das Auto wird als Kreis
 * behandelt; ueberlappt der Kreis eine Kante, wird er herausgeschoben und
 * der Geschwindigkeitsanteil in Wandrichtung entfernt. Das reicht voellig
 * fuer ein Arcade-Fahrspiel und kostet fast nichts.
 */

import { pointSegment } from '../core/utils.js';

export function createCollider(buildings, { cell = 24 } = {}) {
  const grid = new Map();

  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;

  function insert(seg) {
    const steps = Math.max(1, Math.ceil(Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) / (cell * 0.6)));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const k = key(seg.ax + (seg.bx - seg.ax) * t, seg.az + (seg.bz - seg.az) * t);
      if (seen.has(k)) continue;
      seen.add(k);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(seg);
    }
  }

  for (const b of buildings) {
    const ring = b.poly;
    if (!ring || ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      if (Math.hypot(c.x - a.x, c.z - a.z) < 0.2) continue;
      insert({ ax: a.x, az: a.z, bx: c.x, bz: c.z, top: b.baseY + b.wallH, base: b.baseY });
    }
  }

  function nearby(x, z, r) {
    const out = [];
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const n = Math.max(1, Math.ceil(r / cell));
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        const arr = grid.get(`${cx + dx},${cz + dz}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  /**
   * Schiebt einen Kreis aus allen Waenden heraus.
   * @returns {{x:number,z:number,hit:boolean,nx:number,nz:number,depth:number}}
   */
  function resolve(x, z, radius, y = -Infinity) {
    let px = x;
    let pz = z;
    let hit = false;
    let nx = 0;
    let nz = 0;
    let depth = 0;

    // Zwei Durchgaenge, damit Innenecken sauber aufloesen.
    for (let pass = 0; pass < 2; pass++) {
      for (const seg of nearby(px, pz, radius + 2)) {
        // Ueber dem Dach faehrt man drueber (Rampen, Bruecken).
        if (y > seg.top) continue;
        const r = pointSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
        if (r.dist >= radius || r.dist < 1e-6) continue;
        const ux = (px - r.x) / r.dist;
        const uz = (pz - r.z) / r.dist;
        const push = radius - r.dist;
        px += ux * push;
        pz += uz * push;
        if (push > depth) {
          depth = push;
          nx = ux;
          nz = uz;
        }
        hit = true;
      }
    }

    return { x: px, z: pz, hit, nx, nz, depth };
  }

  return { resolve, nearby };
}
