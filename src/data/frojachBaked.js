/**
 * Mitgelieferte Offline-Karte von Frojach (Gemeinde Teufenbach-Katsch, Bezirk Murau).
 *
 * WOFUER
 * Das Spiel holt das echte Strassennetz beim ersten Start live von der
 * Overpass-API (siehe `overpass.js`) — dort stecken auch die Gebaeudegrund-
 * risse. Wenn das scheitert (kein Netz, Overpass ueberlastet, Firewall),
 * faellt es auf diesen Datensatz zurueck, damit man trotzdem sofort losfaehrt.
 *
 * WOHER DIE GEOMETRIE STAMMT
 * Der Verlauf der B96 Murtalstrasse, der Katschtal-Abzweig und die Strassen
 * am Nordufer sind gegen die tatsaechliche Street-View-Abdeckung im Talkessel
 * kalibriert: Panorama-Standorte liegen per Definition auf befahrenen
 * Strassen, also markieren sie den echten Strassenkorridor. Die Achsen
 * stimmen damit auf ein paar Meter. Ortsinterne Details (Dorfstrassen,
 * Hofzufahrten, Feldwege) sind daraus plausibel ergaenzt, aber nicht
 * vermessen — dafuer die Live-OSM-Daten verwenden.
 *
 * KOORDINATEN
 * [x, y] in Metern relativ zum Ortsmittelpunkt: x = Osten, y = Norden.
 * (Achtung: in Three.js ist z = -y.)
 */

import { localToLatLon } from '../core/geo.js';

/** [x_ost, y_nord] -> {lat, lon} */
const p = (x, y) => localToLatLon(x, -y);
const line = (pts) => pts.map(([x, y]) => p(x, y));

// ---------------------------------------------------------------------------
// B 96 Murtalstrasse — die Lebensader des Dorfes.
// Stuetzpunkte aus der Street-View-Abdeckung (Befliegung 08/2025).
// ---------------------------------------------------------------------------

const B96 = [
  [-2500, 300], [-2150, 312], [-1803, 322], [-1683, 316], [-1557, 324],
  [-1433, 335], [-1319, 349], [-1203, 362], [-1084, 364], [-959, 361],
  [-844, 343], [-732, 319], [-588, 275], [-487, 237], [-374, 192],
  [-231, 136], [-130, 97], [-60, 74], [9, 51], [120, 26], [244, 8],
  [358, -9], [482, -26], [600, -37], [720, -44], [839, -52], [956, -61],
  [1083, -71], [1210, -84], [1325, -105], [1437, -125], [1502, -128],
  [1557, -121], [1659, -86], [1809, -9], [2050, 90], [2400, 210],
];

/** Index-Bereiche der B96, die als Ortsdurchfahrt gelten (Tempo 50). */
const B96_WEST = B96.slice(0, 15); // bis kurz vor den Ortsanfang
const B96_ORT = B96.slice(14, 22); // Ortsdurchfahrt Frojach
const B96_OST = B96.slice(21); //     Richtung Teufenbach

// ---------------------------------------------------------------------------
// Katschtalstrasse — verlaesst die B96 westlich des Ortes und zieht ins
// suedliche Seitental nach Katsch an der Mur.
// ---------------------------------------------------------------------------

const KATSCHTAL = [
  [-73, -9], [-152, -90], [-237, -112], [-354, -115], [-476, -110],
  [-553, -95], [-604, -90], [-658, -93], [-719, -97], [-792, -143],
  [-844, -228], [-954, -268], [-1087, -321], [-1203, -348], [-1310, -384],
  [-1442, -383], [-1555, -364], [-1637, -320], [-1690, -246],
];

const KATSCH_SUED = [
  [-719, -97], [-718, -352], [-721, -477], [-809, -450], [-845, -580],
  [-912, -619], [-960, -720], [-1010, -840],
];

const KATSCH_DORF = [
  [-607, -226], [-695, -260], [-697, -672], [-737, -660], [-629, -770],
  [-575, -818], [-520, -900],
];

// ---------------------------------------------------------------------------
// Nordufer der Mur: Pux, Schloss Pux, Puxer Loch, Aufstieg zum Puxberg.
// ---------------------------------------------------------------------------

const NORDUFER = [
  [-1204, 510], [-1100, 466], [-973, 680], [-717, 629], [-602, 588],
  [-495, 465], [-441, 413], [-361, 353], [-222, 277], [-126, 246],
  [-1, 350], [86, 399], [150, 444], [237, 492], [361, 517], [474, 493],
  [594, 520], [681, 612],
];

const PUX_STRASSE = [
  [-1204, 510], [-1240, 615], [-1329, 648], [-1449, 616], [-1563, 593],
  [-1654, 617], [-1793, 632],
];

const PUXBERG_WEG = [
  [-1329, 648], [-1327, 679], [-1212, 724], [-1184, 847], [-1283, 1001],
  [-1400, 1037], [-1287, 1080], [-1254, 1184], [-1321, 1316], [-1408, 1370],
  [-1542, 1458], [-1675, 1570], [-1812, 1648],
];

// ---------------------------------------------------------------------------
// Murbruecke Frojach-Katsch (1966) — Rad- und Fussgaengerbruecke, im Spiel
// befahrbar, weil sie die schoenste Abkuerzung ans Nordufer ist.
// ---------------------------------------------------------------------------

const MURBRUECKE_SUED = [[-130, 97], [-133, 122], [-131, 148]];
const MURBRUECKE = [[-131, 148], [-129, 178], [-127, 208]];
const MURBRUECKE_NORD = [[-127, 208], [-126, 246]];

// ---------------------------------------------------------------------------
// Ortsinterne Strassen (plausibel ergaenzt).
// Frojach ist ein Strassendorf: rund 60 Haeuser reihen sich an der B96,
// dahinter liegen die Hoefe an zwei Nebengassen.
// ---------------------------------------------------------------------------

const DORFSTRASSE = [
  [-231, 136], [-215, 105], [-170, 78], [-100, 58], [-20, 44], [70, 30],
  [150, 18], [220, 8], [244, 8],
];

const UNTERDORF = [
  [-170, 78], [-186, 40], [-170, 6], [-110, -12], [-30, -20], [50, -20],
  [128, -14], [175, 0], [180, 12],
];

const KIRCHWEG = [[-100, 58], [-104, 26], [-118, -2], [-136, -24]];
const BAHNHOFWEG = [[70, 30], [76, -2], [72, -34], [58, -58]];
const SCHULGASSE = [[-20, 44], [-16, 18], [-24, -4]];
const HOFWEG_OST = [[244, 8], [300, -8], [372, -30], [430, -66]];
const MURWEG = [
  [-374, 192], [-300, 172], [-180, 150], [-40, 128], [110, 108], [280, 92],
  [450, 78], [620, 66],
];
const FELDWEG_SUED = [[-136, -24], [-230, -46], [-350, -52], [-470, -40]];
const SAEGEWERKWEG = [[482, -26], [520, 2], [566, 24], [620, 30]];
const ALMWEG = [
  [-470, -40], [-520, -120], [-560, -230], [-600, -350], [-580, -470],
  [-520, -580],
];

// ---------------------------------------------------------------------------

const WAYS = [
  { id: 'b96-w', name: 'B 96 Murtalstraße', ref: 'B 96', highway: 'primary', lanes: 2, maxspeed: 100, pts: B96_WEST },
  { id: 'b96-ort', name: 'B 96 Murtalstraße', ref: 'B 96', highway: 'primary', lanes: 2, maxspeed: 50, pts: B96_ORT },
  { id: 'b96-o', name: 'B 96 Murtalstraße', ref: 'B 96', highway: 'primary', lanes: 2, maxspeed: 100, pts: B96_OST },

  { id: 'katschtal', name: 'Katschtalstraße', highway: 'secondary', lanes: 2, maxspeed: 70, pts: KATSCHTAL },
  { id: 'katsch-sued', name: 'Katschtalstraße', highway: 'unclassified', lanes: 1, maxspeed: 50, pts: KATSCH_SUED },
  { id: 'katsch-dorf', name: 'Katsch an der Mur', highway: 'residential', lanes: 1, maxspeed: 30, pts: KATSCH_DORF },

  { id: 'nordufer', name: 'Puxer Straße', highway: 'secondary', lanes: 2, maxspeed: 60, pts: NORDUFER },
  { id: 'pux', name: 'Puxer Straße', highway: 'unclassified', lanes: 1, maxspeed: 50, pts: PUX_STRASSE },
  { id: 'puxberg', name: 'Puxbergweg', highway: 'track', lanes: 1, maxspeed: 30, landmark: 'Puxberg', pts: PUXBERG_WEG },

  { id: 'mbr-s', name: 'Murbrückenweg', highway: 'unclassified', lanes: 1, maxspeed: 30, pts: MURBRUECKE_SUED },
  { id: 'mbr', name: 'Murbrücke Frojach–Katsch', highway: 'unclassified', bridge: true, lanes: 1, maxspeed: 20, landmark: 'Murbrücke Frojach–Katsch (1966)', pts: MURBRUECKE },
  { id: 'mbr-n', name: 'Murbrückenweg', highway: 'unclassified', lanes: 1, maxspeed: 30, pts: MURBRUECKE_NORD },

  { id: 'dorfstrasse', name: 'Dorfstraße', highway: 'residential', lanes: 2, maxspeed: 30, pts: DORFSTRASSE },
  { id: 'unterdorf', name: 'Unterdorfweg', highway: 'residential', lanes: 1, maxspeed: 30, pts: UNTERDORF },
  { id: 'kirchweg', name: 'Kirchweg', highway: 'residential', lanes: 1, maxspeed: 30, pts: KIRCHWEG },
  { id: 'bahnhofweg', name: 'Bahnhofweg', highway: 'unclassified', lanes: 1, maxspeed: 30, pts: BAHNHOFWEG },
  { id: 'schulgasse', name: 'Schulgasse', highway: 'residential', lanes: 1, maxspeed: 30, pts: SCHULGASSE },
  { id: 'hofweg-ost', name: 'Hofweg', highway: 'service', lanes: 1, maxspeed: 20, pts: HOFWEG_OST },
  { id: 'murweg', name: 'Murweg', highway: 'track', lanes: 1, maxspeed: 30, pts: MURWEG },
  { id: 'feldweg-sued', name: 'Feldweg', highway: 'track', lanes: 1, maxspeed: 25, pts: FELDWEG_SUED },
  { id: 'saegewerkweg', name: 'Sägewerkweg', highway: 'service', lanes: 1, maxspeed: 20, pts: SAEGEWERKWEG },
  { id: 'almweg', name: 'Almweg', highway: 'track', lanes: 1, maxspeed: 25, pts: ALMWEG },
];

// ---------------------------------------------------------------------------
// Mur, Katschbach, Murtalbahn
// ---------------------------------------------------------------------------

const WATER = [
  {
    id: 'mur',
    name: 'Mur',
    kind: 'river',
    width: 24,
    pts: [
      [-2500, 400], [-2000, 412], [-1600, 424], [-1200, 438], [-900, 452],
      [-600, 420], [-380, 330], [-250, 250], [-150, 190], [-40, 168],
      [140, 156], [340, 142], [560, 120], [800, 96], [1050, 78], [1300, 62],
      [1560, 62], [1820, 96], [2100, 170], [2400, 280],
    ],
  },
  {
    id: 'katschbach',
    name: 'Katschbach',
    kind: 'stream',
    width: 5,
    pts: [
      [-1010, -840], [-900, -640], [-820, -470], [-760, -300], [-720, -160],
      [-660, -60], [-500, 10], [-320, 70], [-160, 128],
    ],
  },
];

const RAIL = [
  {
    id: 'murtalbahn',
    name: 'Murtalbahn',
    kind: 'narrow_gauge',
    pts: [
      [-2500, 250], [-2100, 262], [-1700, 272], [-1300, 300], [-1000, 312],
      [-800, 292], [-600, 228], [-420, 150], [-260, 92], [-100, 40],
      [60, 8], [240, -22], [430, -50], [640, -66], [860, -80], [1090, -94],
      [1320, -122], [1500, -148], [1660, -112], [1830, -34], [2100, 66],
      [2400, 186],
    ],
  },
];

// ---------------------------------------------------------------------------
// Sehenswertes. Alles andere (Wohnhaeuser, Hoefe, Scheunen) setzt
// `world/buildings.js` prozedural entlang der Strassen.
// ---------------------------------------------------------------------------

const LANDMARKS = [
  {
    id: 'bahnhof', name: 'Bahnhof Frojach-Katschtal', kind: 'station',
    note: 'Denkmalgeschütztes Stationsgebäude der Murtalbahn (Unzmarkt–Mauterndorf).',
    at: [58, -66], size: [32, 11], height: 8.5, roof: 'gable', rotation: -0.32,
  },
  {
    id: 'kapelle', name: 'Ortskapelle Frojach', kind: 'chapel',
    at: [-140, -34], size: [11, 17], height: 9, tower: 21, roof: 'gable', rotation: -0.3,
  },
  {
    id: 'gasthaus', name: 'Dorfgasthaus zur Mur', kind: 'pub',
    note: 'Startpunkt für die Frühschoppen-Tour.',
    at: [-52, 34], size: [21, 14], height: 9.5, roof: 'gable', rotation: -0.28,
  },
  {
    id: 'feuerwehr', name: 'FF Frojach', kind: 'fire_station',
    at: [96, 16], size: [18, 11], height: 7.5, roof: 'gable', rotation: -0.25,
  },
  {
    id: 'schule', name: 'Volksschule', kind: 'school',
    at: [-22, 8], size: [24, 13], height: 10, roof: 'gable', rotation: -0.25,
  },
  {
    id: 'lagerhaus', name: 'Lagerhaus', kind: 'warehouse',
    at: [188, -6], size: [30, 15], height: 11, roof: 'gable', rotation: -0.2,
  },
  {
    id: 'saegewerk', name: 'Sägewerk an der Mur', kind: 'industrial',
    at: [624, 34], size: [38, 19], height: 10, roof: 'gable', rotation: -0.1,
  },
  {
    id: 'kirche-katsch', name: 'Pfarrkirche Katsch an der Mur', kind: 'church',
    at: [-660, -700], size: [16, 30], height: 13, tower: 33, roof: 'gable', rotation: 0.5,
  },
  {
    id: 'burg-katsch', name: 'Burgruine Katsch', kind: 'ruin',
    note: 'Seit dem 9. Jahrhundert bezeugt — karolingisches Königsgut über dem Katschtal.',
    at: [-560, -560], size: [30, 22], height: 17, tower: 25, roof: 'none', rotation: 0.4,
  },
  {
    id: 'schloss-pux', name: 'Schloss Pux', kind: 'castle',
    at: [-1360, 700], size: [30, 22], height: 15, tower: 21, roof: 'hip', rotation: 0.2,
  },
  {
    id: 'burg-pux', name: 'Burgruine Pux', kind: 'ruin',
    at: [-1450, 790], size: [20, 15], height: 12, tower: 17, roof: 'none', rotation: 0.3,
  },
];

const POIS = [
  { id: 'puxer-loch', name: 'Puxer Loch', kind: 'cave', at: [-1290, 900] },
  { id: 'murbruecke', name: 'Murbrücke Frojach–Katsch', kind: 'viewpoint', at: [-129, 178] },
  { id: 'puxberg', name: 'Puxberg · 1486 m', kind: 'peak', at: [-1900, 1900] },
  { id: 'nach-teufenbach', name: 'Teufenbach →', kind: 'exit', at: [2400, 210] },
  { id: 'nach-murau', name: '← Murau', kind: 'exit', at: [-2500, 300] },
];

/**
 * Baut den normalisierten Datensatz — exakt das Format, das auch der
 * Overpass-Import liefert, damit der Rest des Spiels keinen Unterschied sieht.
 */
export function buildBakedMap() {
  return {
    source: 'baked',
    generated: '2026-07-24',
    attribution:
      'Frojach, Gemeinde Teufenbach-Katsch. Straßenachsen gegen Google-Street-View-Abdeckung kalibriert, Ortsdetails ergänzt.',
    roads: WAYS.map((w) => ({
      id: w.id,
      name: w.name,
      ref: w.ref || null,
      highway: w.highway,
      lanes: w.lanes || 2,
      maxspeed: w.maxspeed || 50,
      bridge: !!w.bridge,
      tunnel: false,
      oneway: false,
      landmark: w.landmark || null,
      points: line(w.pts),
    })),
    water: WATER.map((w) => ({ ...w, points: line(w.pts), pts: undefined })),
    rail: RAIL.map((r) => ({ ...r, points: line(r.pts), pts: undefined })),
    buildings: [],
    landmarks: LANDMARKS.map((l) => {
      const q = p(l.at[0], l.at[1]);
      return { ...l, lat: q.lat, lon: q.lon };
    }),
    pois: POIS.map((q) => {
      const r = p(q.at[0], q.at[1]);
      return { ...q, lat: r.lat, lon: r.lon };
    }),
  };
}
