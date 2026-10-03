#!/usr/bin/env node
// Build the bundled 2020 Census block files (docs/07 "Blocks bundle").
//
// For each county: every populated 2020 block (TIGERweb Census2020 layer 10),
// every 2020 tract (layer 6, including POP100 = 0), and the incorporated places
// (layer 26) and CDPs (layer 28) intersecting the county envelope with
// full-resolution geometry. Each block gets the 7-digit place GEOID whose
// polygon contains its internal point (even-odd ray casting over all rings;
// incorporated place preferred over a CDP), or "".
//
// Output: public/data/blocks/<SSCCC>.json
//   { retrievedAt, source,
//     tracts: { "<tract6>": { pop, name, blocks: [[block4, pop, hu, lat, lng, ur, place7], ...] } },
//     places: { "<place7>": { name, pop } } }
//
// Asserts (exit 1 on any failure; a failing county's file is not written):
//   - populated blocks pulled == returnCountOnly, tracts pulled == returnCountOnly,
//     places pulled == returnCountOnly (per layer), all GEOIDs unique;
//   - every tract: sum of block POP100 == tract POP100;
//   - every block internal point inside the county envelope;
//   - every place assigned to a block, and every populated envelope place
//     assigned none: in-county block pop + pop of out-of-county populated
//     blocks inside its polygon (live from layer 10) == place POP100;
//   - San Jose 0668000 == 1,013,240 in 06085 alone.
//
// Usage: node scripts/build-block-bundles.mjs [SSCCC ...]   (default: all four)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer';
const LAYER = { blocks: 10, tracts: 6, incorporated: 26, cdp: 28 };
const COUNTIES = {
  '06085': 'Santa Clara CA',
  '06001': 'Alameda CA',
  '28151': 'Washington MS',
  '04001': 'Apache AZ',
};
// Places whose in-county block sum must equal POP100 exactly (whole place in one county).
const EXPECT_WHOLE = { '06085': ['0668000', '0617610'], '28151': ['2829180'], '04001': ['0412770'] };
const EXPECT_POP = { '0668000': 1013240 };
const SOURCE =
  'US Census Bureau TIGERweb tigerWMS_Census2020 MapServer: layer 10 (2020 Census Blocks, POP100 > 0), ' +
  'layer 6 (2020 Census Tracts), layers 26 (Incorporated Places) and 28 (Census Designated Places), ' +
  'full-resolution place polygons; place = polygon containing the block internal point (incorporated preferred over CDP)';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'blocks');

// ---------------------------------------------------------------- network
const MAX_CONCURRENT = 4; // one host
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}
let requestCount = 0;
let retryCount = 0;

async function query(layer, params, label) {
  const url = `${BASE}/${layer}/query`;
  const body = new URLSearchParams({ f: 'json', ...params }).toString();
  let lastErr;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt) {
      retryCount++;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    }
    try {
      return await withSlot(async () => {
        requestCount++;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 90_000);
        try {
          // POST: full-res geometry responses and long where clauses stay off the URL.
          const r = await fetch(url, {
            method: 'POST',
            body,
            signal: ctl.signal,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          });
          const text = await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = JSON.parse(text);
          if (json.error) throw new Error(`service error ${json.error.code}: ${json.error.message}`);
          return json;
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${label}: failed after 4 attempts: ${lastErr?.message}`);
}

async function countOnly(layer, params, label) {
  const j = await query(layer, { ...params, returnCountOnly: 'true' }, `${label} count`);
  if (!Number.isInteger(j.count)) throw new Error(`${label}: count missing`);
  return j.count;
}

// Page by OBJECTID until the service stops reporting exceededTransferLimit.
async function queryAll(layer, params, label, pageSize) {
  const out = [];
  for (let offset = 0; ; ) {
    const j = await query(
      layer,
      { ...params, orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(pageSize) },
      `${label}@${offset}`,
    );
    if (!Array.isArray(j.features)) throw new Error(`${label}@${offset}: no features array`);
    out.push(...j.features);
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < pageSize) break;
    if (j.features.length === 0) break;
  }
  return out;
}

// ---------------------------------------------------------------- geometry
function ringsBbox(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}
// Even-odd over every ring (outer rings, holes, multipart alike).
function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
// A place may come back as more than one feature; it contains the point if any part does.
function placeContains(place, x, y) {
  for (const part of place.parts) {
    const [a, b, c, d] = part.bbox;
    if (x >= a && x <= c && y >= b && y <= d && pointInRings(x, y, part.rings)) return true;
  }
  return false;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;
const fmt = (n) => n.toLocaleString('en-US');

// ---------------------------------------------------------------- per county
async function fetchPlaces(layer, env, label) {
  const params = {
    geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
  };
  const expected = await countOnly(layer, params, label);
  const feats = await queryAll(
    layer,
    { ...params, outFields: 'GEOID,NAME,BASENAME,POP100,OBJECTID', returnGeometry: 'true', outSR: '4326' },
    label,
    50,
  );
  const byId = new Map();
  for (const f of feats) {
    const a = f.attributes;
    const rings = f.geometry?.rings;
    if (!/^\d{7}$/.test(a.GEOID ?? '')) throw new Error(`${label}: bad GEOID ${a.GEOID}`);
    if (!Array.isArray(rings) || rings.length === 0) throw new Error(`${label}: ${a.GEOID} has no geometry`);
    let p = byId.get(a.GEOID);
    if (!p) {
      p = { geoid: a.GEOID, name: a.NAME || a.BASENAME, pop: a.POP100, layer, parts: [], verts: 0 };
      byId.set(a.GEOID, p);
    }
    p.parts.push({ rings, bbox: ringsBbox(rings) });
    p.verts += rings.reduce((s, r) => s + r.length, 0);
  }
  return { expected, pulled: feats.length, places: byId };
}

async function buildCounty(ssccc) {
  const t0 = performance.now();
  const ss = ssccc.slice(0, 2), ccc = ssccc.slice(2);
  const where = `STATE='${ss}' AND COUNTY='${ccc}'`;
  const fails = [];
  const fail = (msg) => fails.push(msg);
  const log = (msg) => console.log(`[${ssccc}] ${msg}`);

  // County envelope (union of its tracts' extents).
  const ext = await query(LAYER.tracts, { where, returnExtentOnly: 'true', outSR: '4326' }, `${ssccc} extent`);
  const env = ext.extent;
  if (!env || !Number.isFinite(env.xmin)) throw new Error(`${ssccc}: no extent`);

  const [blockExpected, tractExpected, blockFeats, tractFeats, inc, cdp] = await Promise.all([
    countOnly(LAYER.blocks, { where: `${where} AND POP100>0` }, `${ssccc} blocks`),
    countOnly(LAYER.tracts, { where }, `${ssccc} tracts`),
    queryAll(
      LAYER.blocks,
      {
        where: `${where} AND POP100>0`,
        outFields: 'GEOID,TRACT,BLOCK,POP100,HU100,UR,INTPTLAT,INTPTLON,OBJECTID',
        returnGeometry: 'false',
      },
      `${ssccc} blocks`,
      5000,
    ),
    queryAll(
      LAYER.tracts,
      { where, outFields: 'GEOID,TRACT,NAME,BASENAME,POP100,OBJECTID', returnGeometry: 'false' },
      `${ssccc} tracts`,
      1000,
    ),
    fetchPlaces(LAYER.incorporated, env, `${ssccc} L26`),
    fetchPlaces(LAYER.cdp, env, `${ssccc} L28`),
  ]);

  // ---- tracts
  const tracts = new Map();
  for (const { attributes: a } of tractFeats) {
    if (a.GEOID !== `${ssccc}${a.TRACT}` || !/^\d{6}$/.test(a.TRACT ?? '')) fail(`tract GEOID/TRACT mismatch ${a.GEOID}`);
    if (!Number.isInteger(a.POP100) || a.POP100 < 0) fail(`tract ${a.GEOID} bad POP100`);
    if (tracts.has(a.TRACT)) fail(`duplicate tract ${a.TRACT}`);
    tracts.set(a.TRACT, { pop: a.POP100, name: a.NAME || a.BASENAME, blocks: [], sum: 0 });
  }
  if (tractFeats.length !== tractExpected) fail(`tracts pulled ${tractFeats.length} != returnCountOnly ${tractExpected}`);

  // ---- places
  for (const [L, r] of [[26, inc], [28, cdp]]) {
    if (r.pulled !== r.expected) fail(`L${L} places pulled ${r.pulled} != returnCountOnly ${r.expected}`);
  }
  const multiPart = [...inc.places.values(), ...cdp.places.values()].filter((p) => p.parts.length > 1).length;
  const crossLayer = [...inc.places.keys()].filter((g) => cdp.places.has(g));
  if (crossLayer.length) fail(`GEOID in both L26 and L28: ${crossLayer.join(',')}`);

  // ---- blocks
  const seen = new Set();
  let outsideEnv = 0, bothIncCdp = 0, multiInc = 0, multiCdp = 0, noPlaceBlocks = 0, noPlacePop = 0;
  let popTotal = 0, huTotal = 0;
  const urCount = { U: 0, R: 0, '': 0 };
  const placeSum = new Map();
  const incList = [...inc.places.values()];
  const cdpList = [...cdp.places.values()];
  const tPip = performance.now();
  for (const { attributes: a } of blockFeats) {
    if (seen.has(a.GEOID)) { fail(`duplicate block ${a.GEOID}`); continue; }
    seen.add(a.GEOID);
    if (a.GEOID !== `${ssccc}${a.TRACT}${a.BLOCK}` || !/^\d{4}$/.test(a.BLOCK ?? '')) fail(`block GEOID mismatch ${a.GEOID}`);
    const t = tracts.get(a.TRACT);
    if (!t) { fail(`block ${a.GEOID} in unknown tract ${a.TRACT}`); continue; }
    if (!Number.isInteger(a.POP100) || a.POP100 <= 0) fail(`block ${a.GEOID} bad POP100`);
    if (!Number.isInteger(a.HU100) || a.HU100 < 0) fail(`block ${a.GEOID} bad HU100`);
    const lat = Number(a.INTPTLAT), lng = Number(a.INTPTLON);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { fail(`block ${a.GEOID} bad internal point`); continue; }
    if (lng < env.xmin || lng > env.xmax || lat < env.ymin || lat > env.ymax) outsideEnv++;
    const ur = a.UR === 'U' || a.UR === 'R' ? a.UR : '';
    if (a.UR && !ur) fail(`block ${a.GEOID} unexpected UR ${a.UR}`);
    urCount[ur]++;

    const incHits = incList.filter((p) => placeContains(p, lng, lat));
    const cdpHits = cdpList.filter((p) => placeContains(p, lng, lat));
    if (incHits.length > 1) multiInc++;
    if (cdpHits.length > 1) multiCdp++;
    if (incHits.length && cdpHits.length) bothIncCdp++;
    const place = incHits[0] ?? cdpHits[0];
    const place7 = place ? place.geoid : '';
    if (place) placeSum.set(place7, (placeSum.get(place7) ?? 0) + a.POP100);
    else { noPlaceBlocks++; noPlacePop += a.POP100; }

    t.blocks.push([a.BLOCK, a.POP100, a.HU100, round5(lat), round5(lng), ur, place7]);
    t.sum += a.POP100;
    popTotal += a.POP100;
    huTotal += a.HU100;
  }
  const pipMs = Math.round(performance.now() - tPip);
  if (blockFeats.length !== blockExpected) fail(`populated blocks pulled ${blockFeats.length} != returnCountOnly ${blockExpected}`);
  if (seen.size !== blockExpected) fail(`unique blocks ${seen.size} != returnCountOnly ${blockExpected}`);
  if (outsideEnv) fail(`${outsideEnv} block internal points outside the county envelope`);
  if (multiInc) fail(`${multiInc} blocks inside more than one incorporated place`);
  if (multiCdp) fail(`${multiCdp} blocks inside more than one CDP`);

  let tractMismatch = 0, zeroPopTracts = 0, zeroPopTractsWithBlocks = 0;
  for (const [code, t] of tracts) {
    if (t.sum !== t.pop) { tractMismatch++; fail(`tract ${code}: block sum ${t.sum} != POP100 ${t.pop}`); }
    if (t.pop === 0) { zeroPopTracts++; if (t.blocks.length) zeroPopTractsWithBlocks++; }
  }

  // ---- place reconciliation: in-county sum + out-of-county blocks inside the polygon == POP100.
  // Run for every assigned place AND every populated envelope place that got no block, so a
  // place whose in-county residents the ray cast missed cannot pass silently.
  const allPlaces = new Map([...inc.places, ...cdp.places]);
  const candidates = [...allPlaces.values()].filter((p) => placeSum.has(p.geoid) || p.pop > 0).map((p) => p.geoid);
  const placeRows = [];
  const unassignedRows = [];
  await Promise.all(
    candidates.map(async (g) => {
      const inSum = placeSum.get(g) ?? 0;
      const p = allPlaces.get(g);
      let outSum = 0, outBlocks = 0;
      if (inSum < p.pop) {
        const bb = p.parts.map((x) => x.bbox).reduce((m, b) => [Math.min(m[0], b[0]), Math.min(m[1], b[1]), Math.max(m[2], b[2]), Math.max(m[3], b[3])]);
        const params = {
          where: `POP100>0 AND NOT (${where})`,
          geometry: bb.join(','),
          geometryType: 'esriGeometryEnvelope',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
        };
        const label = `${ssccc} outside ${g}`;
        const expected = await countOnly(LAYER.blocks, params, label);
        const feats = await queryAll(LAYER.blocks, { ...params, outFields: 'GEOID,POP100,INTPTLAT,INTPTLON,OBJECTID', returnGeometry: 'false' }, label, 5000);
        if (feats.length !== expected) fail(`${label}: pulled ${feats.length} != returnCountOnly ${expected}`);
        for (const { attributes: a } of feats) {
          if (placeContains(p, Number(a.INTPTLON), Number(a.INTPTLAT))) { outSum += a.POP100; outBlocks++; }
        }
      }
      const ok = inSum + outSum === p.pop;
      if (!ok) fail(`place ${g} ${p.name}: in-county ${inSum} + out-of-county ${outSum} != POP100 ${p.pop}`);
      const row = { geoid: g, name: p.name, layer: p.layer, pop: p.pop, inSum, outSum, outBlocks, whole: inSum === p.pop, ok };
      (placeSum.has(g) ? placeRows : unassignedRows).push(row);
    }),
  );
  placeRows.sort((a, b) => a.geoid.localeCompare(b.geoid));
  for (const g of EXPECT_WHOLE[ssccc] ?? []) {
    const r = placeRows.find((x) => x.geoid === g);
    if (!r) fail(`expected place ${g} not assigned any block`);
    else if (!r.whole) fail(`expected whole place ${g} ${r.name}: in-county ${r.inSum} != POP100 ${r.pop}`);
    if (r && EXPECT_POP[g] !== undefined && r.inSum !== EXPECT_POP[g]) fail(`place ${g}: ${r.inSum} != expected ${EXPECT_POP[g]}`);
  }

  // ---- output
  const tractsOut = {};
  for (const code of [...tracts.keys()].sort()) {
    const t = tracts.get(code);
    t.blocks.sort((a, b) => a[0].localeCompare(b[0]));
    tractsOut[code] = { pop: t.pop, name: t.name, blocks: t.blocks };
  }
  const placesOut = {};
  for (const r of placeRows) placesOut[r.geoid] = { name: r.name, pop: r.pop };
  const doc = { retrievedAt: new Date().toISOString(), source: SOURCE, tracts: tractsOut, places: placesOut };
  const json = JSON.stringify(doc);
  const raw = Buffer.byteLength(json);
  const gz = gzipSync(json, { level: 9 }).length;

  log(`tracts ${tracts.size} (returnCountOnly ${tractExpected}; POP100=0: ${zeroPopTracts}, of which with blocks: ${zeroPopTractsWithBlocks}); tract sum mismatches ${tractMismatch}`);
  log(`populated blocks ${seen.size} (returnCountOnly ${blockExpected}); pop ${fmt(popTotal)}; hu ${fmt(huTotal)}; UR U/R/blank ${urCount.U}/${urCount.R}/${urCount['']}`);
  log(`envelope places pulled L26 ${inc.pulled}/${inc.expected}, L28 ${cdp.pulled}/${cdp.expected}; multi-feature places ${multiPart}; max verts ${Math.max(0, ...[...allPlaces.values()].map((p) => p.verts))}`);
  log(`places assigned ${placeRows.length} (L26 ${placeRows.filter((r) => r.layer === 26).length}, L28 ${placeRows.filter((r) => r.layer === 28).length}); blocks in both L26+L28 ${bothIncCdp}; blocks in no place ${noPlaceBlocks} (pop ${fmt(noPlacePop)}); PIP ${pipMs} ms`);
  log(`places whole in county ${placeRows.filter((r) => r.whole).length}; cross-county ${placeRows.filter((r) => !r.whole).length}; reconciled ${placeRows.filter((r) => r.ok).length}/${placeRows.length}`);
  log(`populated envelope places with no block here: ${unassignedRows.length}; reconciled entirely outside the county ${unassignedRows.filter((r) => r.ok).length}/${unassignedRows.length}`);
  for (const r of placeRows) {
    const tag = r.whole ? 'whole' : `cross-county (out ${fmt(r.outSum)} in ${r.outBlocks} blocks)`;
    log(`  place ${r.geoid} ${r.name}: blocks ${fmt(r.inSum)} / POP100 ${fmt(r.pop)} ${tag}${r.ok ? '' : ' MISMATCH'}`);
  }
  log(`size raw ${fmt(raw)} B, gzip -9 ${fmt(gz)} B; ${Math.round(performance.now() - t0)} ms`);
  for (const f of fails.slice(0, 20)) log(`FAIL ${f}`);
  if (fails.length > 20) log(`FAIL ... ${fails.length - 20} more`);

  if (fails.length === 0) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, `${ssccc}.json`), json);
    log(`wrote public/data/blocks/${ssccc}.json`);
  } else {
    log(`NOT written: ${fails.length} failed checks`);
  }
  return fails.length === 0;
}

// ---------------------------------------------------------------- main
const args = process.argv.slice(2);
const targets = args.length ? args : Object.keys(COUNTIES);
for (const t of targets) {
  if (!COUNTIES[t]) {
    console.error(`unknown county ${t}; bundled counties: ${Object.keys(COUNTIES).join(', ')}`);
    process.exit(2);
  }
}
const start = performance.now();
const results = [];
for (const t of targets) {
  try {
    results.push(await buildCounty(t));
  } catch (e) {
    console.log(`[${t}] ERROR ${e.message}`);
    results.push(false);
  }
}
console.log(`requests ${requestCount}, retries ${retryCount}, total ${Math.round(performance.now() - start)} ms`);
if (results.some((ok) => !ok)) {
  console.log('FAILED');
  process.exit(1);
}
console.log('OK');
