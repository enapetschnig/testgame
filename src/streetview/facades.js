/**
 * Echte Hausfassaden aus Google Street View.
 *
 * Fuer jedes Haus wird die strassenseitige Wand bestimmt, das naechst-
 * gelegene Panorama gesucht und daraus ein Standbild angefordert, dessen
 * Blickrichtung und Bildwinkel exakt auf diese Wand zugeschnitten sind.
 * Das Bild wird als Textur auf eine Platte direkt vor der Wand gelegt.
 *
 * Ergebnis: die Haeuser in Frojach sehen aus wie die Haeuser in Frojach —
 * gleiche Farbe, gleiche Fenster, gleiche Holzbalkone.
 *
 * Kosten im Blick behalten: die Static API kostet pro Bild. Deshalb
 * (a) harte Obergrenze, (b) Sortierung nach Naehe zur Ortsmitte, damit das
 * Budget dort landet, wo man tatsaechlich faehrt, (c) Wiederverwendung ueber
 * den HTTP-Cache des Browsers.
 */

import * as THREE from 'three';
import { localToLatLon, latLonToLocal, yawToHeading } from '../core/geo.js';
import { streetViewMeta, streetViewImageUrl, hasApiKey } from './api.js';
import { clamp } from '../core/utils.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Kamerahoehe des Street-View-Fahrzeugs ueber Grund, in Metern. */
const CAM_HEIGHT = 2.4;

/** Wie viele Fassaden hoechstens geladen werden. */
const DEFAULT_BUDGET = 220;

/** Gleichzeitige Anfragen — Google mag keine Flut. */
const CONCURRENCY = 5;

/**
 * Kompasskurs von a nach b, in Grad.
 * Lokale Achsen: x = Ost, z = Sued, also Nord = -z.
 */
function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * DEG) % 360 + 360) % 360;
}

/** Kleinste vorzeichenbehaftete Winkeldifferenz in Grad. */
function angleDiff(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return d;
}

export function createFacadeLoader({ scene, terrain, onProgress = () => {} }) {
  const group = new THREE.Group();
  group.name = 'facades';
  scene.add(group);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const panels = [];
  let cancelled = false;
  let loaded = 0;
  let attempted = 0;

  /** Blendet die Fotos nachts ab, damit sie nicht wie Leuchtkaesten wirken. */
  function setDaylight(day) {
    const v = clamp(0.18 + day * 0.82, 0.18, 1);
    for (const p of panels) p.material.color.setScalar(v);
  }

  async function loadOne(info) {
    const front = info.front;
    if (!front || front.width < 3) return false;

    // 1. Wo steht die Street-View-Kamera? Bevorzugt auf der Strasse vor dem Haus.
    const guessX = front.roadX ?? front.x + front.nx * 12;
    const guessZ = front.roadZ ?? front.z + front.nz * 12;
    const guess = localToLatLon(guessX, guessZ);

    const meta = await streetViewMeta(guess.lat, guess.lon, 45);
    if (!meta || cancelled) return false;

    const cam = latLonToLocal(meta.lat, meta.lon);

    // 2. Steht die Kamera ueberhaupt vor der Wand (und nicht dahinter)?
    const toCamX = cam.x - front.x;
    const toCamZ = cam.z - front.z;
    const facing = toCamX * front.nx + toCamZ * front.nz;
    const distance = Math.hypot(toCamX, toCamZ);
    if (facing <= 1.5 || distance < 4 || distance > 75) return false;

    // Zu schraeger Blick verzerrt das Foto unbrauchbar.
    const obliquity = Math.abs(facing / distance); // 1 = frontal
    if (obliquity < 0.35) return false;

    // 3. Blickrichtung und horizontaler Bildwinkel auf die Wand zuschneiden.
    const halfW = front.width / 2;
    // Wandrichtung (senkrecht zur Aussennormalen)
    const tx = -front.nz;
    const tz = front.nx;
    const e1x = front.x - tx * halfW;
    const e1z = front.z - tz * halfW;
    const e2x = front.x + tx * halfW;
    const e2z = front.z + tz * halfW;

    const bCenter = bearing(cam.x, cam.z, front.x, front.z);
    const b1 = bearing(cam.x, cam.z, e1x, e1z);
    const b2 = bearing(cam.x, cam.z, e2x, e2z);
    const halfFovH = Math.max(Math.abs(angleDiff(bCenter, b1)), Math.abs(angleDiff(bCenter, b2)));
    const fovH = clamp(halfFovH * 2 * 1.08, 18, 110);

    // 4. Vertikal: Kamerahoehe gegen Wandunter- und -oberkante.
    const groundAtCam = terrain.heightAt(cam.x, cam.z);
    const camY = groundAtCam + CAM_HEIGHT;
    const yBottom = info.baseY;
    const yTop = info.baseY + info.wallH;
    const aBottom = Math.atan2(yBottom - camY, distance) * DEG;
    const aTop = Math.atan2(yTop - camY, distance) * DEG;
    const pitch = (aTop + aBottom) / 2;
    const halfFovV = Math.max(Math.abs(aTop - pitch), Math.abs(aBottom - pitch)) * 1.06;

    // Bildseitenverhaeltnis so waehlen, dass es genau passt.
    const W = 640;
    const H = clamp(
      Math.round((W * Math.tan(halfFovV * RAD)) / Math.tan((fovH / 2) * RAD)),
      80,
      640,
    );
    // Falls die Hoehe gedeckelt wurde, den horizontalen Winkel nachziehen,
    // damit die Zuordnung Bild <-> Wand stimmig bleibt.
    const effHalfV = Math.atan((H / W) * Math.tan((fovH / 2) * RAD)) * DEG;

    const url = streetViewImageUrl({
      panoId: meta.panoId,
      lat: meta.lat,
      lon: meta.lon,
      heading: bCenter,
      pitch,
      fov: fovH,
      w: W,
      h: H,
    });

    attempted++;
    const tex = await new Promise((resolve) => {
      loader.load(url, resolve, undefined, () => resolve(null));
    });
    if (!tex || cancelled) return false;

    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;

    // 5. Platte exakt vor die Wand haengen.
    //
    // Das Bild deckt horizontal genau `front.width` ab. Vertikal deckt es
    // den Winkelbereich +-effHalfV um `pitch` ab; daraus ergibt sich die
    // tatsaechlich abgebildete Wandhoehe an der Wandebene.
    const yLo = camY + Math.tan((pitch - effHalfV) * RAD) * distance;
    const yHi = camY + Math.tan((pitch + effHalfV) * RAD) * distance;
    const panelH = Math.max(1.5, yHi - yLo);

    const geo = new THREE.PlaneGeometry(front.width, panelH);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      toneMapped: false, // Foto so zeigen, wie es aufgenommen wurde
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      front.x + front.nx * 0.07,
      (yLo + yHi) / 2,
      front.z + front.nz * 0.07,
    );
    mesh.rotation.y = Math.atan2(front.nx, front.nz);
    mesh.renderOrder = 2;
    mesh.name = `facade:${info.name || 'haus'}`;

    group.add(mesh);
    panels.push(mesh);
    info.facade = mesh;
    loaded++;
    return true;
  }

  /**
   * @param {Array} buildings aus `createBuildings`
   * @param {object} opts
   */
  async function run(buildings, { budget = DEFAULT_BUDGET, center = { x: 0, z: 0 } } = {}) {
    if (!hasApiKey()) return { loaded: 0, attempted: 0, skipped: 'kein API-Key' };

    const queue = buildings
      .filter((b) => b.front && b.front.width >= 3.5)
      .sort(
        (a, b) =>
          Math.hypot(a.center.x - center.x, a.center.z - center.z) -
          Math.hypot(b.center.x - center.x, b.center.z - center.z),
      )
      .slice(0, budget);

    let index = 0;
    let done = 0;

    async function worker() {
      while (index < queue.length && !cancelled) {
        const item = queue[index++];
        try {
          await loadOne(item);
        } catch {
          /* einzelne Fehlschlaege sind normal (keine Abdeckung, 404) */
        }
        done++;
        if (done % 5 === 0 || done === queue.length) {
          onProgress(done / queue.length, loaded, queue.length);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { loaded, attempted, total: queue.length };
  }

  return {
    group,
    run,
    setDaylight,
    get count() {
      return loaded;
    },
    setVisible(v) {
      group.visible = v;
    },
    cancel() {
      cancelled = true;
    },
    dispose() {
      cancelled = true;
      for (const p of panels) {
        p.geometry.dispose();
        p.material.map?.dispose();
        p.material.dispose();
      }
      group.clear();
      panels.length = 0;
    },
  };
}
