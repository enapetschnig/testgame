/**
 * Alles, was die Landschaft bewohnt aussehen laesst: Fichtenwald an den
 * Haengen, Obstbaeume im Dorf, Stromleitungen entlang der Strasse,
 * Leitschienen in den Kurven, Weidezaeune, Heuballen und die Ortstafel.
 *
 * Konsequent als InstancedMesh — bei einigen zehntausend Baeumen ist das
 * der Unterschied zwischen 60 fps und einer Diashow.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, makeFbm, rngRange, rngPick } from '../core/rng.js';
import { clamp, dist, smoothstep } from '../core/utils.js';
import { WORLD_RADIUS } from '../core/geo.js';

/**
 * Fichte: Stamm plus zwei versetzte Kegel. Bewusst wenige Segmente — bei
 * zehntausenden Baeumen zaehlt jedes Dreieck.
 */
function spruceGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2.4, 4, 1, true);
  trunk.translate(0, 1.2, 0);
  parts.push({ geo: trunk, color: 0x4a3524 });

  const lower = new THREE.ConeGeometry(2.0, 5.2, 6, 1, true);
  lower.translate(0, 4.2, 0);
  parts.push({ geo: lower, color: 0x2b4a2b });

  const upper = new THREE.ConeGeometry(1.35, 4.4, 6, 1, true);
  upper.translate(0, 7.4, 0);
  parts.push({ geo: upper, color: 0x335531 });

  return parts;
}

function broadleafGeometry() {
  const trunk = new THREE.CylinderGeometry(0.17, 0.25, 2.6, 4, 1, true);
  trunk.translate(0, 1.3, 0);
  const crown = new THREE.IcosahedronGeometry(2.3, 0);
  crown.scale(1, 0.88, 1);
  crown.translate(0, 4.4, 0);
  return [
    { geo: trunk, color: 0x53402c },
    { geo: crown, color: 0x4c7238 },
  ];
}

/**
 * Verschmilzt die Einzelteile (Stamm, Krone …) zu einer Geometrie und
 * schreibt die Teilefarben in ein Vertex-Farbattribut. Damit braucht ein
 * Baum genau einen Draw-Call statt drei.
 */
function mergeParts(parts) {
  const prepared = parts.map((part) => {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    const c = new THREE.Color(part.color);
    for (let i = 0; i < count; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Nur die Attribute behalten, die alle Teile gemeinsam haben.
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Baut InstancedMeshes — nach Raumkacheln getrennt.
 *
 * Das ist der entscheidende Punkt fuer die Bildrate: ein einziges
 * InstancedMesh ueber die ganze Karte hat eine Bounding-Sphere, die immer im
 * Bild liegt, also wird es in jedem Frame komplett gezeichnet — auch in den
 * Schattendurchgang. In Kacheln zerlegt greift das Frustum-Culling, und pro
 * Bild bleiben nur die paar Kacheln uebrig, die man wirklich sieht.
 */
function instanceParts(parts, transforms, { castShadow = true, tile = 360 } = {}) {
  const group = new THREE.Group();
  if (!transforms.length) return group;

  const geometry = mergeParts(parts);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });

  const buckets = new Map();
  for (const t of transforms) {
    const key = `${Math.floor(t.x / tile)},${Math.floor(t.z / tile)}`;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(t);
  }

  const dummy = new THREE.Object3D();
  for (const list of buckets.values()) {
    const inst = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, t.yaw || 0, 0);
      dummy.scale.setScalar(t.s || 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere(); // sonst kann three die Kachel nicht cullen
    inst.castShadow = castShadow;
    inst.receiveShadow = false;
    inst.frustumCulled = true;
    group.add(inst);
  }
  return group;
}

export function createVegetation(net, terrain, { density = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rng = makeRng(0x54524545);
  const fbm = makeFbm(0x7711, 3, 2.2, 0.5);

  const spruces = [];
  const broadleaf = [];

  // OSM-Waldflaechen kennzeichnen, wo definitiv Wald steht. Jede Flaeche
  // bekommt eine Bounding-Box vorgeschaltet, sonst kostet der Punkt-in-
  // Polygon-Test bei zehntausenden Kandidaten zu viel.
  const forestAreas = (net.areas || [])
    .filter((a) => /forest|wood|scrub|orchard/.test(a.kind || ''))
    .map((a) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of a.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      return { poly: a.points, minX, maxX, minZ, maxZ };
    });

  const inForestArea = (x, z) => {
    for (const a of forestAreas) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      let inside = false;
      const poly = a.poly;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };

  // Rasterweite bestimmt die Baumzahl quadratisch — 20 m ergeben im
  // bewaldeten Hang rund 30.000 Baeume, was ein guter Kompromiss aus
  // dichtem Wald und fluessiger Darstellung ist.
  const STEP = 20 / Math.sqrt(density);
  const R = WORLD_RADIUS + 250;

  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      const jx = x + rngRange(rng, -STEP * 0.5, STEP * 0.5);
      const jz = z + rngRange(rng, -STEP * 0.5, STEP * 0.5);

      const h = terrain.heightAt(jx, jz);
      const alt = h - terrain.valleyFloor;

      // Steigung: Wald waechst auch steil, Wiese wird gemaeht.
      const gx = (terrain.heightAt(jx + 8, jz) - terrain.heightAt(jx - 8, jz)) / 16;
      const gz = (terrain.heightAt(jx, jz + 8) - terrain.heightAt(jx, jz - 8)) / 16;
      const slope = Math.hypot(gx, gz);

      // Grundwahrscheinlichkeit: im Talboden fast nichts, am Hang dichter Wald.
      let p = clamp((alt - 18) / 90, 0, 1) * 0.85 + clamp((slope - 0.14) * 1.9, 0, 1) * 0.5;
      p *= 0.35 + fbm(jx / 340, jz / 340) * 1.25; // Waldraender ausfransen
      if (inForestArea(jx, jz)) p = Math.max(p, 0.9);

      // Ueber der Waldgrenze (hier grosszuegig 1650 m) hoert es auf.
      p *= 1 - smoothstep(clamp((h - 1500) / 220, 0, 1));

      if (rng() > p) continue;

      // Abstand zu Strassen halten, sonst waechst der Wald auf der Fahrbahn.
      const near = net.nearestRoad(jx, jz, 26);
      if (near && near.dist < near.road.width * 0.5 + 5.5) continue;

      const y = terrain.heightAt(jx, jz);
      const t = {
        x: jx,
        y: y - 0.3,
        z: jz,
        yaw: rngRange(rng, 0, Math.PI * 2),
        s: rngRange(rng, 0.72, 1.35),
      };
      // Im Tal Laubbaeume, am Hang Fichten — so schaut das Murtal aus.
      if (alt < 45 && rng() < 0.62) broadleaf.push(t);
      else spruces.push(t);
    }
  }

  if (spruces.length) group.add(instanceParts(spruceGeometry(), spruces));
  if (broadleaf.length) group.add(instanceParts(broadleafGeometry(), broadleaf));

  return group;
}

/**
 * Strassenmoeblierung: Stromleitung, Leitschienen, Weidezaun, Heuballen,
 * Ortstafel. Alles orientiert sich am Strassennetz.
 */
export function createStreetProps(net, terrain) {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = makeRng(0x50524f50);

  const poles = [];
  const guard = [];
  const fence = [];
  const bales = [];

  for (const road of net.roads) {
    const pts = road.points;
    const elev = road.elev;
    const yAt = (i) => (elev ? elev[Math.min(i, elev.length - 1)] : terrain.heightAt(pts[i].x, pts[i].z));

    let acc = rngRange(rng, 0, 40);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = dist(a.x, a.z, b.x, b.z);
      if (segLen < 0.01) continue;
      const ux = (b.x - a.x) / segLen;
      const uz = (b.z - a.z) / segLen;
      const nx = -uz;
      const nz = ux;

      // Kurvigkeit bestimmen -> dort Leitschiene setzen
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const cross = Math.abs(ux * (c.z - b.z) - uz * (c.x - b.x)) / (segLen || 1);

      let t = 0;
      while (t < segLen) {
        if (acc <= 0) {
          const px = a.x + ux * t;
          const pz = a.z + uz * t;
          const py = yAt(i);
          const side = rng() < 0.5 ? -1 : 1;
          const off = road.width * 0.5 + 2.4;

          // Strommasten nur an klassifizierten Strassen
          if (road.rank <= 5 && rng() < 0.55) {
            poles.push({
              x: px + nx * off * side,
              y: terrain.heightAt(px + nx * off * side, pz + nz * off * side),
              z: pz + nz * off * side,
              yaw: Math.atan2(ux, uz),
            });
          }

          // Weidezaun im Talboden
          if (rng() < 0.35 && road.rank >= 5) {
            const fo = road.width * 0.5 + rngRange(rng, 3, 6);
            fence.push({
              x: px + nx * fo * side,
              y: terrain.heightAt(px + nx * fo * side, pz + nz * fo * side),
              z: pz + nz * fo * side,
              yaw: Math.atan2(ux, uz),
            });
          }
          acc = rngRange(rng, 26, 46);
        }
        const adv = Math.min(acc, segLen - t);
        t += adv;
        acc -= adv;
      }

      // Leitschiene: enge Kurve oder Abhang
      const drop = terrain.heightAt(b.x + nx * 9, b.z + nz * 9) - yAt(i);
      if (cross > 0.06 || drop < -3.5) {
        const sideSign = drop < -3.5 ? 1 : cross > 0.06 ? -Math.sign(ux * (c.z - b.z) - uz * (c.x - b.x)) : 1;
        const off = road.width * 0.5 + 1.1;
        for (let s = 0; s < segLen; s += 4) {
          const px = a.x + ux * s + nx * off * sideSign;
          const pz = a.z + uz * s + nz * off * sideSign;
          guard.push({ x: px, y: yAt(i) + 0.52, z: pz, yaw: Math.atan2(ux, uz) });
        }
      }
    }
  }

  // Heuballen auf den Wiesen im Talboden
  for (let k = 0; k < 260; k++) {
    const x = rngRange(rng, -WORLD_RADIUS, WORLD_RADIUS);
    const z = rngRange(rng, -WORLD_RADIUS, WORLD_RADIUS);
    const h = terrain.heightAt(x, z);
    if (h > terrain.valleyFloor + 40) continue;
    const gx = (terrain.heightAt(x + 6, z) - terrain.heightAt(x - 6, z)) / 12;
    const gz = (terrain.heightAt(x, z + 6) - terrain.heightAt(x, z - 6)) / 12;
    if (Math.hypot(gx, gz) > 0.14) continue;
    const near = net.nearestRoad(x, z, 20);
    if (near && near.dist < 12) continue;
    bales.push({ x, y: h + 0.62, z, yaw: rngRange(rng, 0, Math.PI * 2) });
  }

  // --- Meshes ----------------------------------------------------------

  if (poles.length) {
    const post = new THREE.CylinderGeometry(0.14, 0.2, 8.4, 6);
    post.translate(0, 4.2, 0);
    const arm = new THREE.BoxGeometry(2.0, 0.12, 0.12);
    arm.translate(0, 7.9, 0);
    group.add(
      instanceParts(
        [
          { geo: post, color: 0x6b563d },
          { geo: arm, color: 0x5a4a35 },
        ],
        poles,
      ),
    );
  }

  if (guard.length) {
    const beam = new THREE.BoxGeometry(0.1, 0.32, 4.0);
    group.add(instanceParts([{ geo: beam, color: 0xa8adb2 }], guard));
  }

  if (fence.length) {
    const post = new THREE.BoxGeometry(0.1, 1.15, 0.1);
    post.translate(0, 0.58, 0);
    const rail = new THREE.BoxGeometry(0.06, 0.07, 3.0);
    rail.translate(0, 0.92, 0);
    group.add(
      instanceParts(
        [
          { geo: post, color: 0x6d5637 },
          { geo: rail, color: 0x7a6440 },
        ],
        fence,
        { castShadow: false },
      ),
    );
  }

  if (bales.length) {
    const bale = new THREE.CylinderGeometry(0.62, 0.62, 1.2, 10);
    bale.rotateZ(Math.PI / 2);
    group.add(instanceParts([{ geo: bale, color: 0xd8cfa0 }], bales));
  }

  return group;
}

/**
 * Ortstafel. In Oesterreich weiss auf blau — das erste, was man sieht,
 * wenn man nach Frojach hineinfaehrt.
 */
export function createTownSign(net, terrain, text = 'Frojach') {
  const group = new THREE.Group();
  group.name = 'townsign';

  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#1b4a9c';
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#ffffff';
  g.font = 'bold 82px Inter, Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 84);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // Die Ortstafel an die wichtigste Strasse stellen, westlich des Zentrums.
  const road =
    net.roads.find((r) => /B\s?96/i.test(r.ref || '')) ||
    net.roads.find((r) => r.rank <= 3) ||
    net.roads[0];
  if (!road) return group;

  // Punkt suchen, der etwa 320 m westlich der Ortsmitte auf der Strasse liegt.
  let best = road.points[0];
  let bestScore = Infinity;
  for (const p of road.points) {
    const s = Math.abs(Math.hypot(p.x, p.z) - 320) + (p.x > 0 ? 400 : 0);
    if (s < bestScore) {
      bestScore = s;
      best = p;
    }
  }

  const near = net.nearestRoad(best.x, best.z, 40);
  const nx = near ? -(near.seg.bz - near.seg.az) : 1;
  const nz = near ? near.seg.bx - near.seg.ax : 0;
  const nl = Math.hypot(nx, nz) || 1;
  const off = (road.width * 0.5 + 2.2);
  const px = best.x + (nx / nl) * off;
  const pz = best.z + (nz / nl) * off;
  const py = terrain.heightAt(px, pz);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }),
  );
  const yaw = Math.atan2(best.x - px, best.z - pz);
  plate.position.set(px, py + 2.05, pz);
  plate.rotation.y = yaw;
  plate.castShadow = true;
  group.add(plate);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 }),
  );
  post.position.set(px, py + 1.05, pz);
  post.castShadow = true;
  group.add(post);

  return group;
}
