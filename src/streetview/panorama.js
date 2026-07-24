/**
 * Street-View-Panorama, gekoppelt an das Auto.
 *
 * Drei Modi:
 *   off  — nur die 3D-Welt
 *   pip  — Panorama klein oben links, folgt dem Auto
 *   full — Panorama fuellt den Bildschirm, die 3D-Welt laeuft dahinter
 *          weiter. Damit faehrt man buchstaeblich durch die echten Fotos
 *          von Frojach, mit Tacho und Minikarte darueber.
 *
 * Das Panorama wird nur nachgefuehrt, wenn sich das Auto nennenswert bewegt
 * hat — jeder Wechsel kostet Ladezeit und Kontingent.
 */

import { localToLatLon, yawToHeading } from '../core/geo.js';
import { loadMapsApi, hasApiKey } from './api.js';

export const SV_MODES = ['off', 'pip', 'full'];

/** Ab welcher Strecke (m) ein neues Panorama gesucht wird. */
const MOVE_THRESHOLD = 9;
/** Mindestabstand zwischen zwei Suchanfragen (ms). */
const QUERY_INTERVAL = 260;

export function createPanorama({ container, panoEl, onStatus = () => {} }) {
  let maps = null;
  let pano = null;
  let service = null;
  let ready = false;
  let failed = null;

  let mode = 'off';
  let lastLat = 0;
  let lastLon = 0;
  let lastQuery = 0;
  let pending = false;
  let currentPanoId = null;
  let coverage = true;

  const badge = document.createElement('div');
  badge.className = 'sv-badge';
  badge.textContent = 'Street View';
  container.appendChild(badge);

  async function ensure() {
    if (ready || failed) return ready;
    if (!hasApiKey()) {
      failed = 'Kein API-Key hinterlegt';
      onStatus({ ok: false, message: failed });
      return false;
    }
    try {
      onStatus({ ok: false, message: 'Street View wird geladen …', loading: true });
      maps = await loadMapsApi();
      pano = new maps.StreetViewPanorama(panoEl, {
        pov: { heading: 0, pitch: 0 },
        zoom: 0.6,
        visible: false,
        disableDefaultUI: true,
        showRoadLabels: false,
        motionTracking: false,
        motionTrackingControl: false,
        clickToGo: false,
        scrollwheel: false,
        linksControl: false,
        panControl: false,
        addressControl: false,
        fullscreenControl: false,
        enableCloseButton: false,
      });
      service = new maps.StreetViewService();
      ready = true;
      onStatus({ ok: true, message: 'Street View verbunden' });
      return true;
    } catch (err) {
      failed = err.message || String(err);
      onStatus({ ok: false, message: failed });
      return false;
    }
  }

  function applyMode() {
    container.classList.toggle('sv-hidden', mode === 'off');
    container.classList.toggle('sv-pip', mode === 'pip');
    if (pano) pano.setVisible(mode !== 'off');
    // Google berechnet die Groesse nur bei Resize neu.
    if (maps && pano && mode !== 'off') {
      requestAnimationFrame(() => maps.event.trigger(pano, 'resize'));
    }
  }

  async function setMode(next) {
    mode = next;
    if (mode !== 'off') {
      const ok = await ensure();
      if (!ok) {
        mode = 'off';
        container.classList.add('sv-hidden');
        return mode;
      }
    }
    applyMode();
    return mode;
  }

  function cycleMode() {
    const i = SV_MODES.indexOf(mode);
    return setMode(SV_MODES[(i + 1) % SV_MODES.length]);
  }

  /**
   * Vom Spiel jeden Frame aufgerufen.
   * @param {number} x lokale Position (Ost)
   * @param {number} z lokale Position (Sued)
   * @param {number} yaw Fahrzeugausrichtung in Radiant
   */
  function update(x, z, yaw) {
    if (mode === 'off' || !ready || !pano) return;

    const heading = yawToHeading(yaw);
    // Blickrichtung immer sofort mitdrehen — das kostet nichts.
    pano.setPov({ heading, pitch: 0 });

    const { lat, lon } = localToLatLon(x, z);
    const moved =
      Math.abs(lat - lastLat) * 111194 > MOVE_THRESHOLD ||
      Math.abs(lon - lastLon) * 75600 > MOVE_THRESHOLD;

    const now = performance.now();
    if (!moved || pending || now - lastQuery < QUERY_INTERVAL) return;

    lastQuery = now;
    pending = true;
    lastLat = lat;
    lastLon = lon;

    service.getPanorama(
      { location: { lat, lng: lon }, radius: 55, source: 'outdoor', preference: 'nearest' },
      (data, status) => {
        pending = false;
        if (status === 'OK' && data?.location?.pano) {
          coverage = true;
          if (data.location.pano !== currentPanoId) {
            currentPanoId = data.location.pano;
            pano.setPano(currentPanoId);
            pano.setPov({ heading, pitch: 0 });
          }
          badge.textContent = `Street View · ${data.imageDate || ''}`.trim();
        } else {
          if (coverage) badge.textContent = 'Street View · hier keine Aufnahme';
          coverage = false;
        }
      },
    );
  }

  return {
    get mode() {
      return mode;
    },
    get ready() {
      return ready;
    },
    get error() {
      return failed;
    },
    get hasCoverage() {
      return coverage;
    },
    setMode,
    cycleMode,
    update,
    reset() {
      failed = null;
      ready = false;
      pano = null;
      maps = null;
      currentPanoId = null;
    },
  };
}
