/**
 * Das Gelaende des oberen Murtals.
 *
 * Frojach liegt auf rund 760 m im flachen Talboden; noerdlich der Mur steigt
 * es zum Puxberg (1486 m) an, suedlich zieht das Katschtal hinauf. Genau das
 * modelliert dieses Modul: ein flacher Talboden entlang der Murachse, davon
 * ausgehend ansteigende Flanken, dazu Rauschen fuer Kuppen und Mulden.
 *
 * Zusaetzlich wird der Strassenkorridor ins Hoehenfeld eingepraegt, damit
 * Bergstrassen nicht in der Landschaft haengen, sondern eine ausplanierte
 * Trasse bekommen.
 */

import * as THREE from 'three';
import { makeFbm } from '../core/rng.js';
import { clamp, lerp, smoothstep, pointSegment, dist } from '../core/utils.js';
import { WORLD_RADIUS } from '../core/geo.js';

const VALLEY_FLOOR = 760; // m ue. A.
const CELL = 14; // Aufloesung des Hoehenfelds in Metern
const PAD = 400; // Ueberstand ueber die Weltgrenze hinaus

/**
 * Kantenlaenge einer Bodentextur-Kachel in Metern. Groesser heisst weniger
 * sichtbare Wiederholung aus der Ferne, kleiner heisst mehr Struktur direkt
 * vor der Motorhaube. Zwoelf Meter ist der Kompromiss.
 */
const MEADOW_TILE = 12;

let meadowTex = null;

/**
 * Feinstruktur fuer den Boden. Ohne die wirkt eine Wiese aus der Naehe wie
 * eine lackierte Flaeche — mit ihr bekommt sie Halme, Erdflecken und
 * Trittspuren. Die Grossfarbe kommt weiterhin aus den Vertexfarben, diese
 * Textur moduliert nur.
 */
function meadowTexture() {
  if (meadowTex) return meadowTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');

  g.fillStyle = '#b6b6b6';
  g.fillRect(0, 0, S, S);

  // Flecken: hellere und dunklere Bereiche
  for (let i = 0; i < 380; i++) {
    const r = 4 + Math.random() * 22;
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.03 + Math.random() * 0.05})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    g.fill();
  }

  // Halme
  g.lineWidth = 1;
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const len = 2 + Math.random() * 5;
    const dark = Math.random() < 0.5;
    g.strokeStyle = dark ? 'rgba(70,70,70,0.30)' : 'rgba(220,220,220,0.24)';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 2.4, y - len);
    g.stroke();
  }

  meadowTex = new THREE.CanvasTexture(cv);
  meadowTex.wrapS = THREE.RepeatWrapping;
  meadowTex.wrapT = THREE.RepeatWrapping;
  meadowTex.colorSpace = THREE.SRGBColorSpace;
  meadowTex.anisotropy = 8;
  return meadowTex;
}

/** Gipfel und Ruecken, die das Panorama praegen. */
const PEAKS = [
  { x: -1900, z: -1900, h: 726, r: 1500, name: 'Puxberg' }, // 760+726 = 1486 m
  { x: 900, z: -2300, h: 560, r: 1400 },
  { x: -2500, z: 1400, h: 470, r: 1300 },
  { x: 1800, z: 1900, h: 520, r: 1500 },
  { x: -400, z: 2400, h: 430, r: 1200 },
  { x: 2400, z: -900, h: 380, r: 1100 },
];

/**
 * Baut das Hoehenfeld und daraus das Gelaendemesh.
 * @param {object} net Netz aus `network.js`
 */
export function createTerrain(net) {
  const min = -(WORLD_RADIUS + PAD);
  const size = (WORLD_RADIUS + PAD) * 2;
  const n = Math.floor(size / CELL) + 1;

  const fbmBig = makeFbm(0x4652, 4, 2.1, 0.52);
  const fbmSmall = makeFbm(0x4a41, 3, 2.4, 0.45);

  // ---- 1. Talachse aus dem Murlauf ableiten -----------------------------
  //
  // Die Mur ist die tiefste Linie im Tal. Alles Weitere richtet sich am
  // Abstand zu ihr aus. Faellt der Fluss aus den Daten, greift eine gerade
  // Ersatzachse in Talrichtung.
  const river =
    net.water?.find((w) => /^mur$/i.test(w.name || '') || w.kind === 'river') ||
    net.water?.[0];

  const axis =
    river && river.points.length > 1
      ? river.points
      : [
          { x: -3000, z: 640 },
          { x: 0, z: -160 },
          { x: 3000, z: -960 },
        ];

  /** Abstand zur Talachse (quer zum Tal, in Metern). */
  function axisDistance(x, z) {
    let best = Infinity;
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1];
      const b = axis[i];
      const d = pointSegment(x, z, a.x, a.z, b.x, b.z).dist;
      if (d < best) best = d;
    }
    return best;
  }

  /** Auf welcher Talseite liegt der Punkt? (+1 Nord, -1 Sued) */
  function axisSide(x, z) {
    let best = Infinity;
    let side = 1;
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1];
      const b = axis[i];
      const r = pointSegment(x, z, a.x, a.z, b.x, b.z);
      if (r.dist < best) {
        best = r.dist;
        const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
        side = cross >= 0 ? -1 : 1;
      }
    }
    return side;
  }

  // ---- 2. Rohes Gelaende ------------------------------------------------

  const FLOOR_HALF = 210; // Halbe Breite des ebenen Talbodens
  const RAMP = 620; // Laenge des Uebergangs in die Flanke

  function rawHeight(x, z) {
    const d = axisDistance(x, z);
    const side = axisSide(x, z);

    // Talboden: nahezu eben, nur sanft gewellt.
    let h = VALLEY_FLOOR + (fbmSmall(x / 340, z / 340) - 0.5) * 3.2;

    // Anstieg der Flanken, quadratisch einsetzend -> weicher Hangfuss.
    if (d > FLOOR_HALF) {
      const t = clamp((d - FLOOR_HALF) / RAMP, 0, 1);
      const steep = side > 0 ? 232 : 196; // Nordflanke steiler
      h += smoothstep(t) * t * steep;
      // Jenseits des Uebergangs weiter ansteigen, aber flacher.
      if (d > FLOOR_HALF + RAMP) h += (d - FLOOR_HALF - RAMP) * (side > 0 ? 0.2 : 0.16);
    }

    // Gipfel als weiche Glocken aufsetzen.
    for (const pk of PEAKS) {
      const dd = dist(x, z, pk.x, pk.z);
      if (dd < pk.r) {
        const t = 1 - dd / pk.r;
        h += pk.h * t * t * (3 - 2 * t) * 0.5;
      }
    }

    // Grosse Gelaendewellen und feine Struktur.
    const slope = clamp((d - FLOOR_HALF) / 500, 0, 1);
    h += (fbmBig(x / 900, z / 900) - 0.5) * 120 * slope;
    h += (fbmSmall(x / 130, z / 130) - 0.5) * 9 * slope;

    return h;
  }

  // ---- 3. Strassentrassen einpraegen -----------------------------------
  //
  // Zuerst bekommt jede Strasse eine eigene, laengs geglaettete Hoehe
  // ("Gradiente"), damit keine Achterbahn entsteht. Danach wird das
  // Gelaende im Korridor auf diese Gradiente gezogen.

  const roadElev = new Map(); // road.id -> Float64Array je Stuetzpunkt

  for (const road of net.roads) {
    const pts = road.points;
    const raw = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) raw[i] = rawHeight(pts[i].x, pts[i].z);

    // Mehrfach gleitend mitteln -> realistische, stetige Laengsneigung.
    let cur = raw;
    const passes = road.rank <= 3 ? 6 : 4;
    for (let p = 0; p < passes; p++) {
      const next = new Float64Array(cur.length);
      for (let i = 0; i < cur.length; i++) {
        const a = cur[Math.max(0, i - 1)];
        const b = cur[i];
        const c = cur[Math.min(cur.length - 1, i + 1)];
        next[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
      cur = next;
    }

    // Steigung begrenzen: ueber 14 % faehrt hier niemand mehr hoch.
    const MAXG = road.rank <= 3 ? 0.09 : 0.15;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < cur.length; i++) {
        const dl = Math.max(1, dist(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z));
        const dh = cur[i] - cur[i - 1];
        const maxDh = MAXG * dl;
        if (dh > maxDh) cur[i] = cur[i - 1] + maxDh;
        else if (dh < -maxDh) cur[i] = cur[i - 1] - maxDh;
      }
      for (let i = cur.length - 2; i >= 0; i--) {
        const dl = Math.max(1, dist(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z));
        const dh = cur[i] - cur[i + 1];
        const maxDh = MAXG * dl;
        if (dh > maxDh) cur[i] = cur[i + 1] + maxDh;
        else if (dh < -maxDh) cur[i] = cur[i + 1] - maxDh;
      }
    }

    road.elev = cur;
    roadElev.set(road.id, cur);
  }

  /** Hoehe der Fahrbahn an einem Punkt, samt Abstand zur Achse. */
  function roadSurface(x, z, maxDist = 70) {
    let best = null;
    for (const seg of net.segGrid.query(x, z, maxDist)) {
      const r = pointSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (r.dist < (best ? best.dist : maxDist)) best = { r, seg };
    }
    if (!best) return null;
    const road = best.seg.road;
    const elev = road.elev;
    if (!elev) return null;
    const i = best.seg.i;
    if (i == null || i < 1 || i >= elev.length) return null;
    return {
      y: lerp(elev[i - 1], elev[i], best.r.t),
      dist: best.r.dist,
      road,
    };
  }

  // ---- 4. Hoehenfeld rastern -------------------------------------------

  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = min + j * CELL;
    for (let i = 0; i < n; i++) {
      const x = min + i * CELL;
      let h = rawHeight(x, z);
      const rs = roadSurface(x, z, 60);
      if (rs) {
        const half = rs.road.width * 0.5;
        // Innerhalb der Fahrbahn voll einpraegen, dann weich auslaufen.
        const w = 1 - smoothstep(clamp((rs.dist - half - 3) / 34, 0, 1));
        if (w > 0) h = lerp(h, rs.y, w);
      }
      heights[j * n + i] = h;
    }
  }

  /** Bilinear interpolierte Gelaendehoehe. */
  function heightAt(x, z) {
    const fx = clamp((x - min) / CELL, 0, n - 1.001);
    const fz = clamp((z - min) / CELL, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = heights[j * n + i];
    const h10 = heights[j * n + i + 1];
    const h01 = heights[(j + 1) * n + i];
    const h11 = heights[(j + 1) * n + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /**
   * Hoehe der befahrbaren Oberflaeche: auf der Strasse die Gradiente, sonst
   * das Gelaende. Genau das braucht die Fahrzeugphysik.
   */
  function groundHeight(x, z) {
    const rs = roadSurface(x, z, 40);
    if (rs) {
      const half = rs.road.width * 0.5;
      if (rs.dist <= half) return rs.y;
      const t = clamp((rs.dist - half) / 12, 0, 1);
      return lerp(rs.y, heightAt(x, z), smoothstep(t));
    }
    return heightAt(x, z);
  }

  /** Normalenvektor der Oberflaeche — fuer die Neigung des Autos. */
  function groundNormal(x, z, s = 2.2) {
    const hL = groundHeight(x - s, z);
    const hR = groundHeight(x + s, z);
    const hD = groundHeight(x, z - s);
    const hU = groundHeight(x, z + s);
    const nrm = new THREE.Vector3(hL - hR, 2 * s, hD - hU);
    return nrm.normalize();
  }

  // ---- 5. Mesh ----------------------------------------------------------
  //
  // Nicht als ein grosses Netz, sondern in Kacheln: nur so kann three.js
  // Unsichtbares wegwerfen. Ein einziges Mesh ueber 6 km liegt immer im
  // Bild und wuerde in jedem Frame komplett gezeichnet — auch fuer den
  // Schattenwurf.

  const cMeadow = new THREE.Color(0x6f9a4a);
  const cMeadowDry = new THREE.Color(0x87a253);
  const cForest = new THREE.Color(0x2f5230);
  const cRock = new THREE.Color(0x8b8578);
  const cGravel = new THREE.Color(0x9a9083);
  const tmp = new THREE.Color();

  /** Gelaendefarbe an einem Punkt — Wiese, Wald oder Fels. */
  function groundColor(x, z, h, out) {
    const s = 12;
    const gx = (heightAt(x + s, z) - heightAt(x - s, z)) / (2 * s);
    const gz = (heightAt(x, z + s) - heightAt(x, z - s)) / (2 * s);
    const slope = Math.sqrt(gx * gx + gz * gz);
    const alt = clamp((h - VALLEY_FLOOR) / 620, 0, 1);

    out.copy(cMeadow);
    out.lerp(cMeadowDry, clamp((fbmSmall(x / 210, z / 210) - 0.35) * 2, 0, 1) * 0.7);
    out.lerp(cForest, clamp((alt - 0.06) * 2.1, 0, 1) * 0.82);
    out.lerp(cRock, clamp((slope - 0.5) * 1.5, 0, 1));
    if (alt < 0.02) out.lerp(cGravel, clamp((0.02 - alt) * 20, 0, 1) * 0.25);
    return out;
  }

  const TILES = 8;
  const tileCells = Math.ceil((n - 1) / TILES);
  const tileSize = tileCells * CELL;

  const object = new THREE.Group();
  object.name = 'terrain';
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: meadowTexture(),
    roughness: 0.97,
    metalness: 0,
  });

  for (let tj = 0; tj < TILES; tj++) {
    for (let ti = 0; ti < TILES; ti++) {
      const originX = min + ti * tileSize;
      const originZ = min + tj * tileSize;

      const geo = new THREE.PlaneGeometry(tileSize, tileSize, tileCells, tileCells);
      geo.rotateX(-Math.PI / 2);
      geo.translate(originX + tileSize / 2, 0, originZ + tileSize / 2);

      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const uv = geo.attributes.uv;

      for (let idx = 0; idx < pos.count; idx++) {
        const x = pos.getX(idx);
        const z = pos.getZ(idx);
        const h = heightAt(x, z);
        pos.setY(idx, h);

        // Textur in Weltkoordinaten kacheln — so laufen die Kanten
        // zwischen den Gelaendekacheln nahtlos durch.
        uv.setXY(idx, x / MEADOW_TILE, z / MEADOW_TILE);

        groundColor(x, z, h, tmp);
        // Leichte Farbvariation, damit grosse Flaechen nicht flach wirken.
        const v = (fbmSmall(x / 55, z / 55) - 0.5) * 0.09;
        colors[idx * 3] = clamp(tmp.r + v, 0, 1);
        colors[idx * 3 + 1] = clamp(tmp.g + v, 0, 1);
        colors[idx * 3 + 2] = clamp(tmp.b + v, 0, 1);
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      const tile = new THREE.Mesh(geo, mat);
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.name = `terrain-${ti}-${tj}`;
      object.add(tile);
    }
  }

  return {
    object,
    /** Alias, damit aelterer Aufrufcode weiterhin funktioniert. */
    mesh: object,
    heightAt,
    groundHeight,
    groundNormal,
    roadSurface,
    valleyFloor: VALLEY_FLOOR,
    axisDistance,
    bounds: { min, size, cell: CELL, n },
  };
}
