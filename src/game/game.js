/**
 * Der Zusammenbau: Szene, Welt, Fahrzeug, Kamera, HUD, Street View,
 * Spielschleife.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildNetwork } from '../data/network.js';
import { createTerrain } from '../world/terrain.js';
import { createRoads, createWater, createRailway } from '../world/roads.js';
import { createBuildings } from '../world/buildings.js';
import { createVegetation, createStreetProps, createTownSign } from '../world/props.js';
import { createCollider } from '../world/collision.js';
import { createSky, configureRenderer } from '../world/sky.js';

import { Vehicle } from '../vehicle/vehicle.js';
import { VEHICLE_ORDER, VEHICLE_COLORS, SPECS } from '../vehicle/models.js';

import { createInput } from './input.js';
import { createChaseCamera } from './camera.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createTraffic } from './traffic.js';
import { createMissions } from './missions.js';

import { createPanorama } from '../streetview/panorama.js';
import { createFacadeLoader } from '../streetview/facades.js';
import { hasApiKey, streetViewWebUrl } from '../streetview/api.js';

import { localToLatLon, yawToHeading, WORLD_RADIUS } from '../core/geo.js';
import { clamp, formatMoney } from '../core/utils.js';

export async function createGame({ dom, map, onProgress = () => {} }) {
  // ------------------------------------------------------------- Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const quality = window.devicePixelRatio > 1.5 || window.innerWidth < 900 ? 'medium' : 'high';
  configureRenderer(renderer, quality);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.35, 9000);

  // ------------------------------------------------------------ Welt bauen
  onProgress('Straßennetz wird aufgebaut …', 0.72);
  const net = buildNetwork(map);
  await frame();

  onProgress('Gelände wird modelliert …', 0.78);
  const terrain = createTerrain(net);
  scene.add(terrain.mesh);
  await frame();

  onProgress('Fahrbahnen werden gelegt …', 0.84);
  scene.add(createRoads(net, terrain));
  scene.add(createWater(net, terrain));
  scene.add(createRailway(net, terrain));
  await frame();

  onProgress('Häuser werden gestellt …', 0.89);
  const built = createBuildings(net, terrain);
  scene.add(built.group);
  const collider = createCollider(built.buildings);
  await frame();

  onProgress('Wald und Wiesen …', 0.94);
  scene.add(createVegetation(net, terrain, { density: quality === 'high' ? 1 : 0.55 }));
  scene.add(createStreetProps(net, terrain));
  scene.add(createTownSign(net, terrain, 'Frojach'));
  await frame();

  onProgress('Licht und Himmel …', 0.97);
  const sky = createSky(scene, renderer);

  // ------------------------------------------------------- Nachbearbeitung
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.32, // Staerke: dezent, nur Sonne und Lichter
    0.62,
    0.92,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);

  /**
   * Wenn die Bildrate einbricht, wird selbsttaetig Ballast abgeworfen —
   * erst das Bloom, dann die Schatten. Lieber fluessig als huebsch.
   */
  const perf = { avgMs: 16, level: 2, cooldown: 3 };

  function adaptQuality(ms) {
    perf.avgMs = perf.avgMs * 0.94 + ms * 0.06;
    if (perf.cooldown > 0) {
      perf.cooldown -= ms / 1000;
      return;
    }
    if (perf.avgMs > 42 && perf.level > 0) {
      perf.level--;
      perf.cooldown = 4;
      if (perf.level === 1) {
        bloom.enabled = false;
        hud?.toast('Grafik: Bloom abgeschaltet (Bildrate)', '', 2200);
      } else {
        renderer.shadowMap.enabled = false;
        scene.traverse((o) => {
          if (o.isMesh) o.material && (o.material.needsUpdate = true);
        });
        hud?.toast('Grafik: Schatten abgeschaltet (Bildrate)', '', 2200);
      }
    }
  }

  // ----------------------------------------------------------- Spielobjekte
  const world = { terrain, collider, net, bounds: WORLD_RADIUS - 40 };

  let vehicleIndex = 0;
  let vehicle = new Vehicle(world, VEHICLE_ORDER[vehicleIndex], VEHICLE_COLORS[0]);
  scene.add(vehicle.object);

  const spawn = net.spawn();
  vehicle.placeAt(spawn.x, spawn.z, spawn.yaw);

  const chase = createChaseCamera(camera, terrain);
  chase.snap(vehicle);

  const audio = createAudio();
  const hud = createHud(dom, net);
  const input = createInput(window);
  const traffic = createTraffic(net, terrain, scene, { count: quality === 'high' ? 16 : 10 });
  const missions = createMissions(net, terrain, scene, hud, audio);

  // ------------------------------------------------------------ Street View
  const panorama = createPanorama({
    container: dom.streetview,
    panoEl: dom.svPano,
    onStatus: (s) => onStreetViewStatus?.(s),
  });
  let onStreetViewStatus = null;

  const facades = createFacadeLoader({
    scene,
    terrain,
    onProgress: (frac, loaded, total) => {
      if (loaded && loaded % 20 === 0) hud.toast(`${loaded} echte Fassaden geladen`, '', 1400);
    },
  });

  // ---------------------------------------------------------------- Zustand
  const state = {
    running: false,
    paused: false,
    cash: 0,
    stars: 0,
    lastTime: performance.now(),
    bigMap: false,
    manualWaypoint: null,
    facadesLoaded: false,
  };

  function addCash(v) {
    state.cash += v;
  }

  vehicle.onCrash = (force) => {
    audio.crash(force);
    chase.addShake(clamp(force / 16, 0.2, 1.2));
  };

  // ----------------------------------------------------------- Steuerung
  const unbind = [];

  unbind.push(
    input.on('KeyC', () => {
      const m = chase.cycle();
      hud.toast(`Kamera: ${CAMERA_LABEL[m]}`, '', 1200);
    }),
  );

  unbind.push(
    input.on('KeyV', async () => {
      if (!hasApiKey()) {
        // Ohne Key: das echte Street View im Browser oeffnen.
        const { lat, lon } = localToLatLon(vehicle.x, vehicle.z);
        hud.toast('Kein API-Key — öffne Google Street View im Browser', '', 3000);
        window.open(streetViewWebUrl(lat, lon, yawToHeading(vehicle.yaw)), '_blank', 'noopener');
        return;
      }
      const m = await panorama.cycleMode();
      hud.toast(`Street View: ${SV_LABEL[m]}`, m === 'off' ? '' : 'good', 1500);
    }),
  );

  unbind.push(
    input.on('KeyF', () => {
      vehicleIndex = (vehicleIndex + 1) % VEHICLE_ORDER.length;
      switchVehicle(VEHICLE_ORDER[vehicleIndex]);
    }),
  );

  unbind.push(
    input.on('KeyL', () => {
      vehicle.headlights = !vehicle.headlights;
      hud.toast(vehicle.headlights ? 'Licht an' : 'Licht aus', '', 1000);
    }),
  );

  unbind.push(
    input.on('KeyR', () => {
      vehicle.respawn();
      chase.snap(vehicle);
      hud.toast('Zurück auf die Straße', '', 1200);
    }),
  );

  unbind.push(input.on('KeyM', () => toggleBigMap()));
  unbind.push(input.on('Escape', () => (state.bigMap ? toggleBigMap() : togglePause())));
  unbind.push(input.on('KeyP', () => togglePause()));

  unbind.push(
    input.on('KeyJ', () => {
      if (missions.active) missions.abort();
      else missions.begin(vehicle);
    }),
  );

  unbind.push(
    input.on('KeyT', () => {
      sky.state.time = (sky.state.time + 180) % 1440;
      hud.toast(`Uhrzeit vorgestellt`, '', 1000);
    }),
  );

  // Hupe
  let horning = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && !e.repeat && state.running) {
      horning = true;
      audio.horn(true);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyH' && horning) {
      horning = false;
      audio.horn(false);
    }
  });

  function switchVehicle(kind) {
    const old = vehicle;
    const v = new Vehicle(world, kind, VEHICLE_COLORS[vehicleIndex % VEHICLE_COLORS.length]);
    v.placeAt(old.x, old.z, old.yaw);
    v.headlights = old.headlights;
    v.onCrash = old.onCrash;
    scene.remove(old.object);
    old.dispose();
    scene.add(v.object);
    vehicle = v;
    hud.toast(`${SPECS[kind].label}`, '', 1400);
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    dom.pause.hidden = !state.paused;
    if (state.paused) audio.horn(false);
  }

  function toggleBigMap() {
    if (!state.running) return;
    state.bigMap = !state.bigMap;
    dom.bigmap.hidden = !state.bigMap;
    if (state.bigMap) hud.renderBigMap(dom.bigmapCanvas, vehicle, { waypoint: currentWaypoint() });
  }

  // Klick in die grosse Karte setzt einen Wegpunkt
  dom.bigmapCanvas.addEventListener('click', (e) => {
    const r = dom.bigmapCanvas.getBoundingClientRect();
    const size = dom.bigmapCanvas.width;
    const EXTENT = 2700;
    const scale = size / (EXTENT * 2);
    const x = ((e.clientX - r.left) / r.width) * size;
    const y = ((e.clientY - r.top) / r.height) * size;
    const wx = (x - size / 2) / scale;
    const wz = (y - size / 2) / scale;
    state.manualWaypoint = { x: wx, z: wz };
    missions.setTarget(wx, wz);
    hud.toast('Wegpunkt gesetzt', 'good', 1600);
    hud.renderBigMap(dom.bigmapCanvas, vehicle, { waypoint: state.manualWaypoint });
  });

  function currentWaypoint() {
    return missions.waypoint || state.manualWaypoint;
  }

  // ------------------------------------------------------------ Resize
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------- Schleife
  let rafId = 0;

  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.running || state.paused) return;

    const inp = input.update(dt);
    vehicle.update(dt, inp);

    // Tageszeit: 1,5 Spielminuten je echter Sekunde — ein voller Tag mit
    // Sonnenaufgang ueber dem Puxberg dauert damit gut eine Viertelstunde.
    sky.state.time = (sky.state.time + dt * 1.5) % 1440;
    const sun = sky.update(vehicle.x, vehicle.z);

    // Automatisch Licht einschalten, wenn es daemmert
    if (sky.isNight && !vehicle.headlights) vehicle.headlights = true;
    if (!sky.isNight && vehicle.headlights && sun.day > 0.55) vehicle.headlights = false;
    traffic.setNight?.(sky.isNight);
    facades.setDaylight(sun.day);

    traffic.update(dt, vehicle);
    missions.update(dt, vehicle, api);
    chase.update(vehicle, dt);
    audio.update(vehicle, dt);

    panorama.update(vehicle.x, vehicle.z, vehicle.yaw);

    hud.update(vehicle, api);

    // In der Vollbild-Panoramaansicht ist die 3D-Welt verdeckt — dann sparen
    // wir uns das Rendern komplett.
    if (panorama.mode !== 'full') {
      composer.render();
      adaptQuality(performance.now() - now);
    }

    if (state.bigMap) hud.renderBigMap(dom.bigmapCanvas, vehicle, { waypoint: currentWaypoint() });
  }

  // ------------------------------------------------------------------- API
  const api = {
    scene,
    renderer,
    camera,
    net,
    terrain,
    sky,
    hud,
    audio,
    input,
    traffic,
    missions,
    panorama,
    facades,
    state,
    get vehicle() {
      return vehicle;
    },
    get cash() {
      return state.cash;
    },
    get waypoint() {
      return currentWaypoint();
    },
    addCash,

    start() {
      state.running = true;
      state.lastTime = performance.now();
      audio.start();
      audio.resume();
      dom.hud.hidden = false;
      chase.snap(vehicle);
      if (!rafId) loop();
    },

    stop() {
      state.running = false;
      dom.hud.hidden = true;
    },

    togglePause,

    /** Street-View-Statusmeldungen ans Menue weiterreichen. */
    onStreetViewStatus(cb) {
      onStreetViewStatus = cb;
    },

    /** Fassadenfotos nachladen (braucht einen API-Key). */
    async loadFacades(budget = 220) {
      if (state.facadesLoaded) return { loaded: facades.count };
      state.facadesLoaded = true;
      hud.toast('Echte Fassaden werden von Street View geholt …', '', 3000);
      const res = await facades.run(built.buildings, {
        budget,
        center: { x: vehicle.x, z: vehicle.z },
      });
      hud.toast(
        res.loaded
          ? `${res.loaded} echte Hausfassaden aus Street View`
          : 'Keine Street-View-Fassaden verfügbar',
        res.loaded ? 'good' : 'bad',
        3200,
      );
      return res;
    },

    startJob(id) {
      missions.begin(vehicle, id);
    },

    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      unbind.forEach((f) => f());
      input.dispose();
      traffic.dispose();
      facades.dispose();
      renderer.dispose();
    },
  };

  onProgress('Fertig', 1);
  return api;
}

const CAMERA_LABEL = {
  chase: 'Verfolger',
  far: 'Weit',
  hood: 'Motorhaube',
  bumper: 'Stoßstange',
};

const SV_LABEL = {
  off: 'aus',
  pip: 'Bild-im-Bild',
  full: 'Vollbild (echte Fotos)',
};

/** Einen Frame durchlassen, damit der Ladebalken sichtbar weiterlaeuft. */
function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
