/*
 * K-nearest-tract finder using a 4-D feature vector:
 *   [povertyPct, medianIncome, communityAvgDistMiles, pctNoVehicleLowAccess]
 *
 * The vector dimensions are on wildly different scales (income in tens of
 * thousands, distance in single-digit miles), so we min-max normalize each
 * dimension to [0, 1] over the union of {query} ∪ sample, then compute
 * weighted Euclidean distance.
 *
 * Weights bias toward the dimensions our designation logic also weighs:
 *   distance > poverty > no-vehicle access > income
 * which roughly maps to "structural physical access > who's affected".
 */

import sampleTracts from '../data/sampleTracts.js';

const FEATURES = ['povertyPct', 'medianIncome', 'communityAvgDistMiles', 'pctNoVehicleLowAccess'];
const WEIGHTS = { povertyPct: 1.0, medianIncome: 0.6, communityAvgDistMiles: 1.4, pctNoVehicleLowAccess: 1.0 };

function vectorFromCommunityData(data) {
  if (!data) return null;
  const fa = data.foodAccess || {};
  const dem = data.demographics || {};

  const povertyPct = Number(dem.pctPoverty);
  const medianIncome = Number(dem.medianIncome);
  const distance = Number(fa.communityAverageSupermarketMiles ?? fa.nearestSupermarketMiles);
  const noVehicleLowAccess = Number(fa.pctNoVehicleLowAccess);

  if (
    !Number.isFinite(povertyPct) ||
    !Number.isFinite(medianIncome) ||
    !Number.isFinite(distance) ||
    !Number.isFinite(noVehicleLowAccess)
  ) {
    return null;
  }

  return {
    povertyPct,
    medianIncome,
    communityAvgDistMiles: distance,
    pctNoVehicleLowAccess: noVehicleLowAccess,
  };
}

function findRanges(samples, query) {
  const ranges = {};
  for (const f of FEATURES) {
    let min = query[f];
    let max = query[f];
    for (const s of samples) {
      if (s[f] < min) min = s[f];
      if (s[f] > max) max = s[f];
    }
    // Avoid zero-range division when all values collapse.
    ranges[f] = { min, max, span: Math.max(1e-6, max - min) };
  }
  return ranges;
}

function weightedDistance(a, b, ranges) {
  let sum = 0;
  for (const f of FEATURES) {
    const norm = (a[f] - b[f]) / ranges[f].span;
    sum += WEIGHTS[f] * norm * norm;
  }
  return Math.sqrt(sum);
}

/*
 * Returns up to `k` sample tracts closest to the query, with their distance
 * score attached. Excludes the query's own FIPS so the user doesn't see
 * "this tract is similar to itself."
 */
export function findSimilarTracts(communityData, k = 4) {
  const queryVector = vectorFromCommunityData(communityData);
  if (!queryVector) return [];

  const queryFips = communityData?.meta?.fips || '';
  const candidates = sampleTracts.filter((t) => t.fips !== queryFips);
  if (candidates.length === 0) return [];

  const ranges = findRanges(candidates, queryVector);
  const scored = candidates.map((t) => ({
    ...t,
    similarityDistance: weightedDistance(queryVector, t, ranges),
  }));
  scored.sort((a, b) => a.similarityDistance - b.similarityDistance);
  return scored.slice(0, k);
}
