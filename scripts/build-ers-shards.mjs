#!/usr/bin/env node
// Build the per-county USDA ERS tract-attribute shards (docs/07, "ERS tract
// attributes"): public/data/ers/<SSCCC>.json, one file per county.
//
// Sources (ERS Food Access Research Atlas REST, keyless):
//   2025  FARA_2025_StraightLine/MapServer/4  — 2020 tracts, keyed by
//         CensusTract20 (never CensusTract24)
//   2019  FARA_2019/MapServer/30              — 2010 tracts, keyed by GEOID10
//
// File format:
//   { retrievedAt, sources: { 2025: url, 2019: url },
//     f2025: [field names], t2025: { "<geoid20>": [values] },
//     f2019: [field names], t2019: { "<geoid10>": [values] } }
// Values stay numbers (null stays null); shares/rates are rounded to 2
// decimals, income to an integer; 0/1 flags and counts must already be whole
// numbers (asserted, never rounded silently).
//
// Completeness: per layer, rows pulled == the service's returnCountOnly
// (checked before and after the pull), unique OBJECTIDs == rows, unique tract
// ids == rows, every tract id is 11 digits, and rows written == rows pulled.
// Tract totals: against TIGERweb Census2020 layer 6 (50 states + DC), every
// populated 2020 tract has a 2025 row, every 2025 id is a 2020 tract, and
// POP2020 == POP100. Any mismatch exits non-zero before a file is written.
//
// Coverage notes (measured 2026-10-02): 2025 has no Puerto Rico; 2019 has
// Puerto Rico rows with every field null; 2019 shares are null (not 0) for
// many tracts that are not low access — read null as "not published".
//
// Usage: node scripts/build-ers-shards.mjs [outDir]   (default public/data/ers)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(ROOT, process.argv[2] ?? 'public/data/ers');

const BASE = 'https://gisportal.ers.usda.gov/server/rest/services/FARA';
const TIGER_TRACTS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6';
const PAGE = 2000;        // both layers report maxRecordCount 2000
const CONCURRENCY = 4;    // polite: <= 4 in flight to the host
const TIMEOUT_MS = 90_000;

// kind: 'flag' (0/1), 'count' (whole number), 'share' (2 dp), 'income' (integer)
const LAYERS = [
  {
    key: '2025',
    url: `${BASE}/FARA_2025_StraightLine/MapServer/4`,
    idField: 'CensusTract20',
    fields: [
      ['Urban', 'flag'],
      ['LowIncomeTracts', 'flag'],
      ['POP2020', 'count'],
      ['SD_SRAM_LA1and10', 'flag'],
      ['SD_SRAM_LILATracts_1And10', 'flag'],
      ['TractHUNV', 'count'],
      ['OHU2020', 'count'],
      ['PovertyRate', 'share'],
      ['MedianFamilyIncome', 'income'],
      ['GroupQuartersFlag', 'flag'],
    ],
  },
  {
    key: '2019',
    url: `${BASE}/FARA_2019/MapServer/30`,
    idField: 'GEOID10',
    fields: [
      ['LILATracts_1And10', 'flag'],
      ['LA1and10', 'flag'],
      ['lapop1share', 'share'],
      ['lapop10share', 'share'],
      ['Urban', 'flag'],
    ],
  },
];

const SPOT = ['06085504602', '28151000600', '06085508101', '04001944202'];

const problems = [];
const fail = (msg) => problems.push(msg);

async function getJson(url, params) {
  const full = `${url}?${new URLSearchParams({ f: 'json', ...params })}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(full, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // ArcGIS answers bad params with HTTP 200 + { error }.
      if (json.error) throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message}`);
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`${url} failed after 3 attempts: ${lastErr?.message}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// Confirm every field exists in the layer metadata before pulling.
async function checkSchema(layer) {
  const meta = await getJson(layer.url, {});
  const byName = new Map((meta.fields ?? []).map((f) => [f.name, f.type]));
  for (const name of [layer.idField, 'OBJECTID', ...layer.fields.map(([n]) => n)]) {
    if (!byName.has(name)) fail(`${layer.key}: field ${name} missing from layer metadata`);
  }
  return { maxRecordCount: meta.maxRecordCount };
}

// Pull rows [offset, offset + want) ordered by OBJECTID; if the server returns a
// short page, keep requesting the remainder of the window until it is full or
// a page comes back empty (the count checks then fail loudly).
async function pullWindow(url, where, outFields, offset, want) {
  const rows = [];
  while (rows.length < want) {
    const j = await getJson(`${url}/query`, {
      where,
      outFields,
      returnGeometry: 'false',
      orderByFields: 'OBJECTID ASC',
      resultOffset: String(offset + rows.length),
      resultRecordCount: String(want - rows.length),
    });
    const feats = j.features ?? [];
    for (const f of feats) rows.push(f.attributes);
    if (feats.length === 0) break;
  }
  return rows;
}

// Every row matching `where`, paged by resultOffset over OBJECTID order.
// Checks: rows == returnCountOnly (before and after), unique OBJECTIDs, and a
// tail probe at offset == count that must come back empty and not flag
// exceededTransferLimit.
async function pullAll(label, url, where, outFields, page) {
  const count = async () => {
    const j = await getJson(`${url}/query`, { where, returnCountOnly: 'true' });
    if (!Number.isInteger(j.count)) throw new Error(`${label}: returnCountOnly gave no count`);
    return j.count;
  };
  const expected = await count();
  const windows = [];
  for (let off = 0; off < expected; off += page) windows.push([off, Math.min(page, expected - off)]);
  const pages = await pool(windows, CONCURRENCY, ([off, n]) => pullWindow(url, where, outFields, off, n));
  const rows = pages.flat();
  const tail = await getJson(`${url}/query`, {
    where, outFields: 'OBJECTID', returnGeometry: 'false', orderByFields: 'OBJECTID ASC',
    resultOffset: String(expected), resultRecordCount: '1',
  });
  if ((tail.features ?? []).length || tail.exceededTransferLimit) fail(`${label}: rows exist past offset ${expected}`);
  const expectedAfter = await count();
  const oids = new Set(rows.map((r) => r.OBJECTID));
  if (rows.length !== expected) fail(`${label}: pulled ${rows.length} rows, returnCountOnly ${expected}`);
  if (expectedAfter !== expected) fail(`${label}: returnCountOnly changed during pull ${expected} -> ${expectedAfter}`);
  if (oids.size !== rows.length) fail(`${label}: ${rows.length - oids.size} duplicate OBJECTIDs`);
  return { expected, expectedAfter, rows, pages: windows.length, uniqueOids: oids.size };
}

function convert(value, kind) {
  if (value === null || value === undefined) return { v: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { bad: `non-numeric ${JSON.stringify(value)}` };
  switch (kind) {
    case 'flag':
      return value === 0 || value === 1 ? { v: value } : { bad: `flag ${value}` };
    case 'count':
      return Number.isInteger(value) ? { v: value } : { bad: `non-integer count ${value}` };
    case 'share':
      return { v: Math.round(value * 100) / 100 };
    case 'income':
      return { v: Math.round(value) };
    default:
      return { bad: `unknown kind ${kind}` };
  }
}

async function pullLayer(layer) {
  const t0 = Date.now();
  const schema = await checkSchema(layer);
  if (schema.maxRecordCount && schema.maxRecordCount < PAGE) fail(`${layer.key}: maxRecordCount ${schema.maxRecordCount} < ${PAGE}`);
  const outFields = ['OBJECTID', layer.idField, ...layer.fields.map(([n]) => n)].join(',');
  const { expected, expectedAfter, rows, pages, uniqueOids } = await pullAll(layer.key, layer.url, '1=1', outFields, PAGE);

  const ids = new Map();
  let badIds = 0;
  let dupIds = 0;
  const nulls = Object.fromEntries(layer.fields.map(([n]) => [n, 0]));
  const badValues = {};
  for (const r of rows) {
    const id = r[layer.idField];
    if (typeof id !== 'string' || !/^\d{11}$/.test(id)) { badIds++; continue; }
    if (ids.has(id)) { dupIds++; continue; }
    const values = layer.fields.map(([name, kind]) => {
      const c = convert(r[name], kind);
      if (c.bad) { badValues[name] = (badValues[name] ?? 0) + 1; return null; }
      if (c.v === null) nulls[name]++;
      return c.v;
    });
    ids.set(id, values);
  }

  const k = layer.key;
  if (badIds) fail(`${k}: ${badIds} rows with a non-11-digit ${layer.idField}`);
  if (dupIds) fail(`${k}: ${dupIds} duplicate ${layer.idField}`);
  if (ids.size !== expected) fail(`${k}: ${ids.size} unique tract ids, returnCountOnly ${expected}`);
  for (const [name, n] of Object.entries(badValues)) fail(`${k}: ${n} unexpected values in ${name}`);

  console.log(`${k}: returnCountOnly ${expected} (after ${expectedAfter}) | pulled ${rows.length} in ${pages} pages | unique OBJECTID ${uniqueOids} | unique ${layer.idField} ${ids.size} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`${k}: nulls ${Object.entries(nulls).map(([n, c]) => `${n}=${c}`).join(' ')}`);
  return { expected, ids };
}

// Tract totals: TIGERweb's 2020 tracts for the 50 states + DC (ERS 2025 has no
// Puerto Rico or island areas). Every populated tract must have an ERS 2025
// row, every ERS 2025 id must be a real 2020 tract, and POP2020 must equal the
// tract's POP100 — so `income_unavailable` can only mean a fetch failure or a
// tract outside the 50 states + DC, never a hole in the shards.
async function crossCheckTiger(ids25) {
  const t0 = Date.now();
  const where = "STATE NOT IN ('60','66','69','72','78')";
  const { expected, rows } = await pullAll('tiger', TIGER_TRACTS, where, 'OBJECTID,GEOID,POP100', 5000);
  const tiger = new Map(rows.map((r) => [r.GEOID, r.POP100]));
  if (tiger.size !== rows.length) fail(`tiger: ${rows.length - tiger.size} duplicate GEOIDs`);
  const popIdx = LAYERS[0].fields.findIndex(([n]) => n === 'POP2020');
  let populated = 0;
  let populatedMissing = 0;
  let emptyMissing = 0;
  for (const [g, pop] of tiger) {
    if (pop > 0) populated++;
    if (!ids25.has(g)) pop > 0 ? populatedMissing++ : emptyMissing++;
  }
  let notInTiger = 0;
  let popDiffers = 0;
  for (const [g, v] of ids25) {
    if (!tiger.has(g)) notInTiger++;
    else if (tiger.get(g) !== v[popIdx]) popDiffers++;
  }
  if (populatedMissing) fail(`tiger: ${populatedMissing} populated 2020 tracts have no ERS 2025 row`);
  if (notInTiger) fail(`tiger: ${notInTiger} ERS 2025 ids are not 2020 tracts in the 50 states + DC`);
  if (popDiffers) fail(`tiger: ${popDiffers} tracts where ERS POP2020 != TIGER POP100`);
  console.log(`tiger: 2020 tracts (50 states + DC) ${expected}, populated ${populated} | populated without ERS 2025 row ${populatedMissing} | zero-pop without row ${emptyMissing} | ERS ids not in TIGER ${notInTiger} | POP2020 != POP100 ${popDiffers} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function groupByCounty(ids) {
  const byCounty = new Map();
  for (const id of [...ids.keys()].sort()) {
    const c = id.slice(0, 5);
    if (!byCounty.has(c)) byCounty.set(c, {});
    byCounty.get(c)[id] = ids.get(id);
  }
  return byCounty;
}

const started = Date.now();
const retrievedAt = new Date().toISOString();
const results = {};
for (const layer of LAYERS) results[layer.key] = await pullLayer(layer);
await crossCheckTiger(results['2025'].ids);

const c25 = groupByCounty(results['2025'].ids);
const c19 = groupByCounty(results['2019'].ids);
const counties = [...new Set([...c25.keys(), ...c19.keys()])].sort();
const only25 = counties.filter((c) => !c19.has(c));
const only19 = counties.filter((c) => !c25.has(c));

let written25 = 0;
let written19 = 0;
const files = counties.map((c) => {
  const t2025 = c25.get(c) ?? {};
  const t2019 = c19.get(c) ?? {};
  written25 += Object.keys(t2025).length;
  written19 += Object.keys(t2019).length;
  const doc = {
    retrievedAt,
    sources: { 2025: LAYERS[0].url, 2019: LAYERS[1].url },
    f2025: LAYERS[0].fields.map(([n]) => n),
    t2025,
    f2019: LAYERS[1].fields.map(([n]) => n),
    t2019,
  };
  return [c, JSON.stringify(doc)];
});
if (written25 !== results['2025'].expected) fail(`2025: ${written25} rows staged for writing, expected ${results['2025'].expected}`);
if (written19 !== results['2019'].expected) fail(`2019: ${written19} rows staged for writing, expected ${results['2019'].expected}`);

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`FAIL ${problems.length} problem(s); nothing written.`);
  process.exit(1);
}

// Replace the shard set atomically enough for a build script: clear old
// <SSCCC>.json files (so a vanished county can't linger), then write.
mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^\d{5}\.json$/.test(f)) rmSync(path.join(OUT_DIR, f));
let totalBytes = 0;
let largest = ['', 0];
for (const [c, text] of files) {
  writeFileSync(path.join(OUT_DIR, `${c}.json`), text);
  const b = Buffer.byteLength(text);
  totalBytes += b;
  if (b > largest[1]) largest = [c, b];
}

console.log(`counties: ${counties.length} files (2025 counties ${c25.size}, 2019 counties ${c19.size}; only-2025 ${only25.length}: ${only25.join(',') || '-'}; only-2019 ${only19.length}: ${only19.join(',') || '-'})`);
console.log(`written: 2025 rows ${written25} / ${results['2025'].expected}, 2019 rows ${written19} / ${results['2019'].expected}`);
console.log(`bytes: total ${totalBytes}, largest ${largest[0]}.json ${largest[1]}`);
for (const id of SPOT) {
  const show = (layer, key) => {
    const v = results[key].ids.get(id);
    return v ? layer.fields.map(([n], i) => `${n}=${v[i]}`).join(' ') : 'no row';
  };
  console.log(`spot ${id} | 2025 ${show(LAYERS[0], '2025')} | 2019 ${show(LAYERS[1], '2019')}`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${path.relative(ROOT, OUT_DIR) || OUT_DIR}`);
