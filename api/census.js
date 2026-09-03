/*
 * POST /api/census — ACS demographics for one census tract.
 *
 * What changed and why
 * --------------------
 * src/pipeline/censusFetch.js used to read VITE_CENSUS_KEY and append it as a
 * `key=` query parameter on a request the browser made directly (through a
 * rewrite in vercel.json). Every VITE_-prefixed variable is inlined into the
 * production bundle, so that key was public — the same leak the team had
 * already fixed for the LLM key. Keys in query strings are also logged by
 * every proxy in between.
 *
 * The key now lives in the server-only CENSUS_KEY variable and never leaves
 * this function.
 *
 * Request:  { fips: "06075010700" }  (11 digits: state 2, county 3, tract 6)
 * Response: { medianIncome, population, adultPopulation, households,
 *             povertyPopulation, noVehicleHouseholds, stateMedianFamilyIncome }
 *           Any field the upstream did not supply is null, never 0 — see
 *           src/pipeline/censusFetch.js for why that distinction matters.
 */

import { guardRequest } from './_guard.js';

const ACS_BASE = 'https://api.census.gov/data/2022/acs/acs5';
const RATE_LIMIT = { limit: 40, windowMs: 60_000 };

const TRACT_VARIABLES = [
  'B19013_001E', // median household income
  'B01003_001E', // total population
  'B17001_002E', // population below poverty level
  'B25044_003E', // owner-occupied households, no vehicle
  'B25044_010E', // renter-occupied households, no vehicle
  'B11001_001E', // total households — needed for per-household trip math
  'B09021_001E', // population 18+ — CDC prevalence rates are adults-only
];

/*
 * The ACS API returns the string "-666666666" (and other negative sentinels)
 * for suppressed or unavailable estimates. Treating those as real numbers is
 * how you end up displaying a median income of -$666 million.
 */
function acsValue(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function fetchAcs(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'food-desert-simulator/1.0' } });
  if (!res.ok) throw new Error(`Census ACS ${res.status}`);
  const json = await res.json();
  // Row 0 is the header row; row 1 is the single geography we asked for.
  return Array.isArray(json?.[1]) ? json[1] : null;
}

export default async function handler(req, res) {
  const guard = guardRequest(req, res, RATE_LIMIT);
  if (!guard) return;

  const fips = String(guard.body.fips || '');
  if (!/^\d{11}$/.test(fips)) {
    res.status(400).json({ error: 'fips must be an 11-digit census tract code' });
    return;
  }

  const key = process.env.CENSUS_KEY;
  if (!key) {
    console.error('[census] CENSUS_KEY is not configured');
    res.status(500).json({ error: 'Census service is not configured' });
    return;
  }

  const state = fips.slice(0, 2);
  const county = fips.slice(2, 5);
  const tract = fips.slice(5);

  const tractUrl = `${ACS_BASE}?get=${TRACT_VARIABLES.join(',')}`
    + `&for=tract:${tract}&in=state:${state}%20county:${county}&key=${key}`;
  // B19113_001E is state median FAMILY income, the denominator for the USDA
  // low-income test (tract income <= 80% of the state figure).
  const stateUrl = `${ACS_BASE}?get=B19113_001E&for=state:${state}&key=${key}`;

  const [tractRow, stateRow] = await Promise.all([
    fetchAcs(tractUrl).catch((err) => {
      console.error('[census] tract fetch failed:', String(err?.message || err));
      return null;
    }),
    fetchAcs(stateUrl).catch((err) => {
      console.error('[census] state fetch failed:', String(err?.message || err));
      return null;
    }),
  ]);

  // A failed tract fetch is a real failure — the caller needs to know the
  // difference between "no data" and "zero", so we do not fabricate a payload.
  if (!tractRow) {
    res.status(502).json({ error: 'Census ACS request failed' });
    return;
  }

  const [
    medianIncome,
    population,
    povertyPopulation,
    ownerNoVehicle,
    renterNoVehicle,
    households,
    adultPopulation,
  ] = TRACT_VARIABLES.map((_, i) => acsValue(tractRow[i]));

  const noVehicleOwner = ownerNoVehicle ?? 0;
  const noVehicleRenter = renterNoVehicle ?? 0;

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json({
    medianIncome,
    population,
    adultPopulation,
    households,
    povertyPopulation,
    noVehicleHouseholds:
      ownerNoVehicle == null && renterNoVehicle == null
        ? null
        : noVehicleOwner + noVehicleRenter,
    stateMedianFamilyIncome: stateRow ? acsValue(stateRow[0]) : null,
  });
}
