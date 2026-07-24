/**
 * Himmel, Sonnenstand und Licht.
 *
 * Verwendet die atmosphaerische Streuung aus three/addons, dazu ein
 * Richtungslicht als Sonne und ein Hemisphaerenlicht fuer das Streulicht aus
 * Himmel und Wiese. Der Sonnenstand folgt der Tageszeit und ist grob an die
 * Breite von Frojach (47,1 Grad Nord) angepasst — im Sommer steht die Sonne
 * mittags rund 66 Grad hoch, im Winter nur 19.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';

const LAT = 47.13 * (Math.PI / 180);

export function createSky(scene, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(60000);
  scene.add(sky);

  const u = sky.material.uniforms;
  u.turbidity.value = 3.4;
  u.rayleigh.value = 1.9;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;

  const sunDir = new THREE.Vector3();

  // --- Licht -------------------------------------------------------------

  const sun = new THREE.DirectionalLight(0xfff2df, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  const S = 190; // Halbe Kantenlaenge des Schattenbereichs um das Auto
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  // Ohne dieses Update behaelt die Schattenkamera ihr Standardfrustum von
  // 2x2 Einheiten — dann faellt schlicht kein Schatten.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x5c6a3e, 1.05);
  scene.add(hemi);

  // Grundhelligkeit, damit nachts nicht alles in reinem Schwarz absaeuft.
  const ambient = new THREE.AmbientLight(0x2a3648, 0.5);
  scene.add(ambient);

  const fog = new THREE.FogExp2(0xb8c8d8, 0.00035);
  scene.fog = fog;

  // --- Umgebungsreflexion ------------------------------------------------
  //
  // Ohne Environment-Map bleibt jedes metallische Material schwarz — Autolack,
  // Chrom und Glas saehen aus wie Pappe. Deshalb wird aus demselben
  // Himmelsmodell eine Reflexionskarte gebacken und der Szene zugewiesen.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);

  let envTarget = null;
  let lastEnvTime = -999;

  function refreshEnvironment(force = false) {
    // Nur alle 45 Spielminuten neu backen — das reicht optisch voellig.
    if (!force && Math.abs(state.time - lastEnvTime) < 45) return;
    lastEnvTime = state.time;

    const eu = envSky.material.uniforms;
    eu.turbidity.value = u.turbidity.value;
    eu.rayleigh.value = u.rayleigh.value;
    eu.mieCoefficient.value = u.mieCoefficient.value;
    eu.mieDirectionalG.value = u.mieDirectionalG.value;
    eu.sunPosition.value.copy(sunDir);

    const next = pmrem.fromScene(envScene, 0.02);
    envTarget?.dispose();
    envTarget = next;
    scene.environment = next.texture;
    scene.environmentIntensity = 1;
  }

  const state = {
    /** Minuten seit Mitternacht. */
    time: 9 * 60,
    /** 0 = Winter, 0.5 = Sommer */
    season: 0.62,
  };

  /**
   * Sonnenstand aus Tageszeit und Jahreszeit.
   * @returns {{alt:number, az:number}} Hoehe und Azimut in Radiant
   */
  function sunPosition(minutes, season) {
    const decl = 0.409 * Math.sin(2 * Math.PI * (season - 0.22)); // +-23,4 Grad
    const hourAngle = ((minutes / 60) - 12) * (Math.PI / 12);
    const sinAlt =
      Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(hourAngle);
    const alt = Math.asin(clamp(sinAlt, -1, 1));
    const cosAz =
      (Math.sin(decl) - Math.sin(alt) * Math.sin(LAT)) / (Math.cos(alt) * Math.cos(LAT) || 1e-6);
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (hourAngle > 0) az = 2 * Math.PI - az; // nachmittags nach Westen
    return { alt, az };
  }

  const skyCol = new THREE.Color();
  const sunCol = new THREE.Color();
  const nightSky = new THREE.Color(0x0a1220);

  function update(centerX = 0, centerZ = 0) {
    const { alt, az } = sunPosition(state.time, state.season);

    // Azimut 0 = Nord, im Uhrzeigersinn. Lokale Achsen: -z = Nord.
    const cosAlt = Math.cos(alt);
    sunDir.set(cosAlt * Math.sin(az), Math.sin(alt), -cosAlt * Math.cos(az));

    u.sunPosition.value.copy(sunDir);

    // Tag/Nacht-Mischung: Daemmerung zwischen -6 und +8 Grad Sonnenhoehe.
    const day = smoothstep(clamp((alt + 0.105) / 0.245, 0, 1));
    const golden = 1 - smoothstep(clamp(alt / 0.28, 0, 1));

    sun.position.copy(sunDir).multiplyScalar(420).add(new THREE.Vector3(centerX, 0, centerZ));
    sun.target.position.set(centerX, 0, centerZ);
    sun.intensity = day * 3.4;

    // Sonnenfarbe: tief stehend warm, hoch stehend neutral.
    sunCol.setHSL(lerp(0.09, 0.13, 1 - golden), lerp(0.75, 0.18, 1 - golden), lerp(0.6, 0.96, 1 - golden));
    sun.color.copy(sunCol);

    hemi.intensity = lerp(0.32, 1.15, day);
    hemi.color.setHSL(0.58, lerp(0.22, 0.45, day), lerp(0.3, 0.78, day));
    hemi.groundColor.setHSL(0.22, 0.3, lerp(0.09, 0.26, day));

    // Nachts uebernimmt Mond- und Streulicht — kuehl und schwach, aber da.
    ambient.intensity = lerp(0.62, 0.16, day);
    scene.environmentIntensity = lerp(0.35, 1, day);

    // Dunst im Tal: morgens dichter. Auch tagsueber bleibt etwas Dunst —
    // ohne diese Luftperspektive wirken die Haenge wie aufgeklebt.
    const morning = 1 - smoothstep(clamp((state.time - 300) / 340, 0, 1));
    fog.density = lerp(0.00048, 0.0014, morning * 0.8) * lerp(1.6, 1, day);
    skyCol.copy(nightSky).lerp(new THREE.Color(0xc3d2e0), day);
    fog.color.copy(skyCol);

    sky.material.uniforms.turbidity.value = lerp(2.2, 5.2, morning);

    refreshEnvironment();

    return { alt, day };
  }

  update();
  refreshEnvironment(true);

  return {
    sky,
    sun,
    hemi,
    ambient,
    fog,
    state,
    update,
    refreshEnvironment,
    sunDirection: sunDir,
    /** Fuer das HUD: ist gerade Nacht? Dann Scheinwerfer an. */
    get isNight() {
      return sunPosition(state.time, state.season).alt < 0.03;
    },
    dispose() {
      sky.geometry.dispose();
      sky.material.dispose();
      envSky.geometry.dispose();
      envSky.material.dispose();
      envTarget?.dispose();
      pmrem.dispose();
    },
  };
}

/**
 * Renderer mit filmischem Tonemapping und weichen Schatten.
 * Das ist der groesste Hebel fuer ein realistisches Bild — ohne
 * Tonemapping wirkt jede Aussenszene entweder flau oder ausgebrannt.
 */
export function configureRenderer(renderer, quality = 'high') {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.4));
}
