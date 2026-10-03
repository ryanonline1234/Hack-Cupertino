// ACS figures for one tract, via the same-origin /api/acs function. The
// Census key lives on the server (CENSUS_KEY); nothing here reads it.
export async function getCensusData(fips) {
  if (typeof fips !== 'string' || !/^\d{11}$/.test(fips)) return defaultCensus();

  try {
    const res = await fetch(`/api/acs?fips=${fips}`);
    if (!res.ok) return defaultCensus();
    const data = await res.json();
    return { ...defaultCensus(), ...pickCensusFields(data) };
  } catch {
    return defaultCensus();
  }
}

function pickCensusFields(data) {
  const fields = {};
  for (const name of Object.keys(defaultCensus())) {
    const value = Number(data?.[name]);
    if (Number.isFinite(value)) fields[name] = value;
  }
  return fields;
}

function defaultCensus() {
  return {
    medianIncome: 0,
    population: 0,
    pctPoverty: 0,
    noVehicleHouseholds: 0,
    stateMedianFamilyIncome: 0,
  };
}
