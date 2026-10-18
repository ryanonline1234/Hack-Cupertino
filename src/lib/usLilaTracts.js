// USDA's published 2019 low-income & low-access tracts for the US map.
//
// Build time (scripts/build-us-lila-tracts.mjs): the 2019 Food Access Research
// Atlas extract (2010 census tracts) is filtered to LILATracts_1And10 = 1 and
// joined on the 11-digit GEOID to the Census 2010 Gazetteer internal points.
// Run time (src/components/DesignationAtlasView.jsx): the committed JSON is
// decoded and summarized for the tracts currently in view.
//
// Everything here is pure (no fetch, no fs, no DOM) so tests can import it.

// Column order of each row in public/data/us/usda2019-lila-tracts.json.
// The names are the source field names: GEOID/INTPTLAT/INTPTLONG from the
// Gazetteer, the rest from the atlas.
export const LILA_TRACT_FIELDS = Object.freeze([
  'GEOID',
  'INTPTLAT',
  'INTPTLONG',
  'State',
  'County',
  'Urban',
  'LAPOP1_10',
  'LALOWI1_10',
  'PovertyRate',
  'MedianFamilyIncome',
]);

// The atlas columns the builder reads (a subset of the extract's 13).
export const ATLAS_REQUIRED_COLUMNS = Object.freeze([
  'CensusTract',
  'State',
  'County',
  'Urban',
  'LILATracts_1And10',
  'LAPOP1_10',
  'LALOWI1_10',
  'PovertyRate',
  'MedianFamilyIncome',
]);

// Atlas CensusTract is numeric in the extract, so states 01-09 lose their
// leading zero (10 digits). GEOIDs are always 11.
export function padGeoid(value) {
  const digits = String(value ?? '').trim();
  if (!/^\d{1,11}$/.test(digits)) {
    throw new Error(`Not a census tract id: ${JSON.stringify(value)}`);
  }
  return digits.padStart(11, '0');
}

// Minimal RFC 4180 reader: commas, double-quoted fields, "" escapes, CRLF or
// LF. Returns an array of string arrays; a trailing newline adds no row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// CSV text -> array of { column: value } records. Throws when a required
// column is missing or a row has the wrong number of fields.
export function parseAtlasCsv(text, required = ATLAS_REQUIRED_COLUMNS) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error('Atlas CSV is empty');
  const names = header.map((name) => name.trim());
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Atlas CSV is missing columns: ${missing.join(', ')}`);
  return body
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells, index) => {
      if (cells.length !== names.length) {
        throw new Error(`Atlas CSV row ${index + 2} has ${cells.length} fields, expected ${names.length}`);
      }
      return Object.fromEntries(names.map((name, i) => [name, cells[i]]));
    });
}

// Census Gazetteer tract file (tab-separated, space-padded, CRLF) ->
// Map<GEOID, [lat, lng]> from INTPTLAT / INTPTLONG.
export function parseGazetteerTracts(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) throw new Error('Gazetteer file is empty');
  const header = lines[0].split('\t').map((name) => name.trim());
  const iGeoid = header.indexOf('GEOID');
  const iLat = header.indexOf('INTPTLAT');
  const iLng = header.indexOf('INTPTLONG');
  if (iGeoid < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`Gazetteer header lacks GEOID/INTPTLAT/INTPTLONG: ${header.join(',')}`);
  }
  const centroids = new Map();
  for (let n = 1; n < lines.length; n += 1) {
    const cells = lines[n].split('\t');
    const geoid = padGeoid(cells[iGeoid]);
    const lat = Number(cells[iLat]);
    const lng = Number(cells[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error(`Gazetteer line ${n + 1} has a bad internal point for ${geoid}`);
    }
    if (centroids.has(geoid)) throw new Error(`Gazetteer lists ${geoid} twice`);
    centroids.set(geoid, [lat, lng]);
  }
  return centroids;
}

// Atlas cell -> number, or null for an unpublished value ('NULL' / blank).
// Anything else that isn't a number is an error, never a silent 0.
export function atlasNumber(value, { integer = false } = {}) {
  const text = String(value ?? '').trim();
  if (text === '' || text.toUpperCase() === 'NULL') return null;
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`Not a number in the atlas: ${JSON.stringify(value)}`);
  if (integer && !Number.isInteger(number)) throw new Error(`Expected a whole number in the atlas: ${JSON.stringify(value)}`);
  return number;
}

const round4 = (value) => Math.round(value * 1e4) / 1e4;

// The atlas uses tract codes as corrected after the 2010 census; the 2010
// Gazetteer keeps the original codes. Same tract, same boundaries, new number
// (Census ACS geography-change notes): atlas GEOID -> 2010 Gazetteer GEOID.
// Only the renamed tracts USDA flagged are listed; any other miss still fails
// the build.
export const GEOID_2010_CODE_CHANGES = Object.freeze({
  // 2011 ACS: Madison County, NY, tract 9401.01 is now 0301.01, 9401.02 is now 0301.02.
  '36053030101': '36053940101',
  '36053030102': '36053940102',
  // 2012 ACS: Pima County, AZ, tract 4704.00 is now 52.00.
  '04019005200': '04019470400',
  // 2014 ACS: Bedford city, VA (51515) was absorbed into Bedford County (51019).
  '51019050100': '51515050100',
});

// Atlas records + Gazetteer centroids -> one compact row per tract USDA
// flagged LILATracts_1And10 = 1, in LILA_TRACT_FIELDS order, sorted by GEOID.
// Rows keep the atlas GEOID; `recoded` lists the ones placed via
// GEOID_2010_CODE_CHANGES. Flagged tracts without a point land in `misses`.
export function buildLilaTractRows(atlasRecords, centroids, codeChanges = GEOID_2010_CODE_CHANGES) {
  const rows = [];
  const misses = [];
  const recoded = [];
  const seen = new Set();
  let flagged = 0;
  for (const record of atlasRecords) {
    const flag = atlasNumber(record.LILATracts_1And10, { integer: true });
    if (flag !== 0 && flag !== 1) throw new Error(`LILATracts_1And10 is not 0/1 for ${record.CensusTract}`);
    if (flag !== 1) continue;
    flagged += 1;
    const geoid = padGeoid(record.CensusTract);
    if (seen.has(geoid)) throw new Error(`Atlas lists ${geoid} twice`);
    seen.add(geoid);
    let point = centroids.get(geoid);
    if (!point && codeChanges[geoid]) {
      point = centroids.get(codeChanges[geoid]);
      if (point) recoded.push(`${geoid}<-${codeChanges[geoid]}`);
    }
    if (!point) {
      misses.push(geoid);
      continue;
    }
    rows.push([
      geoid,
      round4(point[0]),
      round4(point[1]),
      String(record.State ?? '').trim(),
      String(record.County ?? '').trim(),
      atlasNumber(record.Urban, { integer: true }) === 1 ? 1 : 0,
      atlasNumber(record.LAPOP1_10, { integer: true }),
      atlasNumber(record.LALOWI1_10, { integer: true }),
      atlasNumber(record.PovertyRate),
      atlasNumber(record.MedianFamilyIncome, { integer: true }),
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { rows, misses, recoded, flagged };
}

// ── Run time ────────────────────────────────────────────────────────────

// Committed JSON -> array of tract objects. Throws if the field list doesn't
// match, so a stale or hand-edited file fails loudly instead of mis-mapping.
export function decodeLilaTracts(json) {
  const fields = json?.fields;
  if (!Array.isArray(fields) || fields.join(',') !== LILA_TRACT_FIELDS.join(',')) {
    throw new Error('Unexpected fields in the USDA 2019 tract file');
  }
  if (!Array.isArray(json.rows)) throw new Error('The USDA 2019 tract file has no rows');
  return json.rows.map((row) => ({
    geoid: row[0],
    lat: row[1],
    // Every US tract is west of Greenwich except the far Aleutians (past
    // 180°, e.g. 02016000100 at +178.3). Shift those by -360 so they draw
    // beside the rest of Alaska instead of across the map; `pointLng` keeps
    // the Gazetteer value for anything that geocodes the point.
    lng: row[2] > 0 ? row[2] - 360 : row[2],
    pointLng: row[2],
    state: row[3],
    county: row[4],
    urban: row[5] === 1,
    lowAccess: row[6],
    lowIncomeLowAccess: row[7],
    povertyRate: row[8],
    medianFamilyIncome: row[9],
  }));
}

// bounds: { south, west, north, east } in degrees (Leaflet getBounds()).
export function tractsInBounds(tracts, bounds) {
  const { south, west, north, east } = bounds;
  return tracts.filter((t) => t.lat >= south && t.lat <= north && t.lng >= west && t.lng <= east);
}

// Totals for a set of tracts. Null counts (unpublished) are skipped, and
// `unpublished` says how many tracts lacked a low-access count.
export function summarizeLilaTracts(tracts) {
  let lowAccess = 0;
  let lowIncomeLowAccess = 0;
  let urban = 0;
  let unpublished = 0;
  for (const t of tracts) {
    if (Number.isFinite(t.lowAccess)) lowAccess += t.lowAccess;
    else unpublished += 1;
    if (Number.isFinite(t.lowIncomeLowAccess)) lowIncomeLowAccess += t.lowIncomeLowAccess;
    if (t.urban) urban += 1;
  }
  return { tracts: tracts.length, lowAccess, lowIncomeLowAccess, urban, rural: tracts.length - urban, unpublished };
}

// States ranked by flagged tracts in the set (ties: more low-access residents).
export function topStatesByTracts(tracts, limit = 5) {
  const byState = new Map();
  for (const t of tracts) {
    const entry = byState.get(t.state) || { state: t.state, tracts: 0, lowAccess: 0 };
    entry.tracts += 1;
    if (Number.isFinite(t.lowAccess)) entry.lowAccess += t.lowAccess;
    byState.set(t.state, entry);
  }
  return [...byState.values()]
    .sort((a, b) => b.tracts - a.tracts || b.lowAccess - a.lowAccess || a.state.localeCompare(b.state))
    .slice(0, limit);
}

// Dot radius in px: sqrt of low-access residents (area ~ people), small at
// national zoom and growing a little as you zoom in.
export function lilaDotRadius(lowAccess, zoom) {
  const people = Number.isFinite(lowAccess) && lowAccess > 0 ? lowAccess : 0;
  const zoomScale = Math.min(3, Math.max(0.6, 0.75 + (zoom - 4) * 0.38));
  return (0.8 + Math.sqrt(people) / 36) * zoomScale;
}
