/**
 * Kamera.
 *
 * Vier Perspektiven, wie man sie aus dem Genre kennt: Verfolgerkamera nah
 * und weit, Motorhaube und Stossstange. Die Verfolgerkamera zieht bei Tempo
 * zurueck und dreht bei Drift leicht mit — das macht schnelles Fahren
 * lesbar, ohne dass einem schwindlig wird.
 */

import * as THREE from 'three';
import { damp, dampAngle, clamp, lerp } from '../core/utils.js';

export const CAMERA_MODES = ['chase', 'far', 'hood', 'bumper'];

const PRESETS = {
  chase: { dist: 6.6, height: 2.5, look: 1.15, fov: 68, lag: 7.5 },
  far: { dist: 10.5, height: 4.2, look: 1.6, fov: 62, lag: 5.2 },
  hood: { dist: -0.15, height: 1.28, look: 1.15, fov: 76, lag: 26 },
  bumper: { dist: -1.7, height: 0.62, look: 0.9, fov: 82, lag: 30 },
};

export function createChaseCamera(camera, terrain) {
  let mode = 'chase';
  let yaw = 0;
  let dist = PRESETS.chase.dist;
  let height = PRESETS.chase.height;
  let fov = PRESETS.chase.fov;
  let shake = 0;

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function setMode(m) {
    mode = m;
    return mode;
  }

  function cycle() {
    const i = CAMERA_MODES.indexOf(mode);
    return setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  function addShake(amount) {
    shake = Math.min(1.4, shake + amount);
  }

  function update(vehicle, dt) {
    const p = PRESETS[mode];
    const speedFrac = clamp(vehicle.speed / 45, 0, 1);

    // Ziel-Kamerawinkel: Fahrzeugausrichtung, bei Drift etwas nachlaufend.
    const driftYaw = mode === 'hood' || mode === 'bumper'
      ? vehicle.yaw
      : vehicle.yaw - clamp(vehicle.yawRate * 0.16, -0.35, 0.35);

    yaw = dampAngle(yaw, driftYaw, p.lag, dt);

    // Bei Tempo weiter weg und flacheres Blickfeld -> Geschwindigkeitsgefuehl
    const targetDist = p.dist * (1 + speedFrac * 0.28);
    const targetHeight = p.height * (1 + speedFrac * 0.1);
    dist = damp(dist, targetDist, 6, dt);
    height = damp(height, targetHeight, 6, dt);

    const targetFov = p.fov + speedFrac * 11 + vehicle.slip * 4;
    fov = damp(fov, targetFov, 5, dt);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const back = { x: Math.sin(yaw), z: Math.cos(yaw) }; // Gegenrichtung zu vorne

    pos.set(
      vehicle.x + back.x * dist,
      vehicle.y + height,
      vehicle.z + back.z * dist,
    );

    if (mode === 'hood' || mode === 'bumper') {
      // Innenperspektiven sitzen fest am Auto und nicken mit.
      const f = vehicle.forward;
      pos.set(
        vehicle.x - f.x * p.dist,
        vehicle.y + height,
        vehicle.z - f.z * p.dist,
      );
      camera.position.copy(pos);
      look.set(
        vehicle.x + f.x * 40,
        vehicle.y + height + Math.sin(-vehicle.pitch) * 40 * 0.5,
        vehicle.z + f.z * 40,
      );
      camera.up.set(Math.sin(vehicle.roll) * 0.35, 1, 0).normalize();
      camera.lookAt(look);
    } else {
      // Nicht durch den Boden schauen
      const ground = terrain.groundHeight(pos.x, pos.z);
      if (pos.y < ground + 1.1) pos.y = ground + 1.1;
      camera.position.lerp(pos, 1 - Math.exp(-p.lag * 1.2 * dt));
      look.set(vehicle.x, vehicle.y + p.look, vehicle.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
    }

    // Ruettelei bei Aufprall und auf Schotter
    if (shake > 0.001) {
      const s = shake * 0.22;
      tmp.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      camera.position.add(tmp);
      shake = damp(shake, 0, 5, dt);
    }
    if (!vehicle.onRoad && vehicle.speed > 6) {
      const s = clamp(vehicle.speed / 40, 0, 1) * 0.035;
      camera.position.y += (Math.random() - 0.5) * s;
    }
  }

  return {
    get mode() {
      return mode;
    },
    setMode,
    cycle,
    update,
    addShake,
    /** Fuer den Einstieg: sofort ans Auto setzen, ohne Nachziehen. */
    snap(vehicle) {
      yaw = vehicle.yaw;
      const p = PRESETS[mode];
      camera.position.set(
        vehicle.x + Math.sin(yaw) * p.dist,
        vehicle.y + p.height,
        vehicle.z + Math.cos(yaw) * p.dist,
      );
      camera.lookAt(vehicle.x, vehicle.y + p.look, vehicle.z);
    },
  };
}
