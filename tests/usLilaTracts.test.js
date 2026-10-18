import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import {
  GEOID_2010_CODE_CHANGES,
  LILA_TRACT_FIELDS,
  buildLilaTractRows,
  decodeLilaTracts,
  lilaDotRadius,
  padGeoid,
  parseAtlasCsv,
  parseCsv,
  parseGazetteerTracts,
  summarizeLilaTracts,
  topStatesByTracts,
  tractsInBounds,
} from '../src/lib/usLilaTracts.js';
import { readZipEntry, serializeLilaTracts } from '../scripts/build-us-lila-tracts.mjs';

// Synthetic rows in the atlas extract's 13-column layout; ids and values are made up
// except where a test needs a real post-2010 tract renumbering.
const HEADER = 'CensusTract,State,County,Urban,LILATracts_1And10,lapop1share,lapop10share,laseniors1share,lahunv1share,LAPOP1_10,PovertyRate,MedianFamilyIncome,LALOWI1_10';
const atlasCsv = (...rows) => [HEADER, ...rows].join('\n') + '\n';

// Gazetteer layout: tab-separated, space-padded, CRLF, header padded too.
function gazetteer(...rows) {
  const head = 'USPS\tGEOID\tPOP10\tHU10\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                      ';
  const lines = rows.map(([usps, geoid, lat, lng]) => `${usps}\t${geoid}\t100\t50\t1\t0\t       0.001\t       0.000\t ${lat}\t ${lng}               `);
  return [head, ...lines].join('\r\n') + '\r\n';
}

test('padGeoid restores the leading zero the atlas dropped and rejects non-ids', () => {
  assert.equal(padGeoid('1001020100'), '01001020100');
  assert.equal(padGeoid(1001020200), '01001020200');
  assert.equal(padGeoid(' 28133950100 '), '28133950100');
  assert.throws(() => padGeoid('123456789012'));
  assert.throws(() => padGeoid('01001-02'));
  assert.throws(() => padGeoid(''));
});

test('parseCsv handles quoted commas, doubled quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('parseAtlasCsv requires the columns the builder reads and the full row width', () => {
  assert.throws(() => parseAtlasCsv('CensusTract,State\n1001020100,Alabama\n'), /missing columns/);
  assert.throws(() => parseAtlasCsv(atlasCsv('1001020100,Alabama,Autauga County,1,1')), /expected 13/);
  const [record] = parseAtlasCsv(atlasCsv('1001020200,Alabama,Autauga County,1,1,58.11,NULL,5.83,9,1261,17.9,49000,604'));
  assert.equal(record.CensusTract, '1001020200');
  assert.equal(record.LALOWI1_10, '604');
});

test('parseGazetteerTracts reads INTPTLAT/INTPTLONG keyed by GEOID from the padded TSV', () => {
  const map = parseGazetteerTracts(gazetteer(['AL', '01001020200', '32.4757580', '-86.4724678'], ['PR', '72153750602', '17.9850254', '-66.8535312']));
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('01001020200'), [32.475758, -86.4724678]);
  assert.throws(() => parseGazetteerTracts('USPS\tGEOID\tLAT\n'), /GEOID\/INTPTLAT\/INTPTLONG/);
  assert.throws(() => parseGazetteerTracts(gazetteer(['AL', '01001020200', '1', '2'], ['AL', '01001020200', '1', '2'])), /twice/);
});

test('buildLilaTractRows keeps only LILATracts_1And10 = 1, joined on the padded GEOID, in the documented row shape', () => {
  const records = parseAtlasCsv(atlasCsv(
    '1001020100,Alabama,Autauga County,1,0,99.19,NULL,11.44,0.79,1896,11.3,81250,461',
    '1001020200,Alabama,Autauga County,1,1,58.11,NULL,5.83,9,1261,17.9,49000,604',
    '28133950100,Mississippi,Sunflower County,0,1,NULL,40.1,NULL,NULL,2345,38.5,NULL,1200',
    '6037999999,California,Los Angeles County,1,1,1,NULL,1,1,10,5,90000,2',
  ));
  const centroids = parseGazetteerTracts(gazetteer(
    ['AL', '01001020100', '32.4771112', '-86.4903033'],
    ['AL', '01001020200', '32.47575849', '-86.47246781'],
    ['MS', '28133950100', '33.6512345', '-90.5987654'],
  ));
  const { rows, misses, recoded, flagged } = buildLilaTractRows(records, centroids);

  assert.equal(flagged, 3);
  assert.deepEqual(misses, ['06037999999']);
  assert.deepEqual(recoded, []);
  assert.deepEqual(rows.map((r) => r[0]), ['01001020200', '28133950100'], 'unflagged tract dropped, sorted by GEOID');
  for (const row of rows) assert.equal(row.length, LILA_TRACT_FIELDS.length);
  assert.deepEqual(rows[0], ['01001020200', 32.4758, -86.4725, 'Alabama', 'Autauga County', 1, 1261, 604, 17.9, 49000]);
  assert.deepEqual(rows[1], ['28133950100', 33.6512, -90.5988, 'Mississippi', 'Sunflower County', 0, 2345, 1200, 38.5, null]);
});

test('buildLilaTractRows places renumbered tracts via the 2010 code change table and keeps the atlas GEOID', () => {
  assert.equal(GEOID_2010_CODE_CHANGES['36053030101'], '36053940101');
  const records = parseAtlasCsv(atlasCsv('36053030101,New York,Madison County,1,1,66.69,NULL,6.12,11.27,1825,30.4,42109,1001'));
  const centroids = parseGazetteerTracts(gazetteer(['NY', '36053940101', '43.0982900', '-75.6496950']));
  const { rows, misses, recoded } = buildLilaTractRows(records, centroids);
  assert.deepEqual(misses, []);
  assert.deepEqual(recoded, ['36053030101<-36053940101']);
  assert.equal(rows[0][0], '36053030101');
  assert.deepEqual(rows[0].slice(1, 3), [43.0983, -75.6497]);
});

test('buildLilaTractRows fails loudly on a non-0/1 flag, a duplicate tract or a non-numeric count', () => {
  const centroids = new Map([['01001020200', [32.5, -86.5]]]);
  const row = (flag, lapop = '1261') => `1001020200,Alabama,Autauga County,1,${flag},1,NULL,1,1,${lapop},17.9,49000,604`;
  assert.throws(() => buildLilaTractRows(parseAtlasCsv(atlasCsv(row('2'))), centroids), /0\/1/);
  assert.throws(() => buildLilaTractRows(parseAtlasCsv(atlasCsv(row('1'), row('1'))), centroids), /twice/);
  assert.throws(() => buildLilaTractRows(parseAtlasCsv(atlasCsv(row('1', 'n/a'))), centroids), /Not a number/);
  assert.throws(() => buildLilaTractRows(parseAtlasCsv(atlasCsv(row('1', '12.5'))), centroids), /whole number/);
});

test('decodeLilaTracts maps rows to named fields and rejects a different field list', () => {
  const doc = { fields: [...LILA_TRACT_FIELDS], rows: [['01001020200', 32.4758, -86.4725, 'Alabama', 'Autauga County', 1, 1261, 604, 17.9, 49000]] };
  assert.deepEqual(decodeLilaTracts(doc), [{
    geoid: '01001020200', lat: 32.4758, lng: -86.4725, pointLng: -86.4725, state: 'Alabama', county: 'Autauga County',
    urban: true, lowAccess: 1261, lowIncomeLowAccess: 604, povertyRate: 17.9, medianFamilyIncome: 49000,
  }]);
  const aleutian = decodeLilaTracts({ fields: doc.fields, rows: [['02016000100', 51.9594, 178.3388, 'Alaska', 'Aleutians West Census Area', 0, 1185, 433, 16.6, 61250]] });
  assert.ok(Math.abs(aleutian[0].lng - -181.6612) < 1e-9, 'past-180° Aleutians draw beside Alaska');
  assert.equal(aleutian[0].pointLng, 178.3388, 'the published point is kept for geocoding');
  assert.throws(() => decodeLilaTracts({ ...doc, fields: LILA_TRACT_FIELDS.slice(1) }), /Unexpected fields/);
  assert.throws(() => decodeLilaTracts({ fields: [...LILA_TRACT_FIELDS] }), /no rows/);
});

test('in-view summary: bounds filter, totals with unpublished counts skipped, states ranked by flagged tracts', () => {
  const t = (geoid, lat, lng, state, urban, lowAccess, lowIncomeLowAccess) => ({ geoid, lat, lng, state, urban, lowAccess, lowIncomeLowAccess });
  const tracts = [
    t('a', 33.5, -90.5, 'Mississippi', false, 2000, 900),
    t('b', 33.6, -90.4, 'Mississippi', true, 1000, 500),
    t('c', 34.7, -92.3, 'Arkansas', true, 3000, null),
    t('d', 40.7, -74.0, 'New York', true, null, null),
  ];
  const visible = tractsInBounds(tracts, { south: 33, west: -93, north: 35, east: -90 });
  assert.deepEqual(visible.map((x) => x.geoid), ['a', 'b', 'c']);
  assert.deepEqual(summarizeLilaTracts(visible), { tracts: 3, lowAccess: 6000, lowIncomeLowAccess: 1400, urban: 2, rural: 1, unpublished: 0 });
  assert.equal(summarizeLilaTracts(tracts).unpublished, 1);
  assert.deepEqual(topStatesByTracts(tracts, 2), [
    { state: 'Mississippi', tracts: 2, lowAccess: 3000 },
    { state: 'Arkansas', tracts: 1, lowAccess: 3000 },
  ]);
});

test('dot radius follows the square root of low-access residents and grows with zoom', () => {
  const base = lilaDotRadius(0, 6);
  const r100 = lilaDotRadius(100, 6) - base;
  const r400 = lilaDotRadius(400, 6) - base;
  assert.ok(Math.abs(r400 / r100 - 2) < 1e-9, '4x the people -> 2x the radius above the base');
  assert.equal(lilaDotRadius(null, 6), base);
  assert.ok(lilaDotRadius(2000, 4) < lilaDotRadius(2000, 6));
  assert.ok(lilaDotRadius(2000, 6) < lilaDotRadius(2000, 9));
  assert.ok(lilaDotRadius(2000, 4) < 3, 'small at national zoom');
});

test('serializeLilaTracts writes valid JSON with one row per line', () => {
  const doc = { retrievedAt: '2026-10-18', fields: ['a'], rows: [['x', 1], ['y', 2]] };
  const text = serializeLilaTracts(doc);
  assert.deepEqual(JSON.parse(text), doc);
  assert.equal(text.split('\n').filter((line) => line.startsWith('[')).length, 2);
});

test('readZipEntry inflates a deflated entry and checks size and CRC', () => {
  const name = 'Gaz_tracts_national.txt';
  const data = Buffer.from('USPS\tGEOID\r\nAL\t01001020100\r\n');
  const packed = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + packed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, nameBuf, packed, central, nameBuf, eocd]);

  assert.equal(readZipEntry(zip, name).toString(), data.toString());
  assert.throws(() => readZipEntry(zip, 'other.txt'), /not found/);
  assert.throws(() => readZipEntry(Buffer.from('not a zip at all, just some bytes'), name), /Not a zip/);
});

test('the committed tract file is complete: every flagged tract, 11-digit unique GEOIDs, US coordinates', () => {
  const doc = JSON.parse(readFileSync(new URL('../public/data/us/usda2019-lila-tracts.json', import.meta.url), 'utf8'));
  assert.deepEqual(doc.fields, [...LILA_TRACT_FIELDS]);
  assert.match(doc.sources.gazetteer, /^https:\/\/www2\.census\.gov\/geo\/docs\/maps-data\/data\/gazetteer\/Gaz_tracts_national\.zip$/);
  assert.equal(doc.counts.joinMisses.length, 0);
  assert.equal(doc.rows.length, doc.counts.written);
  assert.equal(doc.counts.written, doc.counts.flagged);
  const ids = new Set();
  for (const row of doc.rows) {
    assert.equal(row.length, LILA_TRACT_FIELDS.length);
    assert.match(row[0], /^\d{11}$/);
    ids.add(row[0]);
    // 50 states + DC; only the far Aleutians sit past 180°.
    const inUs = (row[2] > -180 && row[2] < -64) || (row[3] === 'Alaska' && row[2] > 170);
    assert.ok(row[1] > 17 && row[1] < 72 && inUs, `${row[0]} at ${row[1]},${row[2]}`);
    assert.equal(row[1], Math.round(row[1] * 1e4) / 1e4);
    assert.ok(row[5] === 0 || row[5] === 1);
    assert.ok(Number.isInteger(row[6]) && row[6] >= 0, `${row[0]} LAPOP1_10`);
  }
  assert.equal(ids.size, doc.rows.length);
});

test('the US map reads the tract JSON (not the retired CSV) and escapes tooltip text', () => {
  const source = readFileSync(new URL('../src/components/DesignationAtlasView.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/data\/us\/usda2019-lila-tracts\.json/);
  assert.doesNotMatch(source, /food_atlas\.csv/);
  assert.match(source, /escapeHtml\(t\.county\)/);
  assert.ok(!existsSync(new URL('../public/data/food_atlas.csv', import.meta.url)), 'the 5.5 MB CSV is no longer deployed');
  assert.ok(existsSync(new URL('../scripts/data/food_atlas_2019.csv', import.meta.url)));
});
