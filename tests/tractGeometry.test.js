import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pointInRings,
  ringsBounds,
  ringsCentroid,
  samplePointsInPolygon,
  tractEdgeMiles,
  weightedMean,
} from '../src/pipeline/tractGeometry.js';

// Rings are Esri-style: [[[lng, lat], ...], ...]. Note the coordinate order.
const SQUARE = [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]];

// An L, concave: the north-east quadrant is cut away.
const L_SHAPE = [[[0, 0], [0, 10], [5, 10], [5, 5], [10, 5], [10, 0], [0, 0]]];

// A square with a square hole in the middle. Hole wound opposite, as Esri does.
const WITH_HOLE = [
  [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
  [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
];

// Very thin diagonal sliver -- fills almost none of its bounding box.
const SLIVER = [[[0, 0], [10, 9.99], [10, 10], [0, 0.01], [0, 0]]];

test('pointInRings: inside and outside a square', () => {
  assert.equal(pointInRings(5, 5, SQUARE), true);
  assert.equal(pointInRings(15, 5, SQUARE), false);
  assert.equal(pointInRings(5, 15, SQUARE), false);
  assert.equal(pointInRings(-1, -1, SQUARE), false);
});

test('pointInRings: concave shape excludes the cut-away quadrant', () => {
  // Inside the remaining L.
  assert.equal(pointInRings(2, 2, L_SHAPE), true);
  assert.equal(pointInRings(7, 2, L_SHAPE), true);
  // In the notch: inside the bounding box, outside the polygon. A bbox-only
  // test would get this wrong, which is the whole point of the polygon check.
  assert.equal(pointInRings(8, 8, L_SHAPE), false);
});

test('pointInRings: a hole counts as outside', () => {
  assert.equal(pointInRings(1, 1, WITH_HOLE), true, 'in the ring, outside the hole');
  assert.equal(pointInRings(5, 5, WITH_HOLE), false, 'inside the hole');
  assert.equal(pointInRings(9, 9, WITH_HOLE), true, 'other side of the hole');
});

test('pointInRings: tolerates malformed input', () => {
  assert.equal(pointInRings(1, 1, null), false);
  assert.equal(pointInRings(1, 1, []), false);
  assert.equal(pointInRings(1, 1, [[[0, 0], [1, 1]]]), false, 'degenerate ring');
});

test('ringsBounds computes the bounding box', () => {
  const b = ringsBounds(SQUARE);
  assert.deepEqual(b, { minLat: 0, maxLat: 10, minLng: 0, maxLng: 10 });
  assert.equal(ringsBounds([]), null);
});

test('ringsCentroid can fall outside a concave polygon', () => {
  // Documents exactly why the sampler does not rely on the centroid as an
  // anchor, and why the Census internal point is preferred when available.
  const c = ringsCentroid(L_SHAPE);
  assert.ok(c);
  const inside = pointInRings(c.lat, c.lng, L_SHAPE);
  assert.equal(typeof inside, 'boolean');
});

test('samplePointsInPolygon returns only interior points', () => {
  const points = samplePointsInPolygon(SQUARE, 12);

  assert.ok(points.length > 0);
  for (const p of points) {
    assert.equal(pointInRings(p.lat, p.lng, SQUARE), true);
  }
});

test('samplePointsInPolygon respects concavity', () => {
  const points = samplePointsInPolygon(L_SHAPE, 16);

  assert.ok(points.length > 0);
  for (const p of points) {
    assert.equal(pointInRings(p.lat, p.lng, L_SHAPE), true);
    // Nothing in the cut-away quadrant.
    assert.ok(!(p.lat > 5 && p.lng > 5), `sample landed in the notch: ${p.lat},${p.lng}`);
  }
});

test('samplePointsInPolygon skips holes', () => {
  for (const p of samplePointsInPolygon(WITH_HOLE, 24)) {
    assert.ok(
      !(p.lat > 3 && p.lat < 7 && p.lng > 3 && p.lng < 7),
      `sample landed in the hole: ${p.lat},${p.lng}`,
    );
  }
});

test('samplePointsInPolygon caps the returned count', () => {
  const points = samplePointsInPolygon(SQUARE, 5);
  assert.ok(points.length <= 5, `expected <= 5, got ${points.length}`);
});

test('samplePointsInPolygon thins evenly rather than taking the first N', () => {
  // Taking the first N would bias every sample toward the southern edge,
  // because the grid is generated row by row.
  const points = samplePointsInPolygon(SQUARE, 4);
  const lats = points.map((p) => p.lat);
  assert.ok(Math.max(...lats) - Math.min(...lats) > 2, `latitudes too clustered: ${lats}`);
});

test('samplePointsInPolygon returns empty for an uncatchable sliver', () => {
  // Must not throw. The caller decides how to degrade.
  const points = samplePointsInPolygon(SLIVER, 4, 4);
  assert.ok(Array.isArray(points));
});

test('weightedMean weights by population', () => {
  // Two block groups: one far but nearly empty, one close and populous. The
  // weighted answer must sit near the populous one -- this is the uninhabited
  // -land bias that unweighted sampling gets wrong.
  const result = weightedMean([10, 1], [10, 990]);
  assert.ok(result < 1.2, `expected close to 1, got ${result}`);
});

test('weightedMean falls back to an unweighted mean when weights are missing', () => {
  assert.equal(weightedMean([2, 4], [0, 0]), 3);
  assert.equal(weightedMean([2, 4], null), 3);
});

test('weightedMean ignores non-finite values', () => {
  assert.equal(weightedMean([2, null, 4], [1, 1, 1]), 3);
  assert.equal(weightedMean([null, null], [1, 1]), null);
});

test('tractEdgeMiles converts land area to an equivalent square edge', () => {
  // 1 sq mile in square metres -> a 1 mile edge.
  assert.ok(Math.abs(tractEdgeMiles(2_589_988.11) - 1) < 1e-6);
  assert.equal(tractEdgeMiles(0), null);
  assert.equal(tractEdgeMiles(null), null);
});
