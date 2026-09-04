/*
 * CDC PLACES health measures for one tract.
 *
 * Missing data is null, not zero.
 *
 * This module used to return `{ diabetes: 0, obesity: 0, ... }` whenever a
 * measure was absent or the request failed, and nothing downstream could tell
 * that apart from a real reading. A tract with no PLACES coverage displayed
 * "0% diabetes prevalence" as a finding, and projectImpact then computed a
 * zero health benefit from adding a store — a confident answer built on
 * absent data.
 *
 * Same fix, and same reasoning, as src/pipeline/censusFetch.js: every measure
 * is a number or null, and null means "we do not know". formatters.js already
 * renders null as an em dash.
 *
 * Note these are adult (18+) prevalence rates. projectionEngine pairs them
 * with the ACS 18+ population for exactly that reason.
 */

const MEASURES = ['DIABETES', 'OBESITY', 'BPHIGH', 'MHLTH', 'CHECKUP'];

function unavailable() {
  const result = {};
  for (const measure of MEASURES) result[measure.toLowerCase()] = null;
  result.source = 'unavailable';
  return result;
}

export async function getCdcData(stateAbbr, fips) {
  try {
    // Prefer tract-level data if fips is available, fall back to state-level
    const query = fips
      ? `locationname=${fips}`
      : `stateabbr=${stateAbbr}`;

    const res = await fetch(
      `/api/cdc/resource/cwsq-ngmh.json?${query}&$limit=200`
    );
    if (!res.ok) return unavailable();

    const data = await res.json();
    if (!Array.isArray(data)) return unavailable();

    const result = {};
    let found = 0;

    for (const measure of MEASURES) {
      // Prefer age-adjusted prevalence, fall back to crude.
      const row =
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'AgeAdjPrv') ||
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'CrdPrv');

      const value = row ? Number.parseFloat(row.data_value) : NaN;
      // A genuine 0.0 is a legitimate reading and must survive; only a
      // non-numeric or absent value becomes null.
      result[measure.toLowerCase()] = Number.isFinite(value) ? value : null;
      if (Number.isFinite(value)) found += 1;
    }

    result.source = found > 0 ? 'cdc_places' : 'unavailable';
    return result;
  } catch {
    return unavailable();
  }
}
