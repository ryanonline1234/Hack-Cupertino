import Papa from 'papaparse';

const DEFAULT_DATA = {
  isFoodDesert: false,
  usdaLilaFlag: false,
  hasUsdaMatch: false,
  matchQuality: 'none',
  designationMethod: 'none',
  accessRule: 'urban_1mi',
  isRural: false,
  lowAccessByShare: false,
  lowAccessByCount: false,
  isLowAccess: false,
  lowIncomeByPoverty: false,
  lowIncomeByIncomeThreshold: false,
  isLowIncome: false,
  povertyRate: 0,
  medianFamilyIncome: 0,
  lowAccessPopulationCount: 0,
  lowIncomeLowAccessPopulationCount: 0,
  qualifyingLowAccessPct: 0,
  pctLowAccess1mi: 0,
  pctLowAccess10mi: 0,
  pctSeniorsLowAccess: 0,
  pctNoVehicleLowAccess: 0,
};

const LOW_ACCESS_SIGNIFICANT_PCT = 33;
const LOW_ACCESS_SIGNIFICANT_COUNT = 500;
const POVERTY_LOW_INCOME_THRESHOLD = 20;

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

// Module-level cache — parsed and indexed once, reused on every subsequent call
let cachedDataset = null;

async function loadCsv() {
  if (cachedDataset) return cachedDataset;

  try {
    const res = await fetch('/data/food_atlas.csv');
    if (!res.ok) return null;
    const text = await res.text();

    const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
    const tractIndex = new Map();
    const countyIndex = new Map();

    for (const row of data) {
      const tractId = normalizeTractId(row.CensusTract);
      if (tractId && !tractIndex.has(tractId)) {
        tractIndex.set(tractId, row);
      }

      const countyId = countyKey(row.CensusTract);
      if (!countyId) continue;
      if (!countyIndex.has(countyId)) countyIndex.set(countyId, []);
      countyIndex.get(countyId).push(row);
    }

    cachedDataset = { rows: data, tractIndex, countyIndex };
    return cachedDataset;
  } catch {
    return null;
  }
}

export async function getUsdaData(fips) {
  try {
    const dataset = await loadCsv();
    if (!dataset) return { ...DEFAULT_DATA };

    const { tractIndex, countyIndex } = dataset;

    const target = normalizeTractId(fips);
    const targetCounty = countyKey(fips);
    const targetNumeric = tractNumericKey(fips);

    let row = tractIndex.get(target);

    let matchQuality = 'exact';

    if (!row && targetCounty) {
      const countyRows = countyIndex.get(targetCounty) || [];
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
    const lowAccessPopulationCount = Number.parseFloat(row.LAPOP1_10) || 0;
    const lowIncomeLowAccessPopulationCount = Number.parseFloat(row.LALOWI1_10) || 0;
    const povertyRate = parseFloat(row.PovertyRate) || 0;
    const medianFamilyIncome = parseFloat(row.MedianFamilyIncome) || 0;
    const isRural = Number(row.Urban) === 0;
    const accessRule = isRural ? 'rural_10mi' : 'urban_1mi';
    const qualifyingLowAccessPct = isRural ? pctLowAccess10mi : pctLowAccess1mi;
    const lowAccessByShare = qualifyingLowAccessPct >= LOW_ACCESS_SIGNIFICANT_PCT;
    const lowAccessByCount = lowAccessPopulationCount >= LOW_ACCESS_SIGNIFICANT_COUNT;
    const isLowAccess = lowAccessByShare || lowAccessByCount;
    const lowIncomeByPoverty = povertyRate >= POVERTY_LOW_INCOME_THRESHOLD;

    const usdaLilaFlag = Number(row.LILATracts_1And10) === 1;
    // Derived rule aligned with USDA-style definition: low-income + limited access distance.
    const derivedFoodDesert =
      isLowAccess &&
      lowIncomeByPoverty;

    const isFoodDesert = usdaLilaFlag || derivedFoodDesert;
    let designationMethod = 'not_designated';
    if (usdaLilaFlag) designationMethod = 'usda_lila';
    else if (derivedFoodDesert) designationMethod = 'derived_low_income_and_access';
    else if (isLowAccess && !lowIncomeByPoverty) designationMethod = 'low_access_not_low_income';

    return {
      isFoodDesert,
      usdaLilaFlag,
      hasUsdaMatch: true,
      matchQuality,
      designationMethod,
      accessRule,
      isRural,
      lowAccessByShare,
      lowAccessByCount,
      isLowAccess,
      lowIncomeByPoverty,
      lowIncomeByIncomeThreshold: false,
      isLowIncome: lowIncomeByPoverty,
      povertyRate,
      medianFamilyIncome,
      lowAccessPopulationCount,
      lowIncomeLowAccessPopulationCount,
      qualifyingLowAccessPct,
      pctLowAccess1mi,
      pctLowAccess10mi,
      pctSeniorsLowAccess,
      pctNoVehicleLowAccess,
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}
