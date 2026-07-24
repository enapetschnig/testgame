/**
 * Aufgaben — bewusst optional. Der Kern des Spiels ist freies Fahren durch
 * Frojach; wer will, kann nebenbei Checkpoints abfahren, Sehenswuerdigkeiten
 * abklappern oder eine Lieferung durchs Murtal bringen.
 *
 * Checkpoints sind schwebende Ringe, die mit dem Auto durchfahren werden.
 */

import * as THREE from 'three';
import { dist, formatMoney } from '../core/utils.js';
import { makeRng, rngPick } from '../core/rng.js';

const RING_RADIUS = 7;

function makeRing(color = 0xffcf3d) {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.42, 10, 40),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.4,
      transparent: true,
      opacity: 0.92,
    }),
  );
  torus.rotation.x = Math.PI / 2;
  g.add(torus);

  // Lichtsaeule, damit man den Punkt von weitem sieht
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_RADIUS * 0.92, RING_RADIUS * 0.92, 34, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = 17;
  g.add(beam);
  return g;
}

export function createMissions(net, terrain, scene, hud, audio) {
  const rng = makeRng(0x4d495353);
  const ring = makeRing();
  ring.visible = false;
  scene.add(ring);

  let active = null;
  let waypoint = null;

  /** Zufaelliger Punkt auf einer befahrbaren Strasse. */
  function randomRoadPoint(minDistFrom = null, minDist = 250) {
    const candidates = net.roads.filter((r) => r.traffic && r.length > 40);
    if (!candidates.length) return null;
    for (let i = 0; i < 60; i++) {
      const road = candidates[Math.floor(rng() * candidates.length)];
      const p = road.points[Math.floor(rng() * road.points.length)];
      if (minDistFrom && dist(p.x, p.z, minDistFrom.x, minDistFrom.z) < minDist) continue;
      return { x: p.x, z: p.z, road };
    }
    const road = candidates[0];
    const p = road.points[0];
    return { x: p.x, z: p.z, road };
  }

  function setTarget(x, z, label) {
    waypoint = { x, z, label };
    ring.position.set(x, terrain.groundHeight(x, z) + 2.2, z);
    ring.visible = true;
  }

  function clearTarget() {
    waypoint = null;
    ring.visible = false;
  }

  // ------------------------------------------------------------- Auftraege

  const JOBS = [
    {
      id: 'lieferung',
      name: 'Lieferung',
      start: (vehicle) => {
        const to = randomRoadPoint(vehicle, 420);
        const reward = Math.round(dist(vehicle.x, vehicle.z, to.x, to.z) * 0.9 + 120);
        return {
          steps: [{ x: to.x, z: to.z }],
          reward,
          text: `Lieferung zustellen — <b>${to.road.name || to.road.ref || 'Feldweg'}</b>`,
          timeLimit: null,
        };
      },
    },
    {
      id: 'zeitfahrt',
      name: 'Zeitfahrt B96',
      start: (vehicle) => {
        const steps = [];
        let from = vehicle;
        for (let i = 0; i < 4; i++) {
          const p = randomRoadPoint(from, 320);
          steps.push({ x: p.x, z: p.z });
          from = p;
        }
        const total = steps.reduce((s, p, i) => {
          const prev = i === 0 ? vehicle : steps[i - 1];
          return s + dist(prev.x, prev.z, p.x, p.z);
        }, 0);
        return {
          steps,
          reward: Math.round(total * 1.4 + 300),
          text: 'Zeitfahrt — alle Tore erwischen',
          timeLimit: total / 17 + 22,
        };
      },
    },
    {
      id: 'rundfahrt',
      name: 'Sehenswürdigkeiten',
      start: () => {
        const lms = (net.landmarks || []).filter((l) => l.name);
        const picks = [];
        const pool = [...lms];
        for (let i = 0; i < Math.min(4, pool.length); i++) {
          const idx = Math.floor(rng() * pool.length);
          picks.push(pool.splice(idx, 1)[0]);
        }
        return {
          steps: picks.map((l) => ({ x: l.x, z: l.z, name: l.name })),
          reward: 700,
          text: 'Rundfahrt durch Frojach und Umgebung',
          timeLimit: null,
        };
      },
    },
  ];

  function begin(vehicle, jobId = null) {
    const job = jobId ? JOBS.find((j) => j.id === jobId) : rngPick(rng, JOBS);
    const built = job.start(vehicle);
    active = {
      job,
      steps: built.steps,
      index: 0,
      reward: built.reward,
      text: built.text,
      timeLeft: built.timeLimit,
      startedAt: performance.now(),
    };
    const s = active.steps[0];
    setTarget(s.x, s.z, s.name);
    hud.toast(`${job.name} gestartet`, 'good');
    hud.subtitle(built.text.replace(/<[^>]+>/g, ''));
    return active;
  }

  function abort(reason = 'Auftrag abgebrochen') {
    if (!active) return;
    active = null;
    clearTarget();
    hud.objective(null);
    hud.toast(reason, 'bad');
  }

  function update(dt, vehicle, game) {
    if (ring.visible) {
      ring.rotation.y += dt * 0.8;
      ring.children[0].position.y = Math.sin(performance.now() / 620) * 0.35;
    }

    if (!active) return;

    if (active.timeLeft != null) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) {
        abort('Zeit abgelaufen');
        return;
      }
    }

    const step = active.steps[active.index];
    const d = dist(vehicle.x, vehicle.z, step.x, step.z);

    hud.objective(
      `${active.job.name} — Tor ${active.index + 1}/${active.steps.length}<br>` +
        `<b>${Math.round(d)} m</b>` +
        (active.timeLeft != null ? ` · noch <b>${active.timeLeft.toFixed(1)} s</b>` : '') +
        (step.name ? `<br>${step.name}` : ''),
    );

    if (d < RING_RADIUS + 1.5 && Math.abs(vehicle.y - ring.position.y) < 14) {
      active.index++;
      audio.ping();
      if (active.index >= active.steps.length) {
        const bonus = active.timeLeft != null ? Math.round(active.timeLeft * 18) : 0;
        const total = active.reward + bonus;
        game.addCash(total);
        hud.toast(`Geschafft! ${formatMoney(total)}`, 'good', 3400);
        audio.cash();
        active = null;
        clearTarget();
        hud.objective(null);
      } else {
        const next = active.steps[active.index];
        setTarget(next.x, next.z, next.name);
        if (active.timeLeft != null) active.timeLeft += 14;
        hud.toast('Tor erwischt', 'good', 1100);
      }
    }
  }

  return {
    begin,
    abort,
    update,
    setTarget,
    clearTarget,
    get active() {
      return active;
    },
    get waypoint() {
      return waypoint;
    },
    jobs: JOBS,
  };
}
