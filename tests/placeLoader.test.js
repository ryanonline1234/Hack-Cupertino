import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assemblePlaceSummary,
  fetchPlaceBlocks,
  fetchTracts,
  loadPlaceSummary,
  resetPlaceCache,
} from '../src/pipeline/placeLoader.js';
import { TIGER_BASE } from '../src/pipeline/tractLookup.js';
import { resetBlockCache } from '../src/pipeline/blockLoader.js';
import { resetErsCache } from '../src/pipeline/ersLoader.js';
import { resetStoreCache } from '../src/pipeline/storeLoader.js';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

// Synthetic fixture (not real Census values) unless a test says otherwise.
// One counted store at S. Three tracts touch "Testville" (place 0699999):
//   A 06085000100, wholly inside, urban: 300 residents at S, 200 two miles
//     north -> 40% beyond 1 mi, low income -> MEETS.
//   B 06085000200, on the city line, urban: 100 residents inside the city
//     half a mile east of S, 600 outside three miles west -> low access on
//     ALL its blocks (600 >= 500), not low income -> DOES NOT MEET.
//   C 06085000300, wholly inside, rural: 50 residents five miles east ->
//     within 10 mi, low income -> DOES NOT MEET.
// In-city: 500 + 100 + 50 = 650 = the place's POP100.

const S = { lat: 37.3, lng: -121.9 };
const MI_LAT = 1 / 69;
const MI_LNG = 1 / (69 * Math.cos((37.3 * Math.PI) / 180));
const PLACE = { geoid: '0699999', name: 'Testville city', kind: 'incorporated' };
const STORE = { lat: S.lat, lng: S.lng, type: 'M', name: 'Only Market' };
const DATASET = { name: 'USDA SNAP-authorized supermarkets and super stores', date: '2026-09-17T13:33:58.255Z', retrievedAt: null };
const STORES_OK = { status: 'ok', stores: [STORE], dataset: DATASET };

const A1 = { id: '060850001001000', pop: 300, hu: 100, lat: S.lat, lng: S.lng, ur: 'U' };
const A2 = { id: '060850001001001', pop: 200, hu: 80, lat: S.lat + 2 * MI_LAT, lng: S.lng, ur: 'U' };
const B1 = { id: '060850002001000', pop: 100, hu: 40, lat: S.lat, lng: S.lng + 0.5 * MI_LNG, ur: 'U' };
const B2 = { id: '060850002001001', pop: 600, hu: 200, lat: S.lat, lng: S.lng - 3 * MI_LNG, ur: 'U' };
const C1 = { id: '060850003001000', pop: 50, hu: 20, lat: S.lat, lng: S.lng + 5 * MI_LNG, ur: 'R' };

// Square around A, B1 and C1 (B2 lies west of it).
const RINGS = [[[-121.92, 37.2], [-121.8, 37.2], [-121.8, 37.4], [-121.92, 37.4], [-121.92, 37.2]]];

const ers = ({ urban, lowIncome, sramLILA = false, lila = null, missing2019 = false }) => ({
  status: 'ok',
  e2025: { urban, lowIncome, sramLILA, sramLA: sramLILA, pop2020: 0 },
  e2019: missing2019 ? null : { lila, la: lila, lapop1share: null, lapop10share: null, urban },
  e2019Reason: missing2019 ? 'boundary_changed' : null,
  retrievedAt: null,
});
const ERS = {
  '06085000100': ers({ urban: true, lowIncome: true, lila: true }),
  '06085000200': ers({ urban: true, lowIncome: false, sramLILA: true, missing2019: true }),
  '06085000300': ers({ urban: false, lowIncome: true, lila: false }),
};
const TRACT_META = {
  '06085000100': { geoid: '06085000100', name: 'Census Tract 1', basename: '1', pop: 500, intptLat: A1.lat, intptLng: A1.lng },
  '06085000200': { geoid: '06085000200', name: 'Census Tract 2', basename: '2', pop: 700, intptLat: B1.lat, intptLng: B1.lng },
  '06085000300': { geoid: '06085000300', name: 'Census Tract 3', basename: '3', pop: 50, intptLat: C1.lat, intptLng: C1.lng },
};
const TRACT_BLOCKS = { '06085000100': [A1, A2], '06085000200': [B1, B2], '06085000300': [C1] };

function fixtureInput(overrides = {}) {
  return {
    place: PLACE,
    placePop: 650,
    placeName: 'Testville city',
    source: 'tigerweb',
    cityBlocks: [A1, A2, B1, C1],
    tracts: Object.keys(TRACT_META).map((g) => ({ ...TRACT_META[g], blocks: TRACT_BLOCKS[g], ers: ERS[g] })),
    stores: STORES_OK,
    retrievedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

const row = (r, geoid) => r.tracts.find((t) => t.geoid === geoid);

// ------------------------------------------------------------- assembler

test('assemblePlaceSummary adds up in-city residents against each tract\'s own limit', () => {
  const r = assemblePlaceSummary(fixtureInput());
  assert.equal(r.status, 'ok');
  assert.equal(r.reason, null);
  assert.equal(r.population, 650);
  // Only A2 is beyond its limit among in-city blocks (B2 is outside the city;
  // C1 is 5 mi out but its rural limit is 10 mi).
  assert.equal(r.beyond, 200);
  assert.equal(r.share, 200 / 650);
  assert.equal(r.tractCount, 3);
  assert.deepEqual(r.meeting, { residents: 500, tracts: 1, share: 500 / 650 });
  assert.deepEqual(r.unknownTracts, { residents: 0, tracts: 0, reasons: [] });
  assert.deepEqual(r.flagged.lram2019, { residents: 500, tracts: 1, share: 500 / 650, missingTracts: 1, missingResidents: 100 });
  assert.deepEqual(r.flagged.sram2025, { residents: 100, tracts: 1, share: 100 / 650, missingTracts: 0, missingResidents: 0 });
  assert.equal(r.place.pop, 650);
  assert.equal(r.storesDataset, DATASET);
});

test('a tract on the city line is tested on all its blocks; totals count in-city residents only', () => {
  const r = assemblePlaceSummary(fixtureInput());
  const b = row(r, '06085000200');
  assert.equal(b.population, 700);
  assert.equal(b.inCityPop, 100);
  assert.equal(b.wholeInCity, false);
  assert.equal(b.beyond, 600, 'the out-of-city block decides low access');
  assert.equal(b.byCount, true);
  assert.equal(b.lowAccess, true);
  assert.equal(b.inCityBeyond, 0);
  assert.equal(b.status, 'not_met');
  assert.equal(b.qualifier, 'la_not_li');
  assert.equal(b.lram2019, null);
  assert.equal(b.lram2019Reason, 'boundary_changed');
  assert.equal(b.sram2025, true);
  assert.equal(b.intptLat, B1.lat);

  const a = row(r, '06085000100');
  assert.equal(a.status, 'met');
  assert.equal(a.threshold, 1);
  assert.equal(a.share, 0.4);
  assert.equal(a.wholeInCity, true);
  assert.equal(a.basename, '1');

  const c = row(r, '06085000300');
  assert.equal(c.threshold, 10);
  assert.equal(c.urban, false);
  assert.equal(c.lowAccess, false);
  assert.equal(c.status, 'not_met');
});

test('a tract with low access and no ERS 2025 row is Unknown, and the summary says so', () => {
  const input = fixtureInput();
  input.tracts[0] = { ...input.tracts[0], ers: { status: 'missing_row', e2025: null, e2019: null, e2019Reason: 'boundary_changed' } };
  const r = assemblePlaceSummary(input);
  assert.equal(r.status, 'ok');
  const a = row(r, '06085000100');
  assert.equal(a.status, 'unknown');
  assert.equal(a.reason, 'income_unavailable');
  // Urban/rural falls back to the block majority (all 'U').
  assert.equal(a.urbanSource, 'block_ur');
  assert.deepEqual(r.unknownTracts, { residents: 500, tracts: 1, reasons: ['income_unavailable'] });
  assert.equal(r.meeting.residents, 0);
  assert.equal(r.flagged.sram2025.missingTracts, 1);
  assert.equal(r.flagged.sram2025.missingResidents, 500);
});

test('in-city blocks that miss the place POP100 make the summary Unknown with no totals', () => {
  const r = assemblePlaceSummary(fixtureInput({ placePop: 651 }));
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'place_incomplete');
  assert.deepEqual(r.detail, { found: 650, expected: 651 });
  for (const key of ['population', 'beyond', 'meeting', 'flagged', 'tracts']) assert.ok(!(key in r), key);
});

test('every failure is Unknown with a named reason, never a partial sum', () => {
  const short = fixtureInput();
  short.tracts[1] = { ...short.tracts[1], blocks: [B1] }; // 100 of 700
  assert.equal(assemblePlaceSummary(short).reason, 'blocks_incomplete');

  const orphan = fixtureInput();
  orphan.tracts = orphan.tracts.slice(0, 2); // C1 has no tract
  assert.equal(assemblePlaceSummary(orphan).reason, 'blocks_incomplete');

  assert.equal(assemblePlaceSummary(fixtureInput({ stores: { status: 'stores_unavailable', stores: [], dataset: null } })).reason, 'stores_unavailable');
  assert.equal(assemblePlaceSummary(fixtureInput({ stores: null })).reason, 'stores_unavailable');

  const ersDown = fixtureInput();
  ersDown.tracts[2] = { ...ersDown.tracts[2], ers: { status: 'unavailable', e2025: null, e2019: null } };
  assert.equal(assemblePlaceSummary(ersDown).reason, 'ers_unavailable');

  const noUrban = fixtureInput();
  noUrban.tracts[2] = {
    ...noUrban.tracts[2],
    blocks: [{ ...C1, ur: null }],
    ers: { status: 'missing_row', e2025: null, e2019: null, e2019Reason: null },
  };
  noUrban.cityBlocks = [A1, A2, B1, { ...C1, ur: null }];
  assert.equal(assemblePlaceSummary(noUrban).reason, 'urban_unavailable');

  assert.equal(assemblePlaceSummary(fixtureInput({ placePop: null })).reason, 'place_unavailable');
  assert.equal(assemblePlaceSummary(fixtureInput({ placePop: 0, cityBlocks: [] })).reason, 'no_residents');
  assert.equal(assemblePlaceSummary(fixtureInput({ place: { geoid: '123' } })).reason, 'no_place');

  // A duplicated in-city block would count twice without the final check.
  const dup = fixtureInput({ cityBlocks: [A1, A2, B1, C1] });
  dup.tracts[2] = { ...dup.tracts[2], blocks: [C1, { ...C1 }], pop: 100 };
  assert.equal(assemblePlaceSummary(dup).reason, 'blocks_incomplete');
});

test('adding a store never raises the in-city residents beyond the limit', () => {
  const before = assemblePlaceSummary(fixtureInput());
  const extra = { lat: A2.lat, lng: A2.lng, type: 'M', name: 'New' };
  const after = assemblePlaceSummary(fixtureInput({ stores: { ...STORES_OK, stores: [STORE, extra] } }));
  assert.ok(after.beyond <= before.beyond);
  assert.equal(after.beyond, 0);
  // Duplicate store: identical result.
  const dup = assemblePlaceSummary(fixtureInput({ stores: { ...STORES_OK, stores: [STORE, { ...STORE }] } }));
  assert.equal(dup.beyond, before.beyond);
  assert.deepEqual(dup.meeting, before.meeting);
});

// ------------------------------------------------------------- loader (injected lookups)

function liveLookups(overrides = {}) {
  const calls = { geometry: 0, blocks: 0, tracts: [], tractBlocks: [], ers: [], stores: [], bundles: [] };
  const lookups = {
    fetchBundle: async (county) => {
      calls.bundles.push(county);
      return null;
    },
    fetchPlaceGeometry: async (place) => {
      calls.geometry += 1;
      assert.equal(place.geoid, PLACE.geoid);
      return { status: 'ok', pop: 650, name: 'Testville city', rings: RINGS };
    },
    fetchPlaceBlocks: async (rings, { onPage }) => {
      calls.blocks += 1;
      assert.equal(rings, RINGS);
      onPage?.(1, 1);
      // Intersecting blocks: a superset that includes B2 (outside the polygon).
      return { status: 'ok', blocks: [A1, A2, B1, B2, C1] };
    },
    fetchTracts: async (geoids) => {
      calls.tracts.push(...geoids);
      return { status: 'ok', tracts: new Map(geoids.map((g) => [g, TRACT_META[g]])) };
    },
    loadTractBlocks: async (tract) => {
      calls.tractBlocks.push(tract.geoid);
      assert.equal(tract.pop, TRACT_META[tract.geoid].pop);
      return { status: 'ok', blocks: TRACT_BLOCKS[tract.geoid], population: tract.pop, source: 'tigerweb' };
    },
    loadErsTract: async (g) => {
      calls.ers.push(g);
      return ERS[g];
    },
    loadStoresNear: async (bbox, radius) => {
      calls.stores.push({ bbox, radius });
      return STORES_OK;
    },
    ...overrides,
  };
  return { lookups, calls };
}

const LIVE_PLACE = { ...PLACE, countyFips: '06067' };

test('loadPlaceSummary (live): polygon membership, boundary tracts loaded in full, same totals as the assembler', async () => {
  const { lookups, calls } = liveLookups();
  const steps = [];
  const r = await loadPlaceSummary(LIVE_PLACE, { ...lookups, onProgress: (p) => steps.push(p.step) });
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'tigerweb');
  assert.deepEqual(calls.bundles, [], 'an unbundled county never reads a bundle');
  assert.equal(calls.geometry, 1);
  assert.deepEqual(calls.tracts, ['06085000100', '06085000200', '06085000300']);
  // Only the tract on the city line needs its other blocks.
  assert.deepEqual(calls.tractBlocks, ['06085000200']);
  assert.equal(calls.stores.length, 1);
  assert.equal(calls.stores[0].radius, 30);
  assert.ok(calls.stores[0].bbox.minLng <= B2.lng, 'stores cover the whole boundary tract');

  const expected = assemblePlaceSummary(fixtureInput());
  for (const key of ['population', 'beyond', 'share', 'tractCount', 'meeting', 'unknownTracts', 'flagged']) {
    assert.deepEqual(r[key], expected[key], key);
  }
  assert.deepEqual(r.tracts, expected.tracts);

  const order = ['boundary', 'blocks', 'tracts', 'tract_blocks', 'ers', 'stores', 'compute'];
  const firstSeen = order.map((s) => steps.indexOf(s));
  assert.ok(firstSeen.every((i) => i >= 0), `steps ${steps}`);
  assert.deepEqual([...firstSeen].sort((a, b) => a - b), firstSeen);
});

test('loadPlaceSummary (live): each failing input gives Unknown with its reason', async () => {
  const cases = [
    [{ fetchPlaceGeometry: async () => ({ status: 'place_unavailable' }) }, 'place_unavailable'],
    [{ fetchPlaceGeometry: async () => ({ status: 'no_place' }) }, 'no_place'],
    [{ fetchPlaceBlocks: async () => ({ status: 'blocks_unavailable' }) }, 'blocks_unavailable'],
    [{ fetchPlaceBlocks: async () => ({ status: 'ok', blocks: [A1, A2, B1] }) }, 'place_incomplete'],
    [{ fetchTracts: async () => ({ status: 'tracts_unavailable' }) }, 'tracts_unavailable'],
    [{ loadTractBlocks: async () => ({ status: 'blocks_incomplete', blocks: [], population: null }) }, 'blocks_incomplete'],
    [{ loadTractBlocks: async () => { throw new Error('boom'); } }, 'blocks_unavailable'],
    [{ loadErsTract: async () => ({ status: 'unavailable', e2025: null, e2019: null }) }, 'ers_unavailable'],
    [{ loadStoresNear: async () => ({ status: 'stores_unavailable', stores: [], dataset: null }) }, 'stores_unavailable'],
  ];
  for (const [override, reason] of cases) {
    const { lookups } = liveLookups(override);
    const r = await loadPlaceSummary(LIVE_PLACE, lookups);
    assert.equal(r.status, 'unknown', reason);
    assert.equal(r.reason, reason);
    assert.ok(!('population' in r), `${reason}: no totals`);
  }
});

test('loadPlaceSummary stops when its signal aborts', async () => {
  const controller = new AbortController();
  const { lookups, calls } = liveLookups({
    fetchTracts: async (geoids) => {
      controller.abort();
      return { status: 'ok', tracts: new Map(geoids.map((g) => [g, TRACT_META[g]])) };
    },
  });
  const r = await loadPlaceSummary(LIVE_PLACE, { ...lookups, signal: controller.signal });
  assert.equal(r.reason, 'cancelled');
  assert.deepEqual(calls.ers, []);
});

test('loadPlaceSummary rejects a malformed place without fetching', async () => {
  const { lookups, calls } = liveLookups();
  const r = await loadPlaceSummary({ geoid: 'abc' }, lookups);
  assert.equal(r.reason, 'no_place');
  assert.equal(calls.geometry, 0);
});

// ------------------------------------------------------------- loader (bundled)

const bundleRow = (b, place) => [b.id.slice(11), b.pop, b.hu, b.lat, b.lng, b.ur, place];
function fakeBundle({ placePop = 650, extraPlaces = {} } = {}) {
  return {
    retrievedAt: '2026-10-02T00:00:00.000Z',
    source: 'synthetic',
    tracts: {
      '000100': { pop: 500, name: 'Census Tract 1', blocks: [bundleRow(A1, PLACE.geoid), bundleRow(A2, PLACE.geoid)] },
      '000200': { pop: 700, name: 'Census Tract 2', blocks: [bundleRow(B1, PLACE.geoid), bundleRow(B2, '')] },
      '000300': { pop: 50, name: 'Census Tract 3', blocks: [bundleRow(C1, PLACE.geoid)] },
      '000400': { pop: 10, name: 'Census Tract 4', blocks: [['1000', 10, 4, 37.5, -121.5, 'U', '']] },
    },
    places: { [PLACE.geoid]: { name: 'Testville city', pop: placePop }, ...extraPlaces },
  };
}

test('loadPlaceSummary (bundled): a place wholly in bundled counties needs no polygon or live blocks', async () => {
  const { lookups, calls } = liveLookups({
    fetchBundle: async (county) => {
      calls.bundles.push(county);
      return county === '06085' ? fakeBundle() : null;
    },
    fetchPlaceGeometry: async () => assert.fail('no polygon query for a bundled place'),
    loadTractBlocks: async () => assert.fail('no live block query for a bundled place'),
  });
  const r = await loadPlaceSummary({ ...PLACE, countyFips: '06085' }, lookups);
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'bundled');
  assert.deepEqual(calls.bundles, ['06085']);
  assert.deepEqual(calls.tracts, ['06085000100', '06085000200', '06085000300'], 'tract 4 is not in the city');
  const expected = assemblePlaceSummary(fixtureInput({ source: 'bundled' }));
  for (const key of ['population', 'beyond', 'meeting', 'flagged']) assert.deepEqual(r[key], expected[key], key);
  // Bundle blocks carry their place; the rows are otherwise identical.
  assert.equal(row(r, '06085000200').beyond, 600);
});

test('loadPlaceSummary (bundled): a place reaching outside the bundled counties goes live', async () => {
  const { lookups, calls } = liveLookups({
    fetchBundle: async (county) => {
      calls.bundles.push(county);
      // The bundle records POP100 = 700: 50 residents live in an unbundled county.
      return county === '06085' ? fakeBundle({ placePop: 700 }) : { tracts: {}, places: {} };
    },
    fetchPlaceGeometry: async () => {
      calls.geometry += 1;
      return { status: 'ok', pop: 650, name: 'Testville city', rings: RINGS };
    },
  });
  const r = await loadPlaceSummary({ ...PLACE, countyFips: '06085' }, lookups);
  assert.deepEqual(calls.bundles, ['06085', '06001'], 'checks the other bundled county in the state first');
  assert.equal(calls.geometry, 1);
  assert.equal(r.source, 'tigerweb');
  assert.equal(r.status, 'ok');
});

test('loadPlaceSummary (bundled): an unreadable bundle falls back to the live path', async () => {
  const { lookups, calls } = liveLookups();
  const r = await loadPlaceSummary({ ...PLACE, countyFips: '06085' }, lookups);
  assert.deepEqual(calls.bundles, ['06085']);
  assert.equal(calls.geometry, 1);
  assert.equal(r.status, 'ok');
});

// ------------------------------------------------------------- default TIGERweb lookups

function formBody(init) {
  return new URLSearchParams(String(init?.body || ''));
}

function blockAttrs(i) {
  return {
    GEOID: `0606700010${String(10000 + i).slice(-5)}`,
    POP100: 1,
    HU100: 1,
    UR: 'U',
    INTPTLAT: '+38.5',
    INTPTLON: '-121.4',
  };
}

test('fetchPlaceBlocks POSTs the polygon, counts first, then fetches six pages side by side', async () => {
  const COUNT = 6001;
  let maxInFlight = 0;
  let inFlight = 0;
  const stub = stubFetch(async (url, init) => {
    assert.equal(url, `${TIGER_BASE}/10/query`);
    assert.equal(init.method, 'POST');
    const body = formBody(init);
    assert.equal(body.get('where'), 'POP100>0');
    assert.equal(body.get('geometryType'), 'esriGeometryPolygon');
    assert.deepEqual(JSON.parse(body.get('geometry')).rings, RINGS);
    if (body.get('returnCountOnly') === 'true') return jsonResponse({ count: COUNT });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const offset = Number(body.get('resultOffset'));
    const n = Math.min(Number(body.get('resultRecordCount')), COUNT - offset);
    return jsonResponse({ features: Array.from({ length: n }, (_, k) => ({ attributes: blockAttrs(offset + k) })) });
  });
  try {
    const pages = [];
    const r = await fetchPlaceBlocks(RINGS, { onPage: (d, t) => pages.push([d, t]) });
    assert.equal(r.status, 'ok');
    assert.equal(r.blocks.length, COUNT);
    assert.equal(stub.calls.length, 7);
    assert.equal(maxInFlight, 6);
    assert.deepEqual(pages.at(-1), [6, 6]);
    assert.equal(r.blocks[0].lat, 38.5);
  } finally {
    stub.restore();
  }
});

test('fetchPlaceBlocks follows a server cap inside a page and rejects shifted pages', async () => {
  // Cap at 400 rows per reply: one page of 1000 takes three requests.
  let stub = stubFetch(async (url, init) => {
    const body = formBody(init);
    if (body.get('returnCountOnly') === 'true') return jsonResponse({ count: 1000 });
    const offset = Number(body.get('resultOffset'));
    const n = Math.min(400, Number(body.get('resultRecordCount')));
    return jsonResponse({
      features: Array.from({ length: n }, (_, k) => ({ attributes: blockAttrs(offset + k) })),
      exceededTransferLimit: offset + n < 1000,
    });
  });
  try {
    const r = await fetchPlaceBlocks(RINGS);
    assert.equal(r.status, 'ok');
    assert.equal(r.blocks.length, 1000);
    assert.equal(stub.calls.length, 4);
  } finally {
    stub.restore();
  }

  // Every reply repeats the first rows: unique GEOIDs fall short of the count.
  stub = stubFetch(async (url, init) => {
    const body = formBody(init);
    if (body.get('returnCountOnly') === 'true') return jsonResponse({ count: 4000 });
    const n = Number(body.get('resultRecordCount'));
    return jsonResponse({ features: Array.from({ length: n }, (_, k) => ({ attributes: blockAttrs(k) })) });
  });
  try {
    assert.equal((await fetchPlaceBlocks(RINGS)).status, 'blocks_unavailable');
  } finally {
    stub.restore();
  }

  // ArcGIS's HTTP-200 error reply and a bad row both fail.
  stub = stubFetch(async () => jsonResponse({ error: { code: 500, message: 'x' } }));
  try {
    assert.equal((await fetchPlaceBlocks(RINGS)).status, 'blocks_unavailable');
  } finally {
    stub.restore();
  }
  stub = stubFetch(async (url, init) => (formBody(init).get('returnCountOnly') === 'true'
    ? jsonResponse({ count: 1 })
    : jsonResponse({ features: [{ attributes: { ...blockAttrs(0), POP100: null } }] })));
  try {
    assert.equal((await fetchPlaceBlocks(RINGS)).status, 'blocks_unavailable');
  } finally {
    stub.restore();
  }
});

test('fetchTracts needs every requested tract back', async () => {
  const attrs = (g) => ({ GEOID: g, NAME: `Census Tract ${g}`, BASENAME: g.slice(5), POP100: 5, INTPTLAT: '+37.1', INTPTLON: '-121.1' });
  let stub = stubFetch(async (url, init) => {
    assert.equal(url, `${TIGER_BASE}/6/query`);
    const where = formBody(init).get('where');
    const ids = [...where.matchAll(/'(\d{11})'/g)].map((m) => m[1]);
    return jsonResponse({ features: ids.map((g) => ({ attributes: attrs(g) })) });
  });
  try {
    const geoids = Array.from({ length: 150 }, (_, i) => `06067${String(100000 + i).slice(-6)}`);
    const r = await fetchTracts(geoids);
    assert.equal(r.status, 'ok');
    assert.equal(r.tracts.size, 150);
    assert.equal(stub.calls.length, 2, '100 GEOIDs per query');
    assert.deepEqual(r.tracts.get(geoids[0]), {
      geoid: geoids[0], name: `Census Tract ${geoids[0]}`, basename: geoids[0].slice(5), pop: 5, intptLat: 37.1, intptLng: -121.1,
    });
  } finally {
    stub.restore();
  }
  stub = stubFetch(async () => jsonResponse({ features: [{ attributes: attrs('06067000100') }] }));
  try {
    assert.equal((await fetchTracts(['06067000100', '06067000200'])).status, 'tracts_unavailable');
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------- golden: San Jose from the committed snapshot

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const haveSnapshot = ['data/blocks/06085.json', 'data/ers/06085.json', 'data/stores/manifest.json']
  .every((f) => existsSync(`${PUBLIC}/${f}`));

test('San Jose (bundled, committed snapshot): in-city population is exactly 1,013,240', { skip: !haveSnapshot }, async () => {
  resetPlaceCache();
  resetBlockCache();
  resetErsCache();
  resetStoreCache();
  const bundle = JSON.parse(readFileSync(`${PUBLIC}/data/blocks/06085.json`, 'utf8'));
  // TIGERweb layer 6 is the one live call; answer it from the bundle (internal
  // point = the tract's first block, enough for the table's links).
  const stub = stubFetch(async (url, init) => {
    if (url.startsWith('/data/')) {
      const file = `${PUBLIC}${url}`;
      return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response('', { status: 404 });
    }
    if (url === `${TIGER_BASE}/6/query`) {
      const ids = [...formBody(init).get('where').matchAll(/'(\d{11})'/g)].map((m) => m[1]);
      return jsonResponse({
        features: ids.map((g) => {
          const t = bundle.tracts[g.slice(5)];
          return { attributes: { GEOID: g, NAME: t.name, BASENAME: t.name.replace('Census Tract ', ''), POP100: t.pop, INTPTLAT: String(t.blocks[0][3]), INTPTLON: String(t.blocks[0][4]) } };
        }),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  try {
    const r = await loadPlaceSummary({ geoid: '0668000', name: 'San Jose city', kind: 'incorporated', countyFips: '06085' });
    assert.equal(r.status, 'ok', r.reason);
    assert.equal(r.source, 'bundled');
    assert.equal(r.population, 1013240);
    assert.equal(r.place.pop, 1013240);
    assert.equal(r.tractCount, 235);
    assert.ok(stub.calls.every((c) => !c.url.includes('/26/') && !c.url.includes('/10/')), 'no polygon or live block query');
    // Golden tract (docs/07): Alviso 06085504602 is low income and low access.
    const alviso = row(r, '06085504602');
    assert.equal(alviso.status, 'met');
    assert.equal(alviso.qualifier, 'li_la');
    // Internal consistency.
    assert.ok(r.beyond >= 0 && r.beyond <= r.population);
    assert.equal(r.tracts.reduce((s, t) => s + t.inCityPop, 0), 1013240);
    assert.ok(r.meeting.tracts >= 1 && r.meeting.residents <= r.population);
  } finally {
    stub.restore();
    resetPlaceCache();
    resetBlockCache();
    resetErsCache();
    resetStoreCache();
  }
});
