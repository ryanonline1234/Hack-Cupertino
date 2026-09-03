/*
 * Census ACS demographics for one tract.
 *
 * Two things changed here, for different reasons.
 *
 * 1. The API key moved server-side.
 *    This module used to read VITE_CENSUS_KEY and put it in a URL query
 *    parameter. Vite inlines every VITE_-prefixed variable into the production
 *    bundle, so the key was readable by anyone who viewed source. It now lives
 *    in CENSUS_KEY on the server and this module calls POST /api/census.
 *
 * 2. Missing data is null, not zero.
 *    The old failure path returned { medianIncome: 0, population: 0,
 *    pctPoverty: 0, ... }. Downstream, nothing could tell that apart from real
 *    data: the UI printed "$0" and "0%" as findings, projectImpact computed
 *    zero residents helped and zero economic impact, and the USDA low-income
 *    test silently evaluated false because 0 is not >= 20.
 *
 *    The app already handles unknown distance honestly — designation goes to
 *    UNKNOWN rather than guessing. Demographics now work the same way: every
 *    field is a number or null, and null means "we do not know", which the UI
 *    renders as "unavailable".
 */

const UNAVAILABLE = {
  medianIncome: null,
  population: null,
  adultPopulation: null,
  households: null,
  pctPoverty: null,
  noVehicleHouseholds: null,
  stateMedianFamilyIncome: null,
  source: 'unavailable',
};

export async function getCensusData(fips) {
  try {
    const res = await fetch('/api/census', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fips }),
    });

    if (!res.ok) {
      console.warn(`Census request failed (${res.status}) — demographics unavailable`);
      return { ...UNAVAILABLE };
    }

    const json = await res.json();

    // Poverty rate is derived, so it is only meaningful when both parts are
    // present and the denominator is non-zero.
    const population = json.population;
    const povertyPopulation = json.povertyPopulation;
    const pctPoverty =
      Number.isFinite(population) && population > 0 && Number.isFinite(povertyPopulation)
        ? (povertyPopulation / population) * 100
        : null;

    return {
      medianIncome: json.medianIncome ?? null,
      population: population ?? null,
      adultPopulation: json.adultPopulation ?? null,
      households: json.households ?? null,
      pctPoverty,
      noVehicleHouseholds: json.noVehicleHouseholds ?? null,
      stateMedianFamilyIncome: json.stateMedianFamilyIncome ?? null,
      source: 'census_acs_2022',
    };
  } catch (err) {
    console.warn('Census request threw — demographics unavailable:', err?.message || err);
    return { ...UNAVAILABLE };
  }
}
