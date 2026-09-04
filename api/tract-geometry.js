/*
 * POST /api/tract-geometry — block-group polygons and populations for a tract.
 *
 * Why this endpoint exists
 * -----------------------
 * Distance-based classification needs to sample points that actually lie
 * inside the tract, weighted by where people live. Block groups are exact
 * subdivisions of a tract, so one query gets both: the polygons to sample
 * within, and the population figures to weight by.
 *
 * Server-side rather than in the browser for three reasons: TIGERweb does not
 * reliably send CORS headers to arbitrary origins, the ACS call needs the
 * server-only CENSUS_KEY, and tract geometry is static so it caches hard.
 *
 * Request:  { fips: "06075010700" }
 * Response: { blockGroups: [{ geoid, population, rings }], populationSource }
 *           `population` is null when ACS suppressed or omitted the count;
 *           the caller degrades to unweighted sampling in that case.
 */

import { guardRequest } from './_guard.js';

const TIGERWEB_SERVICE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';
const ACS_BASE = 'https://api.census.gov/data/2022/acs/acs5';

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const REQUEST_TIMEOUT_MS = 15_000;

/*
 * Generalisation tolerance, in the units of outSR — degrees, since we ask for
 * 4326. ~0.0005 deg is roughly 50m, far finer than the mile-scale decisions
 * this feeds, and it keeps ring payloads small.
 */
const MAX_ALLOWABLE_OFFSET = 0.0005;

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'food-desert-simulator/1.0' },
    });
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Resolve the block-group layer by NAME, not by a hardcoded id.
 *
 * TIGERweb layer numbering is not stable and is not consistent between its
 * MapServers — published references disagree about which id is which for the
 * same feature type. Looking the layer up by name survives Census renumbering,
 * which has happened before. Cached at module scope so we pay for it once per
 * warm instance.
 */
let blockGroupLayerId = null;
async function resolveBlockGroupLayerId() {
  if (blockGroupLayerId != null) return blockGroupLayerId;

  const meta = await fetchJson(`${TIGERWEB_SERVICE}?f=json`, 'TIGERweb service metadata');
  const layers = Array.isArray(meta?.layers) ? meta.layers : [];

  // Match "Census Block Groups" but not "Census Blocks" or "Census Tracts".
  const match = layers.find((layer) => /block\s*group/i.test(layer?.name || ''));
  if (!match || !Number.isInteger(match.id)) {
    throw new Error(
      `No block-group layer found. Available: ${layers.map((l) => `${l.id}:${l.name}`).join(', ') || 'none'}`,
    );
  }

  blockGroupLayerId = match.id;
  return blockGroupLayerId;
}

async function fetchBlockGroupGeometry(fips) {
  const layerId = await resolveBlockGroupLayerId();

  // A block-group GEOID is the 11-digit tract GEOID plus one digit, so a
  // prefix match returns exactly the block groups of this tract.
  const where = encodeURIComponent(`GEOID LIKE '${fips}%'`);
  const url =
    `${TIGERWEB_SERVICE}/${layerId}/query?where=${where}`
    + `&outFields=GEOID&returnGeometry=true&outSR=4326`
    + `&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&f=json`;

  const json = await fetchJson(url, 'TIGERweb block groups');
  if (json?.error) throw new Error(`TIGERweb: ${json.error.message || 'query failed'}`);

  return (json?.features || [])
    .map((feature) => ({
      geoid: String(feature?.attributes?.GEOID || ''),
      rings: Array.isArray(feature?.geometry?.rings) ? feature.geometry.rings : null,
    }))
    .filter((bg) => bg.geoid && bg.rings?.length);
}

async function fetchBlockGroupPopulations(fips, key) {
  const state = fips.slice(0, 2);
  const county = fips.slice(2, 5);
  const tract = fips.slice(5);

  const url =
    `${ACS_BASE}?get=B01003_001E&for=block%20group:*`
    + `&in=state:${state}%20county:${county}%20tract:${tract}&key=${key}`;

  const json = await fetchJson(url, 'Census ACS block groups');
  if (!Array.isArray(json) || json.length < 2) return new Map();

  // Rows: [population, state, county, tract, blockGroup]. The GEOID is the
  // concatenation of the last four.
  const byGeoid = new Map();
  for (const row of json.slice(1)) {
    const [population, st, co, tr, bg] = row;
    const n = Number(population);
    byGeoid.set(`${st}${co}${tr}${bg}`, Number.isFinite(n) && n >= 0 ? n : null);
  }
  return byGeoid;
}

export default async function handler(req, res) {
  const guard = guardRequest(req, res, RATE_LIMIT);
  if (!guard) return;

  const fips = String(guard.body.fips || '');
  if (!/^\d{11}$/.test(fips)) {
    res.status(400).json({ error: 'fips must be an 11-digit census tract code' });
    return;
  }

  let blockGroups;
  try {
    blockGroups = await fetchBlockGroupGeometry(fips);
  } catch (err) {
    console.error('[tract-geometry] geometry fetch failed:', String(err?.message || err));
    res.status(502).json({ error: 'Tract geometry unavailable' });
    return;
  }

  if (blockGroups.length === 0) {
    res.status(404).json({ error: 'No block groups found for this tract' });
    return;
  }

  /*
   * Population is a soft dependency. Without it we still return geometry, and
   * the caller samples inside the tract but unweighted — better than the fixed
   * offset grid it replaces, and it says so via its own distanceModel label.
   */
  let populations = new Map();
  let populationSource = 'unavailable';
  const key = process.env.CENSUS_KEY;

  if (key) {
    try {
      populations = await fetchBlockGroupPopulations(fips, key);
      if (populations.size > 0) populationSource = 'census_acs_2022';
    } catch (err) {
      console.error('[tract-geometry] population fetch failed:', String(err?.message || err));
    }
  } else {
    console.error('[tract-geometry] CENSUS_KEY is not configured; returning unweighted geometry');
  }

  // Geometry is static; cache aggressively at the edge.
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
  res.status(200).json({
    blockGroups: blockGroups.map((bg) => ({
      geoid: bg.geoid,
      population: populations.get(bg.geoid) ?? null,
      rings: bg.rings,
    })),
    populationSource,
  });
}
