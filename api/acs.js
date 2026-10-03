// Vercel serverless function: Census ACS figures for one tract.
//
// The Census API needs a key, and a key read through import.meta.env.VITE_*
// gets inlined into the client bundle. This function keeps CENSUS_KEY on the
// server, accepts only an 11-digit tract FIPS, and asks for a fixed variable
// list, so it can't be used as a general Census relay.

const ACS_BASE = 'https://api.census.gov/data/2022/acs/acs5';

// B19013 median household income, B01003 total population, B17001_002
// population below poverty, B25044_003/_010 owner/renter households with no
// vehicle. B19113 is the state's median family income (low-income test).
const TRACT_VARIABLES = 'B19013_001E,B01003_001E,B17001_002E,B25044_003E,B25044_010E';
const STATE_VARIABLES = 'B19113_001E';

function acsUrl(params, key) {
  const url = new URL(ACS_BASE);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', key);
  return url;
}

async function readRow(response) {
  if (!response.ok) return null;
  const json = await response.json();
  // json[0] = headers, json[1] = values
  return Array.isArray(json?.[1]) ? json[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  // Only ?fips= is accepted, so extra parameters can't be used to bust the
  // CDN cache and drive unlimited keyed Census calls for one tract.
  const params = Object.keys(req.query || {});
  const fips = req.query?.fips;
  if (params.some((name) => name !== 'fips') || typeof fips !== 'string' || !/^\d{11}$/.test(fips)) {
    res.status(400).json({ error: 'Expected fips as an 11-digit census tract id' });
    return;
  }

  const key = process.env.CENSUS_KEY;
  if (!key) {
    res.status(503).json({ error: 'Census data is not configured on this deployment' });
    return;
  }

  const state = fips.slice(0, 2);
  const county = fips.slice(2, 5);
  const tract = fips.slice(5);

  try {
    const [tractRes, stateRes] = await Promise.all([
      fetch(acsUrl({ get: TRACT_VARIABLES, for: `tract:${tract}`, in: `state:${state} county:${county}` }, key)),
      fetch(acsUrl({ get: STATE_VARIABLES, for: `state:${state}` }, key)),
    ]);

    const tractRow = await readRow(tractRes);
    if (!tractRow) {
      res.status(502).json({ error: 'Census tract query failed' });
      return;
    }

    let stateMedianFamilyIncome = 0;
    try {
      const stateRow = await readRow(stateRes);
      stateMedianFamilyIncome = Number(stateRow?.[0]) || 0;
    } catch {
      // The tract figures still stand without the state median.
    }

    const [medianIncome, population, povertyPop, ownerNoVeh, renterNoVeh] =
      tractRow.slice(0, 5).map(Number);

    // ACS 2022 is a fixed release, so a complete answer can sit at the CDN for
    // a day. A partial one (state median missing) must not: it would pin a
    // failing low-income income test for every visitor to this tract.
    res.setHeader('Cache-Control', stateMedianFamilyIncome > 0 ? 'public, s-maxage=86400' : 'no-store');
    res.status(200).json({
      medianIncome: medianIncome > 0 ? medianIncome : 0,
      population: population > 0 ? population : 0,
      pctPoverty: population > 0 ? (povertyPop / population) * 100 : 0,
      noVehicleHouseholds: (ownerNoVeh || 0) + (renterNoVeh || 0),
      stateMedianFamilyIncome: stateMedianFamilyIncome > 0 ? stateMedianFamilyIncome : 0,
    });
  } catch {
    // Never echo the upstream URL: it carries the key.
    res.status(502).json({ error: 'Census request failed' });
  }
}
