/**
 * HUD: Tacho, Minikarte, grosse Karte, Meldungen.
 * Alles auf 2D-Canvas gezeichnet — schnell und ohne Abhaengigkeiten.
 */

import { clamp, lerp, formatClock, formatMoney } from '../core/utils.js';

const ROAD_COLORS = {
  0: '#f2c14e', 1: '#f2c14e', 2: '#f2c14e', 3: '#e8e2d4',
  4: '#d8d2c4', 5: '#c6c0b2', 6: '#b8b2a4', 7: '#aaa496',
  8: '#9c9688', 9: '#8e887a',
};

export function createHud(dom, net) {
  const speedo = dom.speedo.getContext('2d');
  const mini = dom.minimap.getContext('2d');

  let toastTimer = 0;
  let bigMapCache = null;

  // ---------------------------------------------------------------- Tacho

  function drawSpeedo(vehicle) {
    const c = speedo;
    const W = dom.speedo.width;
    const H = dom.speedo.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = W * 0.42;
    c.clearRect(0, 0, W, H);

    const maxKmh = Math.ceil((vehicle.spec.topSpeed * 3.6) / 20) * 20;
    const START = Math.PI * 0.78;
    const SWEEP = Math.PI * 1.44;

    // Ring
    c.lineWidth = W * 0.055;
    c.strokeStyle = 'rgba(8,12,18,0.72)';
    c.beginPath();
    c.arc(cx, cy, R, START, START + SWEEP);
    c.stroke();

    // Drehzahlband als Fuellung
    const rpmFrac = clamp((vehicle.rpm - 850) / (7200 - 850), 0, 1);
    const grad = c.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#57d9a3');
    grad.addColorStop(0.65, '#ffcf3d');
    grad.addColorStop(1, '#ff5c5c');
    c.strokeStyle = grad;
    c.lineWidth = W * 0.04;
    c.beginPath();
    c.arc(cx, cy, R, START, START + SWEEP * rpmFrac);
    c.stroke();

    // Skala
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = `600 ${Math.round(W * 0.055)}px Inter, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const steps = maxKmh / 20;
    for (let i = 0; i <= steps; i++) {
      const a = START + (SWEEP * i) / steps;
      const major = i % 2 === 0;
      const r0 = R - W * 0.052;
      const r1 = R - W * (major ? 0.095 : 0.078);
      c.lineWidth = major ? 2.4 : 1.2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
      if (major) {
        const rt = R - W * 0.15;
        c.fillText(String(i * 20), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }

    // Zeiger
    const kmh = Math.abs(vehicle.speedKmh);
    const a = START + SWEEP * clamp(kmh / maxKmh, 0, 1);
    c.strokeStyle = '#ff5c5c';
    c.lineWidth = 3.4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12);
    c.lineTo(cx + Math.cos(a) * (R - W * 0.1), cy + Math.sin(a) * (R - W * 0.1));
    c.stroke();

    c.fillStyle = '#0d141d';
    c.beginPath();
    c.arc(cx, cy, W * 0.035, 0, Math.PI * 2);
    c.fill();

    // Digitalanzeige
    c.fillStyle = '#f2f5f8';
    c.font = `700 ${Math.round(W * 0.15)}px 'JetBrains Mono', monospace`;
    c.fillText(String(Math.round(kmh)), cx, cy + W * 0.13);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 ${Math.round(W * 0.05)}px Inter, system-ui, sans-serif`;
    c.fillText('km/h', cx, cy + W * 0.235);
  }

  // ------------------------------------------------------------ Minikarte

  function drawMinimap(vehicle, opts = {}) {
    const c = mini;
    const W = dom.minimap.width;
    const H = dom.minimap.height;
    const cx = W / 2;
    const cy = H / 2;
    const RANGE = opts.range ?? 190; // Meter bis zum Kartenrand
    const scale = (W / 2) / RANGE;

    c.save();
    c.clearRect(0, 0, W, H);

    // Rund zuschneiden
    c.beginPath();
    c.arc(cx, cy, W / 2, 0, Math.PI * 2);
    c.clip();

    c.fillStyle = '#22401f';
    c.fillRect(0, 0, W, H);

    c.translate(cx, cy);
    c.rotate(vehicle.yaw); // Karte dreht mit, Auto zeigt immer nach oben
    c.translate(-vehicle.x * scale, -vehicle.z * scale);
    c.scale(scale, scale);

    // Wasser
    c.strokeStyle = '#3f6f86';
    c.lineJoin = 'round';
    for (const w of net.water) {
      if (w.points.length < 2) continue;
      c.lineWidth = Math.max(3, w.width || 8);
      c.beginPath();
      c.moveTo(w.points[0].x, w.points[0].z);
      for (const p of w.points) c.lineTo(p.x, p.z);
      c.stroke();
    }

    // Bahn
    c.strokeStyle = '#6b6358';
    c.setLineDash([6, 5]);
    c.lineWidth = 2.4;
    for (const r of net.rail) {
      if (r.points.length < 2) continue;
      c.beginPath();
      c.moveTo(r.points[0].x, r.points[0].z);
      for (const p of r.points) c.lineTo(p.x, p.z);
      c.stroke();
    }
    c.setLineDash([]);

    // Strassen: nur was in Reichweite ist
    const segs = net.segGrid.query(vehicle.x, vehicle.z, RANGE + 60);
    const byRoad = new Map();
    for (const s of segs) {
      let arr = byRoad.get(s.road);
      if (!arr) byRoad.set(s.road, (arr = []));
      arr.push(s);
    }
    for (const [road, list] of byRoad) {
      c.strokeStyle = ROAD_COLORS[road.rank] || '#a8a294';
      c.lineWidth = Math.max(2.4, road.width * 0.85);
      c.lineCap = 'round';
      c.beginPath();
      for (const s of list) {
        c.moveTo(s.ax, s.az);
        c.lineTo(s.bx, s.bz);
      }
      c.stroke();
    }

    // Wegpunkt
    if (opts.waypoint) {
      c.fillStyle = '#57d9a3';
      c.beginPath();
      c.arc(opts.waypoint.x, opts.waypoint.z, 7 / scale + 3, 0, Math.PI * 2);
      c.fill();
    }

    // Verkehr
    if (opts.traffic) {
      c.fillStyle = '#dfe6ec';
      for (const t of opts.traffic) {
        c.beginPath();
        c.arc(t.x, t.z, 2.6, 0, Math.PI * 2);
        c.fill();
      }
    }

    c.restore();

    // Fahrzeugpfeil
    c.save();
    c.translate(cx, cy);
    c.fillStyle = '#ffcf3d';
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 8);
    c.lineTo(0, 4.4);
    c.lineTo(-6.5, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // Nordzeiger
    c.save();
    c.translate(cx, cy);
    c.rotate(vehicle.yaw);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '700 11px Inter, system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('N', 0, -W / 2 + 15);
    c.restore();
  }

  // ------------------------------------------------------------ Grosse Karte

  function renderBigMap(canvas, vehicle, opts = {}) {
    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.85, 1100);
    if (canvas.width !== Math.round(size)) {
      canvas.width = Math.round(size);
      canvas.height = Math.round(size);
      bigMapCache = null;
    }
    const W = canvas.width;
    const c = canvas.getContext('2d');
    const EXTENT = 2700;
    const scale = W / (EXTENT * 2);

    if (!bigMapCache) {
      bigMapCache = document.createElement('canvas');
      bigMapCache.width = W;
      bigMapCache.height = W;
      const b = bigMapCache.getContext('2d');
      b.fillStyle = '#1d3520';
      b.fillRect(0, 0, W, W);
      b.save();
      b.translate(W / 2, W / 2);
      b.scale(scale, scale);

      b.lineJoin = 'round';
      b.lineCap = 'round';

      b.strokeStyle = '#3f6f86';
      for (const w of net.water) {
        if (w.points.length < 2) continue;
        b.lineWidth = Math.max(8, w.width || 10);
        b.beginPath();
        b.moveTo(w.points[0].x, w.points[0].z);
        for (const p of w.points) b.lineTo(p.x, p.z);
        b.stroke();
      }

      b.strokeStyle = '#6b6358';
      b.setLineDash([14, 10]);
      b.lineWidth = 5;
      for (const r of net.rail) {
        if (r.points.length < 2) continue;
        b.beginPath();
        b.moveTo(r.points[0].x, r.points[0].z);
        for (const p of r.points) b.lineTo(p.x, p.z);
        b.stroke();
      }
      b.setLineDash([]);

      const sorted = [...net.roads].sort((x, y) => y.rank - x.rank);
      for (const road of sorted) {
        b.strokeStyle = ROAD_COLORS[road.rank] || '#a8a294';
        b.lineWidth = Math.max(5, road.width * 1.1);
        b.beginPath();
        b.moveTo(road.points[0].x, road.points[0].z);
        for (const p of road.points) b.lineTo(p.x, p.z);
        b.stroke();
      }

      // Gebaeude
      b.fillStyle = 'rgba(20,26,34,0.55)';
      for (const bl of net.buildings) {
        if (bl.points.length < 3) continue;
        b.beginPath();
        b.moveTo(bl.points[0].x, bl.points[0].z);
        for (const p of bl.points) b.lineTo(p.x, p.z);
        b.closePath();
        b.fill();
      }

      b.restore();

      // Beschriftung
      b.save();
      b.textAlign = 'center';
      const label = (x, z, text, color, size) => {
        const px = W / 2 + x * scale;
        const pz = W / 2 + z * scale;
        b.font = `700 ${size}px Inter, system-ui, sans-serif`;
        b.lineWidth = 3.5;
        b.strokeStyle = 'rgba(0,0,0,0.75)';
        b.strokeText(text, px, pz);
        b.fillStyle = color;
        b.fillText(text, px, pz);
      };
      for (const lm of net.landmarks || []) label(lm.x, lm.z, lm.name, '#ffe9a8', 13);
      for (const poi of net.pois || []) {
        if (!poi.name) continue;
        label(poi.x, poi.z, poi.name, '#cfe8ff', 12);
      }
      b.restore();
    }

    c.clearRect(0, 0, W, W);
    c.drawImage(bigMapCache, 0, 0);

    // Wegpunkt
    if (opts.waypoint) {
      const px = W / 2 + opts.waypoint.x * scale;
      const pz = W / 2 + opts.waypoint.z * scale;
      c.strokeStyle = '#57d9a3';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(px, pz, 10, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(px - 16, pz);
      c.lineTo(px + 16, pz);
      c.moveTo(px, pz - 16);
      c.lineTo(px, pz + 16);
      c.stroke();
    }

    // Auto
    const px = W / 2 + vehicle.x * scale;
    const pz = W / 2 + vehicle.z * scale;
    c.save();
    c.translate(px, pz);
    c.rotate(-vehicle.yaw);
    c.fillStyle = '#ffcf3d';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 10);
    c.lineTo(0, 5.5);
    c.lineTo(-8, 10);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    return { scale, size: W };
  }

  // ------------------------------------------------------------- Meldungen

  function toast(text, kind = '', ms = 2600) {
    dom.toast.textContent = text;
    dom.toast.className = `toast on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.className = 'toast';
    }, ms);
  }

  function subtitle(text, ms = 4000) {
    dom.subtitle.textContent = text;
    dom.subtitle.className = 'subtitle on';
    clearTimeout(subtitle._t);
    subtitle._t = setTimeout(() => {
      dom.subtitle.className = 'subtitle';
    }, ms);
  }

  function objective(html) {
    if (!html) {
      dom.objective.className = 'objective';
      return;
    }
    dom.objective.innerHTML = html;
    dom.objective.className = 'objective on';
  }

  function setStars(n) {
    dom.stars.textContent = '★'.repeat(n);
  }

  function update(vehicle, game) {
    drawSpeedo(vehicle);
    drawMinimap(vehicle, {
      waypoint: game.waypoint,
      traffic: game.traffic?.cars,
    });
    dom.gear.textContent = vehicle.gear < 0 ? 'R' : vehicle.gear;
    dom.clock.textContent = formatClock(game.sky.state.time);
    dom.cash.textContent = formatMoney(game.cash);

    const road = vehicle.currentRoad;
    const name = road?.name || road?.ref || (vehicle.onRoad ? 'Unbenannte Straße' : 'Querfeldein');
    if (dom.streetname.textContent !== name) dom.streetname.textContent = name;
  }

  return { update, drawSpeedo, drawMinimap, renderBigMap, toast, subtitle, objective, setStars,
    invalidateBigMap() { bigMapCache = null; } };
}
