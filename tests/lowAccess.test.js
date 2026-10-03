import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineMiles, pointInPolygon } from '../src/lib/geo.js';
import {
  COUNT_THRESHOLD,
  SHARE_THRESHOLD,
  distanceBands,
  isBorderline,
  nearestDistances,
  nearestStore,
  populationLowAccess,
  populationLowAccessFromDistances,
} from '../src/engine/lowAccess.js';

// Small seeded PRNG so the randomized tests are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPoints(rand, n, { lat0, lat1, lng0, lng1 }, withPop = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = {
      lat: lat0 + rand() * (lat1 - lat0),
      lng: lng0 + rand() * (lng1 - lng0),
    };
    if (withPop) {
      p.pop = Math.floor(rand() * 60);
      p.hu = Math.floor(p.pop / 2.5);
    }
    out.push(p);
  }
  return out;
}

function bruteNearest(blocks, stores) {
  const out = new Float64Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    let best = Infinity;
    for (const s of stores) {
      const d = haversineMiles(blocks[i].lat, blocks[i].lng, s.lat, s.lng);
      if (d < best) best = d;
    }
    out[i] = best;
  }
  return out;
}

// Blocks whose distances are given directly; coordinates are irrelevant to
// populationLowAccessFromDistances.
function blocksWithPops(pops) {
  return pops.map((pop) => ({ pop, hu: 0, lat: 0, lng: 0 }));
}

// --- geo ------------------------------------------------------------------

test('haversineMiles matches the storeDistanceFetch formula (3958.8 mi radius)', () => {
  // Reference values produced by src/pipeline/storeDistanceFetch.js on 2026-10-02.
  const cases = [
    [[37.42105, -121.9727, 37.3382, -121.8863], 7.43453010908616],
    [[33.4106, -91.0618, 33.4, -91.05], 0.9998237675612783],
    [[36.1544, -109.5526, 35.687, -105.9378], 204.81326330273396],
    [[64.8378, -147.7164, 61.2181, -149.9003], 259.2562655695326],
    [[51.88, 179.5, 51.85, -179.4], 46.97871786210717],
    [[0, 0, 0, 0], 0],
  ];
  for (const [args, expected] of cases) {
    assert.equal(haversineMiles(...args), expected);
  }
});

test('pointInPolygon uses [lng, lat] rings with even-odd over all rings', () => {
  // A wide, short rectangle catches swapped axes: lng 10..20, lat 0..1.
  const rect = [[[10, 0], [20, 0], [20, 1], [10, 1], [10, 0]]];
  assert.equal(pointInPolygon(0.5, 15, rect), true);
  assert.equal(pointInPolygon(15, 0.5, rect), false);
  assert.equal(pointInPolygon(1.5, 15, rect), false);

  const outer = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]];
  const island = [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]];
  const rings = [outer, hole, island];
  assert.equal(pointInPolygon(0.1, 0.1, rings), true);
  assert.equal(pointInPolygon(0.5, 0.5, rings), false, 'inside the hole');
  assert.equal(pointInPolygon(2.5, 2.5, rings), true, 'second part');
  assert.equal(pointInPolygon(1.5, 1.5, rings), false);
  assert.equal(pointInPolygon(0.5, 0.5, []), false);
});

// --- counting rule ----------------------------------------------------------

test('thresholds are the ERS ones', () => {
  assert.equal(SHARE_THRESHOLD, 0.33);
  assert.equal(COUNT_THRESHOLD, 500);
});

test('share exactly 33% is low access; just under is not', () => {
  const at = populationLowAccessFromDistances(blocksWithPops([330, 670]), [2, 0.5], 1);
  assert.deepEqual(at, {
    population: 1000,
    beyond: 330,
    share: 0.33,
    byShare: true,
    byCount: false,
    lowAccess: true,
  });

  const under = populationLowAccessFromDistances(blocksWithPops([329, 671]), [2, 0.5], 1);
  assert.equal(under.beyond, 329);
  assert.equal(under.byShare, false);
  assert.equal(under.byCount, false);
  assert.equal(under.lowAccess, false);

  const small = populationLowAccessFromDistances(blocksWithPops([33, 67]), [5, 0.1], 1);
  assert.equal(small.share, 0.33);
  assert.equal(small.lowAccess, true);
});

test('500 residents beyond is low access by count; 499 is not', () => {
  const pops = [499, 9501];
  const under = populationLowAccessFromDistances(blocksWithPops(pops), [3, 0.2], 1);
  assert.equal(under.beyond, 499);
  assert.equal(under.byCount, false);
  assert.equal(under.byShare, false);
  assert.equal(under.lowAccess, false);

  const at = populationLowAccessFromDistances(blocksWithPops([500, 9500]), [3, 0.2], 1);
  assert.equal(at.beyond, 500);
  assert.equal(at.share, 0.05);
  assert.equal(at.byCount, true);
  assert.equal(at.byShare, false);
  assert.equal(at.lowAccess, true);
});

test('a block at exactly T counts as within', () => {
  const r = populationLowAccessFromDistances(blocksWithPops([800]), [1], 1);
  assert.equal(r.beyond, 0);
  assert.equal(r.lowAccess, false);

  const rural = populationLowAccessFromDistances(blocksWithPops([800]), [10], 10);
  assert.equal(rural.beyond, 0);

  const justOver = populationLowAccessFromDistances(blocksWithPops([800]), [1.0000001], 1);
  assert.equal(justOver.beyond, 800);

  // End to end: T equal to the computed distance keeps the block within.
  const block = { pop: 800, hu: 300, lat: 37.4211, lng: -121.9727 };
  const store = { lat: 37.4355, lng: -121.9621 };
  const T = haversineMiles(block.lat, block.lng, store.lat, store.lng);
  assert.equal(populationLowAccess([block], [store], T).beyond, 0);
});

test('population 0 gives share null and lowAccess null', () => {
  for (const blocks of [[], blocksWithPops([0, 0])]) {
    const r = populationLowAccessFromDistances(blocks, new Float64Array(blocks.length).fill(5), 1);
    assert.equal(r.population, 0);
    assert.equal(r.beyond, 0);
    assert.equal(r.share, null);
    assert.equal(r.byShare, null);
    assert.equal(r.byCount, null);
    assert.equal(r.lowAccess, null);
  }
  const viaStores = populationLowAccess(blocksWithPops([0]), [{ lat: 1, lng: 1 }], 1);
  assert.equal(viaStores.lowAccess, null);
});

test('zero-population blocks never count, however far', () => {
  const r = populationLowAccessFromDistances(blocksWithPops([0, 100]), [50, 0.5], 1);
  assert.equal(r.population, 100);
  assert.equal(r.beyond, 0);
  assert.equal(r.lowAccess, false);
});

test('a block without a position is never counted as within', () => {
  const blocks = [
    { pop: 40, hu: 10, lat: NaN, lng: -121.9 },
    { pop: 60, hu: 20, lat: 37.4, lng: -121.9 },
  ];
  const d = nearestDistances(blocks, [{ lat: 37.4, lng: -121.9 }]);
  assert.ok(Number.isNaN(d[0]));
  assert.equal(d[1], 0);
  assert.equal(populationLowAccessFromDistances(blocks, d, 1).beyond, 40);
  assert.equal(distanceBands(blocks, d, 1)[2].residents, 40);
});

test('distances must align with blocks', () => {
  const blocks = blocksWithPops([10, 20]);
  assert.throws(() => populationLowAccessFromDistances(blocks, [0.5], 1), RangeError);
  assert.throws(() => distanceBands(blocks, [0.5, 0.5, 0.5], 1), RangeError);
  assert.throws(() => isBorderline(blocks, [], 1), RangeError);
});

test('no stores: every block is Infinity miles and beyond', () => {
  const blocks = [
    { pop: 10, hu: 4, lat: 37.4, lng: -121.9 },
    { pop: 20, hu: 8, lat: 37.41, lng: -121.91 },
  ];
  const d = nearestDistances(blocks, []);
  assert.ok(d instanceof Float64Array);
  assert.deepEqual([...d], [Infinity, Infinity]);
  const r = populationLowAccess(blocks, [], 1);
  assert.equal(r.beyond, 30);
  assert.equal(r.share, 1);
  assert.equal(r.lowAccess, true);
  assert.deepEqual(nearestStore(37.4, -121.9, []), { miles: Infinity, store: null });
});

test('populationLowAccess equals the distances path', () => {
  const rand = mulberry32(7);
  const box = { lat0: 37.38, lat1: 37.46, lng0: -122.0, lng1: -121.92 };
  const blocks = randomPoints(rand, 300, box, true);
  const stores = randomPoints(rand, 6, box);
  const viaDistances = populationLowAccessFromDistances(blocks, nearestDistances(blocks, stores), 1);
  assert.deepEqual(populationLowAccess(blocks, stores, 1), viaDistances);
});

// --- invariances ------------------------------------------------------------

test('a duplicate store or a store 30 mi away leaves results unchanged', () => {
  const rand = mulberry32(42);
  const box = { lat0: 37.40, lat1: 37.44, lng0: -121.99, lng1: -121.94 };
  const blocks = randomPoints(rand, 250, box, true);
  const stores = [
    { lat: 37.4355, lng: -121.9621, name: 'A' },
    { lat: 37.3900, lng: -121.9300, name: 'B' },
    { lat: 37.4500, lng: -122.0100, name: 'C' },
  ];
  const baseD = nearestDistances(blocks, stores);
  const base = populationLowAccess(blocks, stores, 1);
  assert.ok(base.beyond > 0, 'fixture has someone beyond 1 mi');
  assert.ok(base.beyond < base.population, 'fixture has someone within 1 mi');

  const dup = [...stores, { ...stores[0], name: 'A again' }];
  assert.deepEqual(nearestDistances(blocks, dup), baseD);
  assert.deepEqual(populationLowAccess(blocks, dup, 1), base);

  const far = [...stores, { lat: 37.42 + 30 / 69, lng: -121.965, name: 'Far' }];
  assert.deepEqual(nearestDistances(blocks, far), baseD);
  assert.deepEqual(populationLowAccess(blocks, far, 1), base);
  assert.deepEqual(distanceBands(blocks, nearestDistances(blocks, far), 1), distanceBands(blocks, baseD, 1));
});

test('adding a store never raises beyond (seeded property over nested store sets)', () => {
  const rand = mulberry32(20261002);
  let nestedSets = 0;
  for (let trial = 0; trial < 20; trial++) {
    const lat0 = 33 + rand() * 4;
    const lng0 = -122 + rand() * 30;
    const T = trial % 4 === 0 ? 10 : 1;
    const span = T === 10 ? 0.8 : 0.15;
    const blocks = randomPoints(rand, 150, { lat0, lat1: lat0 + span, lng0, lng1: lng0 + span }, true);
    const pool = randomPoints(rand, 15, {
      lat0: lat0 - span / 2,
      lat1: lat0 + span * 1.5,
      lng0: lng0 - span / 2,
      lng1: lng0 + span * 1.5,
    });

    let prevD = nearestDistances(blocks, []);
    let prev = populationLowAccessFromDistances(blocks, prevD, T);
    nestedSets++;
    for (let k = 1; k <= pool.length; k++) {
      const stores = pool.slice(0, k);
      const d = nearestDistances(blocks, stores);
      const r = populationLowAccessFromDistances(blocks, d, T);
      nestedSets++;
      assert.ok(r.beyond <= prev.beyond, `trial ${trial} k=${k}: ${r.beyond} > ${prev.beyond}`);
      if (prev.lowAccess === false) assert.equal(r.lowAccess, false);
      // Adding one store is min(before, distance to it) per block.
      const added = nearestDistances(blocks, [pool[k - 1]]);
      for (let i = 0; i < blocks.length; i++) {
        assert.ok(d[i] <= prevD[i]);
        assert.equal(d[i], Math.min(prevD[i], added[i]));
      }
      prevD = d;
      prev = r;
    }
  }
  assert.ok(nestedSets >= 300, `ran ${nestedSets} nested store sets`);
});

// --- grid index vs brute force ---------------------------------------------

test('grid nearestDistances equals brute force on random data (0 mismatches)', () => {
  const rand = mulberry32(1234);
  const scenarios = [
    // Dense metro: many stores, blocks inside and around them.
    {
      blocks: randomPoints(rand, 4000, { lat0: 37.0, lat1: 37.7, lng0: -122.3, lng1: -121.5 }),
      stores: randomPoints(rand, 900, { lat0: 37.1, lat1: 37.6, lng0: -122.2, lng1: -121.6 }),
    },
    // Sparse rural: a few stores over a wide area.
    {
      blocks: randomPoints(rand, 2000, { lat0: 34.5, lat1: 37.5, lng0: -110.5, lng1: -108.5 }),
      stores: randomPoints(rand, 25, { lat0: 34, lat1: 38, lng0: -112, lng1: -107 }),
    },
    // High latitude, where a degree of longitude is short.
    {
      blocks: randomPoints(rand, 1500, { lat0: 60, lat1: 71, lng0: -165, lng1: -141 }),
      stores: randomPoints(rand, 60, { lat0: 59, lat1: 71.3, lng0: -166, lng1: -140 }),
    },
    // Blocks far outside the stores' bounding box.
    {
      blocks: randomPoints(rand, 800, { lat0: 40, lat1: 42, lng0: -115, lng1: -112 }),
      stores: randomPoints(rand, 300, { lat0: 34, lat1: 36, lng0: -119, lng1: -117 }),
    },
    // Across the antimeridian (Aleutians).
    {
      blocks: [
        ...randomPoints(rand, 300, { lat0: 51, lat1: 53, lng0: 178.5, lng1: 179.999 }),
        ...randomPoints(rand, 300, { lat0: 51, lat1: 53, lng0: -179.999, lng1: -178.5 }),
      ],
      stores: [
        ...randomPoints(rand, 8, { lat0: 51, lat1: 53, lng0: 179.5, lng1: 179.99 }),
        ...randomPoints(rand, 8, { lat0: 51, lat1: 53, lng0: -179.99, lng1: -177 }),
      ],
    },
    // Duplicates, a store on top of a block, an invalid store, one-store case.
    (() => {
      const blocks = randomPoints(rand, 500, { lat0: 33.3, lat1: 33.5, lng0: -91.2, lng1: -90.9 });
      const stores = randomPoints(rand, 5, { lat0: 33.3, lat1: 33.5, lng0: -91.2, lng1: -90.9 });
      stores.push({ ...stores[0] }, { lat: blocks[3].lat, lng: blocks[3].lng }, { lat: NaN, lng: -91 });
      return { blocks, stores };
    })(),
    {
      blocks: randomPoints(rand, 500, { lat0: 33, lat1: 34, lng0: -92, lng1: -90 }),
      stores: [{ lat: 33.41, lng: -91.06 }],
    },
  ];

  let mismatches = 0;
  let compared = 0;
  for (const { blocks, stores } of scenarios) {
    const grid = nearestDistances(blocks, stores);
    const brute = bruteNearest(blocks, stores);
    assert.equal(grid.length, blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      compared++;
      if (grid[i] !== brute[i]) mismatches++;
    }
  }
  assert.equal(mismatches, 0, `${mismatches} of ${compared} blocks differ from brute force`);
});

test('nearestStore returns the nearest store object and its distance', () => {
  const rand = mulberry32(99);
  const box = { lat0: 37.2, lat1: 37.5, lng0: -122.1, lng1: -121.8 };
  const stores = randomPoints(rand, 200, box).map((s, i) => ({ ...s, name: `S${i}` }));
  const probes = randomPoints(rand, 200, { lat0: 37.0, lat1: 37.7, lng0: -122.3, lng1: -121.6 });
  const brute = bruteNearest(probes, stores);
  probes.forEach((p, i) => {
    const r = nearestStore(p.lat, p.lng, stores);
    assert.equal(r.miles, brute[i]);
    assert.ok(stores.includes(r.store));
    assert.equal(haversineMiles(p.lat, p.lng, r.store.lat, r.store.lng), r.miles);
  });
  const withBad = [{ lat: '37.3', lng: '-121.9' }, null, { lat: 37.5, lng: -122.0 }];
  assert.equal(nearestStore(37.3, -121.9, withBad).store, withBad[2]);
  const noSpot = nearestStore(NaN, -121.9, stores);
  assert.ok(Number.isNaN(noSpot.miles));
  assert.equal(noSpot.store, null);
});

// --- distance bands ---------------------------------------------------------

test('distanceBands split residents beyond T into (T,1.1T], (1.1T,1.5T], >1.5T', () => {
  const blocks = blocksWithPops([1, 2, 4, 8, 16, 32, 64]);
  const d = [1, 1.05, 1.1, 1.10001, 1.5, 1.6, Infinity];
  assert.deepEqual(distanceBands(blocks, d, 1), [
    { fromMi: 1, toMi: 1.1, residents: 6 },
    { fromMi: 1.1, toMi: 1.5, residents: 24 },
    { fromMi: 1.5, toMi: null, residents: 96 },
  ]);
  assert.equal(populationLowAccessFromDistances(blocks, d, 1).beyond, 126);

  const rural = distanceBands(blocksWithPops([5, 7, 11]), [11, 15, 15.5], 10);
  assert.deepEqual(rural, [
    { fromMi: 10, toMi: 11, residents: 5 },
    { fromMi: 11, toMi: 15, residents: 7 },
    { fromMi: 15, toMi: null, residents: 11 },
  ]);
});

test('distance bands sum to beyond on random data', () => {
  const rand = mulberry32(5);
  for (const T of [1, 10]) {
    const span = T === 1 ? 0.2 : 1.5;
    const box = { lat0: 36, lat1: 36 + span, lng0: -110, lng1: -110 + span };
    const blocks = randomPoints(rand, 1000, box, true);
    const stores = randomPoints(rand, 4, box);
    const d = nearestDistances(blocks, stores);
    const bands = distanceBands(blocks, d, T);
    const { beyond } = populationLowAccessFromDistances(blocks, d, T);
    assert.ok(beyond > 0);
    assert.equal(bands.reduce((s, b) => s + b.residents, 0), beyond);
  }
});

// --- borderline -------------------------------------------------------------

test('isBorderline is true when the flag differs between 0.9T and 1.1T', () => {
  // 400 of 1,000 sit at exactly 1 mi: beyond at 0.9 mi, within at 1.1 mi.
  const blocks = blocksWithPops([400, 600]);
  assert.equal(isBorderline(blocks, [1.0, 0.2], 1), true);
  assert.equal(isBorderline(blocks, [10.0, 2], 10), true);
  // Same people at 1.05 mi (beyond T itself) is still borderline.
  assert.equal(isBorderline(blocks, [1.05, 0.2], 1), true);
});

test('isBorderline is false when the flag holds across 0.9T..1.1T', () => {
  const blocks = blocksWithPops([400, 600]);
  assert.equal(isBorderline(blocks, [3, 0.2], 1), false, 'clearly low access');
  assert.equal(isBorderline(blocks, [0.2, 0.3], 1), false, 'clearly served');
  assert.equal(isBorderline(blocks, [0.85, 0.2], 1), false, 'within even at 0.9T');
  assert.equal(isBorderline(blocksWithPops([0]), [5], 1), false, 'no residents');
});
