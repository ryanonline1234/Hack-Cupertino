// ACS figures for one tract, via the same-origin /api/acs function. The
// Census key lives on the server (CENSUS_KEY); nothing here reads it.
// Same feature-detected limit as the data loaders.
const TIMEOUT_MS = 30_000;

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

// -> { status: 'ok' | 'unavailable' | 'not_configured', data }. `data` is the
// default (all-zero) profile unless status is 'ok'. 'not_configured' (503:
// the deployment has no CENSUS_KEY) is the one failure a retry can't fix.
export async function fetchCensusData(fips) {
  if (typeof fips !== 'string' || !/^\d{11}$/.test(fips)) return { status: 'unavailable', data: defaultCensus() };

  try {
    const res = await fetch(`/api/acs?fips=${fips}`, withTimeout());
    if (!res.ok) {
      // 503 means the deployment has no CENSUS_KEY; say so instead of
      // silently showing zeros.
      console.warn(`Census data unavailable (/api/acs ${res.status}); demographics fall back to defaults.`);
      return { status: res.status === 503 ? 'not_configured' : 'unavailable', data: defaultCensus() };
    }
    const data = await res.json();
    return { status: 'ok', data: { ...defaultCensus(), ...pickCensusFields(data) } };
  } catch {
    return { status: 'unavailable', data: defaultCensus() };
  }
}

export async function getCensusData(fips) {
  return (await fetchCensusData(fips)).data;
}

function pickCensusFields(data) {
  const fields = {};
  for (const name of Object.keys(defaultCensus())) {
    const value = Number(data?.[name]);
    if (Number.isFinite(value)) fields[name] = value;
  }
  return fields;
}

export function defaultCensus() {
  return {
    medianIncome: 0,
    population: 0,
    pctPoverty: 0,
    noVehicleHouseholds: 0,
    stateMedianFamilyIncome: 0,
  };
}
