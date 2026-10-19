import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import {
  COUNTY_FIELDS,
  GEOID_2010_CODE_CHANGES,
  LILA_TRACT_FIELDS,
  buildCountyRows,
  buildLilaTractRows,
  countyLabel,
  decodeCounties,
  decodeLilaTracts,
  lilaDotRadius,
  normalizeCountyText,
  padGeoid,
  paddedCountyBounds,
  parseAtlasCsv,
  parseCsv,
  parseGazetteerTracts,
  searchCounties,
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
// An optional fifth value sets POP10 (default 100).
function gazetteer(...rows) {
  const head = 'USPS\tGEOID\tPOP10\tHU10\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                      ';
  const lines = rows.map(([usps, geoid, lat, lng, pop = 100]) => `${usps}\t${geoid}\t${pop}\t50\t1\t0\t       0.001\t       0.000\t ${lat}\t ${lng}               `);
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

// ── County search ───────────────────────────────────────────────────────

test('parseGazetteerTracts with details adds POP10 and USPS', () => {
  const text = gazetteer(['AL', '01001020200', '32.4757580', '-86.4724678', 3000]);
  assert.deepEqual(parseGazetteerTracts(text, { details: true }).get('01001020200'), [32.475758, -86.4724678, 3000, 'AL']);
  assert.deepEqual(parseGazetteerTracts(text).get('01001020200'), [32.475758, -86.4724678], 'default shape unchanged');
  assert.throws(() => parseGazetteerTracts(gazetteer(['AL', '01001020200', '1', '2', 'x']), { details: true }), /bad POP10/);
});

test('GEOID_2010_CODE_CHANGES covers the 2015 county renames and the 2011/2012 renumberings', () => {
  assert.equal(Object.keys(GEOID_2010_CODE_CHANGES).length, 25);
  assert.equal(GEOID_2010_CODE_CHANGES['02158000100'], '02270000100', 'Wade Hampton -> Kusilvak');
  assert.equal(GEOID_2010_CODE_CHANGES['46102940500'], '46113940500', 'Shannon -> Oglala Lakota');
  assert.equal(GEOID_2010_CODE_CHANGES['36053030402'], '36053940700', 'Madison 9407.00 is now 0304.02');
  assert.equal(GEOID_2010_CODE_CHANGES['36065024800'], '36065940000', 'Oneida 9400.00 is now 0248.00');
  for (const [atlas, gaz] of Object.entries(GEOID_2010_CODE_CHANGES)) {
    assert.match(atlas, /^\d{11}$/);
    assert.match(gaz, /^\d{11}$/);
    assert.equal(atlas.slice(0, 2), gaz.slice(0, 2), `${atlas} stays in its state`);
  }
});

test('buildCountyRows: every county, flagged or not, with a POP10-weighted center, a point box and flagged totals', () => {
  const records = parseAtlasCsv(atlasCsv(
    '1001020100,Alabama,Autauga County,1,0,99.19,NULL,11.44,0.79,1896,11.3,81250,461',
    '1001020200,Alabama,Autauga County,1,1,58.11,NULL,5.83,9,1261,17.9,49000,604',
    '1001020300,Alabama,Autauga County,1,1,1,NULL,1,1,NULL,17.9,49000,NULL',
    '28133950100,Mississippi,Sunflower County,0,1,NULL,40.1,NULL,NULL,2345,38.5,NULL,1200',
    '28133950200,Mississippi,Sunflower County,0,0,NULL,40.1,NULL,NULL,10,38.5,NULL,1',
    '2016000100,Alaska,Aleutians West Census Area,0,0,1,1,1,1,1,1,1,1',
    '2016000200,Alaska,Aleutians West Census Area,0,0,1,1,1,1,1,1,1,1',
    '2158000100,Alaska,Kusilvak Census Area,0,0,1,1,1,1,1,1,1,1',
  ));
  const points = parseGazetteerTracts(gazetteer(
    ['AL', '01001020100', '32.0', '-86.0', 300],
    ['AL', '01001020200', '33.0', '-87.0', 100],
    ['AL', '01001020300', '32.5', '-86.5', 0],
    ['MS', '28133950100', '33.6', '-90.6', 1000],
    ['MS', '28133950200', '33.8', '-90.4', 3000],
    ['AK', '02016000100', '52.0', '178.0', 100],
    ['AK', '02016000200', '53.8', '-166.6', 100],
    ['AK', '02270000100', '62.28', '-163.19', 7459],
  ), { details: true });
  const { rows, misses, recoded } = buildCountyRows(records, points);

  assert.deepEqual(misses, []);
  assert.deepEqual(recoded, ['02158000100<-02270000100'], 'Kusilvak placed at its Wade Hampton point');
  assert.deepEqual(rows.map((r) => r[0]), ['01001', '02016', '02158', '28133']);
  for (const row of rows) assert.equal(row.length, COUNTY_FIELDS.length);
  // Weighted: (32*300 + 33*100 + 32.5*0) / 400 = 32.25; -86.25.
  assert.deepEqual(rows[0], ['01001', 'Autauga County', 'Alabama', 'AL', 32.25, -86.25, 32, -87, 33, -86, 3, 2, 1261]);
  // Aleutians West: the +178 point is drawn at -182, so the box stays narrow.
  assert.deepEqual(rows[1].slice(4, 10), [52.9, -174.3, 52, -182, 53.8, -166.6]);
  assert.deepEqual(rows[1].slice(10), [2, 0, 0], 'a county with no flagged tract still gets a row');
  assert.deepEqual(rows[3], ['28133', 'Sunflower County', 'Mississippi', 'MS', 33.75, -90.45, 33.6, -90.6, 33.8, -90.4, 2, 1, 2345]);
});

test('buildCountyRows falls back to a plain mean without POP10, lists misses and rejects a county with two names', () => {
  const records = parseAtlasCsv(atlasCsv(
    '1001020100,Alabama,Autauga County,1,0,1,NULL,1,1,1,1,1,1',
    '1001020200,Alabama,Autauga County,1,1,1,NULL,1,1,40,1,1,1',
    '1001020300,Alabama,Autauga County,1,0,1,NULL,1,1,1,1,1,1',
  ));
  const noPop = new Map([['01001020100', [32, -86, null, 'AL']], ['01001020200', [33, -87, null, 'AL']]]);
  const { rows, misses } = buildCountyRows(records, noPop);
  assert.deepEqual(misses, ['01001020300']);
  assert.deepEqual(rows[0], ['01001', 'Autauga County', 'Alabama', 'AL', 32.5, -86.5, 32, -87, 33, -86, 3, 1, 40]);
  const clash = parseAtlasCsv(atlasCsv(
    '1001020100,Alabama,Autauga County,1,0,1,NULL,1,1,1,1,1,1',
    '1001020200,Alabama,Baldwin County,1,0,1,NULL,1,1,1,1,1,1',
  ));
  assert.throws(() => buildCountyRows(clash, noPop), /both/);
});

const sampleCounties = () => decodeCounties({
  fields: [...COUNTY_FIELDS],
  rows: [
    ['06085', 'Santa Clara County', 'California', 'CA', 37.315, -121.91, 36.978, -122.177, 37.46, -121.524, 372, 6, 6939],
    ['06087', 'Santa Cruz County', 'California', 'CA', 37.0, -122.0, 36.9, -122.3, 37.2, -121.6, 52, 2, 1500],
    ['04023', 'Santa Cruz County', 'Arizona', 'AZ', 31.4, -110.9, 31.3, -111.2, 31.6, -110.5, 10, 3, 9000],
    ['06083', 'Santa Barbara County', 'California', 'CA', 34.6, -120.0, 34.4, -120.6, 35.1, -119.5, 90, 4, 5000],
    ['35049', 'Santa Fe County', 'New Mexico', 'NM', 35.6, -105.9, 35.2, -106.2, 36.0, -105.7, 50, 1, 800],
    ['49043', 'Summit County', 'Utah', 'UT', 40.8, -111.3, 40.6, -111.6, 41.2, -110.5, 10, 0, 0],
    ['28133', 'Sunflower County', 'Mississippi', 'MS', 33.6, -90.6, 33.3, -90.8, 33.9, -90.4, 8, 6, 9000],
    ['22075', 'Plaquemines Parish', 'Louisiana', 'LA', 29.5, -89.7, 29.2, -90.0, 29.9, -89.4, 12, 2, 300],
    ['35013', 'Doña Ana County', 'New Mexico', 'NM', 32.3, -106.8, 32.0, -107.2, 32.9, -106.4, 41, 5, 7000],
    ['02016', 'Aleutians West Census Area', 'Alaska', 'AK', 53.267, -169.944, 51.959, -181.661, 53.621, -166.771, 2, 1, 1185],
    ['24037', "St. Mary's County", 'Maryland', 'MD', 38.3, -76.6, 38.1, -76.9, 38.5, -76.4, 18, 0, 0],
    ['36061', 'New York County', 'New York', 'NY', 40.78, -73.97, 40.7, -74.02, 40.88, -73.91, 288, 3, 5000],
  ],
});

test('decodeCounties names the fields and rejects a different field list', () => {
  const [first] = sampleCounties();
  assert.deepEqual(first, {
    fips: '06085', county: 'Santa Clara County', state: 'California', usps: 'CA', lat: 37.315, lng: -121.91,
    box: [36.978, -122.177, 37.46, -121.524], tracts: 372, flagged: 6, flaggedLowAccess: 6939,
  });
  assert.equal(countyLabel(first), 'Santa Clara County, California');
  assert.throws(() => decodeCounties({ fields: COUNTY_FIELDS.slice(1), rows: [] }), /Unexpected fields/);
  assert.throws(() => decodeCounties({ fields: [...COUNTY_FIELDS] }), /no rows/);
});

test('normalizeCountyText drops case, accents, periods and apostrophes', () => {
  assert.equal(normalizeCountyText('  Doña Ana County '), 'dona ana county');
  assert.equal(normalizeCountyText("St. Mary's"), 'st marys');
  assert.equal(normalizeCountyText('Miami-Dade, FL'), 'miami dade fl');
});

test('searchCounties ranks prefix, then word start, then contains; ties by flagged tracts, then name', () => {
  const counties = sampleCounties();
  const labels = (q, limit) => searchCounties(counties, q, limit).map(countyLabel);
  assert.deepEqual(labels('Santa C'), ['Santa Clara County, California', 'Santa Cruz County, Arizona', 'Santa Cruz County, California']);
  assert.deepEqual(labels('santa'), [
    'Santa Clara County, California', 'Santa Barbara County, California', 'Santa Cruz County, Arizona',
    'Santa Cruz County, California', 'Santa Fe County, New Mexico',
  ]);
  // Word start: "cruz" starts the second word of both Santa Cruz counties.
  assert.deepEqual(labels('cruz'), ['Santa Cruz County, Arizona', 'Santa Cruz County, California']);
  // Contains only: "ara" is inside Clara and Barbara.
  assert.deepEqual(labels('ara'), ['Santa Clara County, California', 'Santa Barbara County, California']);
  // A word start outranks a contains, whatever the flagged counts.
  assert.deepEqual(labels('ana'), ['Doña Ana County, New Mexico']);
  assert.deepEqual(labels('mary'), ["St. Mary's County, Maryland"]);
  // Same tier, same flagged count (6): alphabetical.
  assert.deepEqual(labels('s', 3), ['Santa Clara County, California', 'Sunflower County, Mississippi', 'Santa Barbara County, California']);
  assert.equal(searchCounties(counties, 's').length, 8, 'at most 8');
  assert.deepEqual(labels(''), []);
  assert.deepEqual(labels('   '), []);
  assert.deepEqual(labels('zzz'), []);
});

test('searchCounties ignores case, accents and a trailing County / Parish / Borough on either side', () => {
  const counties = sampleCounties();
  const first = (q) => searchCounties(counties, q)[0]?.fips;
  assert.equal(first('SANTA CLARA COUNTY'), '06085');
  assert.equal(first('santa clara cou'), '06085', 'a half-typed suffix still matches');
  assert.equal(first('dona ana'), '35013');
  assert.equal(first('Doña'), '35013');
  assert.equal(first('plaquemines county'), '22075', 'the wrong suffix is ignored');
  assert.equal(first('plaquemines parish'), '22075');
  assert.equal(first('st marys'), '24037');
  assert.equal(first('St. Mary’s County'), '24037');
  assert.equal(first('new york'), '36061', 'a state name alone is still a county query');
});

test('searchCounties reads a state after the county: USPS code or state name, with or without a comma', () => {
  const counties = sampleCounties();
  const labels = (q) => searchCounties(counties, q).map(countyLabel);
  assert.deepEqual(labels('santa clara ca'), ['Santa Clara County, California']);
  assert.deepEqual(labels('santa cruz az'), ['Santa Cruz County, Arizona']);
  assert.deepEqual(labels('santa cruz, california'), ['Santa Cruz County, California']);
  assert.deepEqual(labels('Santa Cruz County, Calif'), ['Santa Cruz County, California']);
  assert.deepEqual(labels('sunflower, mississippi'), ['Sunflower County, Mississippi']);
  assert.deepEqual(labels('sunflower mississippi'), ['Sunflower County, Mississippi']);
  assert.deepEqual(labels('sunflower, ms'), ['Sunflower County, Mississippi']);
  assert.deepEqual(labels('santa fe new mexico'), ['Santa Fe County, New Mexico']);
  assert.deepEqual(labels('santa clara, nm'), [], 'a state that does not fit filters everything out');
  assert.deepEqual(labels('santa clara,'), ['Santa Clara County, California'], 'an empty state part is ignored');
  assert.deepEqual(labels('Santa Clara County, California'), ['Santa Clara County, California'], 'the label itself finds the county');
});

test('paddedCountyBounds pads by a fraction of the span, at least a minimum, and handles one-point counties', () => {
  const [santaClara] = sampleCounties();
  const [[s, w], [n, e]] = paddedCountyBounds(santaClara);
  assert.ok(Math.abs(s - (36.978 - 0.482 * 0.15)) < 1e-9 && Math.abs(n - (37.46 + 0.482 * 0.15)) < 1e-9);
  assert.ok(w < -122.177 && e > -121.524);
  const one = { box: [31.845, -103.561, 31.845, -103.561] };
  const [[s1, w1], [n1, e1]] = paddedCountyBounds(one);
  assert.ok(Math.abs(n1 - s1 - 0.1) < 1e-9, 'one point -> 0.05° each side');
  assert.ok(e1 - w1 > 0.1, 'longitude pad widened by 1/cos(lat)');
  assert.equal(paddedCountyBounds({ box: null }), null);
  assert.equal(paddedCountyBounds({ box: [1, null, 2, 3] }), null);
});

test('the committed county file covers every atlas tract and agrees with the tract file', () => {
  const url = new URL('../public/data/us/counties.json', import.meta.url);
  const text = readFileSync(url, 'utf8');
  assert.ok(Buffer.byteLength(text) < 400 * 1024, `counties.json is ${Buffer.byteLength(text)} bytes`);
  const doc = JSON.parse(text);
  const tractDoc = JSON.parse(readFileSync(new URL('../public/data/us/usda2019-lila-tracts.json', import.meta.url), 'utf8'));
  assert.deepEqual(doc.fields, [...COUNTY_FIELDS]);
  assert.equal(doc.rows.length, doc.counts.counties);
  assert.deepEqual(doc.counts.placeMisses, []);
  assert.equal(doc.counts.atlasRows, tractDoc.counts.atlasRows);

  const fromTracts = new Map();
  for (const row of tractDoc.rows) {
    const entry = fromTracts.get(row[0].slice(0, 5)) || { flagged: 0, lowAccess: 0, county: row[4], state: row[3] };
    entry.flagged += 1;
    entry.lowAccess += row[6];
    fromTracts.set(row[0].slice(0, 5), entry);
  }
  let tracts = 0;
  let flagged = 0;
  let withFlagged = 0;
  let prev = '';
  for (const row of doc.rows) {
    const [fips, county, state, usps, lat, lng, minLat, minLng, maxLat, maxLng, n, f, lowAccess] = row;
    assert.match(fips, /^\d{5}$/);
    assert.ok(fips > prev, `${fips} sorted and unique`);
    prev = fips;
    assert.ok(county && state, fips);
    assert.match(usps, /^[A-Z]{2}$/);
    for (const v of [lat, lng, minLat, minLng, maxLat, maxLng]) assert.ok(Number.isFinite(v), `${fips} coordinates`);
    assert.ok(minLat <= lat && lat <= maxLat && minLng <= lng && lng <= maxLng, `${fips} center inside its box`);
    assert.ok(maxLat - minLat < 6 && maxLng - minLng < 16, `${fips} box is county-sized`);
    assert.ok(Number.isInteger(n) && n >= 1 && Number.isInteger(f) && f >= 0 && f <= n, fips);
    const t = fromTracts.get(fips);
    assert.equal(f, t ? t.flagged : 0, `${fips} flagged tracts match the tract file`);
    assert.equal(lowAccess, t ? t.lowAccess : 0, `${fips} low-access residents match the tract file`);
    if (t) assert.deepEqual([county, state], [t.county, t.state]);
    tracts += n;
    flagged += f;
    if (f > 0) withFlagged += 1;
  }
  assert.equal(tracts, doc.counts.atlasRows, 'every atlas tract is in a county');
  assert.equal(flagged, tractDoc.rows.length);
  assert.equal(withFlagged, doc.counts.withFlagged);
  assert.equal(withFlagged, fromTracts.size);

  const counties = decodeCounties(doc);
  assert.deepEqual(searchCounties(counties, 'santa clara ca').map((c) => c.fips), ['06085']);
  assert.ok(searchCounties(counties, 'Santa C').some((c) => countyLabel(c) === 'Santa Clara County, California'));
});

test('the US map searches the county file with an ARIA combobox', () => {
  const source = readFileSync(new URL('../src/components/DesignationAtlasView.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/data\/us\/counties\.json/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-activedescendant/);
});
