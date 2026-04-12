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
  assert.equal(metrics.sampleCount, 9);
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
  assert.equal(metrics.sampleCount, 9);
});
