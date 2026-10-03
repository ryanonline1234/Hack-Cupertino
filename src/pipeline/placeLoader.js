// City summary (docs/07 "City summary"): USDA rates census tracts, not cities,
// so this adds up the tract test for the residents inside one Census place.
//
// Membership: a 2020 block is in the city when its internal point lies inside
// the full-resolution place polygon; the in-city blocks must add up to the
// place's POP100 exactly, or the whole summary is Unknown. Each tract the
// city touches is tested on ALL of its blocks (same rule, same code as the
// tract view); totals count in-city residents only. Any load failure makes
// the summary Unknown with a named reason, never a partial sum.
//
// loadPlaceSummary does the fetching; assemblePlaceSummary is the pure part.
import { TIGER_BASE } from './tractLookup.js';
import { BUNDLED_COUNTIES, loadTractBlocks } from './blockLoader.js';
import { loadStoresNear } from './storeLoader.js';
import { loadErsTract } from './ersLoader.js';
import { NON_SNAP_STATES, RURAL_THRESHOLD_MI, STORE_RADIUS_MI, URBAN_THRESHOLD_MI } from './normalizer.js';
import { nearestDistances, populationLowAccessFromDistances } from '../engine/lowAccess.js';
import { evaluateFoodAccess } from '../engine/foodAccessVerdict.js';

const LAYER_TRACTS = 6;
const LAYER_BLOCKS = 10;
const LAYER_INCORPORATED = 26;
const LAYER_CDP = 28;
const BUNDLE_BASE = '/data/blocks';
const TIMEOUT_MS = 60_000;
// Above this many intersecting blocks the block query splits into six pages
// fetched side by side.
const LARGE_BLOCK_COUNT = 3000;
const BLOCK_PAGES = 6;
const MAX_CONCURRENT = 6;
const TRACTS_PER_QUERY = 100;
const BLOCK_FIELDS = 'GEOID,POP100,HU100,UR,INTPTLAT,INTPTLON';
const TRACT_FIELDS = 'GEOID,NAME,BASENAME,POP100,INTPTLAT,INTPTLON';
const PLACE_FIELDS = 'GEOID,NAME,BASENAME,POP100';
// Membership tests run in chunks this size, yielding between chunks so the
// progress bar can paint during a ~30k-block city.
const PIP_CHUNK = 4000;

// Steps in the order loadPlaceSummary reports them (for a progress bar).
export const SUMMARY_STEPS = ['boundary', 'blocks', 'tracts', 'tract_blocks', 'ers', 'stores', 'compute'];

// ------------------------------------------------------------- helpers

const toNumber = (v) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));
const isCount = (n) => Number.isInteger(n) && n >= 0;
const isLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const isLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;
const bool = (v) => (typeof v === 'boolean' ? v : null);
const sumPop = (blocks) => blocks.reduce((s, b) => s + b.pop, 0);
const nonSnapState = (geoid) => NON_SNAP_STATES.has(String(geoid ?? '').slice(0, 2));

// A macrotask turn, so React can render the progress update just sent.
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

function timeoutSignal(signal) {
  const t = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : null;
  if (signal && t && typeof AbortSignal.any === 'function') return AbortSignal.any([signal, t]);
  return signal || t || undefined;
}

// POST <layer>/query (full-resolution polygons and long IN lists stay off the
// URL). Resolves to the parsed JSON, or null on any failure, including
// ArcGIS's HTTP-200 `{ error }` reply.
async function postTiger(layer, params, signal) {
  try {
    const res = await fetch(`${TIGER_BASE}/${layer}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, f: 'json' }).toString(),
      signal: timeoutSignal(signal),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.error) return null;
    return json;
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function parseBlock(a) {
  if (!a || typeof a.GEOID !== 'string' || !/^\d{15}$/.test(a.GEOID)) return null;
  const pop = toNumber(a.POP100);
  const hu = toNumber(a.HU100);
  const lat = toNumber(a.INTPTLAT);
  const lng = toNumber(a.INTPTLON);
  if (!isCount(pop) || !isCount(hu) || !isLat(lat) || !isLng(lng)) return null;
  return { id: a.GEOID, pop, hu, lat, lng, ur: a.UR ?? null };
}

// ------------------------------------------------------------- indexed point-in-polygon

// A full-resolution city boundary has ~10k vertices and the city ~30k blocks:
// the plain even-odd test (src/lib/geo.js pointInPolygon) would make ~300M
// edge checks. The index keeps, per ring, its bounding box and its edges
// bucketed by latitude band, so a test only looks at edges whose latitude
// span covers the point. Each edge check is pointInPolygon's own expression
// on the same operands in the same order, so the answer is identical (a test
// compares the two on random and on-vertex points):
//   - an edge can toggle only when min(yi, yj) <= lat < max(yi, yj), and
//     band(y) is monotone in y, so every such edge sits in band(lat);
//   - a ring whose latitude range excludes lat has no such edge;
//   - east of a ring (by more than LNG_SLACK, far above the few-ulp error of
//     the crossing x) no crossing lies east of the point; west of it every
//     crossing does, and a closed ring has an even number of them.
const LNG_SLACK = 1e-9;
const EDGES_PER_BAND = 8;
const MAX_BANDS = 4096;

// rings: [[[lng, lat], ...], ...] as for pointInPolygon.
export function indexPolygon(rings) {
  const index = [];
  for (const ring of rings || []) {
    const n = Array.isArray(ring) ? ring.length : 0;
    if (n === 0) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const [x, y] of ring) {
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
    }
    // Edges (ring[i], ring[j]) with j the previous vertex, as pointInPolygon
    // walks them; horizontal edges never toggle and are left out.
    const edges = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi !== yj) edges.push(xi, yi, xj, yj);
    }
    const m = edges.length / 4;
    const bands = Math.max(1, Math.min(MAX_BANDS, Math.ceil(m / EDGES_PER_BAND)));
    const height = (maxLat - minLat) / bands;
    const bandOf = (y) => (height > 0 ? Math.min(bands - 1, Math.max(0, Math.floor((y - minLat) / height))) : 0);
    // Compressed rows: band b holds items[start[b] .. start[b + 1]).
    const start = new Uint32Array(bands + 1);
    for (let e = 0; e < m; e++) {
      const lo = bandOf(Math.min(edges[4 * e + 1], edges[4 * e + 3]));
      const hi = bandOf(Math.max(edges[4 * e + 1], edges[4 * e + 3]));
      for (let b = lo; b <= hi; b++) start[b + 1] += 1;
    }
    for (let b = 0; b < bands; b++) start[b + 1] += start[b];
    const items = new Uint32Array(start[bands]);
    const fill = start.slice(0, bands);
    for (let e = 0; e < m; e++) {
      const lo = bandOf(Math.min(edges[4 * e + 1], edges[4 * e + 3]));
      const hi = bandOf(Math.max(edges[4 * e + 1], edges[4 * e + 3]));
      for (let b = lo; b <= hi; b++) items[fill[b]++] = e;
    }
    index.push({ minLat, maxLat, minLng, maxLng, edges: Float64Array.from(edges), bandOf, start, items });
  }
  return index;
}

export function pointInIndexedPolygon(lat, lng, index) {
  let inside = false;
  for (const r of index) {
    if (!(lat >= r.minLat && lat < r.maxLat)) continue;
    if (lng > r.maxLng + LNG_SLACK || lng < r.minLng - LNG_SLACK) continue;
    const { edges, start, items } = r;
    const b = r.bandOf(lat);
    for (let k = start[b]; k < start[b + 1]; k++) {
      const o = 4 * items[k];
      const xi = edges[o];
      const yi = edges[o + 1];
      const xj = edges[o + 2];
      const yj = edges[o + 3];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// The blocks whose internal point lies inside `rings`, in input order.
async function blocksInside(blocks, rings) {
  const index = indexPolygon(rings);
  const inside = [];
  for (let i = 0; i < blocks.length; i += PIP_CHUNK) {
    if (i > 0) await yieldToEventLoop();
    const end = Math.min(blocks.length, i + PIP_CHUNK);
    for (let k = i; k < end; k++) {
      if (pointInIndexedPolygon(blocks[k].lat, blocks[k].lng, index)) inside.push(blocks[k]);
    }
  }
  return inside;
}

// ------------------------------------------------------------- default lookups

const bundleCache = new Map(); // SSCCC -> Promise<bundle | null>

export function resetPlaceCache() {
  bundleCache.clear();
}

// The committed county file (docs/07 "Blocks bundle"), or null.
function fetchBundle(county) {
  if (!bundleCache.has(county)) {
    const p = (async () => {
      const res = await fetch(`${BUNDLE_BASE}/${county}.json`, { signal: timeoutSignal() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || typeof json.tracts !== 'object' || json.tracts === null) throw new Error('bad bundle');
      if (typeof json.places !== 'object' || json.places === null) throw new Error('bad bundle');
      return json;
    })();
    bundleCache.set(county, p);
    p.catch(() => {
      if (bundleCache.get(county) === p) bundleCache.delete(county);
    });
  }
  return bundleCache.get(county).catch(() => null);
}

// Place polygon from TIGERweb layer 26 (incorporated) or 28 (CDP), full
// resolution, WGS84. A place can come back as several features; even-odd
// over all their rings needs no part bookkeeping.
// -> { status: 'ok', pop, name, rings } | { status: 'no_place' | 'place_unavailable' }
export async function fetchPlaceGeometry(place, signal) {
  const layers = place.kind === 'incorporated'
    ? [LAYER_INCORPORATED]
    : place.kind === 'cdp'
      ? [LAYER_CDP]
      : [LAYER_INCORPORATED, LAYER_CDP];
  for (const layer of layers) {
    const json = await postTiger(layer, {
      where: `GEOID='${place.geoid}'`,
      outFields: PLACE_FIELDS,
      returnGeometry: 'true',
      outSR: '4326',
    }, signal);
    if (!json || !Array.isArray(json.features)) return { status: 'place_unavailable' };
    if (json.features.length === 0) continue;
    const rings = [];
    let pop = null;
    let name = null;
    for (const f of json.features) {
      const a = f?.attributes;
      const fr = f?.geometry?.rings;
      if (!a || a.GEOID !== place.geoid || !Array.isArray(fr) || fr.length === 0) return { status: 'place_unavailable' };
      const p = toNumber(a.POP100);
      if (!isCount(p) || (pop !== null && p !== pop)) return { status: 'place_unavailable' };
      pop = p;
      name = a.NAME || a.BASENAME || name;
      rings.push(...fr);
    }
    return { status: 'ok', pop, name, rings };
  }
  return { status: 'no_place' };
}

// Every populated block intersecting the polygon (a superset of the blocks
// whose internal point is inside it). -> { status: 'ok', blocks } | { status: 'blocks_unavailable' }
export async function fetchPlaceBlocks(rings, { onPage, signal } = {}) {
  const spatial = {
    where: 'POP100>0',
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
  const countJson = await postTiger(LAYER_BLOCKS, { ...spatial, returnCountOnly: 'true' }, signal);
  const count = countJson?.count;
  if (!isCount(count)) return { status: 'blocks_unavailable' };
  if (count === 0) return { status: 'ok', blocks: [] };

  const pages = count > LARGE_BLOCK_COUNT ? BLOCK_PAGES : 1;
  const size = Math.ceil(count / pages);
  let done = 0;
  onPage?.(0, pages);
  const results = await Promise.all(Array.from({ length: pages }, async (_, i) => {
    const start = i * size;
    const end = Math.min(count, start + size);
    const rows = [];
    // A server cap below `size` shows up as exceededTransferLimit: keep going
    // inside this page's range.
    while (start + rows.length < end) {
      const json = await postTiger(LAYER_BLOCKS, {
        ...spatial,
        outFields: BLOCK_FIELDS,
        returnGeometry: 'false',
        orderByFields: 'GEOID',
        resultOffset: String(start + rows.length),
        resultRecordCount: String(end - start - rows.length),
      }, signal);
      if (!json || !Array.isArray(json.features) || json.features.length === 0) return null;
      for (const f of json.features) {
        const b = parseBlock(f?.attributes);
        if (!b) return null;
        rows.push(b);
      }
      if (!json.exceededTransferLimit && start + rows.length < end) return null;
    }
    done += 1;
    onPage?.(done, pages);
    return rows.slice(0, end - start);
  }));
  if (results.some((r) => r === null)) return { status: 'blocks_unavailable' };
  const byId = new Map();
  for (const b of results.flat()) byId.set(b.id, b);
  // Pages that shifted under us would duplicate some blocks and drop others.
  if (byId.size !== count) return { status: 'blocks_unavailable' };
  return { status: 'ok', blocks: [...byId.values()] };
}

function parseTract(a) {
  if (!a || typeof a.GEOID !== 'string' || !/^\d{11}$/.test(a.GEOID)) return null;
  const pop = toNumber(a.POP100);
  const intptLat = toNumber(a.INTPTLAT);
  const intptLng = toNumber(a.INTPTLON);
  if (!isCount(pop) || !isLat(intptLat) || !isLng(intptLng)) return null;
  return {
    geoid: a.GEOID,
    name: a.NAME ?? null,
    basename: a.BASENAME ?? null,
    pop,
    intptLat,
    intptLng,
  };
}

// TIGERweb layer 6 rows for the given tract GEOIDs; every one must come back.
// -> { status: 'ok', tracts: Map<geoid, tract> } | { status: 'tracts_unavailable' }
export async function fetchTracts(geoids, signal) {
  const chunks = [];
  for (let i = 0; i < geoids.length; i += TRACTS_PER_QUERY) chunks.push(geoids.slice(i, i + TRACTS_PER_QUERY));
  const results = await mapLimit(chunks, MAX_CONCURRENT, async (chunk) => {
    const json = await postTiger(LAYER_TRACTS, {
      where: `GEOID IN (${chunk.map((g) => `'${g}'`).join(',')})`,
      outFields: TRACT_FIELDS,
      returnGeometry: 'false',
    }, signal);
    if (!json || !Array.isArray(json.features) || json.exceededTransferLimit) return null;
    const rows = json.features.map((f) => parseTract(f?.attributes));
    return rows.some((r) => r === null) ? null : rows;
  });
  if (results.some((r) => r === null)) return { status: 'tracts_unavailable' };
  const tracts = new Map();
  for (const t of results.flat()) tracts.set(t.geoid, t);
  if (geoids.some((g) => !tracts.has(g))) return { status: 'tracts_unavailable' };
  return { status: 'ok', tracts };
}

const DEFAULT_LOOKUPS = {
  fetchBundle,
  fetchPlaceGeometry,
  fetchPlaceBlocks,
  fetchTracts,
  loadTractBlocks,
  loadErsTract,
  loadStoresNear,
};

// ------------------------------------------------------------- in-city blocks

// Bundle rows: [block4, pop, hu, lat, lng, ur, place7]. Null on a bad row.
function bundleTractBlocks(stateCounty, tract6, entry) {
  if (!entry || !Array.isArray(entry.blocks) || !isCount(entry.pop)) return null;
  const geoid = stateCounty + tract6;
  const blocks = [];
  for (const row of entry.blocks) {
    if (!Array.isArray(row)) return null;
    const [block4, pop, hu, lat, lng, ur, place] = row;
    if (typeof block4 !== 'string' || !/^\d{4}$/.test(block4)) return null;
    if (!isCount(pop) || !isCount(hu) || !isLat(lat) || !isLng(lng) || typeof place !== 'string') return null;
    if (pop === 0) continue;
    blocks.push({ id: geoid + block4, pop, hu, lat, lng, ur: ur || null, place });
  }
  return { geoid, pop: entry.pop, name: entry.name ?? null, blocks };
}

// The place from the bundled county files, when it lies wholly inside them:
// its in-place blocks across the bundled counties of its state add up to the
// POP100 the bundle records. Null otherwise (the caller goes live).
async function bundledCity(place, L) {
  const county = place.countyFips;
  if (!BUNDLED_COUNTIES.includes(county)) return null;
  const counties = [
    county,
    ...BUNDLED_COUNTIES.filter((c) => c !== county && c.slice(0, 2) === place.geoid.slice(0, 2)),
  ];
  let placePop = null;
  let placeName = null;
  let found = 0;
  const cityBlocks = [];
  const tractBlocks = new Map();
  for (const c of counties) {
    const bundle = await L.fetchBundle(c);
    if (!bundle) return null;
    const entry = bundle.places[place.geoid];
    if (!entry) {
      if (c === county) return null;
      continue;
    }
    if (!isCount(entry.pop) || (placePop !== null && entry.pop !== placePop)) return null;
    placePop = entry.pop;
    placeName = entry.name ?? placeName;
    for (const [tract6, t] of Object.entries(bundle.tracts)) {
      const rows = t?.blocks;
      if (!Array.isArray(rows) || !rows.some((r) => Array.isArray(r) && r[6] === place.geoid)) continue;
      const parsed = bundleTractBlocks(c, tract6, t);
      if (!parsed) return null;
      tractBlocks.set(parsed.geoid, parsed);
      for (const b of parsed.blocks) {
        if (b.place === place.geoid) {
          cityBlocks.push(b);
          found += b.pop;
        }
      }
    }
    if (found === placePop) {
      return { status: 'ok', source: 'bundled', placePop, placeName, cityBlocks, tractBlocks };
    }
  }
  return null;
}

async function liveCity(place, L, progress, signal) {
  progress('boundary');
  const geom = await L.fetchPlaceGeometry(place, signal);
  if (geom?.status !== 'ok') return { status: geom?.status === 'no_place' ? 'no_place' : 'place_unavailable' };
  progress('blocks', 0, null);
  const res = await L.fetchPlaceBlocks(geom.rings, {
    signal,
    onPage: (done, total) => progress('blocks', done, total),
  });
  if (res?.status !== 'ok') return { status: 'blocks_unavailable' };
  await yieldToEventLoop();
  const cityBlocks = await blocksInside(res.blocks, geom.rings);
  return { status: 'ok', source: 'tigerweb', placePop: geom.pop, placeName: geom.name, cityBlocks, tractBlocks: null };
}

// ------------------------------------------------------------- assembly

function classifyUrban(e2025, blocks) {
  if (typeof e2025?.urban === 'boolean') return { urban: e2025.urban, urbanSource: 'ers_2025' };
  let urbanPop = 0;
  let ruralPop = 0;
  for (const b of blocks) {
    if (b.ur === 'U') urbanPop += b.pop;
    else if (b.ur === 'R') ruralPop += b.pop;
  }
  if (urbanPop > ruralPop) return { urban: true, urbanSource: 'block_ur' };
  if (ruralPop > urbanPop) return { urban: false, urbanSource: 'block_ur' };
  return { urban: null, urbanSource: null };
}

function boundsOf(points) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return minLat <= maxLat ? { minLat, maxLat, minLng, maxLng } : null;
}

const shareOf = (part, whole) => (whole > 0 ? part / whole : null);

function unknown(reason, base = {}, detail = null) {
  return { status: 'unknown', reason, detail, ...base };
}

// Inputs (see loadPlaceSummary for where each comes from):
//   place: { geoid, name, kind }; placePop: the place's POP100; placeName:
//   Census NAME ("San Jose city"); source: 'bundled' | 'tigerweb';
//   cityBlocks: [{ id, pop }] with the internal point inside the place;
//   tracts: [{ geoid, name, basename, pop, intptLat, intptLng,
//              blocks: [{ id, pop, hu, lat, lng, ur }], ers }] — every tract
//              holding an in-city block, with ALL its populated blocks and
//              its loadErsTract() result;
//   stores: loadStoresNear() result.
// -> { status: 'ok', ... totals, tracts: [row] } or { status: 'unknown', reason, detail }.
export function assemblePlaceSummary({
  place,
  placePop,
  placeName = null,
  source = null,
  cityBlocks = [],
  tracts = [],
  stores = null,
  retrievedAt = new Date().toISOString(),
} = {}) {
  const base = {
    place: place
      ? { geoid: place.geoid, name: placeName || place.name || null, kind: place.kind ?? null, pop: isCount(placePop) ? placePop : null }
      : null,
    source,
  };
  if (!place || !/^\d{7}$/.test(String(place.geoid || ''))) return unknown('no_place', base);
  // The SNAP store list has no stores in these territories (normalizer.js
  // NON_SNAP_STATES); a place never crosses a state line, but check the
  // tracts too.
  if (nonSnapState(place.geoid) || tracts.some((t) => nonSnapState(t?.geoid))) {
    return unknown('stores_not_covered', base);
  }
  if (!isCount(placePop)) return unknown('place_unavailable', base);
  if (placePop === 0) return unknown('no_residents', base);

  const population = sumPop(cityBlocks);
  if (population !== placePop) {
    return unknown('place_incomplete', base, { found: population, expected: placePop });
  }

  // Every tract must be complete, and every in-city block must sit in one.
  const byGeoid = new Map(tracts.map((t) => [t.geoid, t]));
  for (const t of tracts) {
    if (!Array.isArray(t.blocks) || !isCount(t.pop) || sumPop(t.blocks) !== t.pop) {
      return unknown('blocks_incomplete', base, { tract: t.geoid });
    }
  }
  const inCity = new Set();
  for (const b of cityBlocks) {
    if (!byGeoid.has(String(b.id).slice(0, 11))) return unknown('blocks_incomplete', base, { block: b.id });
    inCity.add(b.id);
  }

  if (stores?.status !== 'ok') return unknown('stores_unavailable', base);
  if (tracts.some((t) => !t.ers || t.ers.status === 'unavailable')) return unknown('ers_unavailable', base);

  const allBlocks = [];
  const offsets = [];
  for (const t of tracts) {
    offsets.push(allBlocks.length);
    allBlocks.push(...t.blocks);
  }
  const distances = nearestDistances(allBlocks, stores.stores);

  let beyond = 0;
  let foundInCity = 0;
  const rows = [];
  for (let k = 0; k < tracts.length; k++) {
    const t = tracts[k];
    const d = distances.subarray(offsets[k], offsets[k] + t.blocks.length);
    const e2025 = t.ers.status === 'ok' ? t.ers.e2025 : null;
    const { urban, urbanSource } = classifyUrban(e2025, t.blocks);
    // Each resident's limit is their own tract's; without one, the first
    // total would be partial.
    if (urban === null) return unknown('urban_unavailable', base, { tract: t.geoid });
    const threshold = urban ? URBAN_THRESHOLD_MI : RURAL_THRESHOLD_MI;
    const stats = populationLowAccessFromDistances(t.blocks, d, threshold);
    const verdict = evaluateFoodAccess({ lowIncome: bool(e2025?.lowIncome), lowAccess: stats.lowAccess });

    let inCityPop = 0;
    let inCityBeyond = 0;
    for (let i = 0; i < t.blocks.length; i++) {
      const b = t.blocks[i];
      if (!inCity.has(b.id)) continue;
      inCityPop += b.pop;
      if (!(d[i] <= threshold)) inCityBeyond += b.pop;
    }
    beyond += inCityBeyond;
    foundInCity += inCityPop;

    const e2019 = t.ers.e2019 ?? null;
    rows.push({
      geoid: t.geoid,
      name: t.name ?? null,
      basename: t.basename || String(t.name || '').replace(/^census tract\s+/i, '').trim() || t.geoid.slice(5),
      inCityPop,
      population: t.pop,
      wholeInCity: inCityPop === t.pop,
      inCityBeyond,
      beyond: stats.beyond,
      share: stats.share,
      byShare: stats.byShare,
      byCount: stats.byCount,
      lowAccess: stats.lowAccess,
      lowIncome: bool(e2025?.lowIncome),
      threshold,
      urban,
      urbanSource,
      status: verdict.status,
      qualifier: verdict.qualifier,
      reason: verdict.reason,
      lram2019: e2019 ? bool(e2019.lila) : null,
      lram2019Reason: e2019 ? null : t.ers.e2019Reason ?? 'missing_row',
      sram2025: e2025 ? bool(e2025.sramLILA) : null,
      intptLat: t.intptLat,
      intptLng: t.intptLng,
    });
  }
  // A duplicated in-city block id would double-count without this.
  if (foundInCity !== population) return unknown('blocks_incomplete', base, { found: foundInCity, expected: population });

  rows.sort((a, b) => a.geoid.localeCompare(b.geoid));
  const tally = (pick) => {
    let residents = 0;
    let count = 0;
    for (const r of rows) {
      if (pick(r)) {
        residents += r.inCityPop;
        count += 1;
      }
    }
    return { residents, tracts: count };
  };

  const met = tally((r) => r.status === 'met');
  const unknownTracts = tally((r) => r.status === 'unknown');
  // A map's flagged count covers only the tracts it has a row for (2019:
  // identical GEOID only). Over all residents its share is a floor ("at
  // least"); shareOfMatched is the share over the residents it covers.
  const flaggedBy = (key) => {
    const flagged = tally((r) => r[key] === true);
    const missing = tally((r) => r[key] === null);
    const matched = tally((r) => r[key] !== null);
    return {
      ...flagged,
      share: shareOf(flagged.residents, population),
      missingTracts: missing.tracts,
      missingResidents: missing.residents,
      matchedTracts: matched.tracts,
      matchedPopulation: matched.residents,
      shareOfMatched: shareOf(flagged.residents, matched.residents),
    };
  };

  return {
    status: 'ok',
    reason: null,
    detail: null,
    ...base,
    population,
    beyond,
    share: shareOf(beyond, population),
    tractCount: rows.length,
    meeting: { ...met, share: shareOf(met.residents, population) },
    unknownTracts: {
      ...unknownTracts,
      reasons: [...new Set(rows.filter((r) => r.status === 'unknown').map((r) => r.reason))],
    },
    flagged: {
      lram2019: flaggedBy('lram2019'),
      sram2025: flaggedBy('sram2025'),
    },
    tracts: rows,
    storesDataset: stores.dataset ?? null,
    retrievedAt,
  };
}

// ------------------------------------------------------------- fetching

// place: { geoid (7 digits), name, kind ('incorporated'|'cdp'), countyFips
// (the county of the searched tract, for the bundled check) } — meta.place
// plus meta.countyFips from the tract payload.
// lookups: { onProgress({ step, done, total }), signal, ...loader overrides
// (fetchBundle, fetchPlaceGeometry, fetchPlaceBlocks, fetchTracts,
// loadTractBlocks, loadErsTract, loadStoresNear) for tests }.
export async function loadPlaceSummary(place, lookups = {}) {
  const { onProgress, signal, ...overrides } = lookups;
  const L = { ...DEFAULT_LOOKUPS, ...overrides };
  const progress = (step, done = null, total = null) => {
    try {
      onProgress?.({ step, done, total });
    } catch {
      // A progress callback must never break the summary.
    }
  };
  const base = {
    place: place ? { geoid: place.geoid ?? null, name: place.name ?? null, kind: place.kind ?? null, pop: null } : null,
    source: null,
  };
  const aborted = () => Boolean(signal?.aborted);
  const cancelled = () => unknown('cancelled', base);

  if (!place || !/^\d{7}$/.test(String(place.geoid || ''))) return unknown('no_place', base);
  if (nonSnapState(place.geoid)) return unknown('stores_not_covered', base);

  // 1. In-city blocks: bundled county files when the place lies wholly in
  //    them, else TIGERweb live.
  progress('boundary');
  await yieldToEventLoop();
  let city = null;
  try {
    city = await bundledCity(place, L);
  } catch {
    city = null;
  }
  if (aborted()) return cancelled();
  if (!city) city = await liveCity(place, L, progress, signal);
  if (aborted()) return cancelled();
  if (city.status !== 'ok') return unknown(city.status, base);
  base.source = city.source;
  base.place = { ...base.place, name: city.placeName || base.place.name, pop: city.placePop };

  // Fail fast on membership before loading anything per tract.
  const cityPop = sumPop(city.cityBlocks);
  if (cityPop !== city.placePop) {
    return unknown('place_incomplete', base, { found: cityPop, expected: city.placePop });
  }

  // 2. Tract details (name, POP100, internal point for the table's links).
  const geoids = [...new Set(city.cityBlocks.map((b) => b.id.slice(0, 11)))].sort();
  progress('tracts', 0, geoids.length);
  await yieldToEventLoop();
  const tractsRes = await L.fetchTracts(geoids, signal);
  if (aborted()) return cancelled();
  if (tractsRes?.status !== 'ok') return unknown('tracts_unavailable', base);

  // 3. Every block of every touched tract. A tract whose in-city blocks
  //    already add up to its POP100 lies wholly inside: those are all of them.
  const cityByTract = new Map();
  for (const b of city.cityBlocks) {
    const g = b.id.slice(0, 11);
    if (!cityByTract.has(g)) cityByTract.set(g, []);
    cityByTract.get(g).push(b);
  }
  let blocksDone = 0;
  progress('tract_blocks', 0, geoids.length);
  await yieldToEventLoop();
  const tractBlocks = await mapLimit(geoids, MAX_CONCURRENT, async (g) => {
    const meta = tractsRes.tracts.get(g);
    let res;
    if (city.tractBlocks) {
      const t = city.tractBlocks.get(g);
      res = t ? { status: 'ok', blocks: t.blocks } : { status: 'blocks_unavailable', blocks: [] };
    } else if (sumPop(cityByTract.get(g)) === meta.pop) {
      res = { status: 'ok', blocks: cityByTract.get(g) };
    } else if (aborted()) {
      res = { status: 'blocks_unavailable', blocks: [] };
    } else {
      res = await L.loadTractBlocks({ geoid: g, pop: meta.pop }).catch(() => ({ status: 'blocks_unavailable', blocks: [] }));
    }
    blocksDone += 1;
    progress('tract_blocks', blocksDone, geoids.length);
    return res;
  });
  if (aborted()) return cancelled();
  const failed = tractBlocks.find((r) => r?.status !== 'ok');
  if (failed) {
    return unknown(failed?.status === 'blocks_incomplete' ? 'blocks_incomplete' : 'blocks_unavailable', base);
  }

  // 4. USDA ERS rows (one shard per county, cached by the loader).
  progress('ers', 0, geoids.length);
  await yieldToEventLoop();
  const ers = await Promise.all(
    geoids.map((g) => L.loadErsTract(g).catch(() => ({ status: 'unavailable', e2025: null, e2019: null, e2019Reason: null }))),
  );
  if (aborted()) return cancelled();

  // 5. Counted stores around everything the tracts cover.
  progress('stores');
  await yieldToEventLoop();
  const everyBlock = tractBlocks.flatMap((r) => r.blocks);
  const bbox = boundsOf(everyBlock);
  const stores = bbox
    ? await L.loadStoresNear(bbox, STORE_RADIUS_MI).catch(() => ({ status: 'stores_unavailable', stores: [], dataset: null }))
    : { status: 'stores_unavailable', stores: [], dataset: null };
  if (aborted()) return cancelled();

  // 6. The same rule as the tract view, tract by tract.
  progress('compute', 0, everyBlock.length);
  await yieldToEventLoop();
  if (aborted()) return cancelled();
  const tracts = geoids.map((g, i) => ({ ...tractsRes.tracts.get(g), blocks: tractBlocks[i].blocks, ers: ers[i] }));
  return assemblePlaceSummary({
    place: { geoid: place.geoid, name: place.name ?? null, kind: place.kind ?? null },
    placePop: city.placePop,
    placeName: city.placeName,
    source: city.source,
    cityBlocks: city.cityBlocks,
    tracts,
    stores,
  });
}
