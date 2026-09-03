// Production deployments must avoid direct browser→Overpass calls because
// overpass-api.de returns 406 with no Access-Control-Allow-Origin header for
// browser origins like vercel.app. We try (in order):
//   1. Same-origin proxy (`/api/overpass`) — the hardened serverless function.
//      It takes JSON ({lat, lng, radiusMiles}) and builds the query itself;
//      it no longer accepts caller-supplied Overpass QL.
//   2-4. Community mirrors with permissive CORS, called directly with QL as a
//      fallback when our own function is unavailable.
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
    // Report the samples that actually produced a distance, not the number we
    // started with. Sample points that found no store are filtered out above,
    // so the old `samplePoints.length` claimed 9 contributing samples even
    // when only 3 did — a transparency figure the UI shows to the user.
    sampleCount: distancesByPoint.length,
    sampleAttemptCount: samplePoints.length,
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

function makeResult(metrics, source, stores = []) {
  const nearestMiles = metrics.communityAverageSupermarketMiles;

  /*
   * This used to read `nearestMiles == null ? true : nearestMiles >= 25`.
   *
   * A successful Overpass response that simply contains no supermarkets gives
   * a null distance, so that expression asserted "at least 25 miles to a
   * store" — which the evaluator treats as an automatic food-desert
   * designation regardless of the configured threshold. In other words, a gap
   * in OpenStreetMap tagging produced a confident designation.
   *
   * We now only claim >=25 miles when we measured a distance. "Queried, found
   * nothing" is reported as its own state so the evaluator can return Unknown
   * and the UI can say the coverage was thin rather than implying certainty.
   */
  const measured = Number.isFinite(nearestMiles);

  return {
    // Backward-compatible field name now carries community-average distance.
    nearestSupermarketMiles: nearestMiles,
    communityAverageSupermarketMiles: metrics.communityAverageSupermarketMiles,
    centerNearestSupermarketMiles: metrics.centerNearestSupermarketMiles,
    communityDistanceSampleCount: metrics.sampleCount,
    communityDistanceSampleAttempts: metrics.sampleAttemptCount,
    distanceModel: 'community_average_sampled',
    isTwentyFivePlusMiles: measured ? nearestMiles >= 25 : null,
    // True when the query succeeded but OSM had no supermarket within the
    // search radius. Distinct from `source: 'unavailable'`, which means the
    // query itself failed.
    noStoresFound: !measured,
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

export async function getNearestSupermarketDistance(lat, lng) {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }
  // Drop expired entries proactively so the Map doesn't grow unbounded.
  if (cached) cache.delete(key);

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
      const metrics = computeCommunityDistanceMetrics(json?.elements, lat, lng);
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

  // Every endpoint failed. This is different from a successful query that
  // found no stores: there, `noStoresFound` is true and the source names the
  // endpoint. Here we know nothing at all.
  return {
    nearestSupermarketMiles: null,
    communityAverageSupermarketMiles: null,
    centerNearestSupermarketMiles: null,
    communityDistanceSampleCount: 0,
    communityDistanceSampleAttempts: COMMUNITY_SAMPLE_OFFSETS_MILES.length,
    distanceModel: 'community_average_sampled',
    isTwentyFivePlusMiles: null,
    noStoresFound: false,
    storeCount: 0,
    checkedRadiusMiles: SEARCH_RADIUS_MILES,
    stores: [],
    source: 'unavailable',
  };
}
