// Production deployments must avoid direct browser→Overpass calls because
// overpass-api.de returns 406 with no Access-Control-Allow-Origin header for
// browser origins like vercel.app. We try (in order):
//   1. Same-origin proxy (`/api/overpass`) — works in dev via vite.config.js
//      proxy and in production if a serverless function is deployed.
//   2. overpass.kumi.systems — community endpoint with permissive CORS.
//   3. overpass.private.coffee — additional mirror with permissive CORS.
//   4. overpass-api.de — last-ditch direct call (will fail in prod due to CORS,
//      kept for local/dev environments with relaxed CORS).
const OVERPASS_ENDPOINTS = [
  '/api/overpass',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const SEARCH_RADIUS_MILES = 50;
const SEARCH_RADIUS_METERS = Math.round(SEARCH_RADIUS_MILES * 1609.34);
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 1000 * 60 * 15;
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

const cache = new Map();

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

export function buildCommunitySamplePoints(lat, lng) {
  return COMMUNITY_SAMPLE_OFFSETS_MILES.map(([eastMiles, northMiles]) =>
    offsetPointMiles(lat, lng, eastMiles, northMiles)
  );
}

function buildQuery(lat, lng) {
  return `[out:json][timeout:20];(node["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});way["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});relation["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng}););out center;`;
}

function cacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function parseNearestMiles(elements, lat, lng) {
  const withDistances = (elements || [])
    .map((el) => {
      const eLat = el.lat ?? el.center?.lat;
      const eLng = el.lon ?? el.center?.lon;
      if (!Number.isFinite(eLat) || !Number.isFinite(eLng)) return null;
      return haversineMiles(lat, lng, eLat, eLng);
    })
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);

  return withDistances.length > 0 ? withDistances[0] : null;
}

function average(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function computeCommunityDistanceMetrics(elements, lat, lng) {
  const samplePoints = buildCommunitySamplePoints(lat, lng);
  const distancesByPoint = samplePoints
    .map((point) => parseNearestMiles(elements, point.lat, point.lng))
    .filter((distanceMiles) => Number.isFinite(distanceMiles));

  const centerNearestSupermarketMiles = parseNearestMiles(elements, lat, lng);
  const communityAverageSupermarketMiles = average(distancesByPoint);

  return {
    centerNearestSupermarketMiles,
    communityAverageSupermarketMiles,
    sampleCount: samplePoints.length,
  };
}

function makeResult(metrics, source) {
  const nearestMiles = metrics.communityAverageSupermarketMiles;
  return {
    // Backward-compatible field name now carries community-average distance.
    nearestSupermarketMiles: nearestMiles,
    communityAverageSupermarketMiles: metrics.communityAverageSupermarketMiles,
    centerNearestSupermarketMiles: metrics.centerNearestSupermarketMiles,
    communityDistanceSampleCount: metrics.sampleCount,
    distanceModel: 'community_average_sampled',
    isTwentyFivePlusMiles: nearestMiles == null ? true : nearestMiles >= 25,
    checkedRadiusMiles: SEARCH_RADIUS_MILES,
    source,
  };
}

async function fetchFromEndpoint(endpoint, query, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    body: query,
    signal,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);
  return res.json();
}

export async function getNearestSupermarketDistance(lat, lng) {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }
  // Drop expired entries proactively so the Map doesn't grow unbounded.
  if (cached) cache.delete(key);

  const query = buildQuery(lat, lng);

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const json = await fetchFromEndpoint(endpoint, query, controller.signal);
      const metrics = computeCommunityDistanceMetrics(json?.elements, lat, lng);
      const result = makeResult(metrics, `osm_overpass:${endpoint}`);
      cache.set(key, { result, cachedAt: Date.now() });
      return result;
    } catch {
      // Try next endpoint.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    nearestSupermarketMiles: null,
    communityAverageSupermarketMiles: null,
    centerNearestSupermarketMiles: null,
    communityDistanceSampleCount: 0,
    distanceModel: 'community_average_sampled',
    isTwentyFivePlusMiles: null,
    checkedRadiusMiles: SEARCH_RADIUS_MILES,
    source: 'unavailable',
  };
}
