import Papa from 'papaparse';

const DEFAULT_DATA = {
  isFoodDesert: false,
  pctLowAccess1mi: 0,
  pctLowAccess10mi: 0,
  pctSeniorsLowAccess: 0,
  pctNoVehicleLowAccess: 0,
  nearestStoreMiles: null,
};

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

    // CSV stores CensusTract as a number — compare as strings after trimming
    const target = String(fips).replace(/^0+/, '');
    const row = rows.find(
      (r) => String(r.CensusTract).replace(/^0+/, '') === target
    );

    if (!row) return { ...DEFAULT_DATA };

    return {
      isFoodDesert: row.LILATracts_1And10 === '1',
      pctLowAccess1mi: parseFloat(row.lapop1share) * 100 || 0,
      pctLowAccess10mi: parseFloat(row.lapop10share) * 100 || 0,
      pctSeniorsLowAccess: parseFloat(row.laseniors1share) * 100 || 0,
      pctNoVehicleLowAccess: parseFloat(row.lahunv1share) * 100 || 0,
      nearestStoreMiles: parseFloat(row.LAPOP1_10) || null,
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}
