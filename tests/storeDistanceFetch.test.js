import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunitySamplePoints,
  computeCommunityDistanceMetrics,
  legacySamplePlan,
} from '../src/pipeline/storeDistanceFetch.js';
import { pointInRings } from '../src/pipeline/tractGeometry.js';

const SF_LAT = 37.773;
const SF_LNG = -122.418;

// A ~0.6 x 0.5 mile block around the SF anchor — roughly a dense urban tract.
const SMALL_TRACT = [[
  [SF_LNG - 0.005, SF_LAT - 0.004],
  [SF_LNG - 0.005, SF_LAT + 0.004],
  [SF_LNG + 0.005, SF_LAT + 0.004],
  [SF_LNG + 0.005, SF_LAT - 0.004],
  [SF_LNG - 0.005, SF_LAT - 0.004],
]];

function planFromGroups(groups, distanceModel) {
  return { distanceModel, groups };
}

test('buildCommunitySamplePoints returns center plus surrounding sample points', () => {
  const points = buildCommunitySamplePoints(SF_LAT, SF_LNG);

  assert.equal(points.length, 9);
  assert.ok(points.some((p) => Math.abs(p.lat - SF_LAT) < 1e-9 && Math.abs(p.lng - SF_LNG) < 1e-9));
});

test('buildCommunitySamplePoints scales the spread to the tract', () => {
  // The regression this guards: offsets were fixed at 1-1.5 miles regardless
  // of tract size, so on a small urban tract most samples measured a
  // neighbouring tract — and 1.5 mi exceeds the 1 mi urban decision threshold.
  const full = buildCommunitySamplePoints(SF_LAT, SF_LNG, 1);
  const shrunk = buildCommunitySamplePoints(SF_LAT, SF_LNG, 0.1);

  const spread = (pts) => Math.max(...pts.map((p) => Math.abs(p.lat - SF_LAT)));
  assert.ok(spread(shrunk) < spread(full) / 5, 'scaled plan must sample much closer in');
});

test('the legacy fixed grid escapes a small urban tract', () => {
  // Documents the bug being fixed: on a tract this size, most of the old
  // model's sample points fall outside it entirely.
  const escaped = legacySamplePlan(SF_LAT, SF_LNG).groups[0].points
    .filter((p) => !pointInRings(p.lat, p.lng, SMALL_TRACT));

  assert.ok(escaped.length >= 8, `expected most samples outside the tract, got ${escaped.length}`);
});

test('metrics are null when no stores are present', () => {
  const metrics = computeCommunityDistanceMetrics([], SF_LAT, SF_LNG);

  assert.equal(metrics.centerNearestSupermarketMiles, null);
  assert.equal(metrics.communityAverageSupermarketMiles, null);
  // Samples that produced a distance, not samples attempted.
  assert.equal(metrics.sampleCount, 0);
  assert.equal(metrics.sampleAttemptCount, 9);
});

test('metrics compute center-nearest and community-average distances', () => {
  const metrics = computeCommunityDistanceMetrics(
    [{ lat: SF_LAT, lon: SF_LNG }],
    SF_LAT,
    SF_LNG,
  );

  assert.equal(metrics.centerNearestSupermarketMiles, 0);
  assert.ok(metrics.communityAverageSupermarketMiles > 0);
  assert.ok(metrics.communityAverageSupermarketMiles < 3);
  assert.equal(metrics.sampleCount, 9);
  assert.equal(metrics.distanceModel, 'fixed_offset_grid');
});

test('population weighting pulls the average toward where people live', () => {
  /*
   * Two block groups. One holds nearly everyone and sits on top of the store;
   * the other is empty land far away. The unweighted mean of the two group
   * means would be about halfway between. The weighted mean must land near
   * the populated one — this is the uninhabited-land bias that plain
   * polygon sampling still gets wrong.
   */
  const store = [{ lat: SF_LAT, lon: SF_LNG }];
  const populated = { geoid: '1', population: 4000, points: [{ lat: SF_LAT, lng: SF_LNG }] };
  const empty = { geoid: '2', population: 5, points: [{ lat: SF_LAT + 0.29, lng: SF_LNG }] };

  const weighted = computeCommunityDistanceMetrics(
    store, SF_LAT, SF_LNG,
    planFromGroups([populated, empty], 'block_group_population_weighted'),
  );
  const unweighted = computeCommunityDistanceMetrics(
    store, SF_LAT, SF_LNG,
    planFromGroups(
      [{ ...populated, population: null }, { ...empty, population: null }],
      'block_group_uniform',
    ),
  );

  assert.ok(weighted.communityAverageSupermarketMiles < 1,
    `weighted should be near the populated group, got ${weighted.communityAverageSupermarketMiles}`);
  assert.ok(unweighted.communityAverageSupermarketMiles > 9,
    `unweighted should sit midway, got ${unweighted.communityAverageSupermarketMiles}`);
});

test('block groups that found no store are excluded, not counted as zero', () => {
  // A group contributing no measurement must drop out of the weighting
  // entirely; counting it as 0 miles would understate the distance.
  const metrics = computeCommunityDistanceMetrics(
    [{ lat: SF_LAT, lon: SF_LNG }],
    SF_LAT,
    SF_LNG,
    planFromGroups([
      { geoid: '1', population: 100, points: [{ lat: SF_LAT, lng: SF_LNG }] },
      { geoid: '2', population: 100, points: [] },
    ], 'block_group_population_weighted'),
  );

  assert.equal(metrics.communityAverageSupermarketMiles, 0);
  assert.equal(metrics.sampleCount, 1);
  assert.equal(metrics.sampleAttemptCount, 1);
});

test('the distance model label travels with the metrics', () => {
  // The evidence trace uses this to say which rung produced the number, so a
  // fallback result is not shown with the same confidence as real polygons.
  for (const model of [
    'block_group_population_weighted',
    'block_group_uniform',
    'tract_area_scaled_grid',
    'fixed_offset_grid',
  ]) {
    const metrics = computeCommunityDistanceMetrics(
      [{ lat: SF_LAT, lon: SF_LNG }],
      SF_LAT,
      SF_LNG,
      planFromGroups([{ geoid: null, population: null, points: [{ lat: SF_LAT, lng: SF_LNG }] }], model),
    );
    assert.equal(metrics.distanceModel, model);
  }
});

// ── The sampling ladder ─────────────────────────────────────────────────────
/*
 * buildSamplePlan degrades through four rungs. Each must be reachable and
 * must label itself, because a designation produced by rung 4 deserves less
 * confidence than one from rung 1 and the UI has to be able to tell them
 * apart.
 */

function mockGeometry(response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: response != null,
    status: response != null ? 200 : 502,
    json: async () => response,
  });
  return () => { globalThis.fetch = original; };
}

// Each test uses a distinct FIPS: buildSamplePlan memoises geometry per tract.
test('rung 1: block groups with population produce a weighted plan', async () => {
  const restore = mockGeometry({
    blockGroups: [
      { geoid: '060750107001', population: 1200, rings: SMALL_TRACT },
      { geoid: '060750107002', population: 800, rings: SMALL_TRACT },
    ],
  });
  try {
    const { buildSamplePlan } = await import('../src/pipeline/storeDistanceFetch.js');
    const plan = await buildSamplePlan(SF_LAT, SF_LNG, { fips: '06075010701' });

    assert.equal(plan.distanceModel, 'block_group_population_weighted');
    assert.equal(plan.groups.length, 2);
    for (const group of plan.groups) {
      assert.ok(group.points.length > 0);
      for (const p of group.points) {
        assert.ok(pointInRings(p.lat, p.lng, SMALL_TRACT), 'every sample must be inside the polygon');
      }
    }
  } finally { restore(); }
});

test('rung 2: block groups without population fall back to uniform', async () => {
  const restore = mockGeometry({
    blockGroups: [{ geoid: '060750107021', population: null, rings: SMALL_TRACT }],
  });
  try {
    const { buildSamplePlan } = await import('../src/pipeline/storeDistanceFetch.js');
    const plan = await buildSamplePlan(SF_LAT, SF_LNG, { fips: '06075010702' });

    assert.equal(plan.distanceModel, 'block_group_uniform');
  } finally { restore(); }
});

test('rung 3: no geometry but known land area scales the grid', async () => {
  const restore = mockGeometry(null);
  try {
    const { buildSamplePlan } = await import('../src/pipeline/storeDistanceFetch.js');
    // 0.25 sq mi — a typical dense urban tract.
    const plan = await buildSamplePlan(SF_LAT, SF_LNG, {
      fips: '06075010703',
      arealandSqMeters: 647497,
      internalLat: SF_LAT,
      internalLng: SF_LNG,
    });

    assert.equal(plan.distanceModel, 'tract_area_scaled_grid');
    const spread = Math.max(...plan.groups[0].points.map((p) => Math.abs(p.lat - SF_LAT)));
    // Half a mile is ~0.0072 deg; a 0.5-mile tract must sample well inside that.
    assert.ok(spread < 0.005, `samples spread too far for a 0.25 sq mi tract: ${spread}`);
  } finally { restore(); }
});

test('rung 4: nothing known falls back to the legacy fixed grid', async () => {
  const restore = mockGeometry(null);
  try {
    const { buildSamplePlan } = await import('../src/pipeline/storeDistanceFetch.js');
    const plan = await buildSamplePlan(SF_LAT, SF_LNG, { fips: '06075010704' });

    assert.equal(plan.distanceModel, 'fixed_offset_grid');
    assert.equal(plan.groups[0].points.length, 9);
  } finally { restore(); }
});

test('a tract with no fips skips the geometry lookup entirely', async () => {
  const { buildSamplePlan } = await import('../src/pipeline/storeDistanceFetch.js');
  const plan = await buildSamplePlan(SF_LAT, SF_LNG, {});

  assert.equal(plan.distanceModel, 'fixed_offset_grid');
});
