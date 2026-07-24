/**
 * Einstiegspunkt: Karte laden, Menue verdrahten, Spiel starten.
 */

import './style.css';

import { loadOsmMap, clearCache, normalize } from './data/overpass.js';
import { buildBakedMap } from './data/frojachBaked.js';
import { createGame } from './game/game.js';
import { getApiKey, setApiKey, hasApiKey } from './streetview/api.js';

const dom = {
  canvas: document.getElementById('scene'),
  hud: document.getElementById('hud'),
  menu: document.getElementById('menu'),
  menuMain: document.getElementById('menu-main'),
  loader: document.getElementById('loader'),
  loadbar: document.getElementById('loadbar'),
  loadtext: document.getElementById('loadtext'),
  streetview: document.getElementById('streetview'),
  svPano: document.getElementById('sv-pano'),
  svKey: document.getElementById('sv-key'),
  svSave: document.getElementById('sv-save'),
  svClear: document.getElementById('sv-clear'),
  svState: document.getElementById('sv-state'),
  mapSource: document.getElementById('map-source'),
  btnPlay: document.getElementById('btn-play'),
  btnFreeroam: document.getElementById('btn-freeroam'),
  btnRefetch: document.getElementById('btn-refetch'),
  btnResume: document.getElementById('btn-resume'),
  btnToMenu: document.getElementById('btn-tomenu'),
  pause: document.getElementById('pause'),
  bigmap: document.getElementById('bigmap'),
  bigmapCanvas: document.getElementById('bigmap-canvas'),
  toast: document.getElementById('toast'),
  subtitle: document.getElementById('subtitle'),
  objective: document.getElementById('objective'),
  clock: document.getElementById('clock'),
  cash: document.getElementById('cash'),
  stars: document.getElementById('stars'),
  minimap: document.getElementById('minimap'),
  speedo: document.getElementById('speedo'),
  gear: document.getElementById('gear'),
  streetname: document.getElementById('streetname'),
  touch: document.getElementById('touch'),
};

let game = null;
let mapData = null;

/**
 * Eingebetteter Modus.
 *
 * Die Einzeldatei-Fassung (`npm run build:single`) laeuft auch dort, wo
 * ausgehende Verbindungen gesperrt sind — etwa in einer Vorschau mit
 * strenger Content-Security-Policy. Dann gaebe es nur vier vergebliche
 * Overpass-Anlaeufe und ein Street-View-Menue, das nichts tun kann.
 * Also: mitgelieferte Karte verwenden und ehrlich hinschreiben, was fehlt.
 */
const EMBEDDED = !!globalThis.__FROJACH_EMBEDDED;

function progress(text, frac) {
  dom.loadtext.textContent = text;
  dom.loadbar.style.width = `${Math.round(clamp01(frac) * 100)}%`;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- Kartenwahl

/**
 * Wenn `npm run bake:map` gelaufen ist, liegt eine echte OSM-Kopie im
 * Projekt. Die ist genauer als die handgebaute Ersatzkarte und braucht
 * kein Netz — deshalb hat sie Vorrang.
 */
const bakedOsm = import.meta.glob('./data/frojachOsm.json');

async function loadBundledOsm() {
  const entry = Object.values(bakedOsm)[0];
  if (!entry) return null;
  try {
    const mod = await entry();
    const map = normalize(mod.default ?? mod);
    if (map.roads.length < 3) return null;
    map.source = 'osm-bundled';
    return map;
  } catch (err) {
    console.warn('[map] mitgelieferte OSM-Datei unlesbar', err);
    return null;
  }
}

async function fetchMap({ force = false } = {}) {
  let map = null;

  if (!force) {
    progress('Mitgelieferte OpenStreetMap-Daten werden gelesen …', 0.06);
    map = await loadBundledOsm();
  }

  if (!map && EMBEDDED) {
    progress('Mitgelieferte Karte wird verwendet', 0.6);
    map = buildBakedMap();
  }

  if (!map) {
    progress('Frojach wird von OpenStreetMap geholt …', 0.1);
    try {
      map = await loadOsmMap({
        force,
        onProgress: (msg, frac) => progress(msg, frac),
      });
    } catch (err) {
      console.warn('[map]', err);
    }
  }

  if (!map) {
    progress('OpenStreetMap nicht erreichbar — mitgelieferte Karte wird verwendet', 0.6);
    map = buildBakedMap();
  }

  describeMap(map);
  return map;
}

function describeMap(map) {
  const label =
    {
      osm: 'Live von OpenStreetMap geladen',
      'osm-cache': 'Aus dem Zwischenspeicher (OpenStreetMap)',
      'osm-stale': 'Ältere OpenStreetMap-Kopie (Overpass nicht erreichbar)',
      'osm-bundled': 'Mitgelieferte OpenStreetMap-Kopie (npm run bake:map)',
      baked: 'Mitgelieferte Offline-Karte (Nachbau)',
    }[map.source] || map.source;

  const counts =
    `${map.roads.length} Straßen` +
    (map.buildings?.length ? `, ${map.buildings.length} Gebäudegrundrisse` : ', keine Gebäudedaten') +
    (map.water?.length ? `, ${map.water.length} Gewässer` : '');

  dom.mapSource.innerHTML = `<b>${label}</b><br>${counts}<br><span class="small">${map.attribution}</span>`;
}

// ------------------------------------------------------------------- Menue

function refreshKeyState() {
  const has = hasApiKey();
  dom.svState.textContent = has ? '(Key hinterlegt)' : '(nicht verbunden)';
  dom.svState.className = has ? 'ok' : '';
  if (has) dom.svKey.value = '•'.repeat(20);
}

dom.svSave.addEventListener('click', async () => {
  const v = dom.svKey.value.trim();
  if (!v || v.startsWith('•')) return;
  setApiKey(v);
  refreshKeyState();
  dom.svState.textContent = '(wird geprüft …)';
  if (game) {
    await game.panorama.setMode('pip');
    game.loadFacades();
  }
});

dom.svClear.addEventListener('click', () => {
  setApiKey('');
  dom.svKey.value = '';
  refreshKeyState();
});

dom.btnRefetch.addEventListener('click', async () => {
  dom.menuMain.hidden = true;
  dom.loader.hidden = false;
  await clearCache();
  mapData = await fetchMap({ force: true });
  dom.loader.hidden = true;
  dom.menuMain.hidden = false;
  if (game) {
    // Neue Kartendaten brauchen einen frischen Weltaufbau.
    game.dispose();
    game = null;
    dom.hud.hidden = true;
  }
});

async function boot(startMode = 'play') {
  dom.menu.classList.add('hidden');

  if (!game) {
    dom.menu.classList.remove('hidden');
    dom.menuMain.hidden = true;
    dom.loader.hidden = false;
    game = await createGame({
      dom,
      map: mapData,
      onProgress: (t, f) => progress(t, f),
    });
    game.onStreetViewStatus((s) => {
      dom.svState.textContent = `(${s.message})`;
      dom.svState.className = s.ok ? 'ok' : '';
    });
    // Fuer die Konsole: Fahrzeug, Netz und Kamera lassen sich damit im
    // laufenden Spiel inspizieren.
    globalThis.__frojach = game;
    dom.loader.hidden = true;
    dom.menu.classList.add('hidden');
  }

  game.start();

  // Touch-Steuerung nur auf Geraeten ohne Maus einblenden
  if (matchMedia('(pointer: coarse)').matches) {
    dom.touch.hidden = false;
    game.input.bindTouch(dom.touch);
  }

  if (!EMBEDDED && hasApiKey()) {
    game.panorama.setMode('pip');
    game.loadFacades();
  } else if (!EMBEDDED) {
    game.hud.subtitle(
      'Tipp: Google-Maps-API-Key im Menü hinterlegen — dann bekommen die Häuser ihre echten Fassaden.',
      6500,
    );
  }

  if (startMode === 'play') {
    setTimeout(() => game.startJob('rundfahrt'), 1800);
  }
}

dom.btnPlay.addEventListener('click', () => boot('play'));
dom.btnFreeroam.addEventListener('click', () => boot('free'));

dom.btnResume.addEventListener('click', () => game?.togglePause());
dom.btnToMenu.addEventListener('click', () => {
  if (!game) return;
  game.togglePause();
  game.stop();
  dom.pause.hidden = true;
  dom.menu.classList.remove('hidden');
  dom.menuMain.hidden = false;
});

// -------------------------------------------------------------------- Start

/**
 * Im eingebetteten Modus fehlt der Netzzugriff. Statt Schaltflaechen
 * anzubieten, die ins Leere laufen, wird gesagt, was hier geht und was
 * nur in der lokalen Fassung.
 */
function applyEmbeddedNotice() {
  if (!EMBEDDED) return;

  const svPanel = document.getElementById('sv-panel');
  if (svPanel) {
    svPanel.open = false;
    svPanel.querySelector('summary').innerHTML =
      '🛣️ Google Street View <em>(nur in der lokalen Fassung)</em>';
    svPanel.querySelectorAll('.field, .hint').forEach((el) => el.remove());
    const p = document.createElement('p');
    p.className = 'hint';
    p.innerHTML =
      'Diese eingebettete Fassung darf keine Verbindungen nach außen aufbauen. ' +
      'Panorama-Fahrmodus und die echten Hausfassaden brauchen deshalb die ' +
      'lokale Fassung: <b>npm install && npm run dev</b>, dann den eigenen ' +
      'Google-Maps-API-Key im Menü hinterlegen.';
    svPanel.appendChild(p);
  }

  if (dom.btnRefetch) {
    dom.btnRefetch.disabled = true;
    dom.btnRefetch.textContent = 'Nicht verfügbar (kein Netzzugriff)';
    dom.btnRefetch.style.opacity = '0.5';
    dom.btnRefetch.style.cursor = 'not-allowed';
  }
}

(async function init() {
  refreshKeyState();
  applyEmbeddedNotice();
  mapData = await fetchMap();
  progress('Bereit', 1);
  dom.loader.hidden = true;
  dom.menuMain.hidden = false;
})();
