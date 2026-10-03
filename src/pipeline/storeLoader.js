// Counted stores (SNAP Supermarket + Super Store, minus reviewed exclusions)
// from the committed 2-degree tiles in public/data/stores/. A tile missing
// from the manifest has no counted stores; a listed tile that fails to load
// makes the whole answer unavailable — never an empty list.
export const STORE_DATASET_NAME = 'USDA SNAP-authorized supermarkets and super stores';

const STORES_BASE = '/data/stores';
const TILE_DEG = 2;
const MI_PER_DEG_LAT = 69;
const TIMEOUT_MS = 30_000;

let manifestPromise = null;
const tileCache = new Map(); // key -> Promise<stores[]>

export function resetStoreCache() {
  manifestPromise = null;
  tileCache.clear();
}

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

async function fetchJson(url) {
  const res = await fetch(url, withTimeout());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isCount = (n) => Number.isInteger(n) && n >= 0;
const floorTile = (x) => Math.floor(x / TILE_DEG) * TILE_DEG;
// Keep tile longitudes in [-180, 180) so a bbox over the antimeridian finds them.
const wrapLng = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

function validBbox(b) {
  return (
    b !== null &&
    typeof b === 'object' &&
    [b.minLat, b.maxLat, b.minLng, b.maxLng].every(Number.isFinite) &&
    b.minLat <= b.maxLat &&
    b.minLng <= b.maxLng &&
    b.minLat >= -90 &&
    b.maxLat <= 90
  );
}

// Tile keys "<latFloor>_<lngFloor>" covering bbox grown by radiusMi.
export function storeTileKeys(bbox, radiusMi = 30) {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const dLat = radiusMi / MI_PER_DEG_LAT;
  const dLng = radiusMi / (MI_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
  const lat0 = Math.max(-90, bbox.minLat - dLat);
  const lat1 = Math.min(90, bbox.maxLat + dLat);
  let lng0 = bbox.minLng - dLng;
  let lng1 = bbox.maxLng + dLng;
  if (!(lng1 - lng0 < 360)) {
    lng0 = -180;
    lng1 = 180 - TILE_DEG;
  }
  const keys = new Set();
  for (let la = floorTile(lat0); la <= floorTile(lat1); la += TILE_DEG) {
    for (let lo = floorTile(lng0); lo <= floorTile(lng1); lo += TILE_DEG) {
      keys.add(`${la}_${wrapLng(lo)}`);
    }
  }
  return [...keys];
}

function loadManifest() {
  if (!manifestPromise) {
    const p = fetchJson(`${STORES_BASE}/manifest.json`).then((m) => {
      const tiles = m?.tiles;
      if (!tiles || typeof tiles !== 'object' || Array.isArray(tiles)) throw new Error('bad manifest');
      if (!Object.values(tiles).every(isCount)) throw new Error('bad manifest tile counts');
      return m;
    });
    manifestPromise = p;
    p.catch(() => {
      if (manifestPromise === p) manifestPromise = null;
    });
  }
  return manifestPromise.catch(() => null);
}

// Rows [lat, lng, type, name]; the row count must match the manifest so a
// stale or truncated tile can't pass as complete.
function parseTile(rows, expected) {
  if (!Array.isArray(rows) || rows.length !== expected) throw new Error('tile/manifest count mismatch');
  return rows.map((row) => {
    if (!Array.isArray(row)) throw new Error('bad tile row');
    const [lat, lng, type, name] = row;
    const ok =
      Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      Number.isFinite(lng) && Math.abs(lng) <= 180 &&
      typeof type === 'string';
    if (!ok) throw new Error('bad tile row');
    return { lat, lng, type, name: typeof name === 'string' ? name : null };
  });
}

function loadTile(key, expected) {
  if (!tileCache.has(key)) {
    const p = fetchJson(`${STORES_BASE}/${key}.json`).then((rows) => parseTile(rows, expected));
    tileCache.set(key, p);
    p.catch(() => {
      if (tileCache.get(key) === p) tileCache.delete(key);
    });
  }
  return tileCache.get(key).catch(() => null);
}

const unavailable = () => ({ status: 'stores_unavailable', stores: [], dataset: null });

// bbox: { minLat, maxLat, minLng, maxLng }.
// -> { status: 'ok', stores: [{ lat, lng, type, name }], dataset: { name, date, retrievedAt } }
//    | { status: 'stores_unavailable', stores: [], dataset: null }
export async function loadStoresNear(bbox, radiusMi = 30) {
  if (!validBbox(bbox) || !(Number.isFinite(radiusMi) && radiusMi >= 0)) return unavailable();
  const manifest = await loadManifest();
  if (!manifest) return unavailable();
  const keys = storeTileKeys(bbox, radiusMi).filter((k) => hasOwn(manifest.tiles, k));
  const tiles = await Promise.all(keys.map((k) => loadTile(k, manifest.tiles[k])));
  if (tiles.some((t) => t === null)) return unavailable();
  return {
    status: 'ok',
    stores: tiles.flat(),
    dataset: {
      name: STORE_DATASET_NAME,
      date: manifest.dataLastEditDate ?? null,
      retrievedAt: manifest.retrievedAt ?? null,
    },
  };
}
