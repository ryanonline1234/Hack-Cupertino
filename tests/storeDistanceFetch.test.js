import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunitySamplePoints,
  computeCommunityDistanceMetrics,
} from '../src/pipeline/storeDistanceFetch.js';

test('buildCommunitySamplePoints returns center plus surrounding sample points', () => {
  const lat = 37.773;
  const lng = -122.418;
  const points = buildCommunitySamplePoints(lat, lng);

  assert.equal(points.length, 9);
  assert.ok(points.some((point) => Math.abs(point.lat - lat) < 1e-9 && Math.abs(point.lng - lng) < 1e-9));
});

test('computeCommunityDistanceMetrics returns null metrics when no stores are present', () => {
  const metrics = computeCommunityDistanceMetrics([], 37.773, -122.418);

  assert.equal(metrics.centerNearestSupermarketMiles, null);
  assert.equal(metrics.communityAverageSupermarketMiles, null);
  // sampleCount is the number of samples that actually produced a distance.
  // With no stores anywhere, that is zero — it used to report 9, overstating
  // the evidence behind the figure the UI shows.
  assert.equal(metrics.sampleCount, 0);
  assert.equal(metrics.sampleAttemptCount, 9);
});

test('computeCommunityDistanceMetrics calculates center-nearest and community-average distances', () => {
  const lat = 37.773;
  const lng = -122.418;

  const elements = [
    { lat, lon: lng },
  ];

  const metrics = computeCommunityDistanceMetrics(elements, lat, lng);

  assert.ok(Number.isFinite(metrics.centerNearestSupermarketMiles));
  assert.ok(Number.isFinite(metrics.communityAverageSupermarketMiles));
  assert.equal(metrics.centerNearestSupermarketMiles, 0);
  assert.ok(metrics.communityAverageSupermarketMiles > metrics.centerNearestSupermarketMiles);
  assert.ok(metrics.communityAverageSupermarketMiles < 3);
  // One store within reach of every sample point: all 9 contribute.
  assert.equal(metrics.sampleCount, 9);
  assert.equal(metrics.sampleAttemptCount, 9);
});

test('sampleCount counts only the samples that found a store', () => {
  // A single store 40 miles north of centre: reachable from every sample
  // point, so all 9 contribute. Contrast with the empty-elements case above,
  // where none do. The point of the assertion is that the two differ.
  const lat = 37.773;
  const lng = -122.418;
  const metrics = computeCommunityDistanceMetrics(
    [{ lat: lat + 0.58, lon: lng }],
    lat,
    lng,
  );

  assert.equal(metrics.sampleCount, 9);
  assert.ok(metrics.communityAverageSupermarketMiles > 30);
});
