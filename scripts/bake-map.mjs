#!/usr/bin/env node
/**
 * Holt das echte Frojach von der Overpass-API und legt es als JSON neben den
 * Quellcode. Damit startet das Spiel auch offline mit metergenauen Strassen
 * und echten Gebaeudegrundrissen, statt auf die handgebaute Ersatzkarte
 * zurueckzufallen.
 *
 *   npm run bake:map
 *
 * Danach liegt `src/data/frojachOsm.json` bereit; `main.js` laedt sie
 * automatisch, falls vorhanden.
 *
 * Overpass ist ein Gemeinschaftsdienst — bitte nicht in einer Schleife
 * aufrufen. Einmal reicht; die Daten aendern sich selten.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/frojachOsm.json');

// Muss mit src/core/geo.js uebereinstimmen.
const ORIGIN = { lat: 47.13333, lon: 14.3 };
const RADIUS = 2600;
const M_PER_DEG_LAT = (Math.PI / 180) * 6378137;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const DRIVABLE =
  '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|' +
  'tertiary|tertiary_link|unclassified|residential|living_street|service|track|pedestrian|' +
  'cycleway|footway|path)$';

function bbox() {
  const dLat = RADIUS / M_PER_DEG_LAT;
  const dLon = RADIUS / M_PER_DEG_LON;
  return [
    (ORIGIN.lat - dLat).toFixed(6),
    (ORIGIN.lon - dLon).toFixed(6),
    (ORIGIN.lat + dLat).toFixed(6),
    (ORIGIN.lon + dLon).toFixed(6),
  ].join(',');
}

const query = `[out:json][timeout:180];
(
  way["highway"~"${DRIVABLE}"](${bbox()});
  way["building"](${bbox()});
  way["waterway"~"^(river|stream|canal)$"](${bbox()});
  way["natural"="water"](${bbox()});
  way["railway"~"^(rail|narrow_gauge|light_rail|tram)$"](${bbox()});
  way["landuse"~"^(forest|meadow|farmland|farmyard|grass|orchard|vineyard|residential|cemetery)$"](${bbox()});
  way["natural"~"^(wood|scrub|water|wetland)$"](${bbox()});
  node["place"~"^(village|hamlet|isolated_dwelling|locality|town)$"](${bbox()});
  node["amenity"~"^(place_of_worship|fuel|restaurant|pub|cafe|fire_station|school|townhall|bus_station)$"](${bbox()});
  node["historic"](${bbox()});
  node["tourism"~"^(viewpoint|attraction|museum|information)$"](${bbox()});
  node["railway"="station"](${bbox()});
  node["natural"="peak"](${bbox()});
);
out geom qt;`;

async function fetchOverpass() {
  let lastError = null;
  for (const url of ENDPOINTS) {
    process.stdout.write(`→ ${url} … `);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'frojach-drive/1.0 (map bake script)',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error('unerwartete Antwort');
      console.log(`${json.elements.length} Objekte`);
      return json;
    } catch (err) {
      lastError = err;
      console.log(`fehlgeschlagen (${err.message})`);
    }
  }
  throw lastError ?? new Error('kein Endpunkt erreichbar');
}

const raw = await fetchOverpass();

// Rohdaten schlank machen: nur was das Spiel liest, und Koordinaten auf
// sieben Nachkommastellen (rund 1 cm) kuerzen.
const round = (v) => Math.round(v * 1e7) / 1e7;
const slim = {
  generated: new Date().toISOString(),
  origin: ORIGIN,
  radius: RADIUS,
  attribution: 'Kartendaten © OpenStreetMap-Mitwirkende (ODbL)',
  elements: raw.elements.map((el) => {
    const out = { type: el.type, id: el.id, tags: el.tags };
    if (el.type === 'node') {
      out.lat = round(el.lat);
      out.lon = round(el.lon);
    } else if (el.geometry) {
      out.geometry = el.geometry.map((g) => ({ lat: round(g.lat), lon: round(g.lon) }));
    }
    return out;
  }),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(slim));

const ways = slim.elements.filter((e) => e.type === 'way');
const roads = ways.filter((e) => e.tags?.highway).length;
const buildings = ways.filter((e) => e.tags?.building).length;

console.log(`\n✓ ${OUT}`);
console.log(`  ${roads} Straßen, ${buildings} Gebäude, ${slim.elements.length} Objekte gesamt`);
console.log('  Beim nächsten Start des Spiels wird diese Datei verwendet.');
