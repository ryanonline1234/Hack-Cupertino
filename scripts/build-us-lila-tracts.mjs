#!/usr/bin/env node
// Build the US map's tract file: public/data/us/usda2019-lila-tracts.json.
//
// One dot per census tract USDA flagged LILATracts_1And10 = 1 on its published
// 2019 Food Access Research Atlas (low income and low access, supermarkets,
// 1 mile urban / 10 miles rural; 2010 census tracts), placed at the tract's
// internal point from the Census 2010 Gazetteer.
//
// Sources:
//   atlas      scripts/data/food_atlas_2019.csv — the 2019 atlas extract
//              committed 2026-04-11 (docs/data.md, "US map atlas"); 72,531
//              rows, 50 states + DC, unpublished values are the string NULL.
//   gazetteer  Census 2010 Gazetteer, national census tracts file
//              (GEOID, POP10, HU10, ..., INTPTLAT, INTPTLONG), linked from
//              https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2010.html
//
// File format:
//   { retrievedAt, sources: { atlas, gazetteer }, definition,
//     fields: [names], counts: { atlasRows, flagged, written, recoded, joinMisses },
//     rows: [[GEOID, lat, lng, State, County, Urban, LAPOP1_10, LALOWI1_10,
//             PovertyRate, MedianFamilyIncome], ...] }
// lat/lng are rounded to 4 decimals (~11 m); counts stay whole numbers; null
// means USDA didn't publish the value.
//
// Join: atlas CensusTract zero-padded to the 11-digit GEOID. Four flagged
// tracts were renumbered after 2010 (same boundaries); they are placed via
// GEOID_2010_CODE_CHANGES in src/lib/usLilaTracts.js and listed in
// counts.recoded. Measured 2026-10-18: 9,293 flagged, 9,293 written, 0 misses.
//
// Checks: required columns present, every row has 13 fields, the flag is 0/1,
// no duplicate GEOIDs, every Gazetteer point is a real coordinate. The run
// exits non-zero before writing if any flagged tract fails to join, unless
// --allow-misses is passed (the misses are then listed in the file).
//
// Usage: node scripts/build-us-lila-tracts.mjs [--atlas path] [--gazetteer path-to-zip-or-txt]
//        [--out path] [--allow-misses]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';

import {
  LILA_TRACT_FIELDS,
  buildLilaTractRows,
  parseAtlasCsv,
  parseGazetteerTracts,
} from '../src/lib/usLilaTracts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ATLAS_SOURCE_URL = 'https://www.ers.usda.gov/data-products/food-access-research-atlas';
export const GAZETTEER_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_tracts_national.zip';
const GAZETTEER_ENTRY = 'Gaz_tracts_national.txt';
const TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const opts = {
    atlas: path.join(ROOT, 'scripts/data/food_atlas_2019.csv'),
    gazetteer: null,
    out: path.join(ROOT, 'public/data/us/usda2019-lila-tracts.json'),
    allowMisses: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allow-misses') opts.allowMisses = true;
    else if (arg === '--atlas' || arg === '--gazetteer' || arg === '--out') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} needs a path`);
      opts[arg.slice(2)] = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

// Read one entry from a zip archive (stored or deflated) via the central
// directory. Enough for the Census single-file archives; no dependency.
export function readZipEntry(buffer, name) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const entries = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n += 1) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const entryName = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Corrupt zip local header');
      const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = inflateRawSync(raw);
      else throw new Error(`Unsupported zip compression method ${method}`);
      if (data.length !== size) throw new Error(`${name}: inflated ${data.length} bytes, expected ${size}`);
      if (typeof crc32 === 'function' && (crc32(data) >>> 0) !== crc) throw new Error(`${name}: CRC mismatch`);
      return data;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in the zip`);
}

async function loadGazetteerText(localPath) {
  if (localPath) {
    const buffer = readFileSync(localPath);
    const text = localPath.endsWith('.zip') ? readZipEntry(buffer, GAZETTEER_ENTRY).toString('latin1') : buffer.toString('latin1');
    return { text, provenance: { local: path.relative(ROOT, localPath) } };
  }
  const response = await fetch(GAZETTEER_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Gazetteer download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    text: readZipEntry(buffer, GAZETTEER_ENTRY).toString('latin1'),
    provenance: { bytes: buffer.length, lastModified: response.headers.get('last-modified') },
  };
}

// Compact JSON with one tract row per line, so a rebuild diffs row by row.
export function serializeLilaTracts(doc) {
  const { rows, ...head } = doc;
  const headJson = JSON.stringify(head);
  const body = rows.map((row) => JSON.stringify(row)).join(',\n');
  return `${headJson.slice(0, -1)},"rows":[\n${body}\n]}\n`;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const atlasRecords = parseAtlasCsv(readFileSync(opts.atlas, 'utf8'));
  const { text: gazetteerText, provenance } = await loadGazetteerText(opts.gazetteer);
  const centroids = parseGazetteerTracts(gazetteerText);
  const { rows, misses, recoded, flagged } = buildLilaTractRows(atlasRecords, centroids);

  console.log(`atlas rows: ${atlasRecords.length}`);
  console.log(`gazetteer tracts: ${centroids.size}`);
  console.log(`flagged LILATracts_1And10 = 1: ${flagged}`);
  console.log(`joined: ${rows.length} (${recoded.length} via a post-2010 tract code change: ${recoded.join(', ') || 'none'})`);
  console.log(`join misses: ${misses.length}${misses.length ? ` (${misses.slice(0, 20).join(', ')})` : ''}`);
  if (misses.length && !opts.allowMisses) {
    console.error('Flagged tracts without a Gazetteer point; rerun with --allow-misses to write anyway.');
    return 1;
  }

  const doc = {
    retrievedAt: new Date().toISOString().slice(0, 10),
    sources: {
      atlas: ATLAS_SOURCE_URL,
      atlasFile: 'scripts/data/food_atlas_2019.csv (USDA ERS Food Access Research Atlas 2019 extract, 2010 census tracts, committed 2026-04-11)',
      gazetteer: GAZETTEER_URL,
      gazetteerFile: provenance,
    },
    definition: 'LILATracts_1And10 = 1: low income and low access, supermarkets, 1 mile urban / 10 miles rural (USDA ERS, 2019 release). Point = Census 2010 Gazetteer internal point (INTPTLAT, INTPTLONG).',
    fields: [...LILA_TRACT_FIELDS],
    counts: { atlasRows: atlasRecords.length, flagged, written: rows.length, recoded, joinMisses: misses },
    rows,
  };
  const json = serializeLilaTracts(doc);
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, json);
  console.log(`wrote ${path.relative(ROOT, opts.out)}: ${rows.length} rows, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
