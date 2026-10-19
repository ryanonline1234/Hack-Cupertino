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
// Map<GEOID, [lat, lng]> from INTPTLAT / INTPTLONG. With { details: true }
// each value is [lat, lng, POP10, USPS] instead (null when the file lacks the
// column); the county build weights centers by POP10.
export function parseGazetteerTracts(text, { details = false } = {}) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) throw new Error('Gazetteer file is empty');
  const header = lines[0].split('\t').map((name) => name.trim());
  const iGeoid = header.indexOf('GEOID');
  const iLat = header.indexOf('INTPTLAT');
  const iLng = header.indexOf('INTPTLONG');
  const iPop = header.indexOf('POP10');
  const iUsps = header.indexOf('USPS');
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
    if (!details) {
      centroids.set(geoid, [lat, lng]);
      continue;
    }
    const popText = iPop < 0 ? '' : String(cells[iPop] ?? '').trim();
    const pop = popText === '' ? null : Number(popText);
    if (pop !== null && !(Number.isInteger(pop) && pop >= 0)) {
      throw new Error(`Gazetteer line ${n + 1} has a bad POP10 for ${geoid}`);
    }
    const usps = iUsps < 0 ? null : String(cells[iUsps] ?? '').trim().toUpperCase() || null;
    centroids.set(geoid, [lat, lng, pop, usps]);
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
// Gazetteer keeps the original codes. Same tract, new number (Census ACS
// geography-change notes, 2011/2012/2014/2015 "Geography Changes" pages):
// atlas GEOID -> 2010 Gazetteer GEOID. This lists every atlas tract (flagged
// or not) that has no 2010 Gazetteer row: 25, checked 2026-10-18 against the
// Census pages and, where the atlas publishes LAPOP1_10 and lapop1share,
// against POP10. The tract build only looks up flagged tracts; the county
// build looks up all of them. Any other miss still fails both builds.
export const GEOID_2010_CODE_CHANGES = Object.freeze({
  // 2011 ACS: Madison County, NY: nine tracts renumbered, same boundaries.
  '36053030101': '36053940101', // 9401.01 is now 0301.01
  '36053030102': '36053940102', // 9401.02 is now 0301.02
  '36053030103': '36053940103', // 9401.03 is now 0301.03
  '36053030200': '36053940200', // 9402.00 is now 0302.00
  '36053030300': '36053940300', // 9403.00 is now 0303.00
  '36053030401': '36053940401', // 9404.01 is now 0304.01
  '36053030403': '36053940403', // 9404.03 is now 0304.03
  '36053030600': '36053940600', // 9406.00 is now 0306.00
  '36053030402': '36053940700', // 9407.00 is now 0304.02
  // 2011 ACS: Oneida County, NY: 9400.00 is now 0248.00, 9401.00 is now
  // 0247.00, and 9402.00 forms most of 0249.00 (plus part of 0230.00), so
  // 0249.00 sits at 9402.00's point.
  '36065024800': '36065940000',
  '36065024700': '36065940100',
  '36065024900': '36065940200',
  // 2012 ACS: Pima County, AZ: seven tracts renumbered, same boundaries.
  '04019002704': '04019002701', // 27.01 is now 27.04
  '04019002906': '04019002903', // 29.03 is now 29.06
  '04019004118': '04019410501', // 4105.01 is now 41.18
  '04019004121': '04019410502', // 4105.02 is now 41.21
  '04019004125': '04019410503', // 4105.03 is now 41.25
  '04019005200': '04019470400', // 4704.00 is now 52.00
  '04019005300': '04019470500', // 4705.00 is now 53.00
  // 2012 ACS: Los Angeles County, CA: tract 1370.00 was reinstated from all
  // of 2010 tract 9304.01 plus part of 8002.04, so it sits at 9304.01's point.
  '06037137000': '06037930401',
  // 2014 ACS: Bedford city, VA (51515) was absorbed into Bedford County (51019).
  '51019050100': '51515050100',
  // 2015 ACS: Wade Hampton Census Area, AK (02270) is now Kusilvak Census
  // Area (02158), and Shannon County, SD (46113) is now Oglala Lakota County
  // (46102); tract codes unchanged.
  '02158000100': '02270000100',
  '46102940500': '46113940500',
  '46102940800': '46113940800',
  '46102940900': '46113940900',
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

// Column order of each row in public/data/us/counties.json (the US map's
// county search). FIPS is the first 5 digits of the atlas GEOID; County and
// State are the atlas strings as written; USPS comes from the Gazetteer.
// LAT/LNG is the center, MINLAT..MAXLNG the box of the county's tract points.
export const COUNTY_FIELDS = Object.freeze([
  'FIPS',
  'County',
  'State',
  'USPS',
  'LAT',
  'LNG',
  'MINLAT',
  'MINLNG',
  'MAXLAT',
  'MAXLNG',
  'Tracts',
  'FlaggedTracts',
  'FlaggedLAPOP1_10',
]);

// County coordinates only aim the map, so 3 decimals (~110 m) keep the file small.
const round3 = (value) => Math.round(value * 1e3) / 1e3;

// Gazetteer longitudes east of 180° (only the far Aleutians) -> west of
// -180°, as the map draws them, so Aleutians West's box stays beside Alaska.
const mapLng = (lng) => (lng > 0 ? lng - 360 : lng);

// Atlas records + Gazetteer points (parseGazetteerTracts with details) -> one
// row per county in COUNTY_FIELDS order, sorted by FIPS, for EVERY county in
// the atlas (flagged tracts or not).
//   Tracts            atlas rows in the county
//   FlaggedTracts     of them, LILATracts_1And10 = 1
//   FlaggedLAPOP1_10  sum of LAPOP1_10 over the flagged ones (unpublished skipped)
//   LAT, LNG          POP10-weighted mean of the tract internal points; a plain
//                     mean when the county's POP10 is missing or sums to 0
//   MIN*/MAX*         box around those points (a one-tract county is a point)
//   (coordinates rounded to 3 decimals)
// Tracts are placed like buildLilaTractRows (GEOID, else the 2010 code change);
// a tract with no point still counts but lands in `misses`, and a county
// with no point at all gets null coordinates.
export function buildCountyRows(atlasRecords, points, codeChanges = GEOID_2010_CODE_CHANGES) {
  const byFips = new Map();
  const uspsByState = new Map();
  const misses = [];
  const recoded = [];
  const seen = new Set();
  for (const record of atlasRecords) {
    const geoid = padGeoid(record.CensusTract);
    if (seen.has(geoid)) throw new Error(`Atlas lists ${geoid} twice`);
    seen.add(geoid);
    const flag = atlasNumber(record.LILATracts_1And10, { integer: true });
    if (flag !== 0 && flag !== 1) throw new Error(`LILATracts_1And10 is not 0/1 for ${record.CensusTract}`);
    const fips = geoid.slice(0, 5);
    const county = String(record.County ?? '').trim();
    const state = String(record.State ?? '').trim();
    if (!county || !state) throw new Error(`Atlas tract ${geoid} has no County or State`);
    let entry = byFips.get(fips);
    if (!entry) {
      entry = { fips, county, state, usps: null, tracts: 0, flagged: 0, lowAccess: 0, pts: [] };
      byFips.set(fips, entry);
    } else if (entry.county !== county || entry.state !== state) {
      throw new Error(`County ${fips} is both "${entry.county}, ${entry.state}" and "${county}, ${state}"`);
    }
    entry.tracts += 1;
    if (flag === 1) {
      entry.flagged += 1;
      const lapop = atlasNumber(record.LAPOP1_10, { integer: true });
      if (lapop !== null) entry.lowAccess += lapop;
    }
    let point = points.get(geoid);
    if (!point && codeChanges[geoid]) {
      point = points.get(codeChanges[geoid]);
      if (point) recoded.push(`${geoid}<-${codeChanges[geoid]}`);
    }
    if (!point) {
      misses.push(geoid);
      continue;
    }
    entry.pts.push(point);
    const usps = point[3];
    if (usps) {
      const stateFips = fips.slice(0, 2);
      const known = uspsByState.get(stateFips);
      if (known && known !== usps) throw new Error(`State ${stateFips} is both ${known} and ${usps} in the Gazetteer`);
      uspsByState.set(stateFips, usps);
    }
  }

  const rows = [];
  for (const entry of byFips.values()) {
    let center = [null, null];
    let box = [null, null, null, null];
    if (entry.pts.length) {
      let minLat = Infinity;
      let minLng = Infinity;
      let maxLat = -Infinity;
      let maxLng = -Infinity;
      let sumLat = 0;
      let sumLng = 0;
      let wLat = 0;
      let wLng = 0;
      let wSum = 0;
      for (const [lat, rawLng, pop] of entry.pts) {
        const lng = mapLng(rawLng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        sumLat += lat;
        sumLng += lng;
        if (Number.isFinite(pop) && pop > 0) {
          wLat += lat * pop;
          wLng += lng * pop;
          wSum += pop;
        }
      }
      // Weighted only when every point has a POP10; a partial weighting
      // would silently drop the unweighted tracts.
      const allWeighted = entry.pts.every((p) => Number.isFinite(p[2]));
      center = allWeighted && wSum > 0
        ? [round3(wLat / wSum), round3(wLng / wSum)]
        : [round3(sumLat / entry.pts.length), round3(sumLng / entry.pts.length)];
      box = [round3(minLat), round3(minLng), round3(maxLat), round3(maxLng)];
    }
    rows.push([
      entry.fips,
      entry.county,
      entry.state,
      uspsByState.get(entry.fips.slice(0, 2)) ?? null,
      center[0],
      center[1],
      ...box,
      entry.tracts,
      entry.flagged,
      entry.lowAccess,
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { rows, misses, recoded };
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

// ── County search (run time) ────────────────────────────────────────────

// Committed counties.json -> array of county objects. Throws on a different
// field list, like decodeLilaTracts.
export function decodeCounties(json) {
  const fields = json?.fields;
  if (!Array.isArray(fields) || fields.join(',') !== COUNTY_FIELDS.join(',')) {
    throw new Error('Unexpected fields in the county file');
  }
  if (!Array.isArray(json.rows)) throw new Error('The county file has no rows');
  return json.rows.map((row) => ({
    fips: row[0],
    county: row[1],
    state: row[2],
    usps: row[3],
    lat: row[4],
    lng: row[5],
    box: row[6] === null ? null : [row[6], row[7], row[8], row[9]],
    tracts: row[10],
    flagged: row[11],
    flaggedLowAccess: row[12],
  }));
}

// "Santa Clara County, California"
export function countyLabel(county) {
  return `${county.county}, ${county.state}`;
}

// Lowercase, accents dropped ("Doña" -> "dona"), periods and apostrophes
// dropped ("St. Mary's" -> "st marys"), any other run of punctuation or space
// -> one space.
export function normalizeCountyText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COUNTY_SUFFIX = / (city and borough|county|parish|borough)$/;
const stripCountySuffix = (text) => text.replace(COUNTY_SUFFIX, '');

const searchKeyCache = new WeakMap();
function searchKeys(county) {
  let keys = searchKeyCache.get(county);
  if (!keys) {
    const full = normalizeCountyText(county.county);
    keys = {
      names: [...new Set([full, stripCountySuffix(full)])],
      state: normalizeCountyText(county.state),
      usps: String(county.usps ?? '').toLowerCase(),
    };
    searchKeyCache.set(county, keys);
  }
  return keys;
}

// 0: the name starts with the query, 1: a word in it does, 2: it contains it.
function nameTier(names, queries) {
  let best = null;
  for (const name of names) {
    for (const q of queries) {
      let tier = null;
      if (name.startsWith(q)) tier = 0;
      else if (` ${name}`.includes(` ${q}`)) tier = 1;
      else if (name.includes(q)) tier = 2;
      if (tier !== null && (best === null || tier < best)) best = tier;
    }
  }
  return best;
}

// Ways to read a query: always the whole thing as a county name, plus
// "county, state" (after the last comma: a USPS code or the start of a state
// name) or, without a comma, its last one to three words as a state (a USPS
// code, a full state name, or 3+ letters that start one) when words are left
// over for the county. `states` is a list of { state, usps } keys.
function readCountyQuery(query, states) {
  const matchStates = (part, prefix) => {
    const hits = new Set();
    for (const s of states) {
      if ((part.length === 2 && s.usps === part) || s.state === part || (prefix && s.state.startsWith(part))) hits.add(s.state);
    }
    return hits;
  };
  const raw = String(query ?? '');
  const comma = raw.lastIndexOf(',');
  if (comma >= 0) {
    const county = normalizeCountyText(raw.slice(0, comma));
    const statePart = normalizeCountyText(raw.slice(comma + 1));
    if (!county) return [];
    if (!statePart) return [{ county, states: null }];
    const hits = matchStates(statePart, true);
    return hits.size ? [{ county, states: hits }] : [];
  }
  const whole = normalizeCountyText(raw);
  if (!whole) return [];
  const readings = [{ county: whole, states: null }];
  const words = whole.split(' ');
  for (let k = 1; k <= Math.min(3, words.length - 1); k += 1) {
    const statePart = words.slice(-k).join(' ');
    const hits = matchStates(statePart, statePart.length >= 3);
    if (hits.size) readings.push({ county: words.slice(0, -k).join(' '), states: hits });
  }
  return readings;
}

// Counties matching a typed query, best first, at most `limit`: name starts
// with the query, then a word in the name does, then the name contains it.
// Case, accents and a trailing " County" / " Parish" / " Borough" are ignored
// on both sides, and a state can follow ("santa clara ca", "sunflower,
// mississippi"). Ties: more flagged tracts first, then alphabetical.
export function searchCounties(counties, query, limit = 8) {
  if (!Array.isArray(counties) || !counties.length) return [];
  const stateKeys = new Map();
  for (const c of counties) {
    const k = searchKeys(c);
    if (!stateKeys.has(k.state)) stateKeys.set(k.state, { state: k.state, usps: k.usps });
  }
  const readings = readCountyQuery(query, [...stateKeys.values()]);
  if (!readings.length) return [];
  const prepared = readings.map((r) => ({
    states: r.states,
    queries: [...new Set([r.county, stripCountySuffix(r.county)])].filter(Boolean),
  }));
  const hits = [];
  for (const c of counties) {
    const keys = searchKeys(c);
    let best = null;
    for (const r of prepared) {
      if (r.states && !r.states.has(keys.state)) continue;
      const tier = nameTier(keys.names, r.queries);
      if (tier !== null && (best === null || tier < best)) best = tier;
    }
    if (best !== null) hits.push({ c, tier: best });
  }
  hits.sort(
    (a, b) => a.tier - b.tier || b.c.flagged - a.c.flagged || countyLabel(a.c).localeCompare(countyLabel(b.c), 'en'),
  );
  return hits.slice(0, limit).map((h) => h.c);
}

// The box to fit the map to: the county's tract-point box, padded by
// `fraction` of its span on each side and at least `minPadDeg` degrees of
// latitude (the same distance in longitude), so a one-tract county still
// shows its surroundings. Returns [[south, west], [north, east]] or null.
export function paddedCountyBounds(county, { fraction = 0.15, minPadDeg = 0.05 } = {}) {
  const box = county?.box;
  if (!box || box.some((v) => !Number.isFinite(v))) return null;
  const [minLat, minLng, maxLat, maxLng] = box;
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const padLat = Math.max((maxLat - minLat) * fraction, minPadDeg);
  const padLng = Math.max((maxLng - minLng) * fraction, minPadDeg / cos);
  return [
    [Math.max(-90, minLat - padLat), minLng - padLng],
    [Math.min(90, maxLat + padLat), maxLng + padLng],
  ];
}
