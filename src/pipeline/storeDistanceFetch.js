// Production deployments must avoid direct browser→Overpass calls because
// overpass-api.de returns 406 with no Access-Control-Allow-Origin header for
// browser origins like vercel.app. We try (in order):
//   1. Same-origin proxy (`/api/overpass`) — the hardened serverless function.
//      It takes JSON ({lat, lng, radiusMiles}) and builds the query itself;
//      it no longer accepts caller-supplied Overpass QL.
//   2-4. Community mirrors with permissive CORS, called directly with QL as a
//      fallback when our own function is unavailable.
import {
  samplePointsInPolygon,
  tractEdgeMiles,
  weightedMean,
} from './tractGeometry.js';

const PROXY_ENDPOINT = '/api/overpass';
const DIRECT_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const SEARCH_RADIUS_MILES = 50;
const SEARCH_RADIUS_METERS = Math.round(SEARCH_RADIUS_MILES * 1609.34);
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 1000 * 60 * 15;

/*
 * Legacy fixed offsets, in miles, kept as the last rung of the sampling
 * ladder below. Nine points: the anchor plus four cardinals at 1.5 mi and four
 * diagonals at 1 mi.
 */
const COMMUNITY_SAMPLE_OFFSETS_MILES = [
  [0, 0],
  [1.5, 0],
  [-1.5, 0],
  [0, 1.5],
  [0, -1.5],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/*
 * Divisor that maps a tract's equivalent-square edge onto the offset pattern
 * above. The largest offset is 1.5, so dividing the edge by 4.5 puts the
 * outermost samples at one third of the edge from the anchor — comfortably
 * inside the tract. A 4.5-mile tract reproduces the legacy spacing exactly;
 * a 0.3-mile urban tract shrinks to about ±0.1 mi instead of sampling its
 * neighbours.
 */
const AREA_SCALE_DIVISOR = 4.5;

// How many sample points to take inside each block group.
const POINTS_PER_BLOCK_GROUP = 12;

const cache = new Map();
const geometryCache = new Map();

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineMiles(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;

  return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function offsetPointMiles(lat, lng, eastMiles, northMiles) {
  const latPerMile = 1 / 69;
  const lngPerMile = 1 / (69 * Math.cos(toRad(lat)));
  return {
    lat: lat + northMiles * latPerMile,
    lng: lng + eastMiles * lngPerMile,
  };
}

export function buildCommunitySamplePoints(lat, lng, scale = 1) {
  return COMMUNITY_SAMPLE_OFFSETS_MILES.map(([eastMiles, northMiles]) =>
    offsetPointMiles(lat, lng, eastMiles * scale, northMiles * scale)
  );
}

function buildQuery(lat, lng) {
  return `[out:json][timeout:20];(node["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});way["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});relation["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng}););out center;`;
}

function cacheKey(lat, lng, fips) {
  // Prefer the tract: the result is a property of the tract now, not of the
  // exact click coordinate, so keying on FIPS also raises the hit rate.
  return fips || `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/*
 * Nearest store to one point, in miles.
 *
 * Single pass. This used to map every element to a distance, filter, then sort
 * the whole array to take element [0] — O(n log n) to find a minimum, re-run
 * once per sample point. The ladder below can ask for dozens of sample points
 * instead of nine, so that cost now matters.
 */
function parseNearestMiles(elements, lat, lng) {
  let nearest = null;

  for (const el of elements || []) {
    const eLat = el.lat ?? el.center?.lat;
    const eLng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(eLat) || !Number.isFinite(eLng)) continue;

    const miles = haversineMiles(lat, lng, eLat, eLng);
    if (!Number.isFinite(miles)) continue;
    if (nearest == null || miles < nearest) nearest = miles;
  }

  return nearest;
}

// ── Sampling plan ───────────────────────────────────────────────────────────
/*
 * Which points to sample, and how to combine them.
 *
 * The old model used nine points at fixed 1-1.5 mile offsets from the tract
 * centroid regardless of tract size. A dense urban tract is around 0.1 sq mi,
 * so eight of nine samples landed in *other tracts*; a large rural tract can
 * exceed 1,000 sq mi, so all nine clustered near the middle. Since the urban
 * designation rule fires at >= 1 mile, an offset of 1.5 miles was larger than
 * the entire decision threshold — the sampling geometry could flip a
 * designation by itself.
 *
 * There are four rungs, in descending order of trustworthiness. Each sets its
 * own `distanceModel` so the evidence trace can say which one produced the
 * number, rather than presenting all four with equal confidence.
 */
export function legacySamplePlan(lat, lng) {
  return {
    distanceModel: 'fixed_offset_grid',
    groups: [{ geoid: null, population: null, points: buildCommunitySamplePoints(lat, lng) }],
  };
}

function areaScaledPlan(anchorLat, anchorLng, edgeMiles) {
  return {
    distanceModel: 'tract_area_scaled_grid',
    groups: [{
      geoid: null,
      population: null,
      points: buildCommunitySamplePoints(anchorLat, anchorLng, edgeMiles / AREA_SCALE_DIVISOR),
    }],
  };
}

async function fetchTractGeometry(fips, signal) {
  const cached = geometryCache.get(fips);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch('/api/tract-geometry', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fips }),
    });
    if (!res.ok) throw new Error(`tract geometry ${res.status}`);
    const json = await res.json();
    geometryCache.set(fips, json);
    return json;
  } catch {
    // Cache the miss too: without this, every failed lookup re-requests on
    // each pan, and geometry outages tend not to resolve within a session.
    geometryCache.set(fips, null);
    return null;
  }
}

export async function buildSamplePlan(lat, lng, tract = {}, signal) {
  const { fips, arealandSqMeters, internalLat, internalLng } = tract;

  // Rungs 1 and 2: real block-group polygons.
  if (fips) {
    const geometry = await fetchTractGeometry(fips, signal);
    const groups = (geometry?.blockGroups || [])
      .map((bg) => ({
        geoid: bg.geoid,
        population: Number.isFinite(bg.population) ? bg.population : null,
        points: samplePointsInPolygon(bg.rings, POINTS_PER_BLOCK_GROUP),
      }))
      // A block group too thin to catch a grid point contributes nothing.
      .filter((group) => group.points.length > 0);

    if (groups.length > 0) {
      const weighted = groups.some((g) => Number.isFinite(g.population) && g.population > 0);
      return {
        distanceModel: weighted ? 'block_group_population_weighted' : 'block_group_uniform',
        groups,
      };
    }
  }

  /*
   * Rung 3: no polygon, but the Census geocoder gave us the tract's land area
   * for free, so at least scale the grid to the tract instead of assuming
   * 1.5 miles. Anchor on the Census internal point when we have it — unlike a
   * centroid it is guaranteed to sit inside the tract, which matters for the
   * crescent shapes coastlines and rivers produce.
   */
  const edgeMiles = tractEdgeMiles(arealandSqMeters);
  if (edgeMiles) {
    return areaScaledPlan(
      Number.isFinite(internalLat) ? internalLat : lat,
      Number.isFinite(internalLng) ? internalLng : lng,
      edgeMiles,
    );
  }

  // Rung 4: the old behaviour, and the least trustworthy.
  return legacySamplePlan(lat, lng);
}

// ── Metrics ─────────────────────────────────────────────────────────────────
export function computeCommunityDistanceMetrics(elements, lat, lng, plan) {
  const activePlan = plan || legacySamplePlan(lat, lng);

  const groupMeans = [];
  const groupWeights = [];
  let contributingSamples = 0;
  let attemptedSamples = 0;

  for (const group of activePlan.groups) {
    const distances = [];
    for (const point of group.points) {
      attemptedSamples += 1;
      const miles = parseNearestMiles(elements, point.lat, point.lng);
      if (Number.isFinite(miles)) {
        distances.push(miles);
        contributingSamples += 1;
      }
    }

    if (distances.length === 0) continue;
    groupMeans.push(distances.reduce((sum, d) => sum + d, 0) / distances.length);
    groupWeights.push(group.population);
  }

  /*
   * Weighted across block groups by population, so the average reflects where
   * people actually live rather than how much land there is. Without this, a
   * large rural tract whose residents all live in one town near the one store
   * would still report "far from stores", because parks, farmland and water
   * would carry the same weight as the town.
   */
  const communityAverageSupermarketMiles = weightedMean(groupMeans, groupWeights);

  return {
    centerNearestSupermarketMiles: parseNearestMiles(elements, lat, lng),
    communityAverageSupermarketMiles,
    // Samples that produced a distance, not samples attempted. Reporting the
    // latter overstated the evidence behind the number the UI shows.
    sampleCount: contributingSamples,
    sampleAttemptCount: attemptedSamples,
    blockGroupCount: activePlan.groups.length,
    distanceModel: activePlan.distanceModel,
  };
}

// Pull the raw OSM elements down to a compact, render-friendly list of
// store points. Used by the StreetsGlView highlight overlay and the
// 2D MapView. Sorted nearest-first relative to the search center so the
// UI can cap the marker count cheaply.
export function extractStorePoints(elements, centerLat, centerLng, limit = 200) {
  if (!Array.isArray(elements)) return [];
  const points = [];
  for (const el of elements) {
    const eLat = el?.lat ?? el?.center?.lat;
    const eLng = el?.lon ?? el?.center?.lon;
    if (!Number.isFinite(eLat) || !Number.isFinite(eLng)) continue;
    const name =
      el?.tags?.name ||
      el?.tags?.brand ||
      el?.tags?.operator ||
      'Supermarket';
    const distanceMiles = haversineMiles(centerLat, centerLng, eLat, eLng);
    points.push({
      id: `${el.type}/${el.id}`,
      lat: eLat,
      lng: eLng,
      name,
      distanceMiles,
    });
  }
  points.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return points.slice(0, limit);
}

/*
 * Single constructor for the result shape, used by both the success and the
 * total-failure paths.
 *
 * The failure path used to be a hand-written duplicate of this object literal,
 * which meant any field added here silently went missing when every endpoint
 * was down.
 */
function makeResult(metrics, source, stores = []) {
  const nearestMiles = metrics?.communityAverageSupermarketMiles ?? null;

  /*
   * This used to read `nearestMiles == null ? true : nearestMiles >= 25`.
   *
   * A successful Overpass response that simply contains no supermarkets gives
   * a null distance, so that expression asserted "at least 25 miles to a
   * store" — which the evaluator treats as an automatic food-desert
   * designation regardless of the configured threshold. In other words, a gap
   * in OpenStreetMap tagging produced a confident designation.
   *
   * We now only claim >=25 miles when we measured a distance.
   */
  const measured = Number.isFinite(nearestMiles);

  return {
    // Backward-compatible field name now carries community-average distance.
    nearestSupermarketMiles: nearestMiles,
    communityAverageSupermarketMiles: nearestMiles,
    centerNearestSupermarketMiles: metrics?.centerNearestSupermarketMiles ?? null,
    communityDistanceSampleCount: metrics?.sampleCount ?? 0,
    communityDistanceSampleAttempts: metrics?.sampleAttemptCount ?? 0,
    communityDistanceBlockGroups: metrics?.blockGroupCount ?? 0,
    distanceModel: metrics?.distanceModel ?? 'unavailable',
    isTwentyFivePlusMiles: measured ? nearestMiles >= 25 : null,
    // True when the query succeeded but OSM had no supermarket within the
    // search radius. Distinct from `source: 'unavailable'`, which means the
    // query itself failed.
    noStoresFound: source !== 'unavailable' && !measured,
    storeCount: stores.length,
    checkedRadiusMiles: SEARCH_RADIUS_MILES,
    stores,
    source,
  };
}

// Our own proxy validates {lat, lng, radiusMiles} and builds the query
// server-side; the public mirrors still speak raw Overpass QL.
async function fetchFromProxy(lat, lng, signal) {
  const res = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, radiusMiles: SEARCH_RADIUS_MILES }),
  });

  if (!res.ok) throw new Error(`Overpass proxy failed: ${res.status}`);
  return res.json();
}

async function fetchFromMirror(endpoint, query, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    body: query,
    signal,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);
  return res.json();
}

export async function getNearestSupermarketDistance(lat, lng, tract = {}) {
  const key = cacheKey(lat, lng, tract.fips);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }
  // Drop expired entries proactively so the Map doesn't grow unbounded.
  if (cached) cache.delete(key);

  // Resolved once and reused across endpoint attempts: which points to sample
  // does not depend on which Overpass mirror answered.
  const plan = await buildSamplePlan(lat, lng, tract);

  const query = buildQuery(lat, lng);
  const attempts = [
    { label: PROXY_ENDPOINT, run: (signal) => fetchFromProxy(lat, lng, signal) },
    ...DIRECT_ENDPOINTS.map((endpoint) => ({
      label: endpoint,
      run: (signal) => fetchFromMirror(endpoint, query, signal),
    })),
  ];

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const json = await attempt.run(controller.signal);
      const metrics = computeCommunityDistanceMetrics(json?.elements, lat, lng, plan);
      const stores = extractStorePoints(json?.elements, lat, lng);
      const result = makeResult(metrics, `osm_overpass:${attempt.label}`, stores);
      cache.set(key, { result, cachedAt: Date.now() });
      return result;
    } catch {
      // Try next endpoint.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Every endpoint failed. Distinct from a successful query that found no
  // stores: there, `noStoresFound` is true and the source names the endpoint.
  // Routed through makeResult so it cannot drift from the success shape.
  return makeResult(
    { distanceModel: plan.distanceModel, sampleAttemptCount: 0, blockGroupCount: plan.groups.length },
    'unavailable',
  );
}
