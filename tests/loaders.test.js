import assert from 'node:assert/strict';
import test from 'node:test';

import { STATE_ABBR_BY_FIPS, stateAbbrFromFips } from '../src/lib/stateCodes.js';
import { TIGER_BASE, lookupPlace, lookupTract } from '../src/pipeline/tractLookup.js';
import { BUNDLED_COUNTIES, loadTractBlocks, resetBlockCache } from '../src/pipeline/blockLoader.js';
import {
  STORE_DATASET_NAME,
  loadStoresNear,
  resetStoreCache,
  storeTileKeys,
} from '../src/pipeline/storeLoader.js';
import { loadErsTract, resetErsCache } from '../src/pipeline/ersLoader.js';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

// All fixtures below are synthetic (shapes follow docs/07 and the TIGERweb
// Census2020 layer schemas); counts are not real Census values.

const unexpected = (url) => {
  throw new Error(`unexpected fetch ${url}`);
};
const params = (url) => new URL(url).searchParams;
const tigerLayer = (url) => {
  const m = url.match(/MapServer\/(\d+)\/query/);
  return m ? Number(m[1]) : null;
};
const features = (attrs, extra = {}) => ({ features: attrs.map((attributes) => ({ attributes })), ...extra });

// ---------------------------------------------------------------- stateCodes

test('stateAbbrFromFips covers all 50 states, DC, PR and the territories', () => {
  const states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
    'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
    'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  ];
  const values = new Set(Object.values(STATE_ABBR_BY_FIPS));
  for (const s of [...states, 'DC', 'PR', 'AS', 'GU', 'MP', 'VI', 'UM']) assert.ok(values.has(s), s);
  assert.equal(stateAbbrFromFips('06'), 'CA');
  assert.equal(stateAbbrFromFips('11'), 'DC');
  assert.equal(stateAbbrFromFips('28'), 'MS');
  assert.equal(stateAbbrFromFips('04'), 'AZ');
  assert.equal(stateAbbrFromFips('72'), 'PR');
  assert.equal(stateAbbrFromFips('78'), 'VI');
  assert.equal(stateAbbrFromFips(6), 'CA');
});

test('stateAbbrFromFips returns null for unused or malformed codes', () => {
  assert.equal(stateAbbrFromFips('03'), null); // reserved, never assigned
  assert.equal(stateAbbrFromFips('6085'), null); // a county code is not a state code
  assert.equal(stateAbbrFromFips(''), null);
  assert.equal(stateAbbrFromFips(null), null);
  assert.equal(stateAbbrFromFips(undefined), null);
});

// --------------------------------------------------------------- tractLookup

const ALVISO_TRACT_ATTRS = {
  GEOID: '06085504602',
  STATE: '06',
  COUNTY: '085',
  TRACT: '504602',
  NAME: 'Census Tract 5046.02',
  BASENAME: '5046.02',
  POP100: 2056,
  HU100: 640,
  INTPTLAT: '+37.4496561',
  INTPTLON: '-121.9940084',
};

test('lookupTract queries TIGERweb Census2020 layer 6 by point and parses the tract', async () => {
  const stub = stubFetch(async (url) => (url.startsWith(TIGER_BASE) ? jsonResponse(features([ALVISO_TRACT_ATTRS])) : unexpected(url)));
  try {
    const r = await lookupTract(37.42105, -121.9727);
    assert.deepEqual(r, {
      status: 'ok',
      tract: {
        geoid: '06085504602',
        state: '06',
        county: '085',
        tract: '504602',
        name: 'Census Tract 5046.02',
        basename: '5046.02',
        pop: 2056,
        hu: 640,
        intptLat: 37.4496561,
        intptLng: -121.9940084,
      },
    });
    assert.equal(stub.calls.length, 1);
    const url = stub.calls[0].url;
    assert.ok(url.startsWith('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query?'));
    const p = params(url);
    assert.equal(p.get('geometry'), '-121.9727,37.42105'); // x,y = lng,lat
    assert.equal(p.get('geometryType'), 'esriGeometryPoint');
    assert.equal(p.get('inSR'), '4326');
    assert.equal(p.get('spatialRel'), 'esriSpatialRelIntersects');
    assert.equal(p.get('outFields'), 'GEOID,STATE,COUNTY,TRACT,NAME,BASENAME,POP100,HU100,INTPTLAT,INTPTLON');
    assert.equal(p.get('returnGeometry'), 'false');
    assert.equal(p.get('f'), 'json');
  } finally {
    stub.restore();
  }
});

test('lookupTract: zero features -> no_tract', async () => {
  const stub = stubFetch(async () => jsonResponse({ features: [] }));
  try {
    assert.deepEqual(await lookupTract(30, -40), { status: 'no_tract' });
  } finally {
    stub.restore();
  }
});

test('lookupTract: ArcGIS json.error (HTTP 200) -> unavailable', async () => {
  const stub = stubFetch(async () => jsonResponse({ error: { code: 500, message: 'Error performing query operation' } }));
  try {
    assert.deepEqual(await lookupTract(37.42, -121.97), { status: 'unavailable' });
  } finally {
    stub.restore();
  }
});

test('lookupTract: non-OK HTTP -> unavailable', async () => {
  const stub = stubFetch(async () => new Response('bad gateway', { status: 502 }));
  try {
    assert.deepEqual(await lookupTract(37.42, -121.97), { status: 'unavailable' });
  } finally {
    stub.restore();
  }
});

test('lookupTract: network throw -> unavailable', async () => {
  const stub = stubFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  try {
    assert.deepEqual(await lookupTract(37.42, -121.97), { status: 'unavailable' });
  } finally {
    stub.restore();
  }
});

test('lookupTract: a feature without a valid GEOID or POP100 -> unavailable, not a guess', async () => {
  for (const attrs of [{ ...ALVISO_TRACT_ATTRS, GEOID: null }, { ...ALVISO_TRACT_ATTRS, POP100: null }]) {
    const stub = stubFetch(async () => jsonResponse(features([attrs])));
    try {
      assert.deepEqual(await lookupTract(37.42, -121.97), { status: 'unavailable' });
    } finally {
      stub.restore();
    }
  }
});

test('lookupTract: a point on a shared edge picks the same tract regardless of feature order', async () => {
  const other = { ...ALVISO_TRACT_ATTRS, GEOID: '06085504601', TRACT: '504601', NAME: 'Census Tract 5046.01', BASENAME: '5046.01' };
  for (const order of [[ALVISO_TRACT_ATTRS, other], [other, ALVISO_TRACT_ATTRS]]) {
    const stub = stubFetch(async () => jsonResponse(features(order)));
    try {
      const r = await lookupTract(37.42, -121.97);
      assert.equal(r.tract.geoid, '06085504601');
    } finally {
      stub.restore();
    }
  }
});

test('lookupTract: non-finite coordinates -> no_tract without fetching', async () => {
  const stub = stubFetch(unexpected);
  try {
    assert.deepEqual(await lookupTract(Number.NaN, -121.97), { status: 'no_tract' });
    assert.deepEqual(await lookupTract(37.42, undefined), { status: 'no_tract' });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

const SAN_JOSE = { GEOID: '0668000', NAME: 'San Jose city', BASENAME: 'San Jose', POP100: 1013240 };
const ALVISO_CDP_LIKE = { GEOID: '0601234', NAME: 'Example CDP', BASENAME: 'Example', POP100: 1200 };

function placeStub({ inc, cdp }) {
  return stubFetch(async (url) => {
    const layer = tigerLayer(url);
    const r = layer === 26 ? inc : layer === 28 ? cdp : null;
    if (r === undefined || r === null) return unexpected(url);
    if (r instanceof Error) throw r;
    return r instanceof Response ? r : jsonResponse(r);
  });
}

test('lookupPlace prefers the incorporated place (layer 26) over a CDP (layer 28)', async () => {
  const stub = placeStub({ inc: features([SAN_JOSE]), cdp: features([ALVISO_CDP_LIKE]) });
  try {
    const r = await lookupPlace(37.33, -121.89);
    assert.deepEqual(r, {
      status: 'ok',
      place: { geoid: '0668000', name: 'San Jose city', basename: 'San Jose', pop: 1013240, kind: 'incorporated' },
    });
    for (const call of stub.calls) {
      const p = params(call.url);
      assert.equal(p.get('geometry'), '-121.89,37.33');
      assert.equal(p.get('returnGeometry'), 'false');
    }
  } finally {
    stub.restore();
  }
});

test('lookupPlace falls back to a CDP, and reports no_place when neither layer has one', async () => {
  let stub = placeStub({ inc: features([]), cdp: features([ALVISO_CDP_LIKE]) });
  try {
    const r = await lookupPlace(37.4, -121.9);
    assert.equal(r.status, 'ok');
    assert.equal(r.place.kind, 'cdp');
    assert.equal(r.place.geoid, '0601234');
  } finally {
    stub.restore();
  }
  stub = placeStub({ inc: features([]), cdp: features([]) });
  try {
    assert.deepEqual(await lookupPlace(37.4, -121.9), { status: 'no_place', place: null });
  } finally {
    stub.restore();
  }
});

test('lookupPlace: failure on either layer without an incorporated hit -> unavailable', async () => {
  for (const setup of [
    { inc: new TypeError('Failed to fetch'), cdp: features([ALVISO_CDP_LIKE]) },
    { inc: features([]), cdp: { error: { code: 400, message: 'bad' } } },
    { inc: new Response('down', { status: 503 }), cdp: features([]) },
  ]) {
    const stub = placeStub(setup);
    try {
      assert.deepEqual(await lookupPlace(37.4, -121.9), { status: 'unavailable', place: null });
    } finally {
      stub.restore();
    }
  }
  // An incorporated hit stands even if the CDP layer failed (the two never overlap).
  const stub = placeStub({ inc: features([SAN_JOSE]), cdp: new TypeError('Failed to fetch') });
  try {
    const r = await lookupPlace(37.33, -121.89);
    assert.equal(r.status, 'ok');
    assert.equal(r.place.kind, 'incorporated');
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------- blockLoader

const BUNDLE_06085 = {
  retrievedAt: '2026-10-02T00:00:00Z',
  tracts: {
    504602: {
      pop: 30,
      name: 'Census Tract 5046.02',
      blocks: [
        ['1000', 10, 4, 37.42105, -121.9727, 'U', '0668000'],
        ['1001', 20, 6, 37.43, -121.98, 'U', ''],
      ],
    },
    508101: {
      pop: 15,
      name: 'Census Tract 5081.01',
      blocks: [['2000', 15, 5, 37.32, -122.03, 'U', '0617610']],
    },
  },
};

const tractInput = (geoid, pop) => ({
  geoid,
  state: geoid.slice(0, 2),
  county: geoid.slice(2, 5),
  tract: geoid.slice(5),
  name: 'Census Tract X',
  pop,
  hu: 0,
  intptLat: 0,
  intptLng: 0,
});

test('BUNDLED_COUNTIES matches docs/07 (Santa Clara, Alameda, Washington MS, Apache AZ)', () => {
  assert.deepEqual(BUNDLED_COUNTIES, ['06085', '06001', '28151', '04001']);
});

test('loadTractBlocks: tract POP100 = 0 -> no_residents without any fetch', async () => {
  resetBlockCache();
  const stub = stubFetch(unexpected);
  try {
    const r = await loadTractBlocks(tractInput('17031990000', 0));
    assert.equal(r.status, 'no_residents');
    assert.deepEqual(r.blocks, []);
    assert.equal(r.population, 0);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: bundled county reads /data/blocks/<SSCCC>.json once, never TIGERweb', async () => {
  resetBlockCache();
  const stub = stubFetch(async (url) => (url === '/data/blocks/06085.json' ? jsonResponse(BUNDLE_06085) : unexpected(url)));
  try {
    const a = await loadTractBlocks(tractInput('06085504602', 30));
    assert.deepEqual(a, {
      status: 'ok',
      blocks: [
        { id: '060855046021000', pop: 10, hu: 4, lat: 37.42105, lng: -121.9727, ur: 'U', place: '0668000' },
        { id: '060855046021001', pop: 20, hu: 6, lat: 37.43, lng: -121.98, ur: 'U', place: '' },
      ],
      population: 30,
      source: 'bundled',
    });
    const b = await loadTractBlocks(tractInput('06085508101', 15));
    assert.equal(b.status, 'ok');
    assert.equal(b.population, 15);
    assert.equal(stub.calls.length, 1, 'county bundle is cached in memory');
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: other counties query TIGERweb layer 10 for the tract', async () => {
  resetBlockCache();
  const stub = stubFetch(async (url) => {
    if (tigerLayer(url) !== 10) return unexpected(url);
    return jsonResponse(features([
      { GEOID: '170318425001000', POP100: 300, HU100: 120, UR: 'U', INTPTLAT: '+41.7900000', INTPTLON: '-087.6200000' },
      { GEOID: '170318425001001', POP100: 200, HU100: 80, UR: 'U', INTPTLAT: '+41.7910000', INTPTLON: '-087.6210000' },
    ]));
  });
  try {
    const r = await loadTractBlocks(tractInput('17031842500', 500));
    assert.deepEqual(r, {
      status: 'ok',
      blocks: [
        { id: '170318425001000', pop: 300, hu: 120, lat: 41.79, lng: -87.62, ur: 'U', place: null },
        { id: '170318425001001', pop: 200, hu: 80, lat: 41.791, lng: -87.621, ur: 'U', place: null },
      ],
      population: 500,
      source: 'tigerweb',
    });
    assert.equal(stub.calls.length, 1);
    const p = params(stub.calls[0].url);
    assert.equal(p.get('where'), "STATE='17' AND COUNTY='031' AND TRACT='842500' AND POP100>0");
    assert.equal(p.get('outFields'), 'GEOID,POP100,HU100,UR,INTPTLAT,INTPTLON');
    assert.equal(p.get('returnGeometry'), 'false');
    assert.equal(p.get('f'), 'json');
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: pages TIGERweb on exceededTransferLimit', async () => {
  resetBlockCache();
  const pages = [
    features([{ GEOID: '170318425001000', POP100: 300, HU100: 120, UR: 'U', INTPTLAT: '41.79', INTPTLON: '-87.62' }], { exceededTransferLimit: true }),
    features([{ GEOID: '170318425001001', POP100: 200, HU100: 80, UR: 'R', INTPTLAT: '41.80', INTPTLON: '-87.63' }]),
  ];
  const stub = stubFetch(async (url) => {
    const offset = Number(params(url).get('resultOffset') ?? 0);
    return jsonResponse(offset === 0 ? pages[0] : offset === 1 ? pages[1] : { features: [] });
  });
  try {
    const r = await loadTractBlocks(tractInput('17031842500', 500));
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.blocks.map((b) => b.id), ['170318425001000', '170318425001001']);
    assert.equal(stub.calls.length, 2);
    assert.equal(params(stub.calls[1].url).get('resultOffset'), '1');
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: sum of block POP100 != tract POP100 -> blocks_incomplete, no blocks', async () => {
  resetBlockCache();
  let stub = stubFetch(async () => jsonResponse(features([
    { GEOID: '170318425001000', POP100: 300, HU100: 120, UR: 'U', INTPTLAT: '41.79', INTPTLON: '-87.62' },
  ])));
  try {
    const r = await loadTractBlocks(tractInput('17031842500', 500));
    assert.equal(r.status, 'blocks_incomplete');
    assert.deepEqual(r.blocks, []);
    assert.equal(r.population, null);
    assert.equal(r.blockSum, 300);
  } finally {
    stub.restore();
  }
  stub = stubFetch(async () => jsonResponse(BUNDLE_06085));
  try {
    const r = await loadTractBlocks(tractInput('06085504602', 31));
    assert.equal(r.status, 'blocks_incomplete');
    assert.equal(r.source, 'bundled');
    assert.deepEqual(r.blocks, []);
    // A populated tract missing from its county bundle is incomplete, not empty.
    const missing = await loadTractBlocks(tractInput('06085999999', 40));
    assert.equal(missing.status, 'blocks_incomplete');
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: bundle fetch failure -> blocks_unavailable, and the failure is not cached', async () => {
  resetBlockCache();
  let ok = false;
  const stub = stubFetch(async () => (ok ? jsonResponse(BUNDLE_06085) : new Response('oops', { status: 500 })));
  try {
    const r = await loadTractBlocks(tractInput('06085504602', 30));
    assert.deepEqual(r, { status: 'blocks_unavailable', blocks: [], population: null, source: 'bundled' });
    ok = true;
    const retry = await loadTractBlocks(tractInput('06085504602', 30));
    assert.equal(retry.status, 'ok');
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: malformed bundle rows -> blocks_unavailable (never partial blocks)', async () => {
  resetBlockCache();
  const bad = {
    tracts: { 504602: { pop: 30, blocks: [['1000', 10, 4, 37.42, -121.97, 'U', ''], ['1001', 20, 6, 'x', -121.98, 'U', '']] } },
  };
  const stub = stubFetch(async () => jsonResponse(bad));
  try {
    const r = await loadTractBlocks(tractInput('06085504602', 30));
    assert.equal(r.status, 'blocks_unavailable');
    assert.deepEqual(r.blocks, []);
  } finally {
    stub.restore();
  }
});

test('loadTractBlocks: live json.error, network throw, or a failed later page -> blocks_unavailable', async () => {
  resetBlockCache();
  const first = features([{ GEOID: '170318425001000', POP100: 300, HU100: 120, UR: 'U', INTPTLAT: '41.79', INTPTLON: '-87.62' }], { exceededTransferLimit: true });
  const impls = [
    async () => jsonResponse({ error: { code: 500, message: 'Error performing query operation' } }),
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async (url) => (Number(params(url).get('resultOffset') ?? 0) === 0 ? jsonResponse(first) : new Response('down', { status: 504 })),
  ];
  for (const impl of impls) {
    const stub = stubFetch(impl);
    try {
      const r = await loadTractBlocks(tractInput('17031842500', 500));
      assert.deepEqual(r, { status: 'blocks_unavailable', blocks: [], population: null, source: 'tigerweb' });
    } finally {
      stub.restore();
    }
  }
});

// --------------------------------------------------------------- storeLoader

const MANIFEST = {
  source: 'USDA FNS SNAP Retailer Locator',
  serviceUrl: 'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0',
  dataLastEditDate: '2026-09-28',
  retrievedAt: '2026-10-02T12:00:00Z',
  counts: { supermarket: 3, superStore: 1, excluded: {}, kept: 4 },
  tileDeg: 2,
  tiles: { '36_-122': 2, '36_-124': 1, '38_-122': 1 },
};
const TILES = {
  '36_-122': [[37.41, -121.96, 'M', 'Village Market'], [37.35, -121.9, 'S', 'Target']],
  '36_-124': [[37.0, -122.6, 'M', 'Coast Grocer']],
  '38_-122': [[38.5, -121.5, 'M', 'Far North Foods']],
};
const ALVISO_BBOX = { minLat: 37.4, maxLat: 37.45, minLng: -122.0, maxLng: -121.95 };

function storeStub({ manifest = MANIFEST, tiles = TILES, fail = {} } = {}) {
  return stubFetch(async (url) => {
    if (url === '/data/stores/manifest.json') return fail.manifest ?? jsonResponse(manifest);
    const m = url.match(/^\/data\/stores\/(-?\d+_-?\d+)\.json$/);
    if (!m) return unexpected(url);
    if (fail[m[1]]) return fail[m[1]];
    return tiles[m[1]] ? jsonResponse(tiles[m[1]]) : new Response('Not Found', { status: 404 });
  });
}

test('storeTileKeys expands the bbox by the radius and covers neighbouring tiles', () => {
  // 30 mi around Alviso reaches west past -122 deg into the -124 tile, but not north to 38.
  assert.deepEqual(storeTileKeys(ALVISO_BBOX, 30).sort(), ['36_-122', '36_-124']);
  // A point 1 mi from a tile corner pulls in all four tiles around the corner.
  const corner = { minLat: 37.99, maxLat: 37.99, minLng: -122.01, maxLng: -122.01 };
  assert.deepEqual(storeTileKeys(corner, 1).sort(), ['36_-122', '36_-124', '38_-122', '38_-124']);
  assert.deepEqual(storeTileKeys(corner, 0), ['36_-124']);
  // Across the antimeridian (western Aleutians) tile keys wrap to +178.
  const aleutian = { minLat: 51.0, maxLat: 51.0, minLng: -179.95, maxLng: -179.95 };
  assert.deepEqual(storeTileKeys(aleutian, 30).sort(), ['50_-180', '50_178']);
});

test('loadStoresNear loads the manifest and only the listed tiles it needs', async () => {
  resetStoreCache();
  const stub = storeStub();
  try {
    const r = await loadStoresNear(ALVISO_BBOX, 30);
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.dataset, {
      name: 'USDA SNAP-authorized supermarkets and super stores',
      date: '2026-09-28',
      retrievedAt: '2026-10-02T12:00:00Z',
    });
    assert.equal(STORE_DATASET_NAME, r.dataset.name);
    const byName = (a, b) => a.name.localeCompare(b.name);
    assert.deepEqual([...r.stores].sort(byName), [
      { lat: 37.0, lng: -122.6, type: 'M', name: 'Coast Grocer' },
      { lat: 37.35, lng: -121.9, type: 'S', name: 'Target' },
      { lat: 37.41, lng: -121.96, type: 'M', name: 'Village Market' },
    ]);
    assert.deepEqual(stub.calls.map((c) => c.url).sort(), [
      '/data/stores/36_-122.json',
      '/data/stores/36_-124.json',
      '/data/stores/manifest.json',
    ]);
  } finally {
    stub.restore();
  }
});

test('loadStoresNear caches the manifest and tiles in memory', async () => {
  resetStoreCache();
  const stub = storeStub();
  try {
    await loadStoresNear(ALVISO_BBOX, 30);
    const again = await loadStoresNear(ALVISO_BBOX, 30);
    assert.equal(again.status, 'ok');
    assert.equal(again.stores.length, 3);
    assert.equal(stub.calls.length, 3);
  } finally {
    stub.restore();
  }
});

test('loadStoresNear: a tile absent from the manifest means no stores there, not an error', async () => {
  resetStoreCache();
  const stub = storeStub({ manifest: { ...MANIFEST, tiles: { '38_-122': 1 } } });
  try {
    const r = await loadStoresNear(ALVISO_BBOX, 30);
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.stores, []);
    assert.equal(r.dataset.date, '2026-09-28');
    assert.deepEqual(stub.calls.map((c) => c.url), ['/data/stores/manifest.json']);
  } finally {
    stub.restore();
  }
});

test('loadStoresNear: a listed tile that fails -> stores_unavailable with stores []', async () => {
  resetStoreCache();
  const stub = storeStub({ fail: { '36_-124': new Response('oops', { status: 500 }) } });
  try {
    assert.deepEqual(await loadStoresNear(ALVISO_BBOX, 30), { status: 'stores_unavailable', stores: [], dataset: null });
  } finally {
    stub.restore();
  }
});

test('loadStoresNear: manifest failure -> stores_unavailable, and a retry reloads it', async () => {
  resetStoreCache();
  let stub = storeStub({ fail: { manifest: new Response('oops', { status: 503 }) } });
  try {
    assert.deepEqual(await loadStoresNear(ALVISO_BBOX, 30), { status: 'stores_unavailable', stores: [], dataset: null });
  } finally {
    stub.restore();
  }
  stub = storeStub();
  try {
    const r = await loadStoresNear(ALVISO_BBOX, 30);
    assert.equal(r.status, 'ok');
  } finally {
    stub.restore();
  }
});

test('loadStoresNear: network throw on a tile -> stores_unavailable', async () => {
  resetStoreCache();
  const stub = stubFetch(async (url) => {
    if (url === '/data/stores/manifest.json') return jsonResponse(MANIFEST);
    throw new TypeError('Failed to fetch');
  });
  try {
    assert.deepEqual(await loadStoresNear(ALVISO_BBOX, 30), { status: 'stores_unavailable', stores: [], dataset: null });
  } finally {
    stub.restore();
  }
});

test('loadStoresNear: a tile whose row count disagrees with the manifest, or a bad row -> stores_unavailable', async () => {
  for (const tiles of [
    { ...TILES, '36_-122': [TILES['36_-122'][0]] },
    { ...TILES, '36_-122': [TILES['36_-122'][0], ['37.35', null, 'S', 'Target']] },
  ]) {
    resetStoreCache();
    const stub = storeStub({ tiles });
    try {
      assert.deepEqual(await loadStoresNear(ALVISO_BBOX, 30), { status: 'stores_unavailable', stores: [], dataset: null });
    } finally {
      stub.restore();
    }
  }
});

test('loadStoresNear: radius defaults to 30 mi', async () => {
  resetStoreCache();
  const stub = storeStub();
  try {
    const r = await loadStoresNear(ALVISO_BBOX);
    assert.equal(r.stores.length, 3);
  } finally {
    stub.restore();
  }
});

// ----------------------------------------------------------------- ersLoader

const F2025 = [
  'Urban', 'LowIncomeTracts', 'POP2020', 'SD_SRAM_LA1and10', 'SD_SRAM_LILATracts_1And10',
  'TractHUNV', 'OHU2020', 'PovertyRate', 'MedianFamilyIncome', 'GroupQuartersFlag',
];
const F2019 = ['LILATracts_1And10', 'LA1and10', 'lapop1share', 'lapop10share', 'Urban'];
const ERS_06085 = {
  retrievedAt: '2026-10-02T00:00:00Z',
  sources: { 2025: 'FARA_2025_StraightLine/MapServer/4', 2019: 'FARA_2019/MapServer/30' },
  f2025: F2025,
  t2025: {
    '06085504602': [1, 1, 2056, 0, 0, 12, 600, 7.5, 144464, 0],
    '06085508101': [1, 0, 5000, 0, 0, null, 1700, 3.1, null, 1],
  },
  f2019: F2019,
  t2019: {
    '06085504602': [1, 1, 60.79, null, 1],
    '06085999999': [0, 1, 40.5, null, 1],
  },
};

function ersStub(responses) {
  return stubFetch(async (url) => {
    const r = responses[url];
    if (r === undefined) return unexpected(url);
    if (r instanceof Error) throw r;
    return r instanceof Response ? r : jsonResponse(r);
  });
}

test('loadErsTract maps the 2025 row and the identical-GEOID 2019 row', async () => {
  resetErsCache();
  const stub = ersStub({ '/data/ers/06085.json': ERS_06085 });
  try {
    const r = await loadErsTract('06085504602');
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.e2025, {
      urban: true,
      lowIncome: true,
      pop2020: 2056,
      sramLA: false,
      sramLILA: false,
      tractHUNV: 12,
      ohu2020: 600,
      povertyRate: 7.5,
      medianFamilyIncome: 144464,
      groupQuarters: false,
    });
    assert.deepEqual(r.e2019, { lila: true, la: true, lapop1share: 60.79, lapop10share: null, urban: true });
    assert.equal(r.e2019Reason, null);
    assert.equal(r.retrievedAt, '2026-10-02T00:00:00Z');
    assert.deepEqual(stub.calls.map((c) => c.url), ['/data/ers/06085.json']);
  } finally {
    stub.restore();
  }
});

test('loadErsTract: no identical 2019 GEOID -> e2019 null with reason boundary_changed; nulls stay null', async () => {
  resetErsCache();
  const stub = ersStub({ '/data/ers/06085.json': ERS_06085 });
  try {
    const r = await loadErsTract('06085508101');
    assert.equal(r.status, 'ok');
    assert.equal(r.e2025.lowIncome, false);
    assert.equal(r.e2025.tractHUNV, null);
    assert.equal(r.e2025.medianFamilyIncome, null);
    assert.equal(r.e2025.groupQuarters, true);
    assert.equal(r.e2019, null);
    assert.equal(r.e2019Reason, 'boundary_changed');
    // Same county again: served from memory.
    await loadErsTract('06085504602');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('loadErsTract: county file present but no 2025 row -> missing_row (2019 still reported)', async () => {
  resetErsCache();
  const stub = ersStub({ '/data/ers/06085.json': ERS_06085 });
  try {
    const r = await loadErsTract('06085999999');
    assert.equal(r.status, 'missing_row');
    assert.equal(r.e2025, null);
    assert.deepEqual(r.e2019, { lila: false, la: true, lapop1share: 40.5, lapop10share: null, urban: true });
  } finally {
    stub.restore();
  }
});

test('loadErsTract maps by field name, not position', async () => {
  resetErsCache();
  const order = [...F2025].reverse();
  const row = [1, 1, 2056, 0, 0, 12, 600, 7.5, 144464, 0];
  const shuffled = order.map((name) => row[F2025.indexOf(name)]);
  const doc = { ...ERS_06085, f2025: order, t2025: { '06085504602': shuffled } };
  const stub = ersStub({ '/data/ers/06085.json': doc });
  try {
    const r = await loadErsTract('06085504602');
    assert.equal(r.e2025.pop2020, 2056);
    assert.equal(r.e2025.medianFamilyIncome, 144464);
    assert.equal(r.e2025.urban, true);
    assert.equal(r.e2025.groupQuarters, false);
  } finally {
    stub.restore();
  }
});

test('loadErsTract: 404 for the county file -> missing_row (and is not refetched)', async () => {
  resetErsCache();
  const stub = ersStub({ '/data/ers/72001.json': new Response('Not Found', { status: 404 }) });
  try {
    const r = await loadErsTract('72001956300');
    assert.deepEqual(r, { status: 'missing_row', e2025: null, e2019: null, e2019Reason: null, retrievedAt: null });
    await loadErsTract('72001956400');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('loadErsTract: other HTTP failures, network throws and malformed files -> unavailable; failures are retried', async () => {
  const unavailable = { status: 'unavailable', e2025: null, e2019: null, e2019Reason: null, retrievedAt: null };
  for (const bad of [
    new Response('oops', { status: 500 }),
    new TypeError('Failed to fetch'),
    new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    { ...ERS_06085, f2025: F2025.slice(1) }, // a required field is missing
    { ...ERS_06085, t2025: { '06085504602': [2, 1, 2056, 0, 0, 12, 600, 7.5, 144464, 0] } }, // flag must be 0/1/null
  ]) {
    resetErsCache();
    const stub = ersStub({ '/data/ers/06085.json': bad });
    try {
      assert.deepEqual(await loadErsTract('06085504602'), unavailable);
    } finally {
      stub.restore();
    }
  }
  resetErsCache();
  let fail = true;
  const stub = stubFetch(async () => (fail ? new Response('oops', { status: 500 }) : jsonResponse(ERS_06085)));
  try {
    assert.equal((await loadErsTract('06085504602')).status, 'unavailable');
    fail = false;
    assert.equal((await loadErsTract('06085504602')).status, 'ok');
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('loadErsTract: a malformed GEOID -> unavailable without fetching', async () => {
  resetErsCache();
  const stub = stubFetch(unexpected);
  try {
    assert.equal((await loadErsTract('0608550460')).status, 'unavailable');
    assert.equal((await loadErsTract(null)).status, 'unavailable');
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
