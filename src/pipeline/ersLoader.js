// USDA ERS Food Access Research Atlas attributes for one 2020 tract, from the
// committed per-county shards in public/data/ers/<SSCCC>.json.
const ERS_BASE = '/data/ers';
const TIMEOUT_MS = 30_000;

// [output key, ERS field, kind]; flags are published as 1/0.
const SPEC_2025 = [
  ['urban', 'Urban', 'flag'],
  ['lowIncome', 'LowIncomeTracts', 'flag'],
  ['pop2020', 'POP2020', 'number'],
  ['sramLA', 'SD_SRAM_LA1and10', 'flag'],
  ['sramLILA', 'SD_SRAM_LILATracts_1And10', 'flag'],
  ['tractHUNV', 'TractHUNV', 'number'],
  ['ohu2020', 'OHU2020', 'number'],
  ['povertyRate', 'PovertyRate', 'number'],
  ['medianFamilyIncome', 'MedianFamilyIncome', 'number'],
  ['groupQuarters', 'GroupQuartersFlag', 'flag'],
];
// lapop*share are percents (0-100) as ERS publishes them.
const SPEC_2019 = [
  ['lila', 'LILATracts_1And10', 'flag'],
  ['la', 'LA1and10', 'flag'],
  ['lapop1share', 'lapop1share', 'number'],
  ['lapop10share', 'lapop10share', 'number'],
  ['urban', 'Urban', 'flag'],
];

const MISSING = Symbol('no ERS file for this county');
const countyCache = new Map(); // SSCCC -> Promise<doc | MISSING>

export function resetErsCache() {
  countyCache.clear();
}

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

const isTable = (t) => t !== null && typeof t === 'object' && !Array.isArray(t);

function columnIndex(fields, spec) {
  if (!Array.isArray(fields)) throw new Error('bad field list');
  return spec.map(([key, field, kind]) => {
    const i = fields.indexOf(field);
    if (i < 0) throw new Error(`ERS field ${field} missing`);
    return [key, i, kind];
  });
}

function convert(value, kind) {
  if (value === null || value === undefined) return null;
  if (kind === 'flag') {
    if (value === 1) return true;
    if (value === 0) return false;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`unexpected ERS value ${JSON.stringify(value)}`);
}

function readRow(table, columns, width, geoid) {
  if (!Object.prototype.hasOwnProperty.call(table, geoid)) return null;
  const row = table[geoid];
  if (!Array.isArray(row) || row.length !== width) throw new Error('bad ERS row');
  return Object.fromEntries(columns.map(([key, i, kind]) => [key, convert(row[i], kind)]));
}

function loadCounty(county) {
  if (!countyCache.has(county)) {
    const p = (async () => {
      const res = await fetch(`${ERS_BASE}/${county}.json`, withTimeout());
      // Shards exist only for counties ERS has rows for.
      if (res.status === 404) return MISSING;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      if (!doc || !isTable(doc.t2025) || !isTable(doc.t2019)) throw new Error('bad ERS shard');
      return {
        retrievedAt: doc.retrievedAt ?? null,
        t2025: doc.t2025,
        t2019: doc.t2019,
        c2025: columnIndex(doc.f2025, SPEC_2025),
        c2019: columnIndex(doc.f2019, SPEC_2019),
        w2025: doc.f2025.length,
        w2019: doc.f2019.length,
      };
    })();
    countyCache.set(county, p);
    p.catch(() => {
      if (countyCache.get(county) === p) countyCache.delete(county);
    });
  }
  return countyCache.get(county).catch(() => null);
}

const result = (status, extra = {}) => ({
  status,
  e2025: null,
  e2019: null,
  e2019Reason: null,
  retrievedAt: null,
  ...extra,
});

// -> { status: 'ok'|'missing_row'|'unavailable', e2025, e2019, e2019Reason, retrievedAt }
// status follows the 2025 row. e2019 is the 2019 row with the IDENTICAL
// GEOID (2010 tract kept its id), else null with e2019Reason
// 'boundary_changed'; e2019Reason stays null when no shard was read.
export async function loadErsTract(geoid20) {
  if (typeof geoid20 !== 'string' || !/^\d{11}$/.test(geoid20)) return result('unavailable');
  const shard = await loadCounty(geoid20.slice(0, 5));
  if (shard === null) return result('unavailable');
  if (shard === MISSING) return result('missing_row');
  let e2025;
  let e2019;
  try {
    e2025 = readRow(shard.t2025, shard.c2025, shard.w2025, geoid20);
    e2019 = readRow(shard.t2019, shard.c2019, shard.w2019, geoid20);
  } catch {
    return result('unavailable');
  }
  return result(e2025 ? 'ok' : 'missing_row', {
    e2025,
    e2019,
    e2019Reason: e2019 ? null : 'boundary_changed',
    retrievedAt: shard.retrievedAt,
  });
}
