export async function getCensusData(fips) {
  try {
    const key = import.meta.env.VITE_CENSUS_KEY;
    if (!key) {
      console.warn('VITE_CENSUS_KEY not set — skipping Census fetch');
      return defaultCensus();
    }

    const state = fips.slice(0, 2);
    const county = fips.slice(2, 5);
    const tract = fips.slice(5);

    const url =
      `/api/census/data/2022/acs/acs5?get=B19013_001E,B01003_001E,B17001_002E,B25044_003E,B25044_010E` +
      `&for=tract:${tract}&in=state:${state}%20county:${county}&key=${key}`;

    const res = await fetch(url);
    if (!res.ok) return defaultCensus();

    const json = await res.json();
    // json[0] = headers, json[1] = values
    if (!json?.[1]) return defaultCensus();

    const [medianIncome, population, povertyPop, ownerNoVeh, renterNoVeh] =
      json[1].map(Number);

    return {
      medianIncome: medianIncome > 0 ? medianIncome : 0,
      population: population > 0 ? population : 0,
      pctPoverty: population > 0 ? (povertyPop / population) * 100 : 0,
      noVehicleHouseholds: (ownerNoVeh || 0) + (renterNoVeh || 0),
    };
  } catch {
    return defaultCensus();
  }
}

function defaultCensus() {
  return { medianIncome: 0, population: 0, pctPoverty: 0, noVehicleHouseholds: 0 };
}
