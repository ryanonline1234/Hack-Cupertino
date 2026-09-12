/*
 * Placed-store scenarios ("what if a grocery store opened HERE?").
 *
 * Pure recompute over the already-fetched store set plus user-placed
 * hypothetical stores — no network. Regenerates the deterministic pipeline
 * sample points and re-runs the designation evaluator with identical inputs
 * except the new distance, so before/after deltas are apples-to-apples.
 *
 * Approximation, documented: the pipeline keeps the 200 nearest-first store
 * points, so far-field detail is capped. A placed store near the community
 * (the only case the UI reasons about) always dominates the minimum.
 */
import {
  buildCommunitySamplePoints,
  haversineMiles,
} from '../pipeline/storeDistanceFetch.js';
import { evaluateFoodDesertDesignation } from './foodDesertEvaluation.js';

function nearestOver(points, lat, lng) {
  let best = null;
  for (const p of points) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    const d = haversineMiles(lat, lng, p.lat, p.lng);
    if (best == null || d < best) best = d;
  }
  return best;
}

export function designationLabel(result, isFoodDesertFallback) {
  if (!result) return 'unknown';
  if (result.isFoodDesert === true) return 'designated';
  if (result.isFoodDesert === false) return 'not designated';
  return isFoodDesertFallback ? 'designated (USDA context)' : 'unknown';
}

export function evaluatePlacedStoreScenario(communityData, placedStores, center) {
  const placed = (placedStores || []).filter(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
  );
  if (!communityData || placed.length === 0) return null;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
    return null;
  }

  const { foodAccess } = communityData;
  if (!foodAccess) return null;

  const baseStores = Array.isArray(foodAccess.stores) ? foodAccess.stores : [];
  const allStores = [...baseStores, ...placed];

  const beforeAvg = Number.isFinite(foodAccess.communityAverageSupermarketMiles)
    ? Number(foodAccess.communityAverageSupermarketMiles)
    : null;

  const samplePoints = buildCommunitySamplePoints(center.lat, center.lng);
  const afterDistances = samplePoints
    .map((point) => nearestOver(allStores, point.lat, point.lng))
    .filter((d) => Number.isFinite(d));
  if (afterDistances.length === 0) return null;
  const afterAvg = afterDistances.reduce((a, b) => a + b, 0) / afterDistances.length;

  const sharedInputs = {
    isRural: Boolean(foodAccess.isRural),
    isTwentyFivePlusMiles: foodAccess.isTwentyFivePlusMiles ?? null,
    usdaLilaFlag: Boolean(foodAccess.usdaLilaFlag),
    unavailableMode: 'unknown',
  };
  const after = evaluateFoodDesertDesignation({
    ...sharedInputs,
    nearestSupermarketMiles: afterAvg,
  });
  const before = evaluateFoodDesertDesignation({
    ...sharedInputs,
    nearestSupermarketMiles: beforeAvg,
  });

  return {
    placedCount: placed.length,
    beforeAvg,
    afterAvg,
    beforeLabel: designationLabel(before, foodAccess.isFoodDesert),
    afterLabel: designationLabel(after, foodAccess.isFoodDesert),
    flipped: designationLabel(before, foodAccess.isFoodDesert)
      !== designationLabel(after, foodAccess.isFoodDesert),
  };
}
