#!/usr/bin/env node
// Build the counted-store snapshot (docs/07-access-test-redesign.md, "Stores").
//
// Pulls every SNAP-authorized Supermarket and Super Store from the USDA FNS
// SNAP Retailer Locator FeatureServer, drops the hand-reviewed exclusions in
// scripts/store-exclusions.json (warehouse clubs, military commissaries and
// exchanges, fuel stations), drops coordinates that can't be right, and writes
// 2-degree tiles plus a manifest to public/data/stores/.
//
// Asserts its own completeness and exits 1 on any mismatch:
//   - unique Record_ID count == the service's returnCountOnly (same where clause),
//     taken before and after the pull, and per Store_Type;
//   - every coordinate is finite, inside the US + territories box, and inside
//     its own State's bounding box (TIGERweb 2020 States); any that fail must
//     be listed in knownBadCoordinates (with a reason) or the build fails;
//   - kept == pulled - excluded - dropped, and == the sum of tile counts.
//
// Usage: node scripts/build-store-snapshot.mjs [--review=<file>]
//   --review writes every excluded name (grouped by rule) and every dropped
//   coordinate to <file> for hand review. Keep it out of the repo.
// Needs Node 20+ (built-in fetch). No dependencies.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'stores');
const EXCLUSIONS_FILE = path.join(ROOT, 'scripts', 'store-exclusions.json');

const SERVICE_URL =
  'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0';
const STATES_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80';
const WHERE = "Store_Type IN ('Supermarket','Super Store')";
const OUT_FIELDS = ['Record_ID', 'Store_Name', 'Store_Type', 'Latitude', 'Longitude', 'State'];
const TYPE_CODE = { Supermarket: 'M', 'Super Store': 'S' };
const TILE_DEG = 2;
const NAME_MAX = 60;

// Valid-coordinate envelopes. The US + territories box comes from docs/07's
// build task; it stops at -60 deg longitude, so Guam (east of the antimeridian,
// SNAP-authorized) gets its own box. Every point must ALSO fall inside its
// State's 2020 bounding box (+ margin), which catches geocodes into the wrong
// state that the coarse box can't see.
const US_BOX = { minLat: -15, maxLat: 72, minLng: -180, maxLng: -60 };
const PACIFIC_BOX = { minLat: 13, maxLat: 21, minLng: 144, maxLng: 146.5 }; // Guam + CNMI
const STATE_MARGIN_DEG = 0.05; // ~5 km: covers the 0.005-deg generalization + border geocodes

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);
const reviewFile = args.get('review') || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

// GET a JSON endpoint: up to 3 attempts with backoff. ArcGIS answers bad
// params with HTTP 200 + {"error":{...}}, so the body is always checked.
async function getJson(url, label) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && json.error) {
        throw new Error(`service error ${json.error.code ?? ''} ${json.error.message ?? ''}`.trim());
      }
      return json;
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(1000 * 2 ** attempt);
    }
  }
  fail(`${label}: ${last?.message ?? last} after 3 attempts`);
}

const query = (base, params) => `${base}/query?${new URLSearchParams({ f: 'json', ...params })}`;

async function serviceCount(where) {
  const j = await getJson(query(SERVICE_URL, { where, returnCountOnly: 'true' }), `count(${where})`);
  if (!Number.isInteger(j.count)) fail(`count(${where}) returned no integer count`);
  return j.count;
}

async function pullStores() {
  const rows = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const j = await getJson(
      query(SERVICE_URL, {
        where: WHERE,
        outFields: OUT_FIELDS.join(','),
        returnGeometry: 'false',
        orderByFields: 'ObjectId',
        resultOffset: String(offset),
        maxRecordCountFactor: '5',
      }),
      `page at offset ${offset}`,
    );
    if (!Array.isArray(j.features)) fail(`page at offset ${offset}: no features array`);
    pages++;
    for (const f of j.features) rows.push(f.attributes);
    if (!j.exceededTransferLimit) break;
    if (j.features.length === 0) fail(`page at offset ${offset}: exceededTransferLimit with 0 features`);
    offset += j.features.length;
    await sleep(250);
  }
  return { rows, pages };
}

// State bounding boxes from TIGERweb 2020 States (generalized geometry is
// plenty for a bbox). Keyed by USPS code, which is what SNAP's State holds.
async function loadStateBoxes() {
  const cnt = await getJson(query(STATES_URL, { where: '1=1', returnCountOnly: 'true' }), 'states count');
  const j = await getJson(
    query(STATES_URL, {
      where: '1=1',
      outFields: 'STUSAB',
      returnGeometry: 'true',
      maxAllowableOffset: '0.005',
      geometryPrecision: '4',
      outSR: '4326',
    }),
    'states geometry',
  );
  if (j.exceededTransferLimit) fail('states geometry: exceededTransferLimit');
  if (j.features.length !== cnt.count) fail(`states: got ${j.features.length}, service count ${cnt.count}`);
  const boxes = {};
  for (const f of j.features) {
    const b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
    for (const ring of f.geometry?.rings ?? []) {
      for (const [x, y] of ring) {
        if (y < b.minLat) b.minLat = y;
        if (y > b.maxLat) b.maxLat = y;
        if (x < b.minLng) b.minLng = x;
        if (x > b.maxLng) b.maxLng = x;
      }
    }
    if (b.minLat > b.maxLat) fail(`states: ${f.attributes.STUSAB} has no geometry`);
    boxes[f.attributes.STUSAB] = b;
  }
  return { boxes, count: cnt.count };
}

const inBox = (lat, lng, b, m = 0) =>
  lat >= b.minLat - m && lat <= b.maxLat + m && lng >= b.minLng - m && lng <= b.maxLng + m;

function coordProblem(r, stateBoxes) {
  const lat = r.Latitude;
  const lng = r.Longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'non-finite coordinate';
  if (!inBox(lat, lng, US_BOX) && !inBox(lat, lng, PACIFIC_BOX)) return 'outside US + territories';
  const sb = stateBoxes[r.State];
  if (!sb) return `no 2020 State boundary for State '${r.State}'`;
  if (!inBox(lat, lng, sb, STATE_MARGIN_DEG)) return `outside ${r.State} bounding box`;
  return null;
}

function loadExclusions() {
  const cfg = JSON.parse(readFileSync(EXCLUSIONS_FILE, 'utf8'));
  if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) fail('store-exclusions.json: no rules');
  const ids = new Set();
  const rules = cfg.rules.map((r) => {
    for (const k of ['id', 'field', 'pattern', 'flags', 'reason']) {
      if (typeof r[k] !== 'string') fail(`store-exclusions.json: rule ${r.id ?? '?'} missing ${k}`);
    }
    if (ids.has(r.id)) fail(`store-exclusions.json: duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (!OUT_FIELDS.includes(r.field)) fail(`store-exclusions.json: rule ${r.id} field ${r.field} not pulled`);
    return { ...r, re: new RegExp(r.pattern, r.flags) };
  });
  const known = new Map();
  for (const k of cfg.knownBadCoordinates ?? []) {
    if (!Number.isInteger(k.recordId) || typeof k.reason !== 'string') {
      fail('store-exclusions.json: knownBadCoordinates entries need integer recordId + reason');
    }
    known.set(k.recordId, k);
  }
  return { rules, known };
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const tileKey = (lat, lng) =>
  `${Math.floor(lat / TILE_DEG) * TILE_DEG}_${Math.floor(lng / TILE_DEG) * TILE_DEG}`;
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();

async function main() {
  const t0 = Date.now();
  const { rules, known } = loadExclusions();

  // Layer metadata: editingInfo.dataLastEditDate dates the snapshot.
  const layer = await getJson(`${SERVICE_URL}?f=json`, 'layer metadata');
  const editMs = layer.editingInfo?.dataLastEditDate;
  if (!Number.isFinite(editMs)) fail('layer metadata: no editingInfo.dataLastEditDate');

  const countBefore = await serviceCount(WHERE);
  const countM = await serviceCount("Store_Type = 'Supermarket'");
  const countS = await serviceCount("Store_Type = 'Super Store'");
  const retrievedAt = new Date().toISOString();
  const { rows, pages } = await pullStores();
  const countAfter = await serviceCount(WHERE);
  const { boxes: stateBoxes, count: stateCount } = await loadStateBoxes();

  // ---- completeness ----
  const ids = new Set(rows.map((r) => r.Record_ID));
  const byType = { Supermarket: 0, 'Super Store': 0 };
  for (const r of rows) {
    if (!(r.Store_Type in byType)) fail(`unexpected Store_Type '${r.Store_Type}' (Record_ID ${r.Record_ID})`);
    byType[r.Store_Type]++;
  }
  const checks = [
    ['service count stable during pull', countBefore === countAfter, `${countBefore} -> ${countAfter}`],
    ['type counts sum to total', countM + countS === countBefore, `${countM} + ${countS} vs ${countBefore}`],
    ['rows == returnCountOnly', rows.length === countBefore, `${rows.length} vs ${countBefore}`],
    ['unique Record_ID == returnCountOnly', ids.size === countBefore, `${ids.size} vs ${countBefore}`],
    ['no null Record_ID', !ids.has(null) && !ids.has(undefined), ''],
    ['Supermarket rows == count', byType.Supermarket === countM, `${byType.Supermarket} vs ${countM}`],
    ['Super Store rows == count', byType['Super Store'] === countS, `${byType['Super Store']} vs ${countS}`],
  ];
  for (const [name, ok, detail] of checks) if (!ok) fail(`${name}: ${detail}`);

  // ---- exclusions (first matching rule wins) ----
  const excluded = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const review = Object.fromEntries(rules.map((r) => [r.id, []]));
  const candidates = [];
  for (const r of rows) {
    const hit = rules.find((rule) => rule.re.test(String(r[rule.field] ?? '')));
    if (hit) {
      excluded[hit.id]++;
      const also = rules.filter((rule) => rule !== hit && rule.re.test(String(r[rule.field] ?? '')));
      review[hit.id].push(
        `${r.Record_ID}\t${r.Store_Type}\t${r.State}\t${cleanName(r.Store_Name)}${also.length ? `\t(also: ${also.map((a) => a.id).join(',')})` : ''}`,
      );
    } else {
      candidates.push(r);
    }
  }

  // ---- coordinates ----
  const dropped = [];
  const unexplained = [];
  const kept = [];
  for (const r of candidates) {
    const problem = coordProblem(r, stateBoxes);
    if (!problem) {
      kept.push(r);
      continue;
    }
    const entry = {
      recordId: r.Record_ID,
      state: r.State,
      lat: r.Latitude,
      lng: r.Longitude,
      problem,
    };
    if (known.has(r.Record_ID)) dropped.push({ ...entry, reason: known.get(r.Record_ID).reason });
    else unexplained.push(entry);
  }

  if (reviewFile) {
    const lines = [`# store exclusion review, ${retrievedAt}`];
    for (const rule of rules) {
      lines.push('', `## ${rule.id}  /${rule.pattern}/${rule.flags}  matched ${excluded[rule.id]}`);
      lines.push(...review[rule.id].sort((a, b) => a.split('\t')[3].localeCompare(b.split('\t')[3])));
    }
    lines.push('', `## dropped coordinates (${dropped.length} known, ${unexplained.length} unexplained)`);
    for (const d of [...dropped, ...unexplained]) lines.push(JSON.stringify(d));
    mkdirSync(path.dirname(path.resolve(reviewFile)), { recursive: true });
    writeFileSync(reviewFile, lines.join('\n') + '\n');
  }

  if (unexplained.length) {
    console.error(`FAIL: ${unexplained.length} bad coordinate(s) not in knownBadCoordinates:`);
    for (const u of unexplained) console.error(`  ${JSON.stringify(u)}`);
    process.exit(1);
  }

  // ---- tiles ----
  const tiles = new Map();
  let keptM = 0;
  let keptS = 0;
  for (const r of kept) {
    const lat = round5(r.Latitude);
    const lng = round5(r.Longitude);
    const type = TYPE_CODE[r.Store_Type];
    if (type === 'M') keptM++;
    else keptS++;
    const key = tileKey(lat, lng);
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push([lat, lng, type, cleanName(r.Store_Name)]);
  }
  const totalExcluded = Object.values(excluded).reduce((a, b) => a + b, 0);
  if (kept.length !== rows.length - totalExcluded - dropped.length) {
    fail(`kept ${kept.length} != ${rows.length} - ${totalExcluded} - ${dropped.length}`);
  }
  const tileSum = [...tiles.values()].reduce((a, t) => a + t.length, 0);
  if (tileSum !== kept.length) fail(`tile rows ${tileSum} != kept ${kept.length}`);

  mkdirSync(OUT_DIR, { recursive: true });
  // Remove tiles from a previous build so a vanished tile can't linger.
  for (const f of readdirSync(OUT_DIR)) {
    if (/^-?\d+_-?\d+\.json$/.test(f)) unlinkSync(path.join(OUT_DIR, f));
  }
  const keys = [...tiles.keys()].sort((a, b) => {
    const [alat, alng] = a.split('_').map(Number);
    const [blat, blng] = b.split('_').map(Number);
    return alat - blat || alng - blng;
  });
  let bytes = 0;
  let largest = { key: '', bytes: 0 };
  const tileCounts = {};
  for (const key of keys) {
    const list = tiles
      .get(key)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
    const body = JSON.stringify(list);
    writeFileSync(path.join(OUT_DIR, `${key}.json`), body);
    bytes += body.length;
    if (body.length > largest.bytes) largest = { key, bytes: body.length };
    tileCounts[key] = list.length;
  }

  const manifest = {
    source:
      "USDA FNS SNAP Retailer Locator, Store_Type IN ('Supermarket','Super Store'), minus the hand-reviewed exclusions in scripts/store-exclusions.json and coordinates that fall outside their state",
    serviceUrl: SERVICE_URL,
    where: WHERE,
    dataLastEditDate: new Date(editMs).toISOString(),
    retrievedAt,
    counts: {
      supermarket: byType.Supermarket,
      superStore: byType['Super Store'],
      excluded,
      badCoordinates: dropped.length,
      kept: kept.length,
      keptSupermarket: keptM,
      keptSuperStore: keptS,
    },
    exclusionRule: 'first matching rule in scripts/store-exclusions.json order',
    badCoordinates: dropped.map(({ recordId, state, lat, lng, problem, reason }) => ({
      recordId,
      state,
      lat,
      lng,
      problem,
      reason,
    })),
    tileDeg: TILE_DEG,
    tileRow: '[lat, lng, type, name]; lat/lng 5 decimals; type M = Supermarket, S = Super Store',
    tiles: tileCounts,
  };
  const manifestBody = JSON.stringify(manifest, null, 1) + '\n';
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), manifestBody);

  const knownSeen = dropped.length;
  console.log(
    [
      `layer dataLastEditDate ${manifest.dataLastEditDate}`,
      `service count ${countBefore} (Supermarket ${countM}, Super Store ${countS}); pulled ${rows.length} rows in ${pages} pages, ${ids.size} unique Record_ID`,
      `states with boundaries ${stateCount}`,
      `excluded ${totalExcluded}: ${rules.map((r) => `${r.id} ${excluded[r.id]}`).join(', ')}`,
      `bad coordinates dropped ${dropped.length} (known list ${known.size}, matched ${knownSeen}, unexplained 0)`,
      `kept ${kept.length} (Supermarket ${keptM}, Super Store ${keptS})`,
      `tiles ${keys.length}, ${bytes} bytes; largest ${largest.key} ${largest.bytes} bytes; manifest ${manifestBody.length} bytes`,
      `ok in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    ].join('\n'),
  );
}

main().catch((err) => fail(err?.stack ?? String(err)));
