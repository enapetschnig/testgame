/**
 * Geodaesie fuer Frojach.
 *
 * Das Spiel rechnet intern in Metern in einem lokalen ENU-System
 * ("east-north-up") mit dem Dorfzentrum als Ursprung. Fuer ein Gebiet von
 * wenigen Kilometern ist eine einfache aequirektangulaere Projektion genau
 * genug (Fehler deutlich unter einem Meter).
 *
 * Three.js-Konvention in diesem Projekt:
 *   +x = Osten
 *   +y = oben
 *   -z = Norden   (also +z = Sueden)
 */

/** Ortsmittelpunkt Frojach, Gemeinde Teufenbach-Katsch, Bezirk Murau. */
export const ORIGIN = Object.freeze({
  lat: 47.13333,
  lon: 14.3,
  /** Talboden der Mur bei Frojach in Metern ueber Adria. */
  ele: 760,
  name: 'Frojach',
});

/**
 * Halbe Kantenlaenge des Spielgebiets in Metern. Alles ausserhalb wird
 * nicht aus OpenStreetMap geladen und vom Spiel als Talausgang behandelt.
 */
export const WORLD_RADIUS = 2600;

const DEG = Math.PI / 180;
const R_EARTH = 6378137;

/** Meter pro Grad Breite (praktisch konstant). */
export const M_PER_DEG_LAT = (Math.PI / 180) * R_EARTH;

/** Meter pro Grad Laenge auf Hoehe von Frojach. */
export const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * DEG);

/**
 * WGS84 -> lokale Meter.
 * @returns {{x:number, z:number}} x = Osten, z = Sueden
 */
export function latLonToLocal(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

/**
 * Lokale Meter -> WGS84. Wird fuer Street View gebraucht: das Spiel muss
 * jederzeit sagen koennen, wo auf der echten Erde das Auto gerade steht.
 */
export function localToLatLon(x, z) {
  return {
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
  };
}

/**
 * Three.js-Rotation (Radiant um die y-Achse, 0 = Blick nach -z/Norden,
 * mathematisch positiv = gegen den Uhrzeigersinn) in einen Kompasskurs
 * (Grad, 0 = Nord, im Uhrzeigersinn) umrechnen. Street View erwartet Letzteres.
 */
export function yawToHeading(yaw) {
  return (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
}

/** Umkehrung von {@link yawToHeading}. */
export function headingToYaw(heading) {
  return (-heading * Math.PI) / 180;
}

/** Grosskreisdistanz in Metern (fuer kleine Distanzen genau genug). */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const la1 = a.lat * DEG;
  const la2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bounding-Box um den Ursprung, in Grad — Reihenfolge wie bei Overpass. */
export function worldBBox(radiusM = WORLD_RADIUS) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / M_PER_DEG_LON;
  return {
    south: ORIGIN.lat - dLat,
    west: ORIGIN.lon - dLon,
    north: ORIGIN.lat + dLat,
    east: ORIGIN.lon + dLon,
  };
}

/**
 * Achse des Murtals bei Frojach: die Mur fliesst hier ungefaehr nach
 * Ostnordost (Richtung Teufenbach). Terrain, Fluss und Bahn richten sich
 * an dieser Achse aus.
 */
export const VALLEY_BEARING = 80 * DEG;
export const VALLEY_DIR = Object.freeze({
  // Einheitsvektor talabwaerts in lokalen Koordinaten (x=Ost, z=Sued)
  x: Math.sin(VALLEY_BEARING),
  z: -Math.cos(VALLEY_BEARING),
});
/** Senkrecht zur Talachse, zeigt auf die Nordflanke (Katsch/Pux-Seite). */
export const VALLEY_NORMAL = Object.freeze({
  x: -VALLEY_DIR.z,
  z: VALLEY_DIR.x,
});

/** Zerlegt einen lokalen Punkt in (entlang Tal, quer zum Tal). */
export function toValleyFrame(x, z) {
  return {
    u: x * VALLEY_DIR.x + z * VALLEY_DIR.z,
    v: x * VALLEY_NORMAL.x + z * VALLEY_NORMAL.z,
  };
}

/** Umkehrung von {@link toValleyFrame}. */
export function fromValleyFrame(u, v) {
  return {
    x: u * VALLEY_DIR.x + v * VALLEY_NORMAL.x,
    z: u * VALLEY_DIR.z + v * VALLEY_NORMAL.z,
  };
}
