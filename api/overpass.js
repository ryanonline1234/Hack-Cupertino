/*
 * POST /api/overpass — nearest supermarkets around a point.
 *
 * What changed and why
 * --------------------
 * This endpoint used to forward the raw request body to three Overpass mirrors.
 * The body *is* Overpass QL, so it was an anonymous relay letting anyone run
 * arbitrary, arbitrarily expensive queries against volunteer-run OSM
 * infrastructure from our egress IP — a reliable way to get that IP banned.
 *
 * It now accepts `{ lat, lng, radiusMiles }`, validates the coordinates,
 * clamps the radius, and builds the query itself. Callers cannot supply query
 * text. The query shape is kept in sync with buildQuery() in
 * src/pipeline/storeDistanceFetch.js.
 */

import { clampNumber, guardRequest, validLatitude, validLongitude } from './_guard.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RADIUS_MILES = 50;
const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 50;
const METERS_PER_MILE = 1609.34;

// Overpass is a shared community resource; keep our own callers modest.
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function buildQuery(lat, lng, radiusMeters) {
  const around = `(around:${radiusMeters},${lat},${lng})`;
  return `[out:json][timeout:20];(`
    + `node["shop"="supermarket"]${around};`
    + `way["shop"="supermarket"]${around};`
    + `relation["shop"="supermarket"]${around};`
    + `);out center;`;
}

async function tryEndpoint(url, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      body: query,
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'food-desert-simulator/1.0',
      },
    });
    if (!upstream.ok) throw new Error(`Overpass ${upstream.status}`);
    return await upstream.text();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const guard = guardRequest(req, res, RATE_LIMIT);
  if (!guard) return;

  const lat = validLatitude(guard.body.lat);
  const lng = validLongitude(guard.body.lng);
  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat and lng must be valid coordinates' });
    return;
  }

  const radiusMiles = clampNumber(
    guard.body.radiusMiles,
    MIN_RADIUS_MILES,
    MAX_RADIUS_MILES,
    DEFAULT_RADIUS_MILES,
  );
  const query = buildQuery(lat, lng, Math.round(radiusMiles * METERS_PER_MILE));

  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const text = await tryEndpoint(endpoint, query);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      res.status(200).send(text);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  console.error('[overpass] all endpoints failed:', String(lastError?.message || lastError));
  res.status(502).json({ error: 'All Overpass endpoints failed' });
}
