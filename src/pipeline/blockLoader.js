// 2020 Census blocks for one tract: a committed per-county bundle where we have
// one, otherwise TIGERweb layer 10 live. Either way the block populations must
// add up to the tract's POP100, or the caller gets no blocks at all.
import { queryTiger } from './tractLookup.js';

// Must match scripts/build-block-bundles.mjs.
export const BUNDLED_COUNTIES = ['06085', '06001', '28151', '04001'];

const BUNDLE_BASE = '/data/blocks';
const LAYER_BLOCKS = 10;
const BLOCK_FIELDS = 'GEOID,POP100,HU100,UR,INTPTLAT,INTPTLON';
const MAX_PAGES = 50;
const TIMEOUT_MS = 30_000;

const bundleCache = new Map(); // county SSCCC -> Promise<bundle>

export function resetBlockCache() {
  bundleCache.clear();
}

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const isLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;

function loadBundle(county) {
  if (!bundleCache.has(county)) {
    const p = (async () => {
      const res = await fetch(`${BUNDLE_BASE}/${county}.json`, withTimeout());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || typeof json.tracts !== 'object' || json.tracts === null) throw new Error('bad bundle');
      return json;
    })();
    bundleCache.set(county, p);
    // A failed load must not stick: the next call retries.
    p.catch(() => {
      if (bundleCache.get(county) === p) bundleCache.delete(county);
    });
  }
  return bundleCache.get(county).catch(() => null);
}

// Row: [block4, pop, hu, lat, lng, ur, place7]. Any bad row voids the tract.
function parseBundleRows(geoid, rows) {
  if (!Array.isArray(rows)) return null;
  const blocks = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    const [block4, pop, hu, lat, lng, ur, place] = row;
    if (typeof block4 !== 'string' || !/^\d{4}$/.test(block4)) return null;
    if (!isCount(pop) || !isCount(hu) || !isLat(lat) || !isLng(lng)) return null;
    if (typeof place !== 'string') return null;
    if (pop === 0) continue;
    blocks.push({ id: geoid + block4, pop, hu, lat, lng, ur: ur ?? null, place });
  }
  return blocks;
}

async function bundledBlocks(geoid) {
  const bundle = await loadBundle(geoid.slice(0, 5));
  if (!bundle) return null;
  const entry = bundle.tracts[geoid.slice(5)];
  // A populated tract missing from its bundle fails the population check.
  if (entry === undefined) return [];
  return parseBundleRows(geoid, entry?.blocks);
}

// Number(null) and Number('') are 0; a missing value must not become one.
const toNumber = (v) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));

function parseLiveBlock(geoid, a) {
  if (!a || typeof a.GEOID !== 'string' || !/^\d{15}$/.test(a.GEOID) || !a.GEOID.startsWith(geoid)) return null;
  const pop = toNumber(a.POP100);
  const hu = toNumber(a.HU100);
  const lat = toNumber(a.INTPTLAT);
  const lng = toNumber(a.INTPTLON);
  if (!isCount(pop) || !isCount(hu) || !isLat(lat) || !isLng(lng)) return null;
  // Live blocks carry no place membership (that needs the place polygon).
  return { id: a.GEOID, pop, hu, lat, lng, ur: a.UR ?? null, place: null };
}

async function liveBlocks(geoid) {
  const where =
    `STATE='${geoid.slice(0, 2)}' AND COUNTY='${geoid.slice(2, 5)}' ` +
    `AND TRACT='${geoid.slice(5)}' AND POP100>0`;
  const blocks = [];
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = { where, outFields: BLOCK_FIELDS, returnGeometry: 'false', orderByFields: 'GEOID' };
    if (seen) query.resultOffset = String(seen);
    const json = await queryTiger(LAYER_BLOCKS, query);
    if (!json) return null;
    seen += json.features.length;
    for (const f of json.features) {
      const b = parseLiveBlock(geoid, f?.attributes);
      if (!b) return null;
      if (b.pop > 0) blocks.push(b);
    }
    if (!json.exceededTransferLimit) return blocks;
    if (json.features.length === 0) return null;
  }
  return null;
}

// tract: { geoid, pop, ... } from lookupTract.
// -> { status: 'ok'|'no_residents'|'blocks_unavailable'|'blocks_incomplete',
//      blocks: [{ id, pop, hu, lat, lng, ur, place }], population, source }
// `place` is the 7-digit place GEOID ('' = in no place) for bundled blocks and
// null (not computed) for live ones. Failures return blocks: [] and
// population: null; blocks_incomplete also reports blockSum.
export async function loadTractBlocks(tract) {
  const geoid = tract?.geoid;
  const valid = typeof geoid === 'string' && /^\d{11}$/.test(geoid) && isCount(tract.pop);
  const source = valid && BUNDLED_COUNTIES.includes(geoid.slice(0, 5)) ? 'bundled' : 'tigerweb';
  if (!valid) return { status: 'blocks_unavailable', blocks: [], population: null, source };
  if (tract.pop === 0) return { status: 'no_residents', blocks: [], population: 0, source: null };

  const blocks = source === 'bundled' ? await bundledBlocks(geoid) : await liveBlocks(geoid);
  if (!blocks) return { status: 'blocks_unavailable', blocks: [], population: null, source };
  const blockSum = blocks.reduce((sum, b) => sum + b.pop, 0);
  if (blockSum !== tract.pop) {
    return { status: 'blocks_incomplete', blocks: [], population: null, blockSum, source };
  }
  return { status: 'ok', blocks, population: blockSum, source };
}
