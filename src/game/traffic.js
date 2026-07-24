/**
 * Gegenverkehr.
 *
 * Die KI-Autos fahren auf dem Kantengraph aus `network.js`: Kante abfahren,
 * an der Kreuzung eine anschliessende Kante waehlen, dabei rechts halten.
 * Tempo richtet sich nach Strassenklasse und Kurvenradius; vor Hindernissen
 * (anderes Auto, Spieler) wird gebremst.
 *
 * Weit entfernte Autos werden recycelt statt neu erzeugt — so bleibt die
 * Zahl konstant und die Welt trotzdem belebt.
 */

import * as THREE from 'three';
import { createVehicle, VEHICLE_ORDER, VEHICLE_COLORS } from '../vehicle/models.js';
import { makeRng, rngPick, rngRange } from '../core/rng.js';
import { clamp, dist, lerp, damp, angleDelta } from '../core/utils.js';

const SPAWN_MIN = 90; // nicht direkt vor der Nase auftauchen
const SPAWN_MAX = 420;
const DESPAWN = 620;

export function createTraffic(net, terrain, scene, { count = 14 } = {}) {
  const rng = makeRng(0x54524146);
  const cars = [];

  const drivable = net.edges.filter((e) => e.road.traffic && e.length > 25);
  if (!drivable.length) {
    return { cars, update() {}, dispose() {} };
  }

  /** Alle Kanten an einem Knoten ausser der, aus der man kommt. */
  function nextEdge(nodeId, fromEdgeId) {
    const node = net.nodes[nodeId];
    const options = node.edges.filter((id) => id !== fromEdgeId);
    if (!options.length) return null;
    return net.edges[options[Math.floor(rng() * options.length)]];
  }

  function makeCar() {
    const kind = rng() < 0.12 ? 'tractor' : rngPick(rng, ['hatch', 'wagon', 'wagon', 'hatch', 'sport']);
    const built = createVehicle(kind, rngPick(rng, VEHICLE_COLORS));
    built.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(built.group);
    return {
      kind,
      obj: built.group,
      wheels: built.wheels,
      lights: built.lights,
      spec: built.spec,
      edge: null,
      dir: 1,
      s: 0,
      speed: 0,
      x: 0,
      z: 0,
      y: 0,
      yaw: 0,
      spin: 0,
      active: false,
    };
  }

  /** Setzt ein Auto irgendwo im Ring um den Spieler ab. */
  function place(car, px, pz) {
    for (let tries = 0; tries < 24; tries++) {
      const edge = drivable[Math.floor(rng() * drivable.length)];
      const s = rngRange(rng, 0, edge.length);
      const p = pointOnEdge(edge, s, 1);
      const d = dist(p.x, p.z, px, pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      car.edge = edge;
      car.dir = rng() < 0.5 ? 1 : -1;
      car.s = car.dir > 0 ? s : edge.length - s;
      car.speed = targetSpeed(edge.road) * 0.7;
      car.active = true;
      car.obj.visible = true;
      return true;
    }
    return false;
  }

  /** Punkt und Tangente bei Bogenlaenge s (in Fahrtrichtung dir). */
  function pointOnEdge(edge, s, dir) {
    const pts = edge.points;
    const len = edge.length;
    const ss = clamp(dir > 0 ? s : len - s, 0, len);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = dist(a.x, a.z, b.x, b.z);
      if (acc + seg >= ss || i === pts.length - 1) {
        const t = seg > 1e-6 ? (ss - acc) / seg : 0;
        const dx = (b.x - a.x) / (seg || 1);
        const dz = (b.z - a.z) / (seg || 1);
        return {
          x: lerp(a.x, b.x, t),
          z: lerp(a.z, b.z, t),
          dx: dx * dir,
          dz: dz * dir,
        };
      }
      acc += seg;
    }
    const last = pts[pts.length - 1];
    return { x: last.x, z: last.z, dx: 1, dz: 0 };
  }

  function targetSpeed(road) {
    const limit = (road.maxspeed || 50) / 3.6;
    return clamp(limit * 0.86, 5, 30);
  }

  /** Kruemmung ein Stueck voraus — dafuer wird vor der Kurve gebremst. */
  function curveAhead(car, lookahead = 26) {
    const a = pointOnEdge(car.edge, car.s, car.dir);
    const b = pointOnEdge(car.edge, Math.min(car.edge.length, car.s + lookahead), car.dir);
    const d = Math.abs(angleDelta(Math.atan2(a.dx, a.dz), Math.atan2(b.dx, b.dz)));
    return d;
  }

  for (let i = 0; i < count; i++) {
    const c = makeCar();
    c.obj.visible = false;
    cars.push(c);
  }

  function update(dt, player) {
    const px = player.x;
    const pz = player.z;

    for (const car of cars) {
      if (!car.active) {
        place(car, px, pz);
        continue;
      }

      // --- Wunschgeschwindigkeit -----------------------------------------
      let want = targetSpeed(car.edge.road);
      const curve = curveAhead(car);
      want *= clamp(1 - curve * 1.5, 0.28, 1);
      if (car.kind === 'tractor') want = Math.min(want, 8);

      // Vor dem Spieler und vor anderen Autos abbremsen
      const ahead = pointOnEdge(car.edge, Math.min(car.edge.length, car.s + 16), car.dir);
      const dPlayer = dist(ahead.x, ahead.z, px, pz);
      if (dPlayer < 14) want = Math.min(want, dPlayer < 7 ? 0 : 5);

      for (const other of cars) {
        if (other === car || !other.active) continue;
        const d = dist(ahead.x, ahead.z, other.x, other.z);
        if (d < 12) {
          // Nur bremsen, wenn der andere wirklich davor ist
          const rel = (other.x - car.x) * ahead.dx + (other.z - car.z) * ahead.dz;
          if (rel > 0) want = Math.min(want, d < 6 ? 0 : other.speed * 0.8);
        }
      }

      car.speed = damp(car.speed, want, want > car.speed ? 1.6 : 4.5, dt);
      car.s += car.speed * dt;

      // --- Kreuzung erreicht? ---------------------------------------------
      if (car.s >= car.edge.length) {
        const endNode = car.dir > 0 ? car.edge.b : car.edge.a;
        const next = nextEdge(endNode, car.edge.id);
        if (!next) {
          // Sackgasse: umdrehen
          car.dir *= -1;
          car.s = 0;
        } else {
          car.dir = next.a === endNode ? 1 : -1;
          car.edge = next;
          car.s = 0;
        }
      }

      const p = pointOnEdge(car.edge, car.s, car.dir);
      // Rechts halten: bei Blickrichtung (dx,dz) zeigt (-dz,dx) nach rechts.
      const off = Math.min(2.0, car.edge.road.width * 0.25);
      car.x = p.x - p.dz * off;
      car.z = p.z + p.dx * off;
      car.y = terrain.groundHeight(car.x, car.z);
      const targetYaw = Math.atan2(-p.dx, -p.dz);
      car.yaw = car.yaw === 0 ? targetYaw : car.yaw + angleDelta(car.yaw, targetYaw) * clamp(dt * 9, 0, 1);
      car.spin += (car.speed / (car.spec.wheelRadius || 0.32)) * dt;

      car.obj.position.set(car.x, car.y, car.z);
      car.obj.rotation.y = car.yaw;
      for (const w of car.wheels) w.userData.spin.rotation.x = car.spin;

      // --- Recyceln --------------------------------------------------------
      if (dist(car.x, car.z, px, pz) > DESPAWN) {
        car.active = false;
        car.obj.visible = false;
      }
    }
  }

  function setNight(on) {
    for (const car of cars) {
      if (car.lights.headMat) car.lights.headMat.emissiveIntensity = on ? 2.2 : 0;
      if (car.lights.tailMat) car.lights.tailMat.emissiveIntensity = on ? 1.1 : 0;
    }
  }

  function dispose() {
    for (const car of cars) {
      scene.remove(car.obj);
      car.obj.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material?.dispose?.();
        }
      });
    }
    cars.length = 0;
  }

  return { cars, update, setNight, dispose };
}
