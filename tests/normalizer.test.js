import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  COMMUNITY_CACHE_PREFIX,
  assembleCommunityData,
  buildCommunityData,
  resetCommunityCache,
} from '../src/pipeline/normalizer.js';
import { evaluatePlacedStoreScenario } from '../src/engine/scenarioEngine.js';
import { haversineMiles } from '../src/lib/geo.js';
import { TIGER_BASE } from '../src/pipeline/tractLookup.js';
import { resetBlockCache } from '../src/pipeline/blockLoader.js';
import { resetStoreCache } from '../src/pipeline/storeLoader.js';
import { resetErsCache } from '../src/pipeline/ersLoader.js';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

// Synthetic fixtures unless a test says otherwise: an urban tract of 20
// blocks x 100 residents on a 5 x 4 grid (0.004 deg steps, about 0.28 mi)
// around C, with the only counted store about 2 mi due north, so every
// resident lives beyond 1 mile.

const C = { lat: 37.42, lng: -121.97 };
const GEOID = '06085504602';
const MI_LAT = 1 / 69; // degrees of latitude per mile, close enough here

function gridBlocks({ lat0 = C.lat, lng0 = C.lng, rows = 5, cols = 4, step = 0.004, pop = 100, hu = 40, ur = 'U' } = {}) {
  const blocks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      blocks.push({
        id: `${GEOID}${String(1000 + i)}`,
        pop: typeof pop === 'function' ? pop(i) : pop,
        hu,
        lat: Number((lat0 + (r - (rows - 1) / 2) * step).toFixed(5)),
        lng: Number((lng0 + (c - (cols - 1) / 2) * step).toFixed(5)),
        ur: typeof ur === 'function' ? ur(i) : ur,
        place: '0668000',
      });
    }
  }
  return blocks;
}

const FAR_STORE = { lat: Number((C.lat + 2 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Far Mart' };
const NEAR_STORE = { lat: C.lat + 0.001, lng: C.lng + 0.001, type: 'S', name: 'Near Super' };
const DATASET = {
  name: 'USDA SNAP-authorized supermarkets and super stores',
  date: '2026-09-17T13:33:58.255Z',
  retrievedAt: '2026-10-03T05:51:00.770Z',
};

const sum = (blocks) => blocks.reduce((s, b) => s + b.pop, 0);

function tractOk(pop = 2000, extra = {}) {
  return {
    status: 'ok',
    tract: {
      geoid: GEOID,
      state: '06',
      county: '085',
      tract: '504602',
      name: 'Census Tract 5046.02',
      basename: '5046.02',
      pop,
      hu: 800,
      intptLat: C.lat,
      intptLng: C.lng,
      ...extra,
    },
  };
}
const blocksOk = (blocks) => ({ status: 'ok', blocks, population: sum(blocks), source: 'bundled' });
const storesOk = (stores) => ({ status: 'ok', stores, dataset: DATASET });
const E2025 = {
  urban: true,
  lowIncome: true,
  pop2020: 2000,
  sramLA: false,
  sramLILA: false,
  tractHUNV: 120,
  ohu2020: 700,
  povertyRate: 25.1,
  medianFamilyIncome: 50000,
  groupQuarters: false,
};
const E2019 = { lila: true, la: true, lapop1share: 60.79, lapop10share: null, urban: true };
function ersOk(e2025 = {}, e2019 = E2019) {
  return {
    status: 'ok',
    e2025: { ...E2025, ...e2025 },
    e2019,
    e2019Reason: e2019 ? null : 'boundary_changed',
    retrievedAt: '2026-10-03T05:40:00.000Z',
  };
}
const ERS_MISSING = { status: 'missing_row', e2025: null, e2019: null, e2019Reason: null, retrievedAt: null };
const ERS_DOWN = { status: 'unavailable', e2025: null, e2019: null, e2019Reason: null, retrievedAt: null };
const PLACE = { status: 'ok', place: { geoid: '0668000', name: 'San Jose city', basename: 'San Jose', pop: 1013240, kind: 'incorporated' } };

function assemble(overrides = {}) {
  const blocks = overrides.blockList ?? gridBlocks();
  return assembleCommunityData({
    lat: C.lat,
    lng: C.lng,
    tract: tractOk(sum(blocks)),
    blocks: blocksOk(blocks),
    stores: storesOk([FAR_STORE]),
    ers: ersOk(),
    place: PLACE,
    health: { diabetes: 12 },
    demographics: { population: 2000 },
    retrievedAt: '2026-10-02T12:00:00.000Z',
    ...overrides,
  });
}

// ------------------------------------------------------------ assembly

test('MET: a low-income tract where every resident is beyond 1 mile', () => {
  const data = assemble();
  const { access, meta } = data;
  assert.equal(access.status, 'met');
  assert.deepEqual(access.verdict, { status: 'met', qualifier: 'li_la', reason: null });
  assert.equal(access.reason, null);
  assert.equal(access.threshold, 1);
  assert.equal(access.urban, true);
  assert.equal(access.urbanSource, 'ers_2025');
  assert.equal(access.population, 2000);
  assert.equal(access.beyond, 2000);
  assert.equal(access.share, 1);
  assert.equal(access.byShare, true);
  assert.equal(access.byCount, true);
  assert.equal(access.lowAccess, true);
  assert.equal(access.lowIncome, true);
  assert.equal(access.borderline, false);
  assert.equal(access.bands.reduce((s, b) => s + b.residents, 0), 2000);
  assert.deepEqual(access.storesDataset, DATASET);

  assert.equal(meta.fips, GEOID);
  assert.equal(meta.stateAbbr, 'CA');
  assert.equal(meta.stateFips, '06');
  assert.equal(meta.countyFips, '06085');
  assert.equal(meta.tractName, 'Census Tract 5046.02');
  assert.equal(meta.lat, C.lat);
  assert.equal(meta.lng, C.lng);
  assert.deepEqual(meta.place, { geoid: '0668000', name: 'San Jose city', kind: 'incorporated' });
  assert.equal(meta.retrievedAt, '2026-10-02T12:00:00.000Z');

  assert.deepEqual(data.health, { diabetes: 12 });
  assert.deepEqual(data.demographics, { population: 2000 });
  assert.equal(data.ers.status, 'ok');
  assert.equal(data.ers.e2025.tractHUNV, 120);
});

test('blocks are kept compact, with each block\'s baseline miles for the scenario', () => {
  const { access } = assemble();
  assert.equal(access.blocks.length, 20);
  for (const b of access.blocks) {
    assert.deepEqual(Object.keys(b).sort(), ['hu', 'lat', 'lng', 'miles', 'pop']);
    assert.ok(Math.abs(b.miles - haversineMiles(b.lat, b.lng, FAR_STORE.lat, FAR_STORE.lng)) < 1e-12);
  }
  assert.equal('distances' in access, false);
});

test('the payload survives a JSON round trip (localStorage) with no store in range', () => {
  const data = assemble({ stores: storesOk([]) });
  assert.equal(data.access.lowAccess, true);
  assert.equal(data.access.beyond, 2000);
  const copy = JSON.parse(JSON.stringify(data));
  assert.ok(copy.access.blocks.every((b) => b.miles === null));
  assert.deepEqual(copy.access.point, { miles: null, store: null, reason: 'over_30_mi' });
});

test('point: nearest counted store to the exact spot, no verdict attached', () => {
  const { access } = assemble({ stores: storesOk([FAR_STORE, { lat: 37.6, lng: -121.97, type: 'S', name: 'Farther' }]) });
  assert.equal(access.point.store.name, 'Far Mart');
  assert.ok(Math.abs(access.point.miles - haversineMiles(C.lat, C.lng, FAR_STORE.lat, FAR_STORE.lng)) < 1e-12);
  assert.equal(access.point.reason, null);
});

test('point: a nearest store past 30 miles is reported as over_30_mi', () => {
  const at31 = { lat: Number((C.lat + 31 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Thirty-one' };
  const { access } = assemble({ stores: storesOk([at31]) });
  assert.deepEqual(access.point, { miles: null, store: null, reason: 'over_30_mi' });
  assert.equal(access.beyond, 2000);
});

test('NOT MET: low access but not low income', () => {
  const { access } = assemble({ ers: ersOk({ lowIncome: false }) });
  assert.equal(access.status, 'not_met');
  assert.equal(access.verdict.qualifier, 'la_not_li');
  assert.equal(access.lowAccess, true);
});

test('NOT MET: low income but a supermarket in the middle of the tract', () => {
  const { access } = assemble({ stores: storesOk([FAR_STORE, NEAR_STORE]) });
  assert.equal(access.status, 'not_met');
  assert.equal(access.verdict.qualifier, 'li_not_la');
  assert.equal(access.beyond, 0);
  assert.equal(access.lowAccess, false);
});

test('no ERS row: NOT MET when not low access, Unknown (income_unavailable) when low access', () => {
  const served = assemble({ ers: ERS_MISSING, stores: storesOk([NEAR_STORE]) }).access;
  assert.equal(served.status, 'not_met');
  assert.equal(served.verdict.qualifier, 'not_la_income_unknown');
  assert.equal(served.lowIncome, null);
  assert.equal(served.reason, 'income_unavailable');

  const far = assemble({ ers: ERS_MISSING }).access;
  assert.equal(far.status, 'unknown');
  assert.deepEqual(far.verdict, { status: 'unknown', qualifier: 'la_income_unknown', reason: 'income_unavailable' });
  assert.equal(far.reason, 'income_unavailable');
});

test('Unknown reasons: no_tract returns null', () => {
  assert.equal(assembleCommunityData({ lat: 0, lng: -150, tract: { status: 'no_tract' } }), null);
});

test('Unknown reasons: tract_unavailable', () => {
  const data = assembleCommunityData({ lat: C.lat, lng: C.lng, tract: { status: 'unavailable' } });
  assert.equal(data.access.status, 'unknown');
  assert.equal(data.access.reason, 'tract_unavailable');
  assert.equal(data.access.verdict.reason, 'tract_unavailable');
  assert.equal(data.access.lowAccess, null);
  assert.equal(data.access.lowIncome, null);
  assert.deepEqual(data.access.blocks, []);
  assert.deepEqual(data.access.stores, []);
  assert.equal(data.access.point.miles, null);
  assert.equal(data.access.point.reason, 'tract_unavailable');
  assert.equal(data.meta.fips, null);
  assert.equal(data.meta.lat, C.lat);
});

test('Unknown reasons: no_residents, even when ERS has an income flag', () => {
  for (const ers of [ERS_MISSING, ersOk({ lowIncome: false, pop2020: 0 })]) {
    const data = assembleCommunityData({
      lat: C.lat,
      lng: C.lng,
      tract: tractOk(0),
      blocks: { status: 'no_residents', blocks: [], population: 0, source: null },
      stores: storesOk([FAR_STORE]),
      ers,
    });
    assert.equal(data.access.status, 'unknown');
    assert.equal(data.access.reason, 'no_residents');
    assert.equal(data.access.verdict.reason, 'no_residents');
    assert.equal(data.access.population, 0);
    assert.equal(data.access.lowAccess, null);
    // The spot itself still gets its nearest store.
    assert.equal(data.access.point.store.name, 'Far Mart');
  }
});

test('Unknown reasons: blocks_unavailable and blocks_incomplete', () => {
  for (const status of ['blocks_unavailable', 'blocks_incomplete']) {
    const data = assemble({ blocks: { status, blocks: [], population: null, source: 'tigerweb' } });
    assert.equal(data.access.status, 'unknown', status);
    assert.equal(data.access.reason, status);
    assert.equal(data.access.verdict.reason, status);
    assert.equal(data.access.beyond, null);
    assert.equal(data.access.share, null);
    assert.equal(data.access.lowAccess, null);
    assert.equal(data.access.population, 2000); // the tract's own POP100
    assert.deepEqual(data.access.blocks, []);
  }
});

test('Unknown reasons: stores_unavailable (never treated as zero stores)', () => {
  const down = { status: 'stores_unavailable', stores: [], dataset: null };
  const data = assemble({ stores: down });
  assert.equal(data.access.status, 'unknown');
  assert.equal(data.access.reason, 'stores_unavailable');
  assert.equal(data.access.verdict.reason, 'stores_unavailable');
  assert.equal(data.access.beyond, null);
  assert.equal(data.access.lowAccess, null);
  assert.deepEqual(data.access.point, { miles: null, store: null, reason: 'stores_unavailable' });
  assert.ok(data.access.blocks.every((b) => !('miles' in b)));

  // Not low income decides NOT MET on its own; the access reason stays named.
  const notLi = assemble({ stores: down, ers: ersOk({ lowIncome: false }) }).access;
  assert.equal(notLi.status, 'not_met');
  assert.equal(notLi.verdict.qualifier, 'not_li_access_unknown');
  assert.equal(notLi.reason, 'stores_unavailable');
});

test('urban/rural falls back to the population majority of block UR when ERS has no row', () => {
  // 12 blocks rural (1,200 residents) vs 8 urban (800): rural, T = 10 mi.
  const blockList = gridBlocks({ ur: (i) => (i < 12 ? 'R' : 'U') });
  const rural = assemble({ blockList, ers: ERS_MISSING }).access;
  assert.equal(rural.urban, false);
  assert.equal(rural.urbanSource, 'block_ur');
  assert.equal(rural.threshold, 10);
  assert.equal(rural.beyond, 0);
  assert.equal(rural.lowAccess, false);

  // Weighted by residents, not by block count: 12 small rural blocks lose.
  const weighted = gridBlocks({ ur: (i) => (i < 12 ? 'R' : 'U'), pop: (i) => (i < 12 ? 10 : 200) });
  const urban = assemble({ blockList: weighted, ers: ERS_MISSING }).access;
  assert.equal(urban.urban, true);
  assert.equal(urban.urbanSource, 'block_ur');
  assert.equal(urban.threshold, 1);

  // An ERS row without an Urban value, or an ERS outage, falls back too.
  assert.equal(assemble({ blockList, ers: ersOk({ urban: null }) }).access.urbanSource, 'block_ur');
  assert.equal(assemble({ blockList, ers: ERS_DOWN }).access.urbanSource, 'block_ur');
  // When ERS has the flag it wins over the blocks.
  const ers = assemble({ blockList: gridBlocks({ ur: 'U' }), ers: ersOk({ urban: false }) }).access;
  assert.equal(ers.urban, false);
  assert.equal(ers.urbanSource, 'ers_2025');
  assert.equal(ers.threshold, 10);
});

test('rural tracts keep exact baseline distances even though the map list stops at 5 miles', () => {
  const store8 = { lat: Number((C.lat + 8 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Eight Mile Market' };
  const data = assemble({ stores: storesOk([store8]), ers: ersOk({ urban: false }) });
  assert.equal(data.access.threshold, 10);
  assert.equal(data.access.beyond, 0);
  assert.equal(data.access.lowAccess, false);
  assert.deepEqual(data.access.stores, []);
  assert.ok(data.access.blocks.every((b) => b.miles > 7 && b.miles < 9));
});

test('access.stores keeps stores within the block bbox + 5 miles for the map', () => {
  const at3 = { lat: Number((C.lat - 3 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Three' };
  const at12 = { lat: Number((C.lat - 12 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Twelve' };
  const { access } = assemble({ stores: storesOk([FAR_STORE, at3, at12]) });
  assert.deepEqual(access.stores.map((s) => s.name).sort(), ['Far Mart', 'Three']);
});

test('references: LRAM 2019 share uses lapop1share for urban tracts (as a fraction)', () => {
  const { references } = assemble().access;
  assert.deepEqual(references.lram2019, { lila: true, la: true, share: 0.6079, reason: null });
  assert.deepEqual(references.sram2025, { lila: false, la: false, reason: null });
  assert.equal(references.differNote, 'access differs: SRAM counts convenience and dollar stores');
});

test('references: LRAM 2019 share uses lapop10share for a 2019-rural tract; null stays null', () => {
  const rural19 = { lila: true, la: true, lapop1share: 99.14, lapop10share: 42.57, urban: false };
  assert.equal(assemble({ ers: ersOk({}, rural19) }).access.references.lram2019.share, 0.4257);
  const notPublished = { lila: false, la: false, lapop1share: null, lapop10share: null, urban: true };
  assert.equal(assemble({ ers: ersOk({}, notPublished) }).access.references.lram2019.share, null);
});

test('references: a 2020 tract without a same-GEOID 2010 tract says boundary_changed', () => {
  const { references } = assemble({ ers: ersOk({}, null) }).access;
  assert.deepEqual(references.lram2019, { lila: null, la: null, share: null, reason: 'boundary_changed' });
});

test('references: missing or unavailable ERS rows are named, not guessed', () => {
  const missing = assemble({ ers: ERS_MISSING }).access.references;
  assert.equal(missing.lram2019.reason, 'missing_row');
  assert.deepEqual(missing.sram2025, { lila: null, la: null, reason: 'missing_row' });
  assert.equal(missing.differNote, null);
  const down = assemble({ ers: ERS_DOWN }).access.references;
  assert.equal(down.lram2019.reason, 'unavailable');
  assert.equal(down.sram2025.reason, 'unavailable');
});

test('references: differNote names a differing income flag', () => {
  // This estimate: low access, not low income (2025) -> NOT MET; 2019 said
  // low income and low access.
  const { references } = assemble({ ers: ersOk({ lowIncome: false }) }).access;
  assert.equal(references.differNote, 'income flag differs: 2019 yes, 2025 no');
});

test('references: differNote is null when both maps agree with the estimate', () => {
  const agree = assemble({ ers: ersOk({ sramLA: true, sramLILA: true }) }).access.references;
  assert.equal(agree.differNote, null);
});

test('references: differNote names a 2019 access difference', () => {
  const la19no = { lila: false, la: false, lapop1share: null, lapop10share: null, urban: true };
  const { references } = assemble({ ers: ersOk({ sramLA: true, sramLILA: true }, la19no) }).access;
  assert.match(references.differNote, /^access differs: the 2019 map/);
});

test('the same tract gives the same verdict from any point in it', () => {
  const a = assemble();
  const b = assemble({ lat: C.lat + 0.006, lng: C.lng - 0.005 });
  for (const key of ['status', 'reason', 'threshold', 'population', 'beyond', 'share', 'lowAccess', 'lowIncome']) {
    assert.deepEqual(b.access[key], a.access[key], key);
  }
  assert.deepEqual(b.access.verdict, a.access.verdict);
  assert.notEqual(b.access.point.miles, a.access.point.miles);
});

// -------------------------------------------- buildCommunityData (stubbed)

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function withStorage(fn) {
  return async (t) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    resetCommunityCache();
    resetBlockCache();
    resetStoreCache();
    resetErsCache();
    try {
      await fn(t, storage);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  };
}

const tigerLayer = (url) => {
  const m = url.match(/MapServer\/(\d+)\/query/);
  return m ? Number(m[1]) : null;
};
const features = (attrs) => ({ features: attrs.map((attributes) => ({ attributes })) });

const F2025 = ['Urban', 'LowIncomeTracts', 'POP2020', 'SD_SRAM_LA1and10', 'SD_SRAM_LILATracts_1And10',
  'TractHUNV', 'OHU2020', 'PovertyRate', 'MedianFamilyIncome', 'GroupQuartersFlag'];
const F2019 = ['LILATracts_1And10', 'LA1and10', 'lapop1share', 'lapop10share', 'Urban'];

// A small fake of every upstream the pipeline touches. `fail` names the
// pieces that should error: tract, place, blocks, manifest, tile, ers, cdc, acs.
function fakeWorld({ fail = new Set(), noTract = false, lowIncome = 1 } = {}) {
  const blocks = gridBlocks();
  const bundle = {
    retrievedAt: '2026-10-03T05:47:33.229Z',
    tracts: {
      504602: {
        pop: sum(blocks),
        name: 'Census Tract 5046.02',
        blocks: blocks.map((b) => [b.id.slice(11), b.pop, b.hu, b.lat, b.lng, b.ur, b.place]),
      },
    },
    places: { '0668000': { name: 'San Jose city', pop: 1013240 } },
  };
  const tile = [[FAR_STORE.lat, FAR_STORE.lng, 'M', 'Far Mart'], [37.3, -121.8, 'S', 'Other Super']];
  const manifest = { dataLastEditDate: DATASET.date, retrievedAt: DATASET.retrievedAt, tileDeg: 2, tiles: { '36_-122': tile.length } };
  const ers = {
    retrievedAt: '2026-10-03T05:40:00.000Z',
    f2025: F2025,
    t2025: { [GEOID]: [1, lowIncome, 2000, 0, 0, 120, 700, 25.1, 50000, 0] },
    f2019: F2019,
    t2019: { [GEOID]: [1, 1, 60.79, null, 1] },
  };
  const attrs = noTract ? null : {
    GEOID,
    STATE: '06',
    COUNTY: '085',
    TRACT: '504602',
    NAME: 'Census Tract 5046.02',
    BASENAME: '5046.02',
    POP100: sum(blocks),
    HU100: 800,
    INTPTLAT: '+37.4200000',
    INTPTLON: '-121.9700000',
  };
  const err = () => new Response('upstream error', { status: 500 });
  return (url) => {
    if (url.startsWith(TIGER_BASE)) {
      const layer = tigerLayer(url);
      if (layer === 6) return fail.has('tract') ? err() : jsonResponse(features(attrs ? [attrs] : []));
      if (layer === 26) {
        return fail.has('place') ? err() : jsonResponse(features([{ GEOID: '0668000', NAME: 'San Jose city', BASENAME: 'San Jose', POP100: 1013240 }]));
      }
      if (layer === 28) return fail.has('place') ? err() : jsonResponse(features([]));
    }
    if (url === '/data/blocks/06085.json') return fail.has('blocks') ? err() : jsonResponse(bundle);
    if (url === '/data/stores/manifest.json') return fail.has('manifest') ? err() : jsonResponse(manifest);
    if (url === '/data/stores/36_-122.json') return fail.has('tile') ? err() : jsonResponse(tile);
    if (url === '/data/ers/06085.json') return fail.has('ers') ? err() : jsonResponse(ers);
    if (url.startsWith('/api/cdc/')) {
      if (fail.has('cdc')) throw new TypeError('fetch failed');
      return jsonResponse([{ measureid: 'DIABETES', datavaluetypeid: 'CrdPrv', data_value: '11.5' }]);
    }
    if (url.startsWith('/api/acs?')) {
      if (fail.has('acs')) throw new TypeError('fetch failed');
      return jsonResponse({ population: 2000, medianIncome: 61000, pctPoverty: 21, noVehicleHouseholds: 110, stateMedianFamilyIncome: 100000 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

const cacheKeys = (storage) => [...storage.map.keys()].filter((k) => k.startsWith(COMMUNITY_CACHE_PREFIX));

test('buildCommunityData runs the full pipeline and caches a complete payload', withStorage(async (t, storage) => {
  assert.equal(COMMUNITY_CACHE_PREFIX, 'fds:community:v3:');
  const stub = stubFetch(fakeWorld());
  try {
    const data = await buildCommunityData(C.lat, C.lng);
    assert.equal(data.access.status, 'met');
    assert.equal(data.access.beyond, 2000);
    assert.equal(data.access.blocksSource, 'bundled');
    assert.equal(data.meta.fips, GEOID);
    assert.equal(data.meta.stateAbbr, 'CA');
    assert.deepEqual(data.meta.place, { geoid: '0668000', name: 'San Jose city', kind: 'incorporated' });
    assert.equal(data.meta.cache.status, 'fresh');
    assert.equal(data.health.diabetes, 11.5);
    assert.equal(data.demographics.population, 2000);
    assert.equal(data.access.storesDataset.date, DATASET.date);
    // The ERS shard and the block bundle are fetched once each.
    assert.equal(stub.calls.filter((c) => c.url === '/data/ers/06085.json').length, 1);
    assert.equal(cacheKeys(storage).length, 1);

    const before = stub.calls.length;
    const again = await buildCommunityData(C.lat, C.lng);
    assert.equal(stub.calls.length, before, 'memory hit makes no requests');
    assert.equal(again.meta.cache.status, 'memory');
    assert.equal(again.access.beyond, 2000);

    resetCommunityCache();
    const local = await buildCommunityData(C.lat, C.lng);
    assert.equal(stub.calls.length, before, 'localStorage hit makes no requests');
    assert.equal(local.meta.cache.status, 'local');
    // Infinity/Float64Array would not survive JSON; the scenario still works.
    const scenario = evaluatePlacedStoreScenario(local, [{ lat: C.lat, lng: C.lng, format: 's' }]);
    assert.equal(scenario.before.beyond, 2000);
    assert.equal(scenario.after.beyond, 0);
    assert.equal(scenario.flipped, true);

    const fresh = await buildCommunityData(C.lat, C.lng, { forceRefresh: true });
    assert.equal(fresh.meta.cache.status, 'fresh');
    assert.ok(stub.calls.length > before);
  } finally {
    stub.restore();
  }
}));

test('buildCommunityData returns null outside any tract and caches nothing', withStorage(async (t, storage) => {
  const stub = stubFetch(fakeWorld({ noTract: true }));
  try {
    assert.equal(await buildCommunityData(10, -150), null);
    assert.equal(cacheKeys(storage).length, 0);
    assert.ok(stub.calls.every((c) => tigerLayer(c.url) === 6));
  } finally {
    stub.restore();
  }
}));

for (const [piece, reason] of [
  ['tract', 'tract_unavailable'],
  ['blocks', 'blocks_unavailable'],
  ['manifest', 'stores_unavailable'],
  ['tile', 'stores_unavailable'],
]) {
  test(`never caches a payload that is Unknown because a fetch failed (${piece} -> ${reason})`, withStorage(async (t, storage) => {
    const fail = new Set([piece]);
    const stub = stubFetch((url, init) => fakeWorld({ fail })(url, init));
    try {
      const data = await buildCommunityData(C.lat, C.lng);
      assert.equal(data.access.status, 'unknown');
      assert.equal(data.access.reason, reason);
      assert.equal(data.meta.cache.status, 'fresh');
      assert.equal(cacheKeys(storage).length, 0);

      // The next call goes back to the network and, once it recovers, caches.
      const n = stub.calls.length;
      fail.clear();
      const recovered = await buildCommunityData(C.lat, C.lng);
      assert.ok(stub.calls.length > n);
      assert.equal(recovered.access.status, 'met');
      assert.equal(recovered.meta.cache.status, 'fresh');
      assert.equal(cacheKeys(storage).length, 1);
    } finally {
      stub.restore();
    }
  }));
}

test('an ERS or place outage is not cached either (both would stick for 15 minutes)', withStorage(async (t, storage) => {
  for (const piece of ['ers', 'place']) {
    resetCommunityCache();
    const stub = stubFetch(fakeWorld({ fail: new Set([piece]) }));
    try {
      const data = await buildCommunityData(C.lat, C.lng);
      assert.ok(data, piece);
      assert.equal(cacheKeys(storage).length, 0, piece);
    } finally {
      stub.restore();
    }
  }
}));

test('CDC and ACS failures do not affect the access test', withStorage(async () => {
  const stub = stubFetch(fakeWorld({ fail: new Set(['cdc', 'acs']) }));
  try {
    const data = await buildCommunityData(C.lat, C.lng);
    assert.equal(data.access.status, 'met');
    assert.equal(data.demographics.population, 0);
    assert.equal(data.health.diabetes, 0);
  } finally {
    stub.restore();
  }
}));

test('a hand-off to stores waits for blocks: the tile request covers the tract, not the globe', withStorage(async () => {
  const stub = stubFetch(fakeWorld());
  try {
    await buildCommunityData(C.lat, C.lng);
    const tiles = stub.calls.map((c) => c.url).filter((u) => u.startsWith('/data/stores/') && !u.endsWith('manifest.json'));
    assert.deepEqual(tiles, ['/data/stores/36_-122.json']);
  } finally {
    stub.restore();
  }
}));

// ---------------------------------------- golden tracts (committed data)

// Offline: /data/* is served from the committed public/data snapshot, and
// TIGERweb's tract answer is stubbed with the tract's POP100 and NAME from the
// committed block bundle. Internal points are TIGERweb INTPTLAT/INTPTLON
// (2020) as read on 2026-10-02.
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function goldenWorld(geoid) {
  const county = geoid.slice(0, 5);
  const bundle = JSON.parse(readFileSync(`${PUBLIC_DIR}/data/blocks/${county}.json`, 'utf8'));
  const entry = bundle.tracts[geoid.slice(5)];
  const attrs = {
    GEOID: geoid,
    STATE: geoid.slice(0, 2),
    COUNTY: geoid.slice(2, 5),
    TRACT: geoid.slice(5),
    NAME: entry.name,
    BASENAME: entry.name.replace('Census Tract ', ''),
    POP100: entry.pop,
    HU100: null,
    INTPTLAT: null,
    INTPTLON: null,
  };
  return (url) => {
    if (url.startsWith(TIGER_BASE)) {
      return jsonResponse(features(tigerLayer(url) === 6 ? [attrs] : []));
    }
    if (url.startsWith('/data/')) {
      const file = `${PUBLIC_DIR}${url}`;
      if (!existsSync(file)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(file), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/api/cdc/')) return jsonResponse([]);
    if (url.startsWith('/api/acs?')) return jsonResponse({});
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function golden(geoid, lat, lng) {
  const stub = stubFetch(goldenWorld(geoid));
  try {
    return await buildCommunityData(lat, lng, { forceRefresh: true });
  } finally {
    stub.restore();
  }
}

test('golden: Alviso 06085504602 meets the test; the village pin flips it', withStorage(async () => {
  const data = await golden('06085504602', 37.44966, -121.99401);
  assert.equal(data.meta.fips, '06085504602');
  assert.equal(data.access.threshold, 1);
  assert.equal(data.access.urbanSource, 'ers_2025');
  assert.equal(data.access.lowIncome, true);
  assert.equal(data.access.lowAccess, true);
  assert.equal(data.access.status, 'met');
  const scenario = evaluatePlacedStoreScenario(data, [{ lat: 37.42105, lng: -121.9727, format: 's' }]);
  assert.equal(scenario.flipped, true);
  assert.equal(scenario.after.verdict.status, 'not_met');
  // The same spot as a small grocer changes nothing.
  const grocer = evaluatePlacedStoreScenario(data, [{ lat: 37.42105, lng: -121.9727, format: 'g' }]);
  assert.equal(grocer.flipped, false);
  assert.equal(grocer.after.beyond, data.access.beyond);
}));

test('golden: Greenville MS 28151000600 flips with one pin at its internal point', withStorage(async () => {
  const data = await golden('28151000600', 33.40168, -91.06553);
  assert.equal(data.access.status, 'met');
  const scenario = evaluatePlacedStoreScenario(data, [{ lat: 33.40168, lng: -91.06553, format: 's' }]);
  assert.equal(scenario.flipped, true);
}));

test('golden: Los Altos Hills 06085511704 is NOT MET (not low income)', withStorage(async () => {
  const data = await golden('06085511704', 37.37, -122.14);
  assert.equal(data.access.lowIncome, false);
  assert.equal(data.access.status, 'not_met');
}));

test('golden: Cupertino 06085508101 is not low access', withStorage(async () => {
  const data = await golden('06085508101', 37.3229, -122.0323);
  assert.equal(data.access.lowAccess, false);
  assert.equal(data.access.status, 'not_met');
}));

test('golden: Chinle AZ 04001944202 is rural and low access by count only', withStorage(async () => {
  const data = await golden('04001944202', 36.17013, -109.48008);
  assert.equal(data.access.urban, false);
  assert.equal(data.access.threshold, 10);
  assert.equal(data.access.lowAccess, true);
  assert.equal(data.access.byCount, true);
  assert.equal(data.access.byShare, false);
}));
