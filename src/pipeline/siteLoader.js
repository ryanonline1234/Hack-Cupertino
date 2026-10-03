// Candidate sites for "Suggest sites" (docs/08 §1): existing commercial sites
// from OpenStreetMap, committed per bundled county in public/data/sites/ by
// scripts/build-site-candidates.mjs. Other counties have no file, and a file
// that fails to load (or doesn't check out) is 'unavailable', never an empty
// success: either way the caller suggests Census block points instead, under
// the blocks label.
import { BUNDLED_COUNTIES } from './blockLoader.js';
import { roundCoord } from '../lib/geo.js';
import { siteLabel } from '../lib/siteLabels.js';

export const SITES_BASE = '/data/sites';

const KINDS = ['vacant', 'building', 'commercial_building', 'retail_area'];
// Kinds whose label states a size; a row without one can't be described.
const SIZED_KINDS = new Set(['building', 'commercial_building', 'retail_area']);
const TIMEOUT_MS = 30_000;

// Same over-covering box as the suggestion engine: 69 mi per degree of
// latitude is under the haversine sphere's 69.09, and longitude is taken at
// the box's poleward edge.
const MI_PER_DEG_LAT = 69;
const BOX_SLACK = 1.01;
const RAD = Math.PI / 180;

const cache = new Map(); // county SSCCC -> Promise<result>

export function resetSiteCache() {
  cache.clear();
}

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

const isLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const isLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Row: [id, lat, lng, kind, sqft, name]. Any bad row, a duplicate id or a
// per-kind count that disagrees with the file's own `counts` voids the file,
// so a truncated or hand-edited file can't pass as complete. Points come out
// at pin precision (4 decimals), so a suggested site is scored exactly where
// "Add as store" puts its pin.
function parseFile(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.sites)) throw new Error('bad site file');
  const counts = json.counts;
  if (!counts || typeof counts !== 'object' || !KINDS.every((k) => Number.isInteger(counts[k]) && counts[k] >= 0)) {
    throw new Error('bad site counts');
  }
  const seen = new Set();
  const perKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const candidates = json.sites.map((row) => {
    if (!Array.isArray(row)) throw new Error('bad site row');
    const [id, lat, lng, kind, sqft, name] = row;
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('bad site id');
    if (!isLat(lat) || !isLng(lng) || !hasOwn(perKind, kind)) throw new Error('bad site row');
    const sized = Number.isFinite(sqft) && sqft > 0;
    if (sqft !== null && !sized) throw new Error('bad site size');
    if (SIZED_KINDS.has(kind) && !sized) throw new Error('site without size');
    if (typeof name !== 'string') throw new Error('bad site name');
    const site = { id, lat: roundCoord(lat), lng: roundCoord(lng), kind, sqft: sized ? sqft : null, name: name.trim() || null };
    const label = siteLabel(site);
    if (!label) throw new Error('unlabelled site');
    seen.add(id);
    perKind[kind] += 1;
    return { ...site, label };
  });
  if (!KINDS.every((k) => perKind[k] === counts[k])) throw new Error('site/count mismatch');
  return {
    status: 'ok',
    candidates,
    dataset: {
      source: typeof json.source === 'string' ? json.source : null,
      license: typeof json.license === 'string' ? json.license : null,
      retrievedAt: typeof json.retrievedAt === 'string' ? json.retrievedAt : null,
      osmBase: typeof json.osmBase === 'string' ? json.osmBase : null,
    },
  };
}

const unavailable = () => ({ status: 'unavailable', candidates: [], dataset: null });

// countyFips: 'SSCCC' (communityData.meta.countyFips).
// -> { status: 'ok', candidates: [{ id, lat, lng, kind, sqft, name, label }]
//      (lat/lng at pin precision),
//      dataset: { source, license, retrievedAt, osmBase } }
//  | { status: 'not_bundled' | 'unavailable', candidates: [], dataset: null }
// `label` is siteLabel's (third-party name HTML-escaped, for Leaflet); React
// text takes siteLabelText(candidate). One fetch per county per page load;
// a failure doesn't stick, so the next call tries again.
export function loadSiteCandidates(countyFips) {
  if (typeof countyFips !== 'string' || !BUNDLED_COUNTIES.includes(countyFips)) {
    return Promise.resolve({ status: 'not_bundled', candidates: [], dataset: null });
  }
  if (!cache.has(countyFips)) {
    const p = (async () => {
      const res = await fetch(`${SITES_BASE}/${countyFips}.json`, withTimeout());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFile(await res.json());
    })();
    cache.set(countyFips, p);
    p.catch(() => {
      if (cache.get(countyFips) === p) cache.delete(countyFips);
    });
  }
  return cache.get(countyFips).catch(unavailable);
}

const validPoint = (p) => isLat(p?.lat) && isLng(p?.lng);

// docs/08: candidates within the tract's block bounding box expanded by T.
// The box spans the populated blocks with a point and over-covers slightly,
// so no candidate within T of a block is dropped.
export function filterCandidatesToTract(candidates, blocks, threshold) {
  if (!Array.isArray(candidates) || !Array.isArray(blocks)) return [];
  if (!(Number.isFinite(threshold) && threshold > 0)) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const b of blocks) {
    if (!(b?.pop > 0) || !validPoint(b)) continue;
    minLat = Math.min(minLat, b.lat);
    maxLat = Math.max(maxLat, b.lat);
    minLng = Math.min(minLng, b.lng);
    maxLng = Math.max(maxLng, b.lng);
  }
  if (minLat === Infinity) return [];
  const reach = threshold * BOX_SLACK;
  const dLat = reach / MI_PER_DEG_LAT;
  const edgeLat = Math.min(89, Math.max(Math.abs(minLat), Math.abs(maxLat)) + dLat);
  const dLng = reach / (MI_PER_DEG_LAT * Math.cos(edgeLat * RAD));
  return candidates.filter(
    (c) =>
      validPoint(c) &&
      c.lat >= minLat - dLat && c.lat <= maxLat + dLat &&
      c.lng >= minLng - dLng && c.lng <= maxLng + dLng,
  );
}

// The candidates "Suggest sites" runs on, from a loadSiteCandidates result.
// -> { candidates: [...] | undefined, from: 'commercial' | 'blocks',
//      fallback: null | 'not_bundled' | 'unavailable' | 'none_in_range',
//      considered: <commercial candidates in the box> }
// candidates undefined tells suggestSites to use the tract's block points.
export function tractCandidates(loaded, blocks, threshold) {
  const blocksOnly = (fallback) => ({ candidates: undefined, from: 'blocks', fallback, considered: 0 });
  if (loaded?.status === 'not_bundled') return blocksOnly('not_bundled');
  if (loaded?.status !== 'ok') return blocksOnly('unavailable');
  const near = filterCandidatesToTract(loaded.candidates, blocks, threshold);
  if (near.length === 0) return blocksOnly('none_in_range');
  return { candidates: near, from: 'commercial', fallback: null, considered: near.length };
}

// Why the suggestions came from block points, given what tractCandidates
// prepared and what suggestSites returned: its own reason, or
// 'no_gain_commercial' when commercial candidates were tried and none brought
// anyone within T (suggestSites then re-ran on blocks). null = commercial.
export function candidateFallback(prepared, result) {
  if (!prepared) return null;
  if (prepared.from === 'commercial') return result?.source === 'blocks' ? 'no_gain_commercial' : null;
  return prepared.fallback ?? null;
}
