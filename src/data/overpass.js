/**
 * Holt das echte Frojach aus OpenStreetMap.
 *
 * Overpass liefert Strassen, Gebaeudegrundrisse, Gewaesser, die Murtalbahn
 * und Flaechennutzung. Damit steht im Spiel jedes Haus genau dort, wo es
 * auch in echt steht, und hat den richtigen Grundriss.
 *
 * Ergebnis wird in IndexedDB zwischengespeichert — Overpass ist ein
 * Gemeinschaftsdienst, den man nicht bei jedem Seitenaufruf belasten sollte.
 */

import { worldBBox, WORLD_RADIUS } from '../core/geo.js';

/** Mehrere Spiegel: faellt einer aus, wird der naechste probiert. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const DRIVABLE =
  '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|pedestrian|cycleway|footway|path)$';

const CACHE_DB = 'frojach-drive';
const CACHE_STORE = 'osm';
const CACHE_KEY = `frojach@${WORLD_RADIUS}`;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 Tage

export function buildQuery(radius = WORLD_RADIUS) {
  const b = worldBBox(radius);
  const bbox = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:90];
(
  way["highway"~"${DRIVABLE}"](${bbox});
  way["building"](${bbox});
  way["waterway"~"^(river|stream|canal)$"](${bbox});
  way["natural"="water"](${bbox});
  way["railway"~"^(rail|narrow_gauge|light_rail|tram)$"](${bbox});
  way["landuse"~"^(forest|meadow|farmland|farmyard|grass|orchard|vineyard|residential|cemetery)$"](${bbox});
  way["natural"~"^(wood|scrub|water|wetland)$"](${bbox});
  node["place"~"^(village|hamlet|isolated_dwelling|locality|town)$"](${bbox});
  node["amenity"~"^(place_of_worship|fuel|restaurant|pub|cafe|fire_station|school|townhall|bus_station)$"](${bbox});
  node["historic"](${bbox});
  node["tourism"~"^(viewpoint|attraction|museum|information)$"](${bbox});
  node["railway"="station"](${bbox});
  node["natural"="peak"](${bbox});
);
out geom qt;`;
}

// ------------------------------------------------------------------- Cache

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheRead(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function cacheWrite(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Cache ist optional — ohne laeuft es auch, nur langsamer. */
  }
}

export async function clearCache() {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).delete(CACHE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    /* egal */
  }
}

// ------------------------------------------------------------ Normalisierung

const num = (v) => {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

const DEFAULT_SPEED = {
  motorway: 130, trunk: 100, primary: 100, secondary: 80, tertiary: 70,
  unclassified: 60, residential: 30, living_street: 20, service: 20,
  track: 25, pedestrian: 15, cycleway: 20, footway: 15, path: 15,
};

const DEFAULT_LANES = {
  motorway: 4, trunk: 2, primary: 2, secondary: 2, tertiary: 2,
  unclassified: 2, residential: 2, living_street: 1, service: 1,
  track: 1, pedestrian: 1, cycleway: 1, footway: 1, path: 1,
};

/** Rohes Overpass-JSON -> internes Kartenformat. */
export function normalize(osm) {
  const map = {
    source: 'osm',
    generated: new Date().toISOString().slice(0, 10),
    attribution: 'Kartendaten © OpenStreetMap-Mitwirkende (ODbL)',
    roads: [],
    buildings: [],
    water: [],
    rail: [],
    areas: [],
    landmarks: [],
    pois: [],
  };

  for (const el of osm.elements || []) {
    const t = el.tags || {};

    if (el.type === 'node') {
      const name = t.name || t['name:de'] || null;
      const kind =
        t.natural === 'peak' ? 'peak'
        : t.railway === 'station' ? 'station'
        : t.historic ? String(t.historic)
        : t.amenity ? String(t.amenity)
        : t.tourism ? String(t.tourism)
        : t.place ? String(t.place)
        : 'poi';
      if (!name && kind === 'poi') continue;
      map.pois.push({
        id: `n${el.id}`,
        name: name || kind,
        kind,
        lat: el.lat,
        lon: el.lon,
        ele: num(t.ele),
      });
      continue;
    }

    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const points = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));

    if (t.highway) {
      const hw = t.highway.replace(/_link$/, '');
      map.roads.push({
        id: `w${el.id}`,
        name: t.name || t['name:de'] || null,
        ref: t.ref || null,
        highway: t.highway,
        lanes: num(t.lanes) || DEFAULT_LANES[hw] || 2,
        maxspeed: num(t.maxspeed) || DEFAULT_SPEED[hw] || 50,
        bridge: t.bridge === 'yes' || !!t.bridge,
        tunnel: t.tunnel === 'yes' || !!t.tunnel,
        oneway: t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout',
        surface: t.surface || null,
        landmark: null,
        points,
      });
      continue;
    }

    if (t.building || t['building:part']) {
      const levels = num(t['building:levels']);
      map.buildings.push({
        id: `w${el.id}`,
        name: t.name || null,
        kind: t.building === 'yes' ? t.amenity || t.man_made || 'house' : t.building,
        levels: levels || null,
        height: num(t.height) || (levels ? levels * 3.1 + 0.6 : null),
        roofShape: t['roof:shape'] || null,
        roofHeight: num(t['roof:height']),
        points,
      });
      continue;
    }

    if (t.waterway || t.natural === 'water') {
      map.water.push({
        id: `w${el.id}`,
        name: t.name || null,
        kind: t.waterway || 'water',
        width: num(t.width) || (t.waterway === 'river' ? 22 : 5),
        area: t.natural === 'water',
        points,
      });
      continue;
    }

    if (t.railway) {
      map.rail.push({
        id: `w${el.id}`,
        name: t.name || null,
        kind: t.railway,
        points,
      });
      continue;
    }

    if (t.landuse || t.natural) {
      map.areas.push({
        id: `w${el.id}`,
        kind: t.landuse || t.natural,
        name: t.name || null,
        points,
      });
    }
  }

  return map;
}

// ------------------------------------------------------------------- Fetch

async function tryEndpoint(url, query, signal) {
  const res = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal,
  });
  if (!res.ok) throw new Error(`${url} antwortete ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.elements)) throw new Error('unerwartete Antwort');
  return json;
}

/**
 * Laedt die Karte. Reihenfolge: Cache -> Overpass (mit Spiegeln).
 *
 * @param {object} opts
 * @param {boolean} opts.force      Cache ignorieren und frisch laden
 * @param {(msg:string, frac:number)=>void} opts.onProgress
 * @returns {Promise<object|null>} Karte oder null, wenn nichts zu holen war
 */
export async function loadOsmMap({ force = false, onProgress = () => {} } = {}) {
  if (!force) {
    const cached = await cacheRead(CACHE_KEY);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.map) {
      onProgress('Karte aus dem Zwischenspeicher', 1);
      return { ...cached.map, source: 'osm-cache' };
    }
  }

  const query = buildQuery();
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const url = ENDPOINTS[i];
    onProgress(`OpenStreetMap wird abgefragt (${i + 1}/${ENDPOINTS.length}) …`, 0.15 + i * 0.1);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const raw = await tryEndpoint(url, query, ctrl.signal);
      clearTimeout(timer);
      const map = normalize(raw);
      if (map.roads.length < 3) throw new Error('zu wenige Straßen in der Antwort');
      onProgress(
        `${map.roads.length} Straßen, ${map.buildings.length} Gebäude geladen`,
        0.7,
      );
      await cacheWrite(CACHE_KEY, { at: Date.now(), map });
      return map;
    } catch (err) {
      clearTimeout(timer);
      console.warn('[overpass]', url, err.message);
    }
  }

  // Alles fehlgeschlagen — evtl. liegt noch eine abgelaufene Kopie im Cache.
  const stale = await cacheRead(CACHE_KEY);
  if (stale?.map) {
    onProgress('Overpass nicht erreichbar — alte Kopie wird verwendet', 1);
    return { ...stale.map, source: 'osm-stale' };
  }
  return null;
}
