/**
 * Aus der rohen Karte (lat/lon) wird hier alles, was das Spiel wirklich
 * braucht: Polylinien in Metern, ein befahrbarer Graph fuer den Verkehr und
 * die Navigation, sowie ein Gitterindex fuer "auf welcher Strasse bin ich?".
 */

import { latLonToLocal, WORLD_RADIUS } from '../core/geo.js';
import { chaikin, simplify, pointSegment, dist, pathLength } from '../core/utils.js';

/** Fahrbahnbreite in Metern je OSM-Klasse (ohne Bankett). */
const WIDTH = {
  motorway: 11, trunk: 9, primary: 7.5, secondary: 6.6, tertiary: 6,
  unclassified: 5, residential: 5, living_street: 4.2, service: 3.6,
  track: 3.2, pedestrian: 3, cycleway: 2.6, footway: 2.2, path: 2,
};

/** Wie "wichtig" eine Strasse ist — steuert Zeichenreihenfolge und Karte. */
const RANK = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 6, living_street: 7, service: 8,
  track: 9, pedestrian: 10, cycleway: 11, footway: 12, path: 13,
};

/** Strassen, auf denen KI-Verkehr faehrt (Feldwege und Steige bleiben leer). */
const TRAFFIC_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street',
]);

export function roadWidth(road) {
  const base = WIDTH[road.highway?.replace(/_link$/, '')] ?? 5;
  const lanes = road.lanes || 2;
  // Bei explizit getaggten Spuren die Spurbreite verwenden, sonst Klassenwert.
  return Math.max(2, Math.max(base, lanes * 2.9));
}

export function roadRank(road) {
  return RANK[road.highway?.replace(/_link$/, '')] ?? 6;
}

/** Kleines gleichmaessiges Gitter fuer Nachbarschaftsabfragen. */
class Grid {
  constructor(cell = 60) {
    this.cell = cell;
    this.map = new Map();
  }

  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  add(x, z, item) {
    const k = this.key(x, z);
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push(item);
  }

  /** Alle Eintraege in den Zellen im Umkreis von `radius`. */
  query(x, z, radius = 0) {
    const r = Math.max(1, Math.ceil(radius / this.cell));
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const out = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const arr = this.map.get(`${cx + dx},${cz + dz}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }
}

function projectPoints(points) {
  return points.map((p) => latLonToLocal(p.lat, p.lon));
}

/** Schneidet eine Polylinie an der Weltgrenze in befahrbare Teilstuecke. */
function clipToWorld(pts, radius) {
  const inside = (p) => Math.abs(p.x) <= radius && Math.abs(p.z) <= radius;
  const runs = [];
  let cur = [];
  for (const p of pts) {
    if (inside(p)) {
      cur.push(p);
    } else {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/**
 * @param {object} map Karte aus `overpass.js` oder `frojachBaked.js`
 * @returns {object} Netz in lokalen Metern
 */
export function buildNetwork(map, { radius = WORLD_RADIUS } = {}) {
  const roads = [];

  for (const r of map.roads) {
    const projected = projectPoints(r.points);
    for (const run of clipToWorld(projected, radius)) {
      // OSM-Wege haben oft sehr dichte Stuetzpunkte. Erst ausduennen,
      // dann glaetten — das ergibt fahrbare Kurven statt Polygonzuege.
      let pts = simplify(run, 0.8);
      if (pts.length > 2) pts = chaikin(pts, 2);
      const len = pathLength(pts);
      if (len < 6) continue;
      roads.push({
        ...r,
        points: pts,
        width: roadWidth(r),
        rank: roadRank(r),
        length: len,
        traffic: TRAFFIC_CLASSES.has(r.highway?.replace(/_link$/, '')),
      });
    }
  }

  roads.sort((a, b) => a.rank - b.rank);

  // ---------------------------------------------------------------- Graph
  //
  // Endpunkte, die naeher als SNAP beieinander liegen, werden zu einem
  // Knoten verschmolzen. Damit haengen die Wege zusammen, obwohl OSM sie
  // als separate Objekte fuehrt.
  const SNAP = 9;
  const nodes = [];
  const nodeGrid = new Grid(SNAP * 2);

  function nodeAt(x, z) {
    for (const n of nodeGrid.query(x, z, SNAP)) {
      if (dist(x, z, n.x, n.z) <= SNAP) return n;
    }
    const n = { id: nodes.length, x, z, edges: [] };
    nodes.push(n);
    nodeGrid.add(x, z, n);
    return n;
  }

  const edges = [];
  for (const r of roads) {
    if (!r.traffic) continue;
    const a = nodeAt(r.points[0].x, r.points[0].z);
    const b = nodeAt(r.points[r.points.length - 1].x, r.points[r.points.length - 1].z);
    if (a === b) continue;
    const edge = {
      id: edges.length,
      road: r,
      a: a.id,
      b: b.id,
      length: r.length,
      points: r.points,
    };
    edges.push(edge);
    a.edges.push(edge.id);
    b.edges.push(edge.id);
  }

  // -------------------------------------------------- Index fuer Segmente
  const segGrid = new Grid(50);
  for (const r of roads) {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      // `i` merkt sich, welches Segment des Weges das ist — damit kommt
      // `terrain.roadSurface` ohne lineare Suche an die Hoehenstuetzpunkte.
      const seg = { road: r, i, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      // In jede Zelle eintragen, die das Segment beruehrt (grob gerastert).
      const steps = Math.max(1, Math.ceil(dist(a.x, a.z, b.x, b.z) / 25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        segGrid.add(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, seg);
      }
    }
  }

  const water = (map.water || []).flatMap((w) => {
    const projected = projectPoints(w.points);
    if (w.area) return [{ ...w, points: projected, closed: true }];
    return clipToWorld(projected, radius * 1.25).map((run) => ({
      ...w,
      points: chaikin(simplify(run, 1.2), 2),
      closed: false,
    }));
  });

  const rail = (map.rail || []).flatMap((r) => {
    const projected = projectPoints(r.points);
    return clipToWorld(projected, radius * 1.2).map((run) => ({
      ...r,
      points: chaikin(simplify(run, 1), 2),
    }));
  });

  const buildings = (map.buildings || [])
    .map((b) => {
      const pts = projectPoints(b.points);
      // OSM schliesst Flaechen, indem der letzte Punkt dem ersten entspricht.
      if (pts.length > 1) {
        const f = pts[0];
        const l = pts[pts.length - 1];
        if (Math.abs(f.x - l.x) < 0.01 && Math.abs(f.z - l.z) < 0.01) pts.pop();
      }
      return { ...b, points: pts };
    })
    .filter(
      (b) =>
        b.points.length >= 3 &&
        b.points.every((p) => Math.abs(p.x) <= radius && Math.abs(p.z) <= radius),
    );

  const areas = (map.areas || [])
    .map((a) => ({ ...a, points: projectPoints(a.points) }))
    .filter((a) => a.points.length >= 3);

  const landmarks = (map.landmarks || []).map((l) => {
    const q = latLonToLocal(l.lat, l.lon);
    return { ...l, x: q.x, z: q.z };
  });

  const pois = (map.pois || []).map((q) => {
    const r = latLonToLocal(q.lat, q.lon);
    return { ...q, x: r.x, z: r.z };
  });

  const net = {
    source: map.source,
    attribution: map.attribution,
    roads,
    nodes,
    edges,
    water,
    rail,
    buildings,
    areas,
    landmarks,
    pois,
    segGrid,

    /**
     * Naechstgelegene Strasse zu einem Punkt.
     * Wird gebraucht fuer: Strassenname im HUD, Untergrund-Reibung,
     * Verkehrs-Spawn und das Einrasten der Street-View-Kamera.
     */
    nearestRoad(x, z, maxDist = 45) {
      let best = null;
      for (const seg of segGrid.query(x, z, maxDist)) {
        const r = pointSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
        if (r.dist < (best ? best.dist : maxDist)) {
          best = { dist: r.dist, road: seg.road, x: r.x, z: r.z, t: r.t, seg };
        }
      }
      return best;
    },

    /** Ist der Punkt auf befestigter Fahrbahn? */
    onRoad(x, z) {
      const n = net.nearestRoad(x, z, 30);
      return !!n && n.dist <= n.road.width * 0.5 + 0.6;
    },

    /** Startposition: Mitte der Ortsdurchfahrt, in Fahrtrichtung ausgerichtet. */
    spawn() {
      const preferred =
        roads.find((r) => /B\s?96/i.test(r.ref || '') && r.maxspeed <= 60) ||
        roads.find((r) => /B\s?96|Murtal/i.test(`${r.ref || ''} ${r.name || ''}`)) ||
        roads.find((r) => r.rank <= 3) ||
        roads[0];
      const pts = preferred.points;
      const i = Math.max(1, Math.floor(pts.length / 2));
      const a = pts[i - 1];
      const b = pts[i];
      return {
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
        yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
        road: preferred,
      };
    },
  };

  return net;
}
