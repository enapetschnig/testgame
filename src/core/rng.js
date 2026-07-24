/**
 * Deterministischer Zufall. Die ganze Welt (Haeuser, Baeume, Zaeune, Verkehr)
 * wird prozedural erzeugt — mit festem Seed sieht Frojach bei jedem Start
 * gleich aus, was fuer Wiedererkennbarkeit und Debugging wichtig ist.
 */

/** mulberry32 — klein, schnell, gute Verteilung. */
export function makeRng(seed = 0x46524f4a) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Erzeugt aus einem String einen stabilen 32-Bit-Seed (FNV-1a). */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rngRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function rngInt(rng, lo, hi) {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function rngBool(rng, p = 0.5) {
  return rng() < p;
}

/**
 * Wertrauschen mit bilinearer Interpolation — reicht voellig fuer
 * Gelaendewellen und ist ohne externe Bibliothek zu haben.
 */
export function makeValueNoise(seed = 1337) {
  const rng = makeRng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rng();

  const at = (x, y) => table[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  return function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/** Fraktales Rauschen (fBm) aus mehreren Oktaven Wertrauschen. */
export function makeFbm(seed = 1337, octaves = 4, lacunarity = 2, gain = 0.5) {
  const noise = makeValueNoise(seed);
  return function fbm(x, y) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}
