/**
 * Fahrbahnen, Bankette, Markierungen und Bruecken.
 *
 * Aus jeder Polylinie wird ein Band ("Ribbon") aus Dreiecken gebaut, das der
 * eingepraegten Gradiente des Gelaendes folgt. Alles wird nach Material in
 * wenige grosse Meshes zusammengefasst, damit die Zahl der Draw-Calls klein
 * bleibt — bei ueber hundert Wegen macht das den Unterschied.
 */

import * as THREE from 'three';
import { dist, lerp } from '../core/utils.js';

/** Sammelt Dreiecke und macht am Ende ein einziges Mesh daraus. */
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
  }

  get empty() {
    return this.pos.length === 0;
  }

  vertex(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  build(material, { shadow = false, receive = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadow;
    m.receiveShadow = receive;
    return m;
  }
}

const grainCache = new Map();

/**
 * Koerniges Graustufenmuster als Basistextur fuer Asphalt, Schotter und
 * Bankett. Wird ueber `color` eingefaerbt, deshalb reicht ein Muster je
 * Parametersatz.
 */
function grainTexture(base, contrast, specks) {
  const key = `${base}:${contrast}:${specks}`;
  if (grainCache.has(key)) return grainCache.get(key);

  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#b4b4b4';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < specks; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    const a = 0.02 + Math.random() * 0.09 * contrast;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    const r = 0.6 + Math.random() * 2.6;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  // Grosse, weiche Aufhellungen — verhindert das "Rauschteppich"-Aussehen
  for (let i = 0; i < 26; i++) {
    const a = 0.02 + Math.random() * 0.05;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 12 + Math.random() * 40, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  grainCache.set(key, tex);
  return tex;
}

/** Querrichtung (nach rechts) an Stuetzpunkt i einer Polylinie. */
function normalsAlong(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // Rechte Normale in der xz-Ebene
    out.push({ x: -dz, z: dx, tx: dx, tz: dz });
  }
  return out;
}

/**
 * Baut ein Band konstanter Breite entlang einer Polylinie.
 * @param {Array<{x:number,z:number}>} pts
 * @param {(i:number)=>number} yAt  Hoehe an Stuetzpunkt i
 */
function ribbon(mb, pts, halfWidth, yAt, { yOffset = 0, uvScale = 0.12, uOffset = 0 } = {}) {
  if (pts.length < 2) return;
  const nrm = normalsAlong(pts);
  let s = 0;
  let prev = null;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const nv = nrm[i];
    const y = yAt(i) + yOffset;
    if (i > 0) s += dist(pts[i - 1].x, pts[i - 1].z, p.x, p.z);

    const hw = typeof halfWidth === 'function' ? halfWidth(i) : halfWidth;
    const l = mb.vertex(p.x - nv.x * hw, y, p.z - nv.z * hw, 0, 1, 0, uOffset, s * uvScale);
    const r = mb.vertex(p.x + nv.x * hw, y, p.z + nv.z * hw, 0, 1, 0, uOffset + 1, s * uvScale);

    if (prev) mb.quad(prev.l, prev.r, r, l);
    prev = { l, r };
  }
}

/** Gestrichelte Mittellinie: einzelne Quads mit Luecken. */
function dashedLine(mb, pts, yAt, { width = 0.14, dash = 3, gap = 4.5, yOffset = 0.03 } = {}) {
  const nrm = normalsAlong(pts);
  const cycle = dash + gap;
  let s = 0;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = dist(a.x, a.z, b.x, b.z);
    if (segLen < 0.05) continue;

    let t0 = 0;
    while (t0 < segLen) {
      const posInCycle = (s + t0) % cycle;
      if (posInCycle < dash) {
        const remain = Math.min(dash - posInCycle, segLen - t0);
        const ta = t0 / segLen;
        const tb = (t0 + remain) / segLen;
        emitStripe(mb, a, b, nrm[i - 1], nrm[i], yAt(i - 1), yAt(i), ta, tb, width, yOffset);
        t0 += remain;
      } else {
        t0 += cycle - posInCycle;
      }
    }
    s += segLen;
  }
}

function emitStripe(mb, a, b, na, nb, ya, yb, ta, tb, width, yOffset) {
  const hw = width / 2;
  const pa = { x: lerp(a.x, b.x, ta), z: lerp(a.z, b.z, ta), y: lerp(ya, yb, ta) + yOffset };
  const pb = { x: lerp(a.x, b.x, tb), z: lerp(a.z, b.z, tb), y: lerp(ya, yb, tb) + yOffset };
  const nx = lerp(na.x, nb.x, 0.5);
  const nz = lerp(na.z, nb.z, 0.5);

  const v0 = mb.vertex(pa.x - nx * hw, pa.y, pa.z - nz * hw, 0, 1, 0, 0, 0);
  const v1 = mb.vertex(pa.x + nx * hw, pa.y, pa.z + nz * hw, 0, 1, 0, 1, 0);
  const v2 = mb.vertex(pb.x + nx * hw, pb.y, pb.z + nz * hw, 0, 1, 0, 1, 1);
  const v3 = mb.vertex(pb.x - nx * hw, pb.y, pb.z - nz * hw, 0, 1, 0, 0, 1);
  mb.quad(v0, v1, v2, v3);
}

/** Durchgezogene Linie im Abstand `offset` von der Achse. */
function solidLine(mb, pts, yAt, offset, { width = 0.13, yOffset = 0.03 } = {}) {
  const nrm = normalsAlong(pts);
  const hw = width / 2;
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const nv = nrm[i];
    const y = yAt(i) + yOffset;
    const cx = p.x + nv.x * offset;
    const cz = p.z + nv.z * offset;
    const l = mb.vertex(cx - nv.x * hw, y, cz - nv.z * hw, 0, 1, 0, 0, i);
    const r = mb.vertex(cx + nv.x * hw, y, cz + nv.z * hw, 0, 1, 0, 1, i);
    if (prev) mb.quad(prev.l, prev.r, r, l);
    prev = { l, r };
  }
}

/**
 * @param {object} net    Netz aus `network.js`
 * @param {object} terrain Gelaende aus `terrain.js`
 * @returns {THREE.Group}
 */
export function createRoads(net, terrain) {
  const group = new THREE.Group();
  group.name = 'roads';

  const asphalt = new MeshBuilder();
  const gravel = new MeshBuilder();
  const verge = new MeshBuilder();
  const markings = new MeshBuilder();
  const bridgeDeck = new MeshBuilder();

  const railingsPos = [];

  for (const road of net.roads) {
    const pts = road.points;
    if (pts.length < 2) continue;
    const elev = road.elev;
    const yAt = (i) => (elev ? elev[Math.min(i, elev.length - 1)] : terrain.heightAt(pts[i].x, pts[i].z));
    const hw = road.width / 2;
    const paved = road.rank <= 8 && road.highway !== 'track' && road.highway !== 'path';

    // Bankett/Schotterstreifen ein Stueck breiter und minimal tiefer —
    // kaschiert den Uebergang zum Gelaende.
    ribbon(verge, pts, hw + (paved ? 2.6 : 1.6), yAt, { yOffset: -0.09, uvScale: 0.09 });

    // Fahrbahn
    ribbon(paved ? asphalt : gravel, pts, hw, yAt, { yOffset: 0.02, uvScale: 0.11 });

    // Markierungen nur auf klassifizierten Strassen
    if (road.rank <= 4 && road.width >= 5.4) {
      solidLine(markings, pts, yAt, -(hw - 0.35));
      solidLine(markings, pts, yAt, hw - 0.35);
      if (road.rank <= 3) dashedLine(markings, pts, yAt, {});
    }

    // Bruecken bekommen einen Ueberbau und Gelaender
    if (road.bridge) {
      ribbon(bridgeDeck, pts, hw + 1.1, yAt, { yOffset: -0.55, uvScale: 0.1 });
      const nrm = normalsAlong(pts);
      for (let i = 0; i < pts.length; i++) {
        for (const sgn of [-1, 1]) {
          railingsPos.push({
            x: pts[i].x + nrm[i].x * sgn * (hw + 0.7),
            y: yAt(i) + 0.62,
            z: pts[i].z + nrm[i].z * sgn * (hw + 0.7),
            yaw: Math.atan2(nrm[i].tx, nrm[i].tz),
          });
        }
      }
    }
  }

  const matAsphalt = new THREE.MeshStandardMaterial({
    color: 0x53575d,
    map: grainTexture(0x4a4d52, 0.5, 2400),
    roughness: 0.86,
    metalness: 0,
  });
  const matGravel = new THREE.MeshStandardMaterial({
    color: 0x9c8f78,
    map: grainTexture(0x8c7f6b, 0.75, 2000),
    roughness: 0.95,
    metalness: 0,
  });
  const matVerge = new THREE.MeshStandardMaterial({
    color: 0x6a8a4c,
    map: grainTexture(0x5d7a42, 0.7, 1800),
    roughness: 0.97,
    metalness: 0,
  });
  // Markierungen als beleuchtetes Material — sonst leuchten sie nachts,
  // als waeren sie selbst eine Lichtquelle.
  const matMark = new THREE.MeshStandardMaterial({
    color: 0xd8d4c8,
    roughness: 0.7,
    metalness: 0,
  });
  const matDeck = new THREE.MeshStandardMaterial({ color: 0x6d6558, roughness: 0.9 });

  if (!verge.empty) group.add(verge.build(matVerge));
  if (!bridgeDeck.empty) group.add(bridgeDeck.build(matDeck));
  if (!asphalt.empty) group.add(asphalt.build(matAsphalt));
  if (!gravel.empty) group.add(gravel.build(matGravel));
  if (!markings.empty) {
    const m = markings.build(matMark, { receive: false });
    m.renderOrder = 1;
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -2;
    m.material.polygonOffsetUnits = -2;
    group.add(m);
  }

  // Bruecken-Gelaender als Instanzen
  if (railingsPos.length) {
    const g = new THREE.BoxGeometry(0.09, 1.0, 1.6);
    const m = new THREE.MeshLambertMaterial({ color: 0x9aa3a8 });
    const inst = new THREE.InstancedMesh(g, m, railingsPos.length);
    const dummy = new THREE.Object3D();
    railingsPos.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = true;
    group.add(inst);
  }

  return group;
}

/**
 * Wasserflaechen: die Mur als breites Band, Baeche schmaeler.
 * Der Wasserspiegel liegt etwas unter dem Talboden, damit ein Ufer entsteht.
 */
export function createWater(net, terrain) {
  const group = new THREE.Group();
  group.name = 'water';
  const mb = new MeshBuilder();

  for (const w of net.water) {
    const pts = w.points;
    if (pts.length < 2) continue;
    const half = Math.max(1.5, (w.width || 8) / 2);
    // Wasserspiegel: geglaettete Gelaendehoehe minus Einschnitt.
    const ys = pts.map((p) => terrain.heightAt(p.x, p.z));
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 1; i < ys.length - 1; i++) ys[i] = (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4;
    }
    // Fluss laeuft talabwaerts: streng monoton fallend machen.
    for (let i = 1; i < ys.length; i++) ys[i] = Math.min(ys[i], ys[i - 1]);
    const depth = w.kind === 'river' ? 2.1 : 1.1;
    ribbon(mb, pts, half, (i) => ys[i] - depth, { uvScale: 0.05 });
  }

  if (!mb.empty) {
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3f6f86,
      transparent: true,
      opacity: 0.88,
    });
    const mesh = mb.build(mat, { receive: false });
    mesh.name = 'mur';
    group.add(mesh);
  }
  return group;
}

/** Murtalbahn: Schotterbett, Schwellen und zwei Schienen. */
export function createRailway(net, terrain) {
  const group = new THREE.Group();
  group.name = 'rail';
  if (!net.rail?.length) return group;

  const bed = new MeshBuilder();
  const rails = new MeshBuilder();
  const sleepers = [];

  for (const line of net.rail) {
    const pts = line.points;
    if (pts.length < 2) continue;

    // Bahntrasse wird ebenfalls laengs geglaettet — Zuege moegen keine Buckel.
    const ys = pts.map((p) => terrain.heightAt(p.x, p.z));
    for (let pass = 0; pass < 14; pass++) {
      for (let i = 1; i < ys.length - 1; i++) ys[i] = (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4;
    }
    const yAt = (i) => ys[Math.min(i, ys.length - 1)] + 0.28;

    ribbon(bed, pts, 2.5, (i) => yAt(i) - 0.26, { uvScale: 0.2 });
    // Schmalspur: 760 mm Spurweite -> +-0.38 m
    solidLine(rails, pts, yAt, -0.38, { width: 0.1, yOffset: 0.06 });
    solidLine(rails, pts, yAt, 0.38, { width: 0.1, yOffset: 0.06 });

    const nrm = normalsAlong(pts);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const segLen = dist(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z);
      let t = 0;
      while (acc + t < segLen) {
        const f = (acc + t) / segLen;
        sleepers.push({
          x: lerp(pts[i - 1].x, pts[i].x, f),
          y: lerp(yAt(i - 1), yAt(i), f) - 0.05,
          z: lerp(pts[i - 1].z, pts[i].z, f),
          yaw: Math.atan2(nrm[i].tx, nrm[i].tz),
        });
        t += 1.15;
      }
      acc = (acc + t) - segLen;
    }
  }

  if (!bed.empty) group.add(bed.build(new THREE.MeshLambertMaterial({ color: 0x77706a })));
  if (!rails.empty) {
    const m = rails.build(new THREE.MeshLambertMaterial({ color: 0x6a6258 }), { receive: false });
    m.renderOrder = 1;
    group.add(m);
  }
  if (sleepers.length) {
    // In Kacheln, damit das Frustum-Culling greift — sonst zieht die ganze
    // Strecke quer durchs Tal in jedem Bild mit.
    const g = new THREE.BoxGeometry(0.22, 0.12, 1.3);
    const m = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
    const dummy = new THREE.Object3D();
    const TILE = 360;
    const buckets = new Map();
    for (const s of sleepers) {
      const k = `${Math.floor(s.x / TILE)},${Math.floor(s.z / TILE)}`;
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(s);
    }
    for (const list of buckets.values()) {
      const inst = new THREE.InstancedMesh(g, m, list.length);
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.yaw, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.receiveShadow = true;
      inst.castShadow = false;
      group.add(inst);
    }
  }

  return group;
}

export { MeshBuilder, normalsAlong, ribbon };
