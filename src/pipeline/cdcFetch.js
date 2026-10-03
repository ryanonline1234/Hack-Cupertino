const MEASURES = ['DIABETES', 'OBESITY', 'BPHIGH', 'MHLTH', 'CHECKUP'];
// Same feature-detected limit as the data loaders: a hung proxy can't hold
// the call open forever.
const TIMEOUT_MS = 30_000;

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

// -> { status: 'ok' | 'unavailable', data }. `data` is the default (all-zero)
// profile when the call failed or timed out, so callers that only want the
// figures can ignore `status`; the normalizer reads it to avoid caching an
// outage.
export async function fetchCdcData(stateAbbr, fips) {
  try {
    // Prefer tract-level data if fips is available, fall back to state-level
    const query = fips
      ? `locationname=${fips}`
      : `stateabbr=${stateAbbr}`;

    const res = await fetch(
      `/api/cdc/resource/cwsq-ngmh.json?${query}&$limit=200`,
      withTimeout(),
    );
    if (!res.ok) return unavailable();

    const data = await res.json();
    if (!Array.isArray(data)) return unavailable();

    const result = {};
    for (const measure of MEASURES) {
      // Try AgeAdjPrv first, fall back to CrdPrv
      const row =
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'AgeAdjPrv') ||
        data.find((d) => d.measureid === measure && d.datavaluetypeid === 'CrdPrv');
      result[measure.toLowerCase()] = row ? parseFloat(row.data_value) || 0 : 0;
    }

    return { status: 'ok', data: result };
  } catch {
    return unavailable();
  }
}

export async function getCdcData(stateAbbr, fips) {
  return (await fetchCdcData(stateAbbr, fips)).data;
}

function unavailable() {
  return { status: 'unavailable', data: defaultCdc() };
}

export function defaultCdc() {
  return { diabetes: 0, obesity: 0, bphigh: 0, mhlth: 0, checkup: 0 };
}
