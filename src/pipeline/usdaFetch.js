import Papa from 'papaparse';

const DEFAULT_DATA = {
  isFoodDesert: false,
  hasUsdaMatch: false,
  matchQuality: 'none',
  designationMethod: 'none',
  pctLowAccess1mi: 0,
  pctLowAccess10mi: 0,
  pctSeniorsLowAccess: 0,
  pctNoVehicleLowAccess: 0,
  nearestStoreMiles: null,
};

const LOW_ACCESS_SIGNIFICANT_PCT = 33;
const NO_VEHICLE_SIGNIFICANT_PCT = 10;

function normalizeTractId(value) {
  if (value == null) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  // Some CSV exports can contain scientific notation or decimal suffixes.
  if (/e\+/i.test(raw)) {
    const expanded = Number(raw);
    if (Number.isFinite(expanded)) {
      return Math.trunc(expanded).toString().replace(/^0+/, '');
    }
  }

  const digitsOnly = raw.replace(/[^0-9]/g, '');
  return digitsOnly.replace(/^0+/, '');
}

function tractDigits(value) {
  if (value == null) return '';
  return String(value).replace(/[^0-9]/g, '');
}

function countyKey(value) {
  const digits = tractDigits(value);
  if (!digits) return '';
  return digits.padStart(11, '0').slice(0, 5);
}

function tractNumericKey(value) {
  const normalized = normalizeTractId(value);
  if (!normalized) return 0;
  return Number(normalized) || 0;
}

function toPercent(value) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw || raw.toUpperCase() === 'NULL') return 0;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;

  // Older local mock data used 0-1 shares; USDA full export uses 0-100 percentages.
  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percent));
}

// Module-level cache — parsed once, reused on every subsequent call
let cachedRows = null;

async function loadCsv() {
  if (cachedRows) return cachedRows;

  try {
    const res = await fetch('/data/food_atlas.csv');
    if (!res.ok) return null;
    const text = await res.text();

    const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
    cachedRows = data;
    return cachedRows;
  } catch {
    return null;
  }
}

export async function getUsdaData(fips) {
  try {
    const rows = await loadCsv();
    if (!rows) return { ...DEFAULT_DATA };

    const target = normalizeTractId(fips);
    const targetCounty = countyKey(fips);
    const targetNumeric = tractNumericKey(fips);

    let row = rows.find(
      (r) => normalizeTractId(r.CensusTract) === target
    );

    let matchQuality = 'exact';

    if (!row && targetCounty) {
      const countyRows = rows.filter((r) => countyKey(r.CensusTract) === targetCounty);
      if (countyRows.length > 0) {
        row = countyRows.reduce((best, candidate) => {
          const bestDiff = Math.abs(tractNumericKey(best.CensusTract) - targetNumeric);
          const candidateDiff = Math.abs(tractNumericKey(candidate.CensusTract) - targetNumeric);
          return candidateDiff < bestDiff ? candidate : best;
        }, countyRows[0]);
        matchQuality = 'county_nearest';
      }
    }

    if (!row) return { ...DEFAULT_DATA };

    const pctLowAccess1mi = toPercent(row.lapop1share);
    const pctLowAccess10mi = toPercent(row.lapop10share);
    const pctSeniorsLowAccess = toPercent(row.laseniors1share);
    const pctNoVehicleLowAccess = toPercent(row.lahunv1share);
    const nearestStoreMiles = parseFloat(row.LAPOP1_10);

    const usdaLilaFlag = Number(row.LILATracts_1And10) === 1;
    // Fallback designation rule using available CSV fields when flag quality is uncertain.
    const significantLowAccess = Math.max(pctLowAccess1mi, pctLowAccess10mi) >= LOW_ACCESS_SIGNIFICANT_PCT;
    const significantNoVehicleBurden = pctNoVehicleLowAccess >= NO_VEHICLE_SIGNIFICANT_PCT;
    const derivedFoodDesert = significantLowAccess && significantNoVehicleBurden;

    const isFoodDesert = usdaLilaFlag || derivedFoodDesert;
    const designationMethod = usdaLilaFlag ? 'usda_lila' : (derivedFoodDesert ? 'derived_low_access_no_vehicle' : 'not_designated');

    return {
      isFoodDesert,
      hasUsdaMatch: true,
      matchQuality,
      designationMethod,
      pctLowAccess1mi,
      pctLowAccess10mi,
      pctSeniorsLowAccess,
      pctNoVehicleLowAccess,
      nearestStoreMiles: Number.isFinite(nearestStoreMiles) ? nearestStoreMiles : null,
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}
