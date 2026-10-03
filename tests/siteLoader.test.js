import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  SITES_BASE,
  candidateFallback,
  filterCandidatesToTract,
  loadSiteCandidates,
  resetSiteCache,
  tractCandidates,
} from '../src/pipeline/siteLoader.js';
import { BUNDLED_COUNTIES, loadTractBlocks } from '../src/pipeline/blockLoader.js';
import { loadStoresNear } from '../src/pipeline/storeLoader.js';
import { loadErsTract } from '../src/pipeline/ersLoader.js';
import { STORE_RADIUS_MI, assembleCommunityData } from '../src/pipeline/normalizer.js';
import { suggestSites } from '../src/engine/suggestSites.js';
import { evaluatePlacedStoreScenario } from '../src/engine/scenarioEngine.js';
import { BLOCK_SITE_KIND, BLOCK_SITE_LABEL, siteLabel, siteLabelText } from '../src/lib/siteLabels.js';
import { haversineMiles, roundCoord } from '../src/lib/geo.js';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

// Synthetic fixtures follow the docs/08 file format; the golden checks at the
// end read the committed public/data snapshot through a stubbed fetch.

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const unexpected = (url) => {
  throw new Error(`unexpected fetch ${url}`);
};

function file(sites, extra = {}) {
  const counts = { vacant: 0, building: 0, commercial_building: 0, retail_area: 0 };
  for (const row of Array.isArray(sites) ? sites : []) if (Array.isArray(row) && counts[row[3]] !== undefined) counts[row[3]] += 1;
  return {
    retrievedAt: '2026-10-03T16:03:51.567Z',
    source: 'OpenStreetMap via Overpass',
    license: 'ODbL (© OpenStreetMap contributors)',
    counts,
    osmBase: '2026-10-03T16:02:21Z',
    bbox: [36.9, -122.3, 37.5, -121.1],
    sites,
    ...extra,
  };
}

const SITES = [
  ['n1', 37.42, -121.97, 'vacant', null, ''],
  ['w2', 37.43, -121.98, 'building', 12_400, ''],
  ['r3', 37.44, -121.99, 'retail_area', 100_188, ''],
  ['n4', 37.45, -121.96, 'vacant', null, 'Tom & Jerry <Market>'],
  ['w5', 37.46, -121.95, 'commercial_building', 28_400, ''],
];

function serve(payloadByUrl) {
  return stubFetch(async (url) => {
    if (!(url in payloadByUrl)) return unexpected(url);
    const v = payloadByUrl[url];
    return typeof v === 'function' ? v() : jsonResponse(v);
  });
}

test.beforeEach(() => resetSiteCache());

// ------------------------------------------------------------ loadSiteCandidates

test('loadSiteCandidates reads a bundled county file into labelled candidates', async () => {
  const stub = serve({ [`${SITES_BASE}/06085.json`]: file(SITES) });
  try {
    const r = await loadSiteCandidates('06085');
    assert.equal(r.status, 'ok');
    assert.equal(stub.calls.length, 1);
    assert.equal(r.candidates.length, 5);
    assert.deepEqual(r.candidates[0], {
      id: 'n1', lat: 37.42, lng: -121.97, kind: 'vacant', sqft: null, name: null,
      label: 'Vacant shop (OpenStreetMap)',
    });
    assert.equal(r.candidates[1].label, 'Retail building, ≈12,000 sq ft footprint (OpenStreetMap)');
    assert.equal(r.candidates[2].label, 'Retail area, ≈2.3 acres (OpenStreetMap)');
    // The label is HTML-safe (Leaflet tooltips); the name itself stays raw
    // for siteLabelText (React escapes on its own).
    const v = r.candidates[3];
    assert.equal(v.name, 'Tom & Jerry <Market>');
    assert.equal(v.label, 'Vacant shop · Tom &amp; Jerry &lt;Market&gt; (OpenStreetMap)');
    assert.equal(v.label, siteLabel(v));
    assert.equal(siteLabelText(v), 'Vacant shop · Tom & Jerry <Market> (OpenStreetMap)');
    assert.equal(r.candidates[4].label, 'Commercial building (offices or shops), ≈28,000 sq ft footprint (OpenStreetMap)');
    assert.deepEqual(r.dataset, {
      source: 'OpenStreetMap via Overpass',
      license: 'ODbL (© OpenStreetMap contributors)',
      retrievedAt: '2026-10-03T16:03:51.567Z',
      osmBase: '2026-10-03T16:02:21Z',
    });
  } finally {
    stub.restore();
  }
});

test('candidate points come out at pin precision (4 decimals), so Add as store lands where the site was scored', async () => {
  const stub = serve({ [`${SITES_BASE}/06085.json`]: file([['w7', 37.41356, -121.96396, 'building', 21_000, ''], ['n8', 37.42125, -121.96395, 'vacant', null, '']]) });
  try {
    const r = await loadSiteCandidates('06085');
    assert.equal(r.status, 'ok');
    // toFixed rounding, as a share link writes it (-121.96395 is stored a hair under the half).
    assert.deepEqual(r.candidates.map(({ lat, lng }) => [lat, lng]), [[37.4136, -121.964], [37.4213, -121.9639]]);
    for (const c of r.candidates) {
      assert.equal(c.lat, roundCoord(c.lat));
      assert.equal(c.lng, roundCoord(c.lng));
    }
  } finally {
    stub.restore();
  }
});

test('loadSiteCandidates fetches each county once (memory cache)', async () => {
  const stub = serve({ [`${SITES_BASE}/28151.json`]: file(SITES) });
  try {
    const a = await loadSiteCandidates('28151');
    const b = await loadSiteCandidates('28151');
    assert.equal(stub.calls.length, 1);
    assert.equal(a.status, 'ok');
    assert.deepEqual(b, a);
    // Concurrent first calls share one request too.
    resetSiteCache();
    const [c, d] = await Promise.all([loadSiteCandidates('28151'), loadSiteCandidates('28151')]);
    assert.equal(stub.calls.length, 2);
    assert.deepEqual(c, d);
  } finally {
    stub.restore();
  }
});

test('loadSiteCandidates only loads the bundled counties, and never fetches for others', async () => {
  const stub = stubFetch(async (url) => unexpected(url));
  try {
    for (const county of ['26163', '06075', '6085', '', null, undefined, 6085, '06085x']) {
      assert.deepEqual(await loadSiteCandidates(county), { status: 'not_bundled', candidates: [], dataset: null }, String(county));
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('a failed or malformed candidate file is unavailable, never an empty success', async () => {
  const bad = {
    http404: () => new Response('nope', { status: 404 }),
    notJson: () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    noSites: () => jsonResponse({ ...file(SITES), sites: undefined }),
    sitesNotArray: () => jsonResponse(file({})),
    noCounts: () => jsonResponse({ ...file(SITES), counts: undefined }),
    countMismatch: () => jsonResponse({ ...file(SITES), counts: { vacant: 2, building: 2, commercial_building: 1, retail_area: 1 } }),
    oldCountsShape: () => jsonResponse({ ...file(SITES), counts: { vacant: 2, building: 2, retail_area: 1 } }),
    badLat: () => jsonResponse(file([...SITES, ['n9', Number.NaN, -121.9, 'vacant', null, '']])),
    latOutOfRange: () => jsonResponse(file([...SITES, ['n9', 91, -121.9, 'vacant', null, '']])),
    unknownKind: () => jsonResponse(file([...SITES, ['n9', 37.4, -121.9, 'supermarket', null, '']])),
    buildingNoSize: () => jsonResponse(file([...SITES, ['w9', 37.4, -121.9, 'building', null, '']])),
    negativeSize: () => jsonResponse(file([...SITES, ['w9', 37.4, -121.9, 'retail_area', -5, '']])),
    emptyId: () => jsonResponse(file([...SITES, ['', 37.4, -121.9, 'vacant', null, '']])),
    duplicateId: () => jsonResponse(file([...SITES, ['n1', 37.4, -121.9, 'vacant', null, '']])),
    nameNotString: () => jsonResponse(file([...SITES, ['n9', 37.4, -121.9, 'vacant', null, 7]])),
    rowNotArray: () => jsonResponse(file([...SITES, { id: 'n9' }])),
    networkError: () => { throw new TypeError('Failed to fetch'); },
  };
  for (const [name, respond] of Object.entries(bad)) {
    resetSiteCache();
    const stub = stubFetch(async () => respond());
    try {
      assert.deepEqual(await loadSiteCandidates('06001'), { status: 'unavailable', candidates: [], dataset: null }, name);
    } finally {
      stub.restore();
    }
  }
});

test('a failed load does not stick: the next call fetches again', async () => {
  let fail = true;
  const stub = stubFetch(async () => (fail ? new Response('down', { status: 503 }) : jsonResponse(file(SITES))));
  try {
    assert.equal((await loadSiteCandidates('04001')).status, 'unavailable');
    fail = false;
    assert.equal((await loadSiteCandidates('04001')).status, 'ok');
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('every committed county file loads, with a label for every site', async () => {
  const stub = stubFetch(async (url) => {
    const path = `${PUBLIC_DIR}${url}`;
    if (!url.startsWith(`${SITES_BASE}/`) || !existsSync(path)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(path), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    for (const county of BUNDLED_COUNTIES) {
      const raw = JSON.parse(readFileSync(`${PUBLIC_DIR}${SITES_BASE}/${county}.json`, 'utf8'));
      const r = await loadSiteCandidates(county);
      assert.equal(r.status, 'ok', county);
      assert.equal(r.candidates.length, raw.sites.length, county);
      assert.ok(r.candidates.length > 0, county);
      for (const c of r.candidates) {
        assert.ok(typeof c.label === 'string' && c.label.endsWith('(OpenStreetMap)'), `${county} ${c.id}`);
        assert.ok(!/[<>]/.test(c.label), `${county} ${c.id} label not escaped`);
      }
    }
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------ filterCandidatesToTract

const MI_PER_DEG_LAT = 69.0933;

test('filterCandidatesToTract keeps candidates inside the block box grown by T', () => {
  const blocks = [
    { pop: 10, hu: 4, lat: 37.4, lng: -122.0 },
    { pop: 5, hu: 2, lat: 37.41, lng: -121.99 },
    { pop: 0, hu: 0, lat: 38.5, lng: -120.0 }, // unpopulated: doesn't stretch the box
    { pop: 3, hu: 1, lat: Number.NaN, lng: -121.0 }, // no point: ignored
  ];
  const north = (mi) => ({ id: `n${mi}`, lat: 37.41 + mi / MI_PER_DEG_LAT, lng: -121.995, kind: 'vacant' });
  const east = (mi) => ({
    id: `e${mi}`, lat: 37.405, lng: -121.99 + mi / (MI_PER_DEG_LAT * Math.cos((37.41 * Math.PI) / 180)), kind: 'vacant',
  });
  const inside = { id: 'in', lat: 37.405, lng: -121.995, kind: 'vacant' };
  const candidates = [inside, north(0.9), north(1.2), east(0.9), east(1.2), { id: 'far', lat: 38.5, lng: -120.0, kind: 'vacant' }];
  assert.deepEqual(filterCandidatesToTract(candidates, blocks, 1).map((c) => c.id), ['in', 'n0.9', 'e0.9']);
  assert.deepEqual(filterCandidatesToTract(candidates, blocks, 10).map((c) => c.id), ['in', 'n0.9', 'n1.2', 'e0.9', 'e1.2']);
  // A candidate within T of any block is never dropped by the box.
  for (const c of filterCandidatesToTract(candidates, blocks, 1)) {
    assert.ok(Math.min(...blocks.slice(0, 2).map((b) => haversineMiles(b.lat, b.lng, c.lat, c.lng))) < 1.6);
  }
});

test('filterCandidatesToTract returns [] without populated blocks, a limit or candidates', () => {
  const blocks = [{ pop: 10, hu: 4, lat: 37.4, lng: -122.0 }];
  const c = [{ id: 'a', lat: 37.4, lng: -122.0, kind: 'vacant' }];
  assert.deepEqual(filterCandidatesToTract(c, [], 1), []);
  assert.deepEqual(filterCandidatesToTract(c, [{ pop: 0, hu: 0, lat: 37.4, lng: -122 }], 1), []);
  assert.deepEqual(filterCandidatesToTract(c, blocks, Number.NaN), []);
  assert.deepEqual(filterCandidatesToTract(c, blocks, 0), []);
  assert.deepEqual(filterCandidatesToTract(null, blocks, 1), []);
  assert.deepEqual(filterCandidatesToTract(c, null, 1), []);
  assert.deepEqual(filterCandidatesToTract([{ id: 'x', lat: Number.NaN, lng: -122, kind: 'vacant' }], blocks, 1), []);
});

// ------------------------------------------------------------ tractCandidates / candidateFallback

const BLOCKS = [{ pop: 900, hu: 300, lat: 37.4, lng: -122.0, miles: 3 }];

test('tractCandidates: commercial when a loaded file has candidates near the tract', () => {
  const near = { id: 'a', lat: 37.401, lng: -122.001, kind: 'vacant', label: 'Vacant shop (OpenStreetMap)' };
  const far = { id: 'b', lat: 40, lng: -122.0, kind: 'vacant', label: 'Vacant shop (OpenStreetMap)' };
  const r = tractCandidates({ status: 'ok', candidates: [near, far] }, BLOCKS, 1);
  assert.deepEqual(r, { candidates: [near], from: 'commercial', fallback: null, considered: 1 });
});

test('tractCandidates: blocks (with the reason) for other counties, failed files and empty boxes', () => {
  assert.deepEqual(tractCandidates({ status: 'not_bundled', candidates: [] }, BLOCKS, 1), {
    candidates: undefined, from: 'blocks', fallback: 'not_bundled', considered: 0,
  });
  assert.deepEqual(tractCandidates({ status: 'unavailable', candidates: [] }, BLOCKS, 1), {
    candidates: undefined, from: 'blocks', fallback: 'unavailable', considered: 0,
  });
  assert.deepEqual(tractCandidates(null, BLOCKS, 1), {
    candidates: undefined, from: 'blocks', fallback: 'unavailable', considered: 0,
  });
  const far = { id: 'b', lat: 40, lng: -122.0, kind: 'vacant' };
  assert.deepEqual(tractCandidates({ status: 'ok', candidates: [far] }, BLOCKS, 1), {
    candidates: undefined, from: 'blocks', fallback: 'none_in_range', considered: 0,
  });
});

test('candidateFallback names a commercial run that gained nobody', () => {
  const prepared = { from: 'commercial', fallback: null };
  assert.equal(candidateFallback(prepared, { source: 'commercial', picks: [{}] }), null);
  assert.equal(candidateFallback(prepared, { source: 'blocks', picks: [{}] }), 'no_gain_commercial');
  assert.equal(candidateFallback({ from: 'blocks', fallback: 'unavailable' }, { source: 'blocks', picks: [{}] }), 'unavailable');
  assert.equal(candidateFallback({ from: 'blocks', fallback: 'not_bundled' }, null), 'not_bundled');
  assert.equal(candidateFallback(null, null), null);
});

// ------------------------------------------------------------ end to end (committed data)

function boundsOf(points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

// The app's payload for a bundled tract, built offline by the real loaders.
// failSites: the site file request fails (503) while everything else loads.
async function golden(geoid, lat, lng, { failSites = false } = {}) {
  const bundle = JSON.parse(readFileSync(`${PUBLIC_DIR}/data/blocks/${geoid.slice(0, 5)}.json`, 'utf8'));
  const entry = bundle.tracts[geoid.slice(5)];
  const tract = { geoid, state: geoid.slice(0, 2), county: geoid.slice(2, 5), tract: geoid.slice(5), name: entry.name, pop: entry.pop };
  const stub = stubFetch((url) => {
    if (!url.startsWith('/data/')) throw new Error(`unexpected fetch ${url}`);
    if (failSites && url.startsWith(`${SITES_BASE}/`)) return new Response('down', { status: 503 });
    const path = `${PUBLIC_DIR}${url}`;
    if (!existsSync(path)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(path), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const blocks = await loadTractBlocks(tract);
    const stores = await loadStoresNear(boundsOf([...blocks.blocks, { lat, lng }]), STORE_RADIUS_MI);
    const ers = await loadErsTract(geoid);
    const data = assembleCommunityData({ lat, lng, tract: { status: 'ok', tract }, blocks, stores, ers });
    const loaded = await loadSiteCandidates(data.meta.countyFips);
    return { data, loaded, sitesFetched: stub.calls.filter((c) => c.url.startsWith(`${SITES_BASE}/`)).length };
  } finally {
    stub.restore();
  }
}

// What TrackerApp does on "Suggest sites".
function suggestLikeTheApp(data, loaded, pins = []) {
  const { access } = data;
  const prepared = tractCandidates(loaded, access.blocks, access.threshold);
  const result = suggestSites({
    blocks: access.blocks,
    threshold: access.threshold,
    candidates: prepared.candidates,
    existingPins: pins,
    lowIncome: access.lowIncome,
  });
  return { prepared, result, fallback: candidateFallback(prepared, result) };
}

test('golden: Alviso with a failed site file falls back to blocks with the blocks label (never empty)', async () => {
  const { data, loaded } = await golden('06085504602', 37.44966, -121.99401, { failSites: true });
  assert.equal(loaded.status, 'unavailable');
  const { result, fallback } = suggestLikeTheApp(data, loaded);
  assert.equal(fallback, 'unavailable');
  assert.equal(result.source, 'blocks');
  assert.ok(result.picks.length > 0);
  for (const p of result.picks) {
    assert.equal(p.candidate.kind, BLOCK_SITE_KIND);
    assert.equal(siteLabelText(p.candidate), BLOCK_SITE_LABEL);
  }
  assert.equal(result.flippedAt, 1);
});

test('golden: Alviso with commercial candidates: every pick gains residents and the pick replays as a pin', async () => {
  const { data, loaded, sitesFetched } = await golden('06085504602', 37.44966, -121.99401);
  assert.equal(loaded.status, 'ok');
  assert.equal(sitesFetched, 1);
  const { prepared, result } = suggestLikeTheApp(data, loaded);
  assert.equal(prepared.from, 'commercial');
  assert.ok(result.picks.length > 0);
  for (const p of result.picks) assert.ok(p.gain > 0);
  // Whatever the source, the first pick added as a 4-decimal supermarket pin
  // (as TrackerApp adds it) gives the same residents beyond T.
  const first = result.picks[0];
  const pin = { lat: Number(first.candidate.lat.toFixed(4)), lng: Number(first.candidate.lng.toFixed(4)), format: 's' };
  const scenario = evaluatePlacedStoreScenario(data, [pin]);
  assert.equal(scenario.after.beyond, first.beyondAfter);
  // With that pin placed, the suggestions build on it.
  const again = suggestLikeTheApp(data, loaded, [pin]).result;
  if (first.lowAccessAfter === false) assert.equal(again.reason, 'not_low_access');
  else assert.ok(again.picks.every((p) => p.gain > 0));
});

// The pop-weighted center of a bundled tract's blocks, as the clicked point.
function tractCenter(geoid) {
  const bundle = JSON.parse(readFileSync(`${PUBLIC_DIR}/data/blocks/${geoid.slice(0, 5)}.json`, 'utf8'));
  const rows = bundle.tracts[geoid.slice(5)].blocks;
  const pop = rows.reduce((s, r) => s + r[1], 0);
  return [rows.reduce((s, r) => s + r[1] * r[3], 0) / pop, rows.reduce((s, r) => s + r[1] * r[4], 0) / pop];
}

// Add as store / Add all, as TrackerApp places them: 4-decimal supermarket pins.
const asPins = (picks) => picks.map((p) => ({ lat: roundCoord(p.candidate.lat), lng: roundCoord(p.candidate.lng), format: 's' }));

// Tracts where 4-decimal pins used to disagree with the list (2026-10-03
// review): Greenville's golden tract, Fremont 06001443200, and Morgan Hill
// 06085512309 on Census block points.
for (const [geoid, mode] of [['28151000600', 'auto'], ['28151000600', 'blocks'], ['06001443200', 'auto'], ['06085512309', 'blocks'], ['06085504602', 'auto']]) {
  test(`golden: ${geoid} (${mode}): adding picks 1..k as the app does gives pick k's numbers, and an added pick isn't suggested again`, async () => {
    const [lat, lng] = geoid === '28151000600' ? [33.40168, -91.06553] : tractCenter(geoid);
    const { data, loaded } = await golden(geoid, lat, lng);
    assert.equal(data.access.lowAccess, true);
    const run = (pins) => (mode === 'blocks'
      ? suggestSites({ blocks: data.access.blocks, threshold: data.access.threshold, existingPins: pins, lowIncome: data.access.lowIncome })
      : suggestLikeTheApp(data, loaded, pins).result);
    const result = run([]);
    assert.ok(result.picks.length > 0);
    result.picks.forEach((p, k) => {
      const scenario = evaluatePlacedStoreScenario(data, asPins(result.picks.slice(0, k + 1)));
      assert.equal(scenario.after.beyond, p.beyondAfter, `pick ${k + 1}`);
      assert.equal(scenario.after.share, p.shareAfter, `pick ${k + 1}`);
      assert.equal(scenario.after.lowAccess, p.lowAccessAfter, `pick ${k + 1}`);
      if (result.flippedAt === k + 1) assert.equal(scenario.flipped, true);
    });
    const again = run(asPins(result.picks.slice(0, 1)));
    assert.ok(!again.picks.some((q) => q.candidate.id === result.picks[0].candidate.id), 'pick 1 suggested again after adding it');
    if (result.picks.length > 1) assert.equal(again.picks[0]?.candidate.id, result.picks[1].candidate.id);
  });
}

test('golden: Cupertino is not low access, so nothing is suggested', async () => {
  const { data, loaded } = await golden('06085508101', 37.3229, -122.0323);
  assert.equal(data.access.lowAccess, false);
  const { result } = suggestLikeTheApp(data, loaded);
  assert.equal(result.reason, 'not_low_access');
  assert.deepEqual(result.picks, []);
});
