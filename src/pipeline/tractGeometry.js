/*
 * Polygon helpers for tract-constrained distance sampling.
 *
 * Why this exists
 * ---------------
 * Classification distance used to be sampled from nine points at fixed 1-1.5
 * mile offsets from the tract centroid, regardless of how big the tract was.
 * A dense urban tract is around 0.1 sq mi, so eight of those nine samples
 * landed in *other tracts*; a large rural tract can exceed 1,000 sq mi, so all
 * nine clustered near the middle. The urban designation rule fires at >= 1
 * mile, which means the 1.5-mile offset was larger than the entire decision
 * threshold -- the sampling geometry could flip a designation on its own.
 *
 * These are pure functions over Esri-style ring arrays ([[[lng, lat], ...]]),
 * which is what the TIGERweb REST service returns. No I/O, so they are
 * directly unit-testable -- and they are where the real risk in this change
 * lives.
 */

// ── Point in polygon ────────────────────────────────────────────────────────
/*
 * Ray casting with the even-odd rule.
 *
 * Esri encodes holes as separate rings wound opposite to their outer ring.
 * Counting crossings across *all* rings together and testing the parity means
 * a point inside an outer ring and also inside a hole crosses an even number
 * of edges and is correctly reported as outside -- so we never need to
 * determine winding order, which is the usual source of bugs here.
 */
export function pointInRings(lat, lng, rings) {
  if (!Array.isArray(rings)) return false;

  let inside = false;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      // Does the edge straddle the horizontal ray at `lat`, and is the
      // crossing to the right of `lng`?
      const straddles = (yi > lat) !== (yj > lat);
      if (!straddles) continue;

      const xCross = xi + ((lat - yi) / (yj - yi)) * (xj - xi);
      if (lng < xCross) inside = !inside;
    }
  }

  return inside;
}

// ── Bounding box ────────────────────────────────────────────────────────────
export function ringsBounds(rings) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const ring of rings || []) {
    for (const [lng, lat] of ring || []) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/*
 * Mean of the outer ring's vertices. Used only as a last-resort anchor: for a
 * concave shape it can fall outside the polygon, which is why the sampler
 * prefers an interior grid point and why the Census "internal point"
 * (INTPTLAT/INTPTLON), which is guaranteed to be inside, is preferred above
 * both when available.
 */
export function ringsCentroid(rings) {
  const outer = rings?.[0];
  if (!Array.isArray(outer) || outer.length === 0) return null;

  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const [lng, lat] of outer) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    sumLat += lat;
    sumLng += lng;
    count += 1;
  }

  return count > 0 ? { lat: sumLat / count, lng: sumLng / count } : null;
}

// ── Sampling ────────────────────────────────────────────────────────────────
/*
 * Lay a grid over the bounding box and keep the points that fall inside the
 * polygon. The grid is oversized relative to `targetCount` because a polygon
 * typically fills only part of its bounding box -- a diagonal sliver fills
 * very little -- so a grid sized exactly to the target would return far fewer
 * interior points than asked for.
 *
 * Returns [] rather than throwing when a shape is too thin to catch any grid
 * point; the caller decides what to do about that.
 */
export function samplePointsInPolygon(rings, targetCount = 12, maxGridSide = 24) {
  const bounds = ringsBounds(rings);
  if (!bounds || targetCount < 1) return [];

  // Oversample by 2x on each axis, and never exceed maxGridSide -- an
  // unbounded grid on a large rural tract would cost real CPU per lookup.
  const side = Math.min(maxGridSide, Math.max(2, Math.ceil(Math.sqrt(targetCount) * 2)));

  const latStep = (bounds.maxLat - bounds.minLat) / (side + 1);
  const lngStep = (bounds.maxLng - bounds.minLng) / (side + 1);
  const points = [];

  for (let row = 1; row <= side; row += 1) {
    for (let col = 1; col <= side; col += 1) {
      const lat = bounds.minLat + latStep * row;
      const lng = bounds.minLng + lngStep * col;
      if (pointInRings(lat, lng, rings)) points.push({ lat, lng });
    }
  }

  if (points.length <= targetCount) return points;

  // Thin evenly rather than taking the first N, which would bias every sample
  // toward the polygon's southern edge (the grid is generated row by row).
  const stride = points.length / targetCount;
  const thinned = [];
  for (let i = 0; i < targetCount; i += 1) {
    thinned.push(points[Math.floor(i * stride)]);
  }
  return thinned;
}

// ── Weighted mean ───────────────────────────────────────────────────────────
/*
 * Population-weighted mean, skipping entries with no value.
 *
 * Falls back to an unweighted mean when every weight is zero or missing --
 * which happens for tracts where ACS suppressed the block-group counts. That
 * is a real degradation, so the caller labels the result differently.
 */
export function weightedMean(values, weights) {
  let weightedTotal = 0;
  let weightTotal = 0;
  let plainTotal = 0;
  let plainCount = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;

    plainTotal += value;
    plainCount += 1;

    const weight = weights?.[i];
    if (Number.isFinite(weight) && weight > 0) {
      weightedTotal += value * weight;
      weightTotal += weight;
    }
  }

  if (plainCount === 0) return null;
  if (weightTotal > 0) return weightedTotal / weightTotal;
  return plainTotal / plainCount;
}

// ── Area helper ─────────────────────────────────────────────────────────────
const SQ_METERS_PER_SQ_MILE = 2_589_988.11;

/*
 * Equivalent-square edge length in miles. Used to scale the fallback grid when
 * we have the tract's land area (the Census geocoder returns AREALAND) but no
 * polygon, so at least the sample spread is proportionate to the tract instead
 * of a fixed 1.5 miles.
 */
export function tractEdgeMiles(arealandSqMeters) {
  if (!Number.isFinite(arealandSqMeters) || arealandSqMeters <= 0) return null;
  return Math.sqrt(arealandSqMeters / SQ_METERS_PER_SQ_MILE);
}
