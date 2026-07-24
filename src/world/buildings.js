/**
 * Gebaeude.
 *
 * Liegen OSM-Grundrisse vor, werden genau diese extrudiert — jedes Haus
 * steht dann dort, wo es auch in echt steht, und hat den richtigen Umriss.
 * Fehlen sie (Offline-Karte), reiht dieses Modul die Haeuser als Strassendorf
 * an den Strassen auf, so wie Frojach gebaut ist.
 *
 * Das Dach kommt in beiden Faellen aus dem flaechenkleinsten umschliessenden
 * Rechteck des Grundrisses: Satteldach laengs der langen Achse, wie im
 * oberen Murtal ueblich.
 *
 * Jedes Haus merkt sich seine strassenseitige Wand. Genau dorthin haengt
 * `streetview/facades.js` spaeter das echte Foto der Hausfront.
 */

import * as THREE from 'three';
import { rngRange, rngPick, rngInt, makeRng, hashSeed } from '../core/rng.js';
import { polygonArea, polygonCentroid, dist, clamp } from '../core/utils.js';

// --------------------------------------------------------------- Materialien

/** Wandlaenge in Metern, die eine Texturkachel abdeckt. */
const WALL_TILE = 9;

const PLASTER = [0xf0ece1, 0xe8dcc8, 0xdfe4e2, 0xf2e6d0, 0xe3d9cc, 0xeae7de, 0xd9d2c4];
/**
 * Dachfarben nach dem, was im oberen Murtal tatsaechlich draufliegt:
 * ueberwiegend rotbrauner Ziegel, dazwischen graue Betondachsteine und
 * einzelne dunkle Blechdaecher auf Wirtschaftsgebaeuden.
 */
const ROOFS = [0xa85a3f, 0x9c5138, 0xb06544, 0x8a4a37, 0x7f6f64, 0x8c8078, 0x6d5d54];
const WOOD = [0x6b4a2f, 0x7a5638, 0x5b3d26];

const texCache = new Map();

/**
 * Prozedurale Fassadentextur: Putz, Fensterreihen, Sockel, Holzbalkon.
 * Wird pro Stil/Geschosszahl einmal erzeugt und geteilt.
 */
function facadeTexture(style, floors, seed) {
  const key = `${style}:${floors}:${seed}`;
  if (texCache.has(key)) return texCache.get(key);

  const rng = makeRng(hashSeed(key));
  // Eine Texturkachel deckt WALL_TILE Meter Wand ab (siehe wallGeometry).
  // Bei vier Fensterachsen ergibt das eine Achse alle gut zwei Meter — so
  // stehen die Fenster wie an einem echten Murtaler Haus, nicht wie an
  // einem Buerogebaeude.
  const W = 512;
  const FH = 168; // Pixel pro Geschoss
  const H = FH * floors;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');

  const base = PLASTER[Math.floor(rng() * PLASTER.length)];
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, W, H);

  // Putzstruktur
  for (let i = 0; i < 6400; i++) {
    const a = 0.03 + rng() * 0.05;
    g.fillStyle = rng() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(rng() * W, rng() * H, 3 + rng() * 5, 3 + rng() * 5);
  }

  // Sockel
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(0, H - 24, W, 24);

  const cols = style === 'farm' ? 3 : 4;
  const winW = style === 'farm' ? 60 : 54;
  const winH = 74;

  for (let f = 0; f < floors; f++) {
    const top = H - (f + 1) * FH;
    // Erdgeschoss von Wirtschaftsgebaeuden hat Tore statt Fenster
    if (style === 'farm' && f === 0) {
      const dw = 150;
      const dh = 124;
      g.fillStyle = '#4a3626';
      g.fillRect(W / 2 - dw / 2, top + FH - dh - 8, dw, dh);
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 5;
      g.strokeRect(W / 2 - dw / 2, top + FH - dh - 8, dw, dh);
      // Torfluegel andeuten
      g.beginPath();
      g.moveTo(W / 2, top + FH - dh - 8);
      g.lineTo(W / 2, top + FH - 8);
      g.stroke();
      continue;
    }

    for (let c = 0; c < cols; c++) {
      const cx = ((c + 0.5) / cols) * W;
      const x = cx - winW / 2;
      const y = top + (FH - winH) / 2;

      // Fensterlaibung
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x - 7, y - 7, winW + 14, winH + 14);

      // Glas — ein Teil der Fenster ist erleuchtet
      const lit = rng() < 0.42;
      g.fillStyle = lit ? '#2b3946' : '#1c2530';
      g.fillRect(x, y, winW, winH);

      // Sprossen
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(x + winW / 2, y);
      g.lineTo(x + winW / 2, y + winH);
      g.moveTo(x, y + winH * 0.45);
      g.lineTo(x + winW, y + winH * 0.45);
      g.stroke();

      // Fensterbank
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x - 9, y + winH + 7, winW + 18, 7);

      // Blumenkisterl — ohne die waer's nicht die Steiermark
      if (rng() < 0.45) {
        g.fillStyle = '#5a3b28';
        g.fillRect(x - 5, y + winH + 11, winW + 10, 14);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = rng() < 0.5 ? '#c9414a' : '#d97b2a';
          g.beginPath();
          g.arc(x + 5 + k * ((winW - 4) / 6), y + winH + 11, 6, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // Holzbalkon im Obergeschoss
    if (f > 0 && style !== 'farm' && rng() < 0.5) {
      const wc = new THREE.Color(WOOD[Math.floor(rng() * WOOD.length)]);
      g.fillStyle = `#${wc.getHexString()}`;
      g.fillRect(14, top + FH - 46, W - 28, 14);
      for (let b = 0; b < 26; b++) {
        g.fillRect(18 + b * ((W - 44) / 25), top + FH - 74, 5, 30);
      }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// ------------------------------------------------------- Grundriss-Geometrie

/** Flaechenkleinstes umschliessendes Rechteck (ueber alle Kantenrichtungen). */
function minAreaRect(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 0.2) continue;
    const ux = ex / len;
    const uz = ez / len;
    // Senkrechte
    const vx = -uz;
    const vz = ux;

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of poly) {
      const u = p.x * ux + p.z * uz;
      const v = p.x * vx + p.z * vz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        area,
        ux, uz, vx, vz,
        w, h,
        cx: cu * ux + cv * vx,
        cz: cu * uz + cv * vz,
      };
    }
  }
  return best;
}

/** Wandflaechen als BufferGeometry (exakter Grundriss, senkrecht extrudiert). */
function wallGeometry(poly, baseY, height, floors) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  let perim = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    // Aussennormale (Grundriss laeuft im Uhrzeigersinn -> nach aussen)
    const nx = ez / len;
    const nz = -ex / len;

    // Eine Texturkachel deckt 9 m Wand ab; bei vier Fensterachsen steht
    // damit alle gut zwei Meter ein Fenster.
    const u0 = perim / WALL_TILE;
    const u1 = (perim + len) / WALL_TILE;
    const base = pos.length / 3;

    pos.push(a.x, baseY, a.z, b.x, baseY, b.z, b.x, baseY + height, b.z, a.x, baseY + height, a.z);
    for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    perim += len;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Satteldach ueber dem umschliessenden Rechteck, mit Ueberstand. */
function gableRoofGeometry(rect, baseY, ridgeH, overhang = 0.55) {
  const { ux, uz, vx, vz, cx, cz } = rect;
  // Der First laeuft entlang der langen Achse.
  const alongU = rect.w >= rect.h;
  const halfLong = (alongU ? rect.w : rect.h) / 2 + overhang;
  const halfShort = (alongU ? rect.h : rect.w) / 2 + overhang;
  const lx = alongU ? ux : vx;
  const lz = alongU ? uz : vz;
  const sx = alongU ? vx : ux;
  const sz = alongU ? vz : uz;

  const P = (l, s, y) => [cx + lx * l + sx * s, y, cz + lz * l + sz * s];

  const a = P(-halfLong, -halfShort, baseY);
  const b = P(halfLong, -halfShort, baseY);
  const c = P(halfLong, halfShort, baseY);
  const d = P(-halfLong, halfShort, baseY);
  const r0 = P(-halfLong, 0, baseY + ridgeH);
  const r1 = P(halfLong, 0, baseY + ridgeH);

  const pos = [];
  const idx = [];
  const uv = [];
  const push = (...verts) => {
    const base = pos.length / 3;
    for (const v of verts) pos.push(v[0], v[1], v[2]);
    return base;
  };

  // Zwei Dachflaechen
  let i0 = push(a, b, r1, r0);
  idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  uv.push(0, 0, halfLong / 2, 0, halfLong / 2, 1, 0, 1);

  let i1 = push(c, d, r0, r1);
  idx.push(i1, i1 + 1, i1 + 2, i1, i1 + 2, i1 + 3);
  uv.push(0, 0, halfLong / 2, 0, halfLong / 2, 1, 0, 1);

  // Giebeldreiecke
  let i2 = push(b, c, r1);
  idx.push(i2, i2 + 1, i2 + 2);
  uv.push(0, 0, 1, 0, 0.5, 1);

  let i3 = push(d, a, r0);
  idx.push(i3, i3 + 1, i3 + 2);
  uv.push(0, 0, 1, 0, 0.5, 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Ein Haus bauen.
 * @returns {{group:THREE.Group, info:object}}
 */
function makeBuilding(poly, opts) {
  const {
    terrain,
    rng,
    style = 'house',
    floors = 2,
    name = null,
    roofColor,
    roofPitch = 0.42,
    tower = 0,
    roofShape = 'gable',
  } = opts;

  // Grundriss im Uhrzeigersinn normalisieren, damit Normalen nach aussen zeigen.
  const ring = polygonArea(poly) > 0 ? poly.slice().reverse() : poly.slice();
  const rect = minAreaRect(ring);
  if (!rect || rect.w < 1.5 || rect.h < 1.5) return null;

  const centroid = polygonCentroid(ring);
  // Gelaendehoehe unter dem Haus: tiefster Eckpunkt, damit nichts schwebt.
  let baseY = Infinity;
  for (const p of ring) baseY = Math.min(baseY, terrain.heightAt(p.x, p.z));
  baseY -= 0.15;

  const wallH = opts.height ?? floors * 3.0 + 0.4;
  const group = new THREE.Group();
  group.position.set(0, 0, 0);

  const tex = facadeTexture(style, Math.max(1, Math.round(wallH / 3)), rngInt(rng, 0, 5));
  const wallMat = new THREE.MeshLambertMaterial({ map: tex });
  const walls = new THREE.Mesh(wallGeometry(ring, baseY, wallH, floors), wallMat);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  if (roofShape !== 'none') {
    const shortSide = Math.min(rect.w, rect.h);
    const ridgeH = clamp(shortSide * roofPitch, 1.4, 6.5);
    const roofGeo = gableRoofGeometry(rect, baseY + wallH, ridgeH);
    const roofMat = new THREE.MeshLambertMaterial({
      color: roofColor ?? rngPick(rng, ROOFS),
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // Rauchfang
    if (rng() < 0.8 && shortSide > 4) {
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.5, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xb9a89a }),
      );
      const off = rngRange(rng, -0.25, 0.25);
      const alongU = rect.w >= rect.h;
      const lx = alongU ? rect.ux : rect.vx;
      const lz = alongU ? rect.uz : rect.vz;
      const halfLong = (alongU ? rect.w : rect.h) / 2;
      ch.position.set(
        rect.cx + lx * halfLong * off * 2,
        baseY + wallH + ridgeH * 0.7,
        rect.cz + lz * halfLong * off * 2,
      );
      ch.castShadow = true;
      group.add(ch);
    }
  }

  // Turm (Kirche, Kapelle, Burg)
  if (tower > 0) {
    const side = Math.min(4.4, Math.max(2.6, Math.min(rect.w, rect.h) * 0.55));
    const alongU = rect.w >= rect.h;
    const lx = alongU ? rect.ux : rect.vx;
    const lz = alongU ? rect.uz : rect.vz;
    const halfLong = (alongU ? rect.w : rect.h) / 2;
    const tx = rect.cx - lx * (halfLong - side * 0.35);
    const tz = rect.cz - lz * (halfLong - side * 0.35);

    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(side, tower, side),
      new THREE.MeshLambertMaterial({ color: 0xeee7da }),
    );
    shaft.position.set(tx, baseY + tower / 2, tz);
    shaft.castShadow = true;
    group.add(shaft);

    if (roofShape !== 'none') {
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(side * 0.78, side * 2.3, 4),
        new THREE.MeshLambertMaterial({ color: 0x4a5a52 }),
      );
      spire.position.set(tx, baseY + tower + side * 1.15, tz);
      spire.rotation.y = Math.PI / 4;
      spire.castShadow = true;
      group.add(spire);

      // Zifferblatt
      const clock = new THREE.Mesh(
        new THREE.CircleGeometry(side * 0.28, 16),
        new THREE.MeshBasicMaterial({ color: 0xf5efdf }),
      );
      const nrmAngle = Math.atan2(lx, lz) + Math.PI;
      clock.position.set(
        tx + Math.sin(nrmAngle) * (side / 2 + 0.03),
        baseY + tower * 0.86,
        tz + Math.cos(nrmAngle) * (side / 2 + 0.03),
      );
      clock.rotation.y = nrmAngle;
      group.add(clock);
    }
  }

  const info = {
    name,
    style,
    poly: ring,
    rect,
    baseY,
    wallH,
    center: centroid,
    /** Wird von `attachFacades` gefuellt. */
    front: null,
    walls,
    group,
  };

  return { group, info };
}

/** Bestimmt fuer jedes Haus die strassenseitige Wand. */
function findFrontWall(info, net) {
  const near = net.nearestRoad(info.center.x, info.center.z, 90);
  if (!near) return null;

  let best = null;
  const ring = info.poly;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 2) continue;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    // Aussennormale
    const nx = ez / len;
    const nz = -ex / len;
    const d = dist(mx, mz, near.x, near.z);
    // Wand muss zur Strasse zeigen
    const facing = (near.x - mx) * nx + (near.z - mz) * nz;
    if (facing <= 0) continue;
    const score = d - len * 0.35;
    if (!best || score < best.score) {
      best = { score, mx, mz, nx, nz, len, dist: d, yaw: Math.atan2(nx, nz) };
    }
  }
  if (!best) return null;
  return {
    x: best.mx,
    z: best.mz,
    nx: best.nx,
    nz: best.nz,
    width: best.len,
    yaw: best.yaw,
    roadX: near.x,
    roadZ: near.z,
    roadDist: best.dist,
    road: near.road,
  };
}

// ---------------------------------------------------- Prozedurales Dorf

/** Reiht Haeuser beidseits der Strassen auf — nur ohne OSM-Grundrisse. */
function generateVillage(net, terrain, rng) {
  const polys = [];
  const occupied = [];

  const canPlace = (cx, cz, r) => {
    for (const o of occupied) {
      if (dist(cx, cz, o.x, o.z) < r + o.r) return false;
    }
    return true;
  };

  const DENSITY = {
    primary: 34, secondary: 46, residential: 24, unclassified: 40,
    living_street: 22, service: 34, tertiary: 44,
  };

  for (const road of net.roads) {
    const step = DENSITY[road.highway?.replace(/_link$/, '')];
    if (!step) continue;
    // Am Ortsrand duenner bebauen
    const pts = road.points;
    let acc = rngRange(rng, 0, step);

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = dist(a.x, a.z, b.x, b.z);
      const ux = (b.x - a.x) / (segLen || 1);
      const uz = (b.z - a.z) / (segLen || 1);
      const nx = -uz;
      const nz = ux;

      let t = 0;
      while (t < segLen) {
        if (acc <= 0) {
          const side = rng() < 0.5 ? -1 : 1;
          const setback = rngRange(rng, road.width * 0.5 + 6, road.width * 0.5 + 17);
          const px = a.x + ux * t + nx * side * setback;
          const pz = a.z + uz * t + nz * side * setback;

          // Nur im Talboden bauen, nicht am Steilhang
          const h = terrain.heightAt(px, pz);
          const slope =
            Math.abs(terrain.heightAt(px + 6, pz) - terrain.heightAt(px - 6, pz)) / 12 +
            Math.abs(terrain.heightAt(px, pz + 6) - terrain.heightAt(px, pz - 6)) / 12;

          const distFromCenter = Math.hypot(px, pz);
          const skip = rng() < clamp((distFromCenter - 500) / 1800, 0, 0.86);

          if (!skip && slope < 0.22 && h < terrain.valleyFloor + 120) {
            const isFarm = rng() < 0.3;
            const w = isFarm ? rngRange(rng, 9, 13) : rngRange(rng, 7.5, 11);
            const d = isFarm ? rngRange(rng, 13, 22) : rngRange(rng, 8.5, 14);
            const r = Math.hypot(w, d) / 2 + 3;

            if (canPlace(px, pz, r)) {
              // Firstrichtung parallel zur Strasse
              const jitter = rngRange(rng, -0.16, 0.16);
              const ca = Math.cos(jitter);
              const sa = Math.sin(jitter);
              const axU = ux * ca - uz * sa;
              const azU = uz * ca + ux * sa;
              const axV = -azU;
              const azV = axU;

              const poly = [
                { x: px - axU * (d / 2) - axV * (w / 2), z: pz - azU * (d / 2) - azV * (w / 2) },
                { x: px + axU * (d / 2) - axV * (w / 2), z: pz + azU * (d / 2) - azV * (w / 2) },
                { x: px + axU * (d / 2) + axV * (w / 2), z: pz + azU * (d / 2) + azV * (w / 2) },
                { x: px - axU * (d / 2) + axV * (w / 2), z: pz - azU * (d / 2) + azV * (w / 2) },
              ];
              polys.push({
                points: poly,
                style: isFarm ? 'farm' : 'house',
                levels: isFarm ? 2 : rngInt(rng, 1, 2),
              });
              occupied.push({ x: px, z: pz, r });
            }
          }
          acc = step * rngRange(rng, 0.75, 1.5);
        }
        const adv = Math.min(acc, segLen - t);
        t += adv;
        acc -= adv;
      }
    }
  }

  return polys;
}

// ------------------------------------------------------------------- Public

/**
 * @param {object} net
 * @param {object} terrain
 * @returns {{group:THREE.Group, buildings:Array}}
 */
export function createBuildings(net, terrain) {
  const rng = makeRng(0x46524f31);
  const group = new THREE.Group();
  group.name = 'buildings';
  const infos = [];

  const source =
    net.buildings.length >= 8
      ? net.buildings.map((b) => ({
          points: b.points,
          style: /farm|barn|shed|hut|garage|industrial|warehouse/.test(b.kind || '') ? 'farm' : 'house',
          levels: b.levels || null,
          height: b.height || null,
          name: b.name,
          roofShape: b.roofShape,
        }))
      : generateVillage(net, terrain, rng);

  for (const b of source) {
    const area = Math.abs(polygonArea(b.points));
    if (area < 12 || area > 6000) continue;
    const floors = b.levels || (area > 260 ? 2 : rngInt(rng, 1, 2));
    const built = makeBuilding(b.points, {
      terrain,
      rng,
      style: b.style,
      floors,
      height: b.height || undefined,
      name: b.name,
      roofPitch: b.style === 'farm' ? 0.38 : 0.46,
    });
    if (!built) continue;
    group.add(built.group);
    built.info.front = findFrontWall(built.info, net);
    infos.push(built.info);
  }

  // --- Benannte Bauwerke aus der Karte ----------------------------------
  for (const lm of net.landmarks || []) {
    const [w, d] = lm.size || [14, 10];
    const rot = lm.rotation || 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const corner = (dx, dz) => ({
      x: lm.x + dx * c - dz * s,
      z: lm.z + dx * s + dz * c,
    });
    const poly = [
      corner(-w / 2, -d / 2),
      corner(w / 2, -d / 2),
      corner(w / 2, d / 2),
      corner(-w / 2, d / 2),
    ];
    const built = makeBuilding(poly, {
      terrain,
      rng,
      style: /industrial|warehouse|station/.test(lm.kind) ? 'farm' : 'house',
      height: lm.height || 9,
      floors: Math.max(1, Math.round((lm.height || 9) / 3)),
      name: lm.name,
      tower: lm.tower || 0,
      roofShape: lm.roof === 'none' ? 'none' : 'gable',
      roofColor:
        lm.kind === 'church' || lm.kind === 'chapel' ? 0x59504a
        : lm.kind === 'ruin' ? 0x6d6a63
        : lm.kind === 'castle' ? 0x7a5344
        : undefined,
      roofPitch: lm.kind === 'church' || lm.kind === 'chapel' ? 0.7 : 0.45,
    });
    if (!built) continue;
    built.info.landmark = lm;
    built.info.name = lm.name;
    group.add(built.group);
    built.info.front = findFrontWall(built.info, net);
    infos.push(built.info);
  }

  return { group, buildings: infos };
}

export { facadeTexture, minAreaRect };
