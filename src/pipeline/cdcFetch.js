const MEASURES = ['DIABETES', 'OBESITY', 'BPHIGH', 'MHLTH', 'CHECKUP'];

export async function getCdcData(stateAbbr, fips) {
  try {
    // Prefer tract-level data if fips is available, fall back to state-level
    const query = fips
      ? `locationname=${fips}`
      : `stateabbr=${stateAbbr}`;

    const res = await fetch(
      `/api/cdc/resource/cwsq-ngmh.json?${query}&$limit=200`
    );
    if (!res.ok) return defaultCdc();

    const data = await res.json();

    const result = {};
    for (const measure of MEASURES) {
      // Try AgeAdjPrv first, fall back to CrdPrv
      const row =
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'AgeAdjPrv') ||
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'CrdPrv');
      result[measure.toLowerCase()] = row ? parseFloat(row.data_value) || 0 : 0;
    }

    return result;
  } catch {
    return defaultCdc();
  }
}

function defaultCdc() {
  return { diabetes: 0, obesity: 0, bphigh: 0, mhlth: 0, checkup: 0 };
}
