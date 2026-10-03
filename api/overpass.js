// Vercel serverless function: server-side Overpass lookup for supermarkets.
//
// Direct browser calls to overpass-api.de fail in production with HTTP 406
// "Origin not allowed by Access-Control-Allow-Origin". Routing through
// /api/overpass on the same Vercel origin avoids the cross-origin policy.
//
// The client sends only {lat, lng}; this function builds the one query the
// app needs. It used to forward whatever Overpass QL the caller posted,
// which made it an open relay to three public mirrors.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Same radius the client has always used (storeDistanceFetch.js).
const SEARCH_RADIUS_METERS = Math.round(50 * 1609.34);
const MAX_BODY_BYTES = 256;

// 50 states, DC, Puerto Rico and USVI. The western Aleutians and the Pacific
// territories fall outside; they were never served well by this query.
const US_BOUNDS = { minLat: 17, maxLat: 72, minLng: -180, maxLng: -64 };

export function buildOverpassQuery(lat, lng) {
  // Nodes + ways only: supermarkets are mapped as points or building areas;
  // relations add response weight without changing nearest-store results.
  return `[out:json][timeout:25];(node["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});way["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng}););out center;`;
}

function bodyText(body) {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '';
}

function parseCoordinates(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const lat = parsed?.lat;
  const lng = parsed?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < US_BOUNDS.minLat || lat > US_BOUNDS.maxLat) return null;
  if (lng < US_BOUNDS.minLng || lng > US_BOUNDS.maxLng) return null;
  return { lat, lng };
}

// No timeouts anywhere in this path (owner call): no per-endpoint abort,
// no watchdog. Instead ALL mirrors are queried in parallel and the first
// success wins (Promise.any) — a hung mirror like kumi.systems can never
// wedge the pipeline, and fast failures (HTTP 504 etc.) just lose the
// race. Costs 3× upstream load per query; the traffic here is tiny.
// Response shape: { status, text, winner } so logs show which mirror won.
async function tryEndpoint(url, query) {
  const upstream = await fetch(url, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'food-desert-simulator/1.0' },
  });
  if (!upstream.ok) throw new Error(`Overpass ${upstream.status} from ${url}`);
  return { status: upstream.status, text: await upstream.text(), winner: url };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const text = bodyText(req.body);
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Body too large' });
    return;
  }

  const coords = parseCoordinates(text);
  if (!coords) {
    res.status(400).json({ error: 'Expected JSON {lat, lng} inside the United States' });
    return;
  }

  const query = buildOverpassQuery(coords.lat, coords.lng);

  try {
    const result = await Promise.any(ENDPOINTS.map((endpoint) => tryEndpoint(endpoint, query)));
    console.log(`[overpass] won by ${result.winner} (${result.status})`);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).send(result.text);
    return;
  } catch (err) {
    const detail = err?.errors?.map((e) => String(e?.message || e)).join(' | ') || String(err?.message || err);
    console.error(`[overpass] all mirrors failed: ${detail.slice(0, 300)}`);
    res.status(502).json({ error: 'All Overpass endpoints failed', detail });
  }
}
