import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePlacedStoreScenario } from '../src/engine/scenarioEngine.js';
import { assembleCommunityData } from '../src/pipeline/normalizer.js';

// Synthetic tracts built through the real payload assembly, so the scenario
// is tested against exactly what buildCommunityData hands the UI.
//
// Default: urban, low income, 20 blocks x 100 residents (40 housing units
// each) on a 5 x 4 grid of 0.004 deg (about 0.28 mi) around C; the only
// counted store is about 2 mi north, so all 2,000 residents are beyond 1 mi.

const C = { lat: 37.42, lng: -121.97 };
const MI_LAT = 1 / 69;
const FAR_STORE = { lat: Number((C.lat + 2 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Far Mart' };

function gridBlocks({ rows = 5, cols = 4, step = 0.004, pop = 100, hu = 40 } = {}) {
  const blocks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      blocks.push({
        id: `06085504602${1000 + r * cols + c}`,
        pop,
        hu,
        lat: Number((C.lat + (r - (rows - 1) / 2) * step).toFixed(5)),
        lng: Number((C.lng + (c - (cols - 1) / 2) * step).toFixed(5)),
        ur: 'U',
        place: '',
      });
    }
  }
  return blocks;
}

function community({
  blocks = gridBlocks(),
  stores = [FAR_STORE],
  urban = true,
  lowIncome = true,
  tractHUNV = 120,
  ersStatus = 'ok',
  storesStatus = 'ok',
} = {}) {
  const pop = blocks.reduce((s, b) => s + b.pop, 0);
  return assembleCommunityData({
    lat: C.lat,
    lng: C.lng,
    tract: {
      status: 'ok',
      tract: { geoid: '06085504602', state: '06', county: '085', tract: '504602', name: 'Census Tract 5046.02', pop },
    },
    blocks: { status: 'ok', blocks, population: pop, source: 'bundled' },
    stores: storesStatus === 'ok'
      ? { status: 'ok', stores, dataset: { name: 'test', date: null, retrievedAt: null } }
      : { status: 'stores_unavailable', stores: [], dataset: null },
    ers: ersStatus === 'ok'
      ? {
        status: 'ok',
        e2025: { urban, lowIncome, sramLA: false, sramLILA: false, tractHUNV },
        e2019: null,
        e2019Reason: 'boundary_changed',
        retrievedAt: null,
      }
      : { status: 'missing_row', e2025: null, e2019: null, e2019Reason: null, retrievedAt: null },
  });
}

const pin = (lat, lng, format) => (format === undefined ? { lat, lng } : { lat, lng, format });
const CENTER_PIN = pin(C.lat, C.lng, 's');
const METRICS = (side) => ({
  population: side.population,
  beyond: side.beyond,
  share: side.share,
  byShare: side.byShare,
  byCount: side.byCount,
  lowAccess: side.lowAccess,
  verdict: side.verdict,
});

// Small seeded PRNG so the randomized test is reproducible.
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

test('0 pins, no blocks or no community -> null', () => {
  const data = community();
  assert.equal(evaluatePlacedStoreScenario(data, []), null);
  assert.equal(evaluatePlacedStoreScenario(data, null), null);
  assert.equal(evaluatePlacedStoreScenario(data, undefined), null);
  assert.equal(evaluatePlacedStoreScenario(data, [pin(NaN, 0, 's')]), null);
  assert.equal(evaluatePlacedStoreScenario(null, [CENTER_PIN]), null);
  const noBlocks = { ...data, access: { ...data.access, blocks: [] } };
  assert.equal(evaluatePlacedStoreScenario(noBlocks, [CENTER_PIN]), null);
});

test('no known baseline (stores unavailable) -> null', () => {
  assert.equal(evaluatePlacedStoreScenario(community({ storesStatus: 'down' }), [CENTER_PIN]), null);
});

test('before is exactly the baseline the tract card shows', () => {
  const data = community();
  const r = evaluatePlacedStoreScenario(data, [CENTER_PIN]);
  assert.equal(r.before.population, data.access.population);
  assert.equal(r.before.beyond, data.access.beyond);
  assert.equal(r.before.share, data.access.share);
  assert.equal(r.before.lowAccess, data.access.lowAccess);
  assert.deepEqual(r.before.verdict, data.access.verdict);
});

test('flip example: one supermarket in the middle of the tract', () => {
  const r = evaluatePlacedStoreScenario(community(), [CENTER_PIN]);
  assert.equal(r.counting, 1);
  assert.equal(r.nonCounting, 0);
  assert.equal(r.before.beyond, 2000);
  assert.equal(r.before.verdict.status, 'met');
  assert.equal(r.after.beyond, 0);
  assert.equal(r.after.share, 0);
  assert.equal(r.after.lowAccess, false);
  assert.equal(r.after.verdict.status, 'not_met');
  assert.equal(r.broughtWithin, 2000);
  assert.equal(r.flipped, true);
  assert.equal(r.gap, null);
});

test('a pin without a format counts as a supermarket', () => {
  const r = evaluatePlacedStoreScenario(community(), [pin(C.lat, C.lng)]);
  assert.equal(r.counting, 1);
  assert.equal(r.flipped, true);
});

test('an unknown format counts as a supermarket, as in share links', () => {
  const r = evaluatePlacedStoreScenario(community(), [pin(C.lat, C.lng, 'mega-mart')]);
  assert.equal(r.counting, 1);
  assert.equal(r.nonCounting, 0);
  assert.equal(r.flipped, true);
});

test('gap.residentsToClear matches a brute-force search at the 33% edge', () => {
  // 300 residents: 99 / 300 is exactly 33%, which is still low access.
  const blocks = gridBlocks({ rows: 3, cols: 1, step: 0.03, pop: 100 });
  const r = evaluatePlacedStoreScenario(community({ blocks, stores: [] }), [pin(-80, 0, 'g')]);
  assert.equal(r.after.beyond, 300);
  assert.equal(r.gap.residentsToClear, 300 - 98);
});

test('non-supermarket pins change nothing', () => {
  const data = community();
  const pins = ['g', 'd', 'f'].map((format) => pin(C.lat, C.lng, format));
  const r = evaluatePlacedStoreScenario(data, pins);
  assert.equal(r.counting, 0);
  assert.equal(r.nonCounting, 3);
  assert.deepEqual(METRICS(r.after), METRICS(r.before));
  assert.deepEqual(r.halfMile.after, r.halfMile.before);
  assert.deepEqual(r.noVehicleEstimate.after, r.noVehicleEstimate.before);
  assert.equal(r.broughtWithin, 0);
  assert.equal(r.flipped, false);
});

test('a duplicate pin changes nothing beyond the first copy', () => {
  const data = community();
  const p = pin(C.lat + 0.006, C.lng - 0.004, 's');
  const once = evaluatePlacedStoreScenario(data, [p]);
  const twice = evaluatePlacedStoreScenario(data, [p, { ...p }]);
  assert.deepEqual(METRICS(twice.after), METRICS(once.after));
  assert.deepEqual(twice.halfMile, once.halfMile);
  assert.deepEqual(twice.noVehicleEstimate, once.noVehicleEstimate);
  assert.equal(twice.broughtWithin, once.broughtWithin);
  assert.equal(twice.counting, 2);
});

test('a pin on top of an existing store changes nothing', () => {
  const r = evaluatePlacedStoreScenario(community(), [pin(FAR_STORE.lat, FAR_STORE.lng, 's')]);
  assert.deepEqual(METRICS(r.after), METRICS(r.before));
  assert.equal(r.broughtWithin, 0);
});

test('a pin 30 miles away changes nothing', () => {
  for (const urban of [true, false]) {
    const data = community({ urban, stores: urban ? [FAR_STORE] : [] });
    const r = evaluatePlacedStoreScenario(data, [pin(C.lat + 30 * MI_LAT, C.lng, 's')]);
    assert.equal(r.before.beyond, data.access.beyond);
    assert.equal(r.before.beyond, 2000);
    assert.deepEqual(METRICS(r.after), METRICS(r.before), `urban=${urban}`);
    assert.deepEqual(r.halfMile?.after, r.halfMile?.before);
    assert.equal(r.noVehicleEstimate.after, r.noVehicleEstimate.before);
    assert.equal(r.broughtWithin, 0);
  }
});

test('monotone: adding pins never raises beyond, never lowers residents within 1/2 mi', () => {
  const rand = mulberry32(20261002);
  const data = community();
  for (let trial = 0; trial < 40; trial++) {
    const pins = [];
    let prev = evaluatePlacedStoreScenario(data, [pin(C.lat, C.lng, 'g')]);
    for (let k = 0; k < 6; k++) {
      const format = rand() < 0.25 ? 'd' : 's';
      pins.push(pin(C.lat + (rand() - 0.5) * 0.08, C.lng + (rand() - 0.5) * 0.08, format));
      const r = evaluatePlacedStoreScenario(data, pins);
      assert.ok(r.after.beyond <= prev.after.beyond, 'beyond rose');
      assert.ok(r.halfMile.after >= prev.halfMile.after, 'half-mile residents fell');
      if (prev.noVehicleEstimate && r.noVehicleEstimate) {
        assert.ok(r.noVehicleEstimate.after <= prev.noVehicleEstimate.after + 1e-9, 'no-vehicle estimate rose');
      }
      assert.ok(!(prev.after.lowAccess === false && r.after.lowAccess === true), 'low access came back');
      assert.ok(r.broughtWithin >= 0);
      assert.ok(r.broughtWithin <= r.before.beyond);
      assert.equal(r.broughtWithin, r.before.beyond - r.after.beyond);
      assert.deepEqual(METRICS(r.before), METRICS(prev.before));
      prev = r;
    }
  }
});

test('the scenario keeps the baseline T and income', () => {
  // Not low income: access can flip, the test result can't.
  const notLi = evaluatePlacedStoreScenario(community({ lowIncome: false }), [CENTER_PIN]);
  assert.equal(notLi.before.verdict.status, 'not_met');
  assert.equal(notLi.after.lowAccess, false);
  assert.equal(notLi.after.verdict.status, 'not_met');
  assert.equal(notLi.flipped, false);

  // Income unknown: Unknown before, NOT MET once no longer low access.
  const noIncome = evaluatePlacedStoreScenario(community({ ersStatus: 'missing' }), [CENTER_PIN]);
  assert.equal(noIncome.before.verdict.status, 'unknown');
  assert.equal(noIncome.after.verdict.status, 'not_met');
  assert.equal(noIncome.flipped, false);
});

test('rural tracts use T = 10 mi and report no half-mile row', () => {
  const store8 = { lat: Number((C.lat + 8 * MI_LAT).toFixed(5)), lng: C.lng, type: 'M', name: 'Eight' };
  const data = community({ urban: false, stores: [store8] });
  assert.equal(data.access.threshold, 10);
  const r = evaluatePlacedStoreScenario(data, [CENTER_PIN]);
  // A store 8 mi out already serves everyone at T = 10 mi, even though the
  // payload's map list (bbox + 5 mi) leaves it out.
  assert.equal(r.before.beyond, 0);
  assert.equal(r.after.beyond, 0);
  assert.equal(r.halfMile, null);
});

test('gap: residents and share points still over the limit when the pin does not flip', () => {
  // A pin one row north of the grid's west corner covers its 7 nearest
  // blocks only: 1,300 of 2,000 residents stay beyond 1 mi.
  const r = evaluatePlacedStoreScenario(community(), [pin(C.lat + 0.016, C.lng - 0.006, 's')]);
  assert.equal(r.after.beyond, 1300);
  assert.equal(r.after.lowAccess, true);
  assert.equal(r.flipped, false);
  assert.ok(r.after.byCount && r.after.byShare);
  assert.equal(r.gap.residentsOver, r.after.beyond - 499);
  assert.ok(Math.abs(r.gap.shareOverPct - (r.after.share * 100 - 33)) < 1e-9);
  // residentsToClear: bringing that many more within ends low access.
  const left = r.after.beyond - r.gap.residentsToClear;
  assert.ok(left < 500 && left / r.after.population < 0.33);
  assert.ok(left + 1 >= 500 || (left + 1) / r.after.population >= 0.33);
});

test('gap: only the legs that are still triggered are reported', () => {
  // 1,000 residents, 400 beyond after the pin: share 40% but count under 500.
  const blocks = gridBlocks({ rows: 5, cols: 2, step: 0.004, pop: 100 });
  const data = community({ blocks });
  // A pin one row south of the grid covers its 3 southern rows (600
  // residents); the 4th row is about 1.1 mi away.
  const r = evaluatePlacedStoreScenario(data, [pin(C.lat - 0.012, C.lng, 's')]);
  assert.equal(r.after.population, 1000);
  assert.equal(r.after.beyond, 400);
  assert.equal(r.after.byCount, false);
  assert.equal(r.after.byShare, true);
  assert.equal(r.gap.residentsOver, null);
  assert.ok(Math.abs(r.gap.shareOverPct - (r.after.share * 100 - 33)) < 1e-9);
  assert.equal(r.gap.residentsToClear, r.after.beyond - 329);
});

test('half-mile residents (urban only) before and after', () => {
  const r = evaluatePlacedStoreScenario(community(), [CENTER_PIN]);
  assert.equal(r.halfMile.before, 0);
  // The grid spans about +/-0.55 mi by +/-0.3 mi; the corner blocks are
  // beyond half a mile from the centre pin.
  assert.ok(r.halfMile.after > 0 && r.halfMile.after < 2000);
});

test('no-vehicle households beyond 1/2 mi: TractHUNV apportioned by housing units', () => {
  const r = evaluatePlacedStoreScenario(community({ tractHUNV: 120 }), [CENTER_PIN]);
  assert.equal(r.noVehicleEstimate.before, 120);
  const huBeyondShare = (2000 - r.halfMile.after) / 2000; // equal HU per resident here
  assert.ok(Math.abs(r.noVehicleEstimate.after - 120 * huBeyondShare) < 1e-9);
});

test('no-vehicle estimate is null without TractHUNV or under 20 households', () => {
  assert.equal(evaluatePlacedStoreScenario(community({ tractHUNV: null }), [CENTER_PIN]).noVehicleEstimate, null);
  assert.equal(evaluatePlacedStoreScenario(community({ tractHUNV: 19 }), [CENTER_PIN]).noVehicleEstimate, null);
  assert.equal(evaluatePlacedStoreScenario(community({ ersStatus: 'missing' }), [CENTER_PIN]).noVehicleEstimate, null);
});

test('a hand-built payload without baseline miles is recomputed from blocks + stores', () => {
  const data = community();
  const bare = {
    ...data,
    access: {
      ...data.access,
      blocks: data.access.blocks.map(({ pop, hu, lat, lng }) => ({ pop, hu, lat, lng })),
      stores: [FAR_STORE],
    },
  };
  const a = evaluatePlacedStoreScenario(data, [CENTER_PIN]);
  const b = evaluatePlacedStoreScenario(bare, [CENTER_PIN]);
  assert.deepEqual(b, a);
});
