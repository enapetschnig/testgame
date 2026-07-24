/**
 * Fahrzeugphysik.
 *
 * Kein volles Reifenmodell, sondern ein Arcade-Modell in der Tradition der
 * Vorbilder: laengs eine echte Kraftbilanz (Motor, Bremse, Luftwiderstand,
 * Rollreibung, Hangabtrieb), quer eine saettigende Seitenfuehrungskraft.
 * Ueberschreitet die Querbeschleunigung den Grip, bricht das Heck aus — und
 * mit der Handbremse laesst sich das gezielt provozieren.
 *
 * Achsenkonvention: yaw = 0 blickt nach Norden (-z).
 *   vorne  = (-sin yaw, 0, -cos yaw)
 *   rechts = ( cos yaw, 0, -sin yaw)
 */

import * as THREE from 'three';
import { createVehicle, SPECS } from './models.js';
import { clamp, damp, dampAngle, lerp } from '../core/utils.js';

const GRAVITY = 9.81;

export class Vehicle {
  /**
   * @param {object} world { terrain, collider, net }
   * @param {string} kind
   */
  constructor(world, kind = 'hatch', color = 0xc8332f) {
    this.world = world;
    this.kind = kind;
    this.spec = SPECS[kind] || SPECS.hatch;

    const built = createVehicle(kind, color);
    this.object = built.group;
    this.body = built.body;
    this.wheels = built.wheels;
    this.lights = built.lights;

    // Zustand
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0; // Weltgeschwindigkeit
    this.vz = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.airborne = false;

    // Aufbau-Neigung (nur Optik)
    this.pitch = 0;
    this.roll = 0;
    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.suspension = 0;

    this.headlights = false;
    this.brakeLight = 0;
    this.slip = 0;
    this.lastImpact = 0;
    this.odometer = 0;
    this.engineLoad = 0;
    this.gear = 1;
    this.rpm = 900;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  get right() {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Vorwaertsgeschwindigkeit (negativ = rueckwaerts). */
  get vLong() {
    const f = this.forward;
    return this.vx * f.x + this.vz * f.z;
  }

  placeAt(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.y = this.world.terrain.groundHeight(x, z);
    this.sync();
  }

  respawn() {
    // Auf die naechste Strasse zuruecksetzen, in Fahrtrichtung.
    const near = this.world.net.nearestRoad(this.x, this.z, 400);
    if (near) {
      const dx = near.seg.bx - near.seg.ax;
      const dz = near.seg.bz - near.seg.az;
      this.placeAt(near.x, near.z, Math.atan2(-dx, -dz));
    } else {
      const s = this.world.net.spawn();
      this.placeAt(s.x, s.z, s.yaw);
    }
  }

  /**
   * @param {number} dt Sekunden
   * @param {object} input { throttle, brake, steer, handbrake }
   */
  update(dt, input) {
    const { terrain, collider } = this.world;
    const spec = this.spec;

    const f = this.forward;
    const r = this.right;
    let vLong = this.vx * f.x + this.vz * f.z;
    let vLat = this.vx * r.x + this.vz * r.z;

    // --- Untergrund ------------------------------------------------------
    const near = this.world.net.nearestRoad(this.x, this.z, 30);
    const onRoad = !!near && near.dist <= near.road.width * 0.5 + 0.4;
    const paved = onRoad && near.road.rank <= 8 && near.road.highway !== 'track';
    const surface = paved ? 1 : onRoad ? 0.78 : 0.56;
    this.onRoad = onRoad;
    this.currentRoad = near?.road || null;

    // --- Laengsdynamik ---------------------------------------------------
    const speed = Math.abs(vLong);
    const speedFrac = clamp(speed / spec.topSpeed, 0, 1);

    // Motorkennlinie: viel Schub unten, oben laeuft es aus.
    const powerCurve = (1 - speedFrac * speedFrac * 0.86) * (0.45 + 0.55 * (1 - Math.abs(speedFrac - 0.35)));
    let force = 0;

    if (input.throttle > 0.01) {
      if (vLong < -0.5) {
        // Gas beim Rueckwaertsrollen wirkt als Bremse
        force += input.throttle * spec.brake * 0.8;
      } else {
        force += input.throttle * spec.power * clamp(powerCurve, 0.06, 1.4) * surface;
      }
    }

    if (input.brake > 0.01) {
      if (vLong > 0.4) {
        force -= input.brake * spec.brake * surface;
      } else {
        // Steht oder rollt rueckwaerts -> Rueckwaertsgang
        force -= input.brake * spec.power * 0.42 * surface;
      }
    }

    // Widerstaende: Luftwiderstand 0,5 * rho * cw * A mit rho = 1,225 kg/m3,
    // cw ~ 0,32 und rund 2,2 m2 Stirnflaeche; dazu Rollreibung, die auf
    // der Wiese deutlich hoeher ausfaellt als auf Asphalt.
    const dragCoeff = 0.5 * 1.225 * 0.32 * 2.2;
    force -= dragCoeff * vLong * Math.abs(vLong);
    force -= (paved ? 9.5 : 26) * vLong;

    // Motorbremse
    if (input.throttle < 0.02 && input.brake < 0.02) force -= vLong * 32;

    // Hangabtrieb: bergauf wird es zaeh, bergab rollt es
    const ahead = 2.4;
    const hHere = terrain.groundHeight(this.x, this.z);
    const hAhead = terrain.groundHeight(this.x + f.x * ahead, this.z + f.z * ahead);
    const grade = clamp((hAhead - hHere) / ahead, -0.6, 0.6);
    force -= grade * spec.mass * GRAVITY * 0.92;

    vLong += (force / spec.mass) * dt;

    // Handbremse blockiert die Hinterachse
    if (input.handbrake) vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), 9 * dt);

    // Hoechstgeschwindigkeit
    const vMax = spec.topSpeed * (paved ? 1 : 0.62);
    vLong = clamp(vLong, -vMax * 0.36, vMax);

    // --- Lenkung und Gieren ---------------------------------------------
    const steerMax = lerp(spec.steerLow, spec.steerHigh, clamp(Math.abs(vLong) / 38, 0, 1));
    const steer = input.steer * steerMax;
    this.steerVisual = damp(this.steerVisual, steer, 14, dt);

    const wheelbase = spec.wheelbase;
    // Kinematisches Fahrradmodell als Sollgierrate
    let targetYawRate = (vLong / wheelbase) * Math.tan(steer);

    // Grip begrenzt, wie eng man wirklich fahren kann
    const gripLat = spec.grip * surface * (input.handbrake ? 0.42 : 1);
    const maxYawRate = Math.abs(vLong) > 0.7 ? gripLat / Math.max(2, Math.abs(vLong)) : 3.2;
    targetYawRate = clamp(targetYawRate, -maxYawRate * 1.35, maxYawRate * 1.35);

    this.yawRate = damp(this.yawRate, targetYawRate, input.handbrake ? 6 : 11, dt);
    this.yaw += this.yawRate * dt;

    // --- Querdynamik -----------------------------------------------------
    //
    // Wenn sich das Fahrzeug dreht, die Geschwindigkeit aber traege in die
    // alte Richtung zeigt, wandert sie im Fahrzeugsystem nach aussen:
    //   d(vLat)/dt = +yawRate * vLong
    // Genau das ist das Gefuehl von Fliehkraft. Dagegen haelt die
    // Seitenfuehrung der Reifen — bis sie beim Grip saettigt, dann rutscht es.
    vLat += this.yawRate * vLong * dt * (input.handbrake ? 0.85 : 0.62);

    const desiredLatAccel = -vLat * 9.5;
    const latAccel = clamp(desiredLatAccel, -gripLat, gripLat);
    vLat += latAccel * dt;

    this.slip = clamp(Math.abs(vLat) / 7, 0, 1);

    // Zurueck in Weltkoordinaten
    const nf = this.forward;
    const nr = this.right;
    this.vx = nf.x * vLong + nr.x * vLat;
    this.vz = nf.z * vLong + nr.z * vLat;

    // --- Bewegung, Boden, Kollision --------------------------------------
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    const bounds = this.world.bounds ?? 2560;
    nx = clamp(nx, -bounds, bounds);
    nz = clamp(nz, -bounds, bounds);

    const hit = collider.resolve(nx, nz, spec.width * 0.55, this.y + 0.6);
    if (hit.hit) {
      nx = hit.x;
      nz = hit.z;
      // Geschwindigkeitsanteil in die Wand entfernen, Rest gleitet weiter.
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= hit.nx * vn * 1.35;
        this.vz -= hit.nz * vn * 1.35;
      }
      const impact = Math.abs(vn);
      if (impact > 3.5 && performance.now() - this.lastImpact > 400) {
        this.lastImpact = performance.now();
        this.onCrash?.(impact);
      }
      // Aufprall kostet Tempo
      this.vx *= 0.86;
      this.vz *= 0.86;
    }

    this.odometer += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx;
    this.z = nz;

    // Vertikal: dem Boden folgen, kleine Spruenge zulassen
    const ground = terrain.groundHeight(this.x, this.z);
    if (this.y > ground + 0.06) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.airborne = true;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.airborne = false;
      }
    } else {
      const climb = ground - this.y;
      // Kanten daempfen, damit es nicht schlaegt
      this.y = ground;
      this.vy = clamp(climb / Math.max(dt, 1e-3), -14, 14) * 0.12;
      this.airborne = false;
    }

    // --- Optik -----------------------------------------------------------
    const nrm = terrain.groundNormal(this.x, this.z);
    // Aus der Gelaendenormalen Nick- und Rollwinkel ableiten
    const terrPitch = Math.asin(clamp(-(nrm.x * nf.x + nrm.z * nf.z), -1, 1));
    const terrRoll = Math.asin(clamp(nrm.x * nr.x + nrm.z * nr.z, -1, 1));

    const accelLong = (vLong - (this.prevVLong ?? vLong)) / Math.max(dt, 1e-3);
    this.prevVLong = vLong;

    this.pitch = dampAngle(this.pitch, terrPitch - clamp(accelLong * 0.006, -0.09, 0.09), 9, dt);
    this.roll = dampAngle(this.roll, terrRoll + clamp(this.yawRate * vLong * 0.0055, -0.11, 0.11), 9, dt);

    this.wheelSpin += (vLong / (spec.wheelRadius || 0.32)) * dt;
    this.brakeLight = damp(this.brakeLight, input.brake > 0.05 || input.handbrake ? 1 : 0, 18, dt);
    this.engineLoad = damp(this.engineLoad, input.throttle, 6, dt);

    // Getriebe simulieren — nur fuer Anzeige und Motorgeraeusch
    const gearRatios = [0, 3.4, 2.1, 1.45, 1.08, 0.86, 0.72];
    const maxG = this.kind === 'tractor' ? 3 : 6;
    let g = 1;
    for (let i = 1; i <= maxG; i++) {
      if (Math.abs(vLong) > (spec.topSpeed / maxG) * (i - 0.35)) g = i;
    }
    this.gear = vLong < -0.6 ? -1 : g;
    const ratio = gearRatios[Math.max(1, Math.abs(this.gear))] || 1;
    this.rpm = clamp(
      900 + (Math.abs(vLong) * ratio * 260) + this.engineLoad * 700,
      850,
      7200,
    );

    this.sync();
  }

  /** Zustand auf die Three.js-Objekte uebertragen. */
  sync() {
    this.object.position.set(this.x, this.y, this.z);
    this.object.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);

    for (const w of this.wheels) {
      if (w.userData.front) w.rotation.y = this.steerVisual;
      w.userData.spin.rotation.x = this.wheelSpin;
    }

    if (this.lights.headMat) {
      this.lights.headMat.emissiveIntensity = this.headlights ? 2.4 : 0;
      this.lights.beam.intensity = this.headlights ? 90 : 0;
    }
    if (this.lights.tailMat) {
      this.lights.tailMat.emissiveIntensity =
        this.brakeLight * 3.2 + (this.headlights ? 0.8 : 0);
    }
  }

  dispose() {
    this.object.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
  }
}
