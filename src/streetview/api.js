/**
 * Zugang zu Google Maps.
 *
 * Der API-Key liegt ausschliesslich im Browser des Spielers (localStorage)
 * und geht an niemanden ausser an Google selbst. Er wird bewusst nicht ins
 * Repository eingecheckt — ein Maps-Key ist zwar clientseitig sichtbar, aber
 * ein oeffentlich im Quelltext stehender Key wird binnen Stunden abgegriffen.
 *
 * Empfohlen: den Key in der Cloud Console auf die eigene Domain (HTTP-
 * Referrer) und auf "Maps JavaScript API" + "Street View Static API"
 * einschraenken und ein Kontingent setzen.
 */

const LS_KEY = 'frojach.gmaps.key';

let loadPromise = null;

export function getApiKey() {
  // Reihenfolge: URL-Parameter (?key=…) -> localStorage -> Build-Variable
  try {
    const fromUrl = new URLSearchParams(location.search).get('key');
    if (fromUrl) {
      localStorage.setItem(LS_KEY, fromUrl);
      // Key wieder aus der Adresszeile nehmen, damit er nicht im Verlauf landet.
      const u = new URL(location.href);
      u.searchParams.delete('key');
      history.replaceState(null, '', u);
      return fromUrl;
    }
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return stored;
  } catch {
    /* localStorage kann blockiert sein */
  }
  return import.meta.env?.VITE_GOOGLE_MAPS_KEY || '';
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(LS_KEY, key.trim());
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* egal */
  }
  loadPromise = null;
}

export function hasApiKey() {
  return !!getApiKey();
}

/**
 * Laedt die Maps-JavaScript-API genau einmal nach.
 * @returns {Promise<typeof google.maps>}
 */
export function loadMapsApi() {
  if (loadPromise) return loadPromise;
  const key = getApiKey();
  if (!key) return Promise.reject(new Error('Kein Google-Maps-API-Key hinterlegt'));

  loadPromise = new Promise((resolve, reject) => {
    if (globalThis.google?.maps?.StreetViewPanorama) {
      resolve(google.maps);
      return;
    }

    const cbName = '__frojachMapsReady';
    const timer = setTimeout(() => {
      reject(new Error('Google Maps antwortet nicht (Netzwerk oder Key blockiert)'));
    }, 20000);

    globalThis[cbName] = () => {
      clearTimeout(timer);
      delete globalThis[cbName];
      resolve(google.maps);
    };

    // Google meldet Key-Fehler nur ueber die Konsole. Wir fangen sie ab,
    // damit im Menue eine verstaendliche Meldung erscheinen kann.
    const s = document.createElement('script');
    s.async = true;
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&loading=async&callback=${cbName}&language=de&region=AT`;
    s.onerror = () => {
      clearTimeout(timer);
      loadPromise = null;
      reject(new Error('Maps-Skript konnte nicht geladen werden'));
    };
    document.head.appendChild(s);
  });

  return loadPromise;
}

/**
 * Fragt die (kostenlose) Street-View-Metadaten-Schnittstelle: Gibt es an
 * dieser Stelle ein Panorama, und wo genau steht es?
 *
 * Das ist wichtig fuer die Fassadenfotos — nur mit der echten Kamera-
 * position laesst sich Blickrichtung und Bildwinkel sauber berechnen.
 */
const metaCache = new Map();

export async function streetViewMeta(lat, lon, radius = 70) {
  const key = getApiKey();
  if (!key) return null;
  const ck = `${lat.toFixed(5)},${lon.toFixed(5)},${radius}`;
  if (metaCache.has(ck)) return metaCache.get(ck);

  const url =
    'https://maps.googleapis.com/maps/api/streetview/metadata' +
    `?location=${lat.toFixed(6)},${lon.toFixed(6)}` +
    `&radius=${radius}&source=outdoor&key=${encodeURIComponent(key)}`;

  const p = fetch(url)
    .then((r) => r.json())
    .then((d) => (d && d.status === 'OK' ? { lat: d.location.lat, lon: d.location.lng, panoId: d.pano_id, date: d.date } : null))
    .catch(() => null);

  metaCache.set(ck, p);
  return p;
}

/** URL fuer ein Standbild aus der Street View Static API. */
export function streetViewImageUrl({ lat, lon, panoId, heading, pitch = 0, fov = 70, w = 640, h = 400 }) {
  const key = getApiKey();
  const loc = panoId ? `pano=${encodeURIComponent(panoId)}` : `location=${lat.toFixed(6)},${lon.toFixed(6)}`;
  return (
    'https://maps.googleapis.com/maps/api/streetview' +
    `?size=${w}x${h}&${loc}` +
    `&heading=${heading.toFixed(1)}&pitch=${pitch.toFixed(1)}&fov=${fov.toFixed(1)}` +
    `&source=outdoor&return_error_code=true&key=${encodeURIComponent(key)}`
  );
}

/** Link auf das echte Google-Street-View — funktioniert auch ohne Key. */
export function streetViewWebUrl(lat, lon, heading = 0) {
  return (
    'https://www.google.com/maps/@?api=1&map_action=pano' +
    `&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${heading.toFixed(1)}&pitch=0&fov=90`
  );
}
