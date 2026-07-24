/**
 * Fahrzeuge, komplett aus Code gebaut — keine externen Modelle, damit das
 * Spiel als einzelnes Bundle laeuft und sofort startet.
 *
 * Vier Fahrzeuge, die im Murtal Sinn ergeben: ein Kleinwagen, ein Kombi,
 * ein alter Traktor und ein schneller Wagen fuer die B96.
 */

import * as THREE from 'three';

const paint = (color, metal = 0.55) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: metal });

const glassMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0x1c2a35,
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: 0.72,
  });

const rubber = () => new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
const chrome = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.22, metalness: 0.9 });
const plastic = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });

/**
 * Karosserie aus dem Seitenprofil extrudiert.
 *
 * Ein reiner Quader liest sich aus der Verfolgerperspektive nicht als Auto.
 * Mit Motorhaube, geneigter Frontscheibe und abfallendem Heck entsteht eine
 * erkennbare Silhouette — und das zu ungefaehr denselben Kosten.
 *
 * Das Profil wird in der Ebene (Laenge, Hoehe) gezeichnet und ueber die
 * Fahrzeugbreite extrudiert; +sx zeigt nach vorne.
 */
function profileGeometry(points, width, { bevel = 0.05 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geo.translate(0, 0, -width / 2);
  // Nach der Drehung wird aus der Profilachse -z (also vorne) und aus der
  // Extrusionsrichtung x (die Fahrzeugbreite).
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Rad mit Reifen und Felge. */
function makeWheel(radius, width) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), rubber());
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.012, 12),
    chrome(),
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}

/**
 * Baut ein Fahrzeug.
 * @returns {{group:THREE.Group, wheels:THREE.Group[], spec:object, lights:object}}
 */
export function createVehicle(kind = 'hatch', color = 0xc8332f) {
  const spec = SPECS[kind] || SPECS.hatch;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const L = spec.length;
  const W = spec.width;
  const wheelR = spec.wheelRadius;

  const bodyMat = paint(color, spec.metal ?? 0.55);

  // Bodenfreiheit und Guertellinie werden auch fuer die Leuchten gebraucht.
  const floor = wheelR * 0.42;
  const belt = floor + spec.bodyH;

  if (kind === 'tractor') {
    // Motorhaube
    const hood = new THREE.Mesh(new THREE.BoxGeometry(W * 0.66, 0.72, L * 0.46), bodyMat);
    hood.position.set(0, wheelR + 0.55, -L * 0.16);
    body.add(hood);

    // Kabine
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 1.15, L * 0.34), bodyMat);
    cab.position.set(0, wheelR + 1.1, L * 0.2);
    body.add(cab);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.8, L * 0.3), glassMat());
    glass.position.set(0, wheelR + 1.45, L * 0.2);
    body.add(glass);

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 8), plastic(0x30302e));
    pipe.position.set(W * 0.24, wheelR + 1.45, -L * 0.3);
    body.add(pipe);
  } else {
    // Der Aufbau ist bewusst schmaler als die Spurweite. Sonst stecken die
    // Raeder im Karosseriekoerper und das Auto liest sich als Schuhschachtel.
    const bodyW = W * 0.9;
    const roof = belt + spec.cabinH; // Dachhoehe
    const cz = spec.cabinZ; // Verschiebung der Kabine nach hinten

    // --- Unterbau: Stossfaenger, Motorhaube, abfallendes Heck -------------
    const lower = new THREE.Mesh(
      profileGeometry(
        [
          [L * 0.5, floor + 0.1],
          [L * 0.5, belt - 0.16],
          [L * 0.33, belt - 0.02],
          [L * (0.13 - cz), belt],
          [-L * (0.30 + cz), belt],
          [-L * 0.44, belt - 0.05],
          [-L * 0.5, belt - 0.2],
          [-L * 0.5, floor + 0.1],
        ],
        bodyW,
      ),
      bodyMat,
    );
    lower.position.y = 0;
    body.add(lower);

    // --- Kabine: Frontscheibe geneigt, Heck faellt ab ---------------------
    const cabin = new THREE.Mesh(
      profileGeometry(
        [
          [L * (0.13 - cz), belt - 0.04],
          [L * (0.02 - cz), roof - 0.02],
          [-L * (0.18 + cz), roof],
          [-L * (0.30 + cz), belt - 0.04],
        ],
        bodyW * 0.94,
        { bevel: 0.03 },
      ),
      glassMat(),
    );
    body.add(cabin);

    // Dachhaut ueber der Verglasung. Das Dachstueck des Profils laeuft von
    // sx = L*(0.02-cz) bis sx = -L*(0.18+cz); in Weltkoordinaten ist z = -sx.
    const roofSkin = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.95, 0.07, L * 0.2),
      bodyMat,
    );
    roofSkin.position.set(0, roof, L * (0.08 + cz));
    body.add(roofSkin);

    // --- Stossstangen ----------------------------------------------------
    for (const z of [-L / 2 + 0.1, L / 2 - 0.1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 1.02, 0.26, 0.2), plastic(0x2b2e33));
      b.position.set(0, floor + 0.2, z);
      body.add(b);
    }

    // Radkaesten andeuten
    for (const wz of [-spec.wheelbase / 2, spec.wheelbase / 2]) {
      for (const sx of [-1, 1]) {
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(wheelR * 1.05, 0.05, 5, 10, Math.PI),
          plastic(0x24262a),
        );
        arch.position.set(sx * (bodyW / 2 - 0.01), wheelR, wz);
        arch.rotation.y = Math.PI / 2;
        body.add(arch);
      }
    }
  }

  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  // --- Licht -------------------------------------------------------------

  const lights = { head: [], tail: [], brake: [] };
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d8,
    emissive: 0xfff0cc,
    emissiveIntensity: 0,
    roughness: 0.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x8c1c18,
    emissive: 0xff2a1e,
    emissiveIntensity: 0,
    roughness: 0.35,
  });

  // Buendig in Front- und Heckflaeche, auf halber Hoehe zwischen Bodenkante
  // und Guertellinie — dort sitzen sie auch an einem echten Auto.
  const isTractor = kind === 'tractor';
  const hz = isTractor ? -L * 0.42 : -L / 2 - 0.01;
  const tz = isTractor ? L * 0.3 : L / 2 + 0.01;
  const lampY = isTractor ? wheelR + 0.9 : floor + (belt - floor) * 0.6;
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.08), headMat);
    h.position.set(sx * W * 0.3, lampY, hz);
    body.add(h);
    lights.head.push(h);

    const t = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.07), tailMat);
    t.position.set(sx * W * 0.31, lampY, tz);
    body.add(t);
    lights.tail.push(t);
  }
  lights.headMat = headMat;
  lights.tailMat = tailMat;

  // Scheinwerferkegel
  const beam = new THREE.SpotLight(0xfff0d0, 0, 70, 0.5, 0.45, 1.2);
  beam.position.set(0, lampY, hz);
  beam.target.position.set(0, 0, hz - 24);
  body.add(beam);
  body.add(beam.target);
  lights.beam = beam;

  // --- Raeder ------------------------------------------------------------

  const wheels = [];
  const half = spec.track / 2;
  const positions = [
    { x: -half, z: -spec.wheelbase / 2, front: true },
    { x: half, z: -spec.wheelbase / 2, front: true },
    { x: -half, z: spec.wheelbase / 2, front: false },
    { x: half, z: spec.wheelbase / 2, front: false },
  ];

  for (const wp of positions) {
    const r = kind === 'tractor' && !wp.front ? wheelR * 1.7 : wheelR;
    const w = kind === 'tractor' && !wp.front ? spec.wheelWidth * 1.5 : spec.wheelWidth;
    const holder = new THREE.Group();
    holder.position.set(wp.x, r, wp.z);
    const wheel = makeWheel(r, w);
    holder.add(wheel);
    holder.userData = { front: wp.front, radius: r, spin: wheel };
    group.add(holder);
    wheels.push(holder);
  }

  group.userData.spec = spec;
  return { group, body, wheels, spec, lights };
}

/**
 * Fahrwerte. Die Zahlen sind bewusst arcadig: greifbar, verzeihend, und
 * schnell genug, dass die B96 Spass macht.
 */
export const SPECS = {
  hatch: {
    label: 'Kleinwagen',
    mass: 1150,
    power: 8600, // N bei Standgas-Drehzahl, faellt mit Tempo ab
    topSpeed: 47, // m/s ~ 169 km/h
    brake: 13500,
    grip: 11.5,
    steerLow: 0.62,
    steerHigh: 0.15,
    length: 3.9, width: 1.72, bodyH: 0.62,
    cabinLen: 0.46, cabinH: 0.66, cabinZ: 0.03,
    wheelbase: 2.5, track: 1.65, wheelRadius: 0.31, wheelWidth: 0.2,
  },
  wagon: {
    label: 'Kombi',
    mass: 1480,
    power: 10200,
    topSpeed: 51,
    brake: 15200,
    grip: 11.0,
    steerLow: 0.56,
    steerHigh: 0.13,
    length: 4.7, width: 1.82, bodyH: 0.66,
    cabinLen: 0.58, cabinH: 0.62, cabinZ: 0.06,
    wheelbase: 2.8, track: 1.75, wheelRadius: 0.33, wheelWidth: 0.22,
  },
  sport: {
    label: 'Sportwagen',
    mass: 1320,
    power: 17500,
    topSpeed: 74, // ~266 km/h
    brake: 19000,
    grip: 14.5,
    steerLow: 0.5,
    steerHigh: 0.12,
    metal: 0.75,
    length: 4.4, width: 1.9, bodyH: 0.5,
    cabinLen: 0.4, cabinH: 0.48, cabinZ: 0.08,
    wheelbase: 2.62, track: 1.83, wheelRadius: 0.34, wheelWidth: 0.27,
  },
  tractor: {
    label: 'Traktor',
    mass: 3400,
    power: 16000,
    topSpeed: 12, // ~43 km/h, mehr geht nicht
    brake: 11000,
    grip: 9.5,
    steerLow: 0.75,
    steerHigh: 0.34,
    metal: 0.4,
    length: 3.7, width: 1.9, bodyH: 0.8,
    cabinLen: 0.34, cabinH: 1.1, cabinZ: 0.2,
    wheelbase: 2.2, track: 1.6, wheelRadius: 0.42, wheelWidth: 0.3,
  },
};

export const VEHICLE_ORDER = ['hatch', 'wagon', 'sport', 'tractor'];

export const VEHICLE_COLORS = [
  0xc8332f, 0x2f5fc8, 0xe4e6e8, 0x1d1f22, 0x2f8f5c, 0xd8a12a, 0x7a4ec8, 0xd06a2a,
];
