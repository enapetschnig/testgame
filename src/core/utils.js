/** Kleine Helfer, die ueberall gebraucht werden. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Framerate-unabhaengiges Nachziehen: rate = Anteil pro Sekunde. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Winkeldifferenz normalisiert auf (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(a, b, rate, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));
}

export const dist2 = (ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
};

export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

/** Kuerzester Abstand von P zur Strecke AB, samt Fusspunkt-Parameter t. */
export function pointSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 1e-9 ? clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1) : 0;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { t, x: cx, z: cz, dist: dist(px, pz, cx, cz) };
}

/** Flaeche eines geschlossenen Polygons (positiv = gegen den Uhrzeigersinn). */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j].x * points[i].z - points[i].x * points[j].z;
  }
  return a / 2;
}

export function polygonCentroid(points) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = points[j].x * points[i].z - points[i].x * points[j].z;
    a += f;
    cx += (points[j].x + points[i].x) * f;
    cz += (points[j].z + points[i].z) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      z: points.reduce((s, p) => s + p.z, 0) / n,
    };
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

/** Punkt-in-Polygon (Ray Casting). */
export function pointInPolygon(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Ramer-Douglas-Peucker: duennt Polylinien aus, ohne die Form zu verlieren.
 * OSM-Wege haben oft dutzende Stuetzpunkte pro Kurve — fuer die Fahrbahn-
 * geometrie reicht ein Bruchteil davon.
 */
export function simplify(points, epsilon = 0.6) {
  if (points.length < 3) return points.slice();
  let maxD = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegment(points[i].x, points[i].z, a.x, a.z, b.x, b.z).dist;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [a, b];
  const left = simplify(points.slice(0, idx + 1), epsilon);
  const right = simplify(points.slice(idx), epsilon);
  return left.slice(0, -1).concat(right);
}

/** Chaikin-Glaettung — macht aus eckigen OSM-Wegen fahrbare Kurven. */
export function chaikin(points, iterations = 2, closed = false) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out = [];
    if (!closed) out.push(pts[0]);
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      out.push({ x: p.x * 0.75 + q.x * 0.25, z: p.z * 0.75 + q.z * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, z: p.z * 0.25 + q.z * 0.75 });
    }
    if (!closed) out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Gesamtlaenge einer Polylinie. */
export function pathLength(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
  return l;
}

/** Punkt bei Bogenlaenge s auf einer Polylinie, inkl. Tangente. */
export function pointAtLength(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a.x, a.z, b.x, b.z);
    if (acc + seg >= s || i === points.length - 1) {
      const t = seg > 1e-6 ? clamp((s - acc) / seg, 0, 1) : 0;
      return {
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
        dirX: seg > 1e-6 ? (b.x - a.x) / seg : 1,
        dirZ: seg > 1e-6 ? (b.z - a.z) / seg : 0,
        index: i - 1,
      };
    }
    acc += seg;
  }
  const last = points[points.length - 1];
  return { x: last.x, z: last.z, dirX: 1, dirZ: 0, index: points.length - 2 };
}

export function formatClock(minutesOfDay) {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatMoney(v) {
  return '€ ' + Math.round(v).toLocaleString('de-AT');
}
