import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BuildError,
  SERVICE_URL,
  STATES_URL,
  WHERE,
  applyCoordinateCorrections,
  buildSnapshot,
  loadExclusions,
  parseCoordinateCorrections,
  round5,
  tileKey,
} from '../scripts/build-store-snapshot.mjs';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

// Coordinate corrections in scripts/build-store-snapshot.mjs (docs/07
// "Stores"). Rows below are synthetic SNAP attribute objects except where a
// test says it reads the committed files.

const BASHAS = {
  Record_ID: 343765,
  Store_Name: "Bashas' Dine Market 33",
  Store_Type: 'Super Store',
  Latitude: 36.091755,
  Longitude: -109.62362,
  State: 'AZ',
};
const OTHER = { Record_ID: 1, Store_Name: 'Mesa Market 2', Store_Type: 'Supermarket', Latitude: 33.45, Longitude: -112.07, State: 'AZ' };
const CLUB = { Record_ID: 2, Store_Name: 'Costco Wholesale 1', Store_Type: 'Super Store', Latitude: 33.5, Longitude: -112.0, State: 'AZ' };

const CORRECTION = {
  recordId: 343765,
  name: "Bashas' Dine Market 33",
  replaces: { lat: 36.091755, lng: -109.62362 },
  lat: 36.1627817,
  lng: -109.585938,
  reason: 'served on open land; the store is in Chinle',
  source: 'test',
  checked: '2026-10-03',
};

const throwsBuild = (fn, re) => assert.throws(fn, (err) => err instanceof BuildError && re.test(err.message));

// ------------------------------------------------------------ parse

test('parseCoordinateCorrections accepts a complete entry and an absent list', () => {
  assert.deepEqual(parseCoordinateCorrections(undefined), []);
  assert.deepEqual(parseCoordinateCorrections([CORRECTION]), [CORRECTION]);
});

test('parseCoordinateCorrections rejects incomplete, duplicate and no-op entries', () => {
  const bad = [
    [{ ...CORRECTION, recordId: '343765' }, /integer recordId/],
    [{ ...CORRECTION, name: '' }, /missing name/],
    [{ ...CORRECTION, source: undefined }, /missing source/],
    [{ ...CORRECTION, checked: 'Oct 3' }, /YYYY-MM-DD/],
    [{ ...CORRECTION, lat: 91 }, /valid lat\/lng/],
    [{ ...CORRECTION, replaces: undefined }, /replaces/],
    [{ ...CORRECTION, lat: 36.091755, lng: -109.62362 }, /with itself/],
  ];
  for (const [entry, re] of bad) throwsBuild(() => parseCoordinateCorrections([entry]), re);
  throwsBuild(() => parseCoordinateCorrections([CORRECTION, CORRECTION]), /duplicates/);
  throwsBuild(() => parseCoordinateCorrections({}), /must be an array/);
});

// ------------------------------------------------------------ apply

test('applyCoordinateCorrections moves only the named record and leaves the input alone', () => {
  const rows = [OTHER, BASHAS, CLUB];
  const snapshot = structuredClone(rows);
  const { rows: out, applied } = applyCoordinateCorrections(rows, [CORRECTION]);
  assert.deepEqual(rows, snapshot);
  assert.equal(out.length, 3);
  assert.equal(out[0], OTHER);
  assert.equal(out[2], CLUB);
  assert.deepEqual(out[1], { ...BASHAS, Latitude: 36.1627817, Longitude: -109.585938 });
  assert.deepEqual(applied, [
    {
      recordId: 343765,
      name: "Bashas' Dine Market 33",
      from: { lat: 36.091755, lng: -109.62362 },
      to: { lat: 36.1627817, lng: -109.585938 },
      reason: CORRECTION.reason,
      source: 'test',
      checked: '2026-10-03',
    },
  ]);
  // No corrections: the same array back.
  assert.equal(applyCoordinateCorrections(rows, []).rows, rows);
});

test('applyCoordinateCorrections fails once USDA has moved the record (the entry must go)', () => {
  const fixedUpstream = { ...BASHAS, Latitude: 36.16278, Longitude: -109.58594 };
  throwsBuild(() => applyCoordinateCorrections([OTHER, fixedUpstream], [CORRECTION]), /now at 36\.16278, -109\.58594.*remove the entry/);
  // Float noise within ~0.1 m still matches.
  const noisy = { ...BASHAS, Latitude: 36.091754999999985 };
  assert.equal(applyCoordinateCorrections([noisy], [CORRECTION]).applied.length, 1);
});

test('applyCoordinateCorrections fails when the record is gone, renamed or duplicated', () => {
  throwsBuild(() => applyCoordinateCorrections([OTHER, CLUB], [CORRECTION]), /343765 .*not in the pull/);
  throwsBuild(
    () => applyCoordinateCorrections([{ ...BASHAS, Store_Name: 'Bashas 34' }], [CORRECTION]),
    /now named 'Bashas 34'/,
  );
  throwsBuild(() => applyCoordinateCorrections([BASHAS, BASHAS], [CORRECTION]), /more than once/);
});

// ------------------------------------------------------------ whole build, stubbed services

const AZ_RING = [[-114.82, 31.33], [-109.04, 31.33], [-109.04, 37.0], [-114.82, 37.0], [-114.82, 31.33]];

function serviceStub(rows) {
  const count = (where) => {
    if (where === WHERE) return rows.length;
    const m = where.match(/^Store_Type = '(.+)'$/);
    if (!m) throw new Error(`unexpected where ${where}`);
    return rows.filter((r) => r.Store_Type === m[1]).length;
  };
  return stubFetch((url) => {
    if (url === `${SERVICE_URL}?f=json`) return jsonResponse({ editingInfo: { dataLastEditDate: Date.parse('2026-09-17T13:33:58.255Z') } });
    const u = new URL(url);
    const p = u.searchParams;
    if (url.startsWith(`${SERVICE_URL}/query?`)) {
      if (p.get('returnCountOnly') === 'true') return jsonResponse({ count: count(p.get('where')) });
      return jsonResponse({ features: rows.map((attributes) => ({ attributes })), exceededTransferLimit: false });
    }
    if (url.startsWith(`${STATES_URL}/query?`)) {
      if (p.get('returnCountOnly') === 'true') return jsonResponse({ count: 1 });
      return jsonResponse({ features: [{ attributes: { STUSAB: 'AZ' }, geometry: { rings: [AZ_RING] } }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function tempBuild(corrections) {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-snapshot-'));
  const outDir = path.join(dir, 'stores');
  const exclusionsFile = path.join(dir, 'store-exclusions.json');
  writeFileSync(
    exclusionsFile,
    JSON.stringify({
      rules: [{ id: 'costco', field: 'Store_Name', pattern: '\\bCOSTCO\\b', flags: 'i', reason: 'warehouse club' }],
      knownBadCoordinates: [],
      coordinateCorrections: corrections,
    }),
  );
  return { dir, outDir, exclusionsFile };
}

test('buildSnapshot writes the corrected point into its tile and counts it in the manifest', async () => {
  const { dir, outDir, exclusionsFile } = tempBuild([CORRECTION]);
  const stub = serviceStub([OTHER, BASHAS, CLUB]);
  const lines = [];
  try {
    const manifest = await buildSnapshot({ outDir, exclusionsFile, log: (s) => lines.push(s) });
    const tile = JSON.parse(readFileSync(path.join(outDir, '36_-110.json'), 'utf8'));
    assert.deepEqual(tile, [[36.16278, -109.58594, 'S', "Bashas' Dine Market 33"]]);
    const written = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(written, manifest);
    assert.equal(written.counts.corrected, 1);
    assert.equal(written.counts.kept, 2);
    assert.deepEqual(written.counts.excluded, { costco: 1 });
    assert.deepEqual(written.tiles, { '32_-114': 1, '36_-110': 1 });
    assert.deepEqual(written.coordinateCorrections.map((c) => [c.recordId, c.from, c.to]), [
      [343765, { lat: 36.091755, lng: -109.62362 }, { lat: 36.1627817, lng: -109.585938 }],
    ]);
    assert.match(lines.join('\n'), /coordinates corrected 1 \(list 1\): 343765/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot fails, writing nothing, when a correction no longer matches USDA', async () => {
  const { dir, outDir, exclusionsFile } = tempBuild([CORRECTION]);
  // A previous build's files must survive the failed run.
  mkdirSync(outDir);
  writeFileSync(path.join(outDir, '36_-110.json'), '[]');
  writeFileSync(path.join(outDir, 'manifest.json'), '{}');
  const stub = serviceStub([OTHER, { ...BASHAS, Latitude: 36.1628, Longitude: -109.5859 }, CLUB]);
  try {
    await assert.rejects(
      buildSnapshot({ outDir, exclusionsFile, log: () => {} }),
      (err) => err instanceof BuildError && /343765.*not the 36\.091755, -109\.62362 the entry replaces/.test(err.message),
    );
    assert.deepEqual(readdirSync(outDir).sort(), ['36_-110.json', 'manifest.json']);
    assert.equal(readFileSync(path.join(outDir, '36_-110.json'), 'utf8'), '[]');
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot fails when a corrected record is removed by an exclusion rule', async () => {
  const club = { recordId: 2, name: 'Costco Wholesale 1', replaces: { lat: 33.5, lng: -112.0 }, lat: 33.51, lng: -112.01, reason: 'r', source: 's', checked: '2026-10-03' };
  const { dir, outDir, exclusionsFile } = tempBuild([club]);
  const stub = serviceStub([OTHER, BASHAS, CLUB]);
  try {
    await assert.rejects(
      buildSnapshot({ outDir, exclusionsFile, log: () => {} }),
      (err) => err instanceof BuildError && /Record_ID 2 is removed by exclusion rule 'costco'/.test(err.message),
    );
    assert.equal(existsSync(outDir), false);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ committed files

const STORES_DIR = fileURLToPath(new URL('../public/data/stores/', import.meta.url));

test('committed snapshot: every coordinate correction is in its tile, and the manifest lists it', () => {
  const { corrections, known } = loadExclusions();
  assert.ok(corrections.length >= 1);
  const manifest = JSON.parse(readFileSync(path.join(STORES_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.counts.corrected, corrections.length);
  assert.deepEqual(
    manifest.coordinateCorrections.map((c) => [c.recordId, c.from, c.to]),
    corrections.map((c) => [c.recordId, c.replaces, { lat: c.lat, lng: c.lng }]),
  );
  for (const c of corrections) {
    assert.equal(known.has(c.recordId), false);
    const to = [round5(c.lat), round5(c.lng)];
    const from = [round5(c.replaces.lat), round5(c.replaces.lng)];
    const key = tileKey(...to);
    const tile = JSON.parse(readFileSync(path.join(STORES_DIR, `${key}.json`), 'utf8'));
    const named = tile.filter((r) => r[3] === c.name);
    assert.deepEqual(named.map((r) => [r[0], r[1]]), [to], `${c.name} in ${key}`);
    assert.equal(manifest.tiles[key], tile.length);
    // The served coordinate is gone from its own tile too.
    const fromFile = path.join(STORES_DIR, `${tileKey(...from)}.json`);
    const fromTile = existsSync(fromFile) ? JSON.parse(readFileSync(fromFile, 'utf8')) : [];
    assert.equal(fromTile.some((r) => r[3] === c.name && r[0] === from[0] && r[1] === from[1]), false);
  }
});
