import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  COUNTIES,
  DEDUPE_M,
  ENDPOINTS,
  MIN_BUILDING_SQFT,
  MIN_RETAIL_AREA_SQFT,
  USER_AGENT,
  assembleRings,
  bboxFromBundle,
  buildCandidates,
  buildCounty,
  buildQuery,
  cleanName,
  fetchOverpass,
  polygonMetrics,
  validateOverpass,
} from '../scripts/build-site-candidates.mjs';
import { BUNDLED_COUNTIES } from '../src/pipeline/blockLoader.js';

// All OSM elements below are synthetic; ids and tags are made up.

const R = 6371008.8;
const M_PER_DEG = (R * Math.PI) / 180;
const SQFT_PER_M2 = 10.763910416709722;

// Closed axis-aligned rectangle of `sqft` square feet centered on lat/lng, as
// Overpass `out geom` returns it ([{lat, lon}], first point repeated last).
function rect(lat, lng, sqft, aspect = 1) {
  const m2 = sqft / SQFT_PER_M2;
  const h = Math.sqrt(m2 / aspect);
  const w = m2 / h;
  const dLat = h / 2 / M_PER_DEG;
  const dLng = w / 2 / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [
    { lat: lat - dLat, lon: lng - dLng },
    { lat: lat - dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng - dLng },
    { lat: lat - dLat, lon: lng - dLng },
  ];
}
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const way = (id, geometry, tags) => ({ type: 'way', id, geometry, tags });
const metersToDegLat = (m) => m / M_PER_DEG;

const BBOX = { s: 37.3, w: -122.1, n: 37.5, e: -121.8 };

// ---------------------------------------------------------------- constants

test('bundled counties match the block loader', () => {
  assert.deepEqual([...COUNTIES].sort(), [...BUNDLED_COUNTIES].sort());
});

test('endpoints are tried in the documented order and the User-Agent carries no personal data', () => {
  assert.deepEqual(ENDPOINTS, [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]);
  assert.match(USER_AGENT, /food-desert-simulator/);
  assert.doesNotMatch(USER_AGENT, /@|github\.com\/|ryan/i);
});

test('thresholds: 10,000 sq ft buildings, 2-acre retail areas, 50 m dedupe', () => {
  assert.equal(MIN_BUILDING_SQFT, 10_000);
  assert.equal(MIN_RETAIL_AREA_SQFT, 2 * 43_560);
  assert.equal(DEDUPE_M, 50);
});

// ---------------------------------------------------------------- geometry

test('polygonMetrics: a 1 km lat/lng box matches the exact spherical-zone area', () => {
  const s = 37.4, n = 37.4 + 1000 / M_PER_DEG;
  const w = -121.97, e = w + 0.0113;
  const ring = [
    { lat: s, lon: w }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: w }, { lat: s, lon: w },
  ];
  const exactM2 = R * R * ((e - w) * Math.PI / 180) * (Math.sin((n * Math.PI) / 180) - Math.sin((s * Math.PI) / 180));
  const m = polygonMetrics({ outers: [ring], inners: [] });
  assert.ok(Math.abs(m.sqft / SQFT_PER_M2 - exactM2) / exactM2 < 1e-4, `${m.sqft / SQFT_PER_M2} vs ${exactM2}`);
  assert.ok(Math.abs(m.lat - (s + n) / 2) < 1e-6);
  assert.ok(Math.abs(m.lng - (w + e) / 2) < 1e-6);
});

test('polygonMetrics: winding order does not matter and holes are subtracted', () => {
  const outer = rect(37.42, -121.97, 40_000);
  const hole = rect(37.42, -121.97, 10_000);
  const cw = polygonMetrics({ outers: [outer], inners: [] });
  const ccw = polygonMetrics({ outers: [[...outer].reverse()], inners: [] });
  assert.ok(Math.abs(cw.sqft - 40_000) < 5);
  assert.ok(Math.abs(cw.sqft - ccw.sqft) < 1e-6);
  const holed = polygonMetrics({ outers: [outer], inners: [hole] });
  assert.ok(Math.abs(holed.sqft - 30_000) < 5);
});

test('polygonMetrics: L-shape centroid is area-weighted, not the vertex mean', () => {
  // 2x1 bar plus a 1x1 block on top of its left end (units of 0.001 deg at the equator).
  const u = 0.001;
  const ring = [[0, 0], [0, 2], [1, 2], [1, 1], [2, 1], [2, 0], [0, 0]].map(([y, x]) => ({ lat: y * u, lon: x * u }));
  const m = polygonMetrics({ outers: [ring], inners: [] });
  // Areas 2 (centroid 0.5, 1.0) and 1 (centroid 1.5, 0.5) -> (2*0.5+1.5)/3, (2*1+0.5)/3.
  assert.ok(Math.abs(m.lat / u - 2.5 / 3) < 1e-3);
  assert.ok(Math.abs(m.lng / u - 2.5 / 3) < 1e-3);
});

test('assembleRings joins split, reversed outer segments into a closed ring', () => {
  const r = rect(37.42, -121.97, 200_000);
  const a = r.slice(0, 3); // p0 p1 p2
  const b = [r[2], r[3]]; // p2 p3
  const c = [r[0], r[3]]; // p0 p3 (must be reversed to p3 p0 to close)
  const rings = assembleRings([a, c, b]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  assert.deepEqual(rings[0][0], rings[0][4]);
  assert.ok(Math.abs(polygonMetrics({ outers: rings, inners: [] }).sqft - 200_000) < 20);
});

test('assembleRings returns null when a ring cannot close', () => {
  const r = rect(37.42, -121.97, 200_000);
  assert.equal(assembleRings([r.slice(0, 3), [r[3], r[0]]]), null);
});

// ---------------------------------------------------------------- bbox + query

test('bboxFromBundle pads the populated-block extent by 2 miles', () => {
  const bundle = {
    tracts: {
      '000100': { blocks: [['1000', 5, 2, 37.0, -122.0, 'U', ''], ['1001', 5, 2, 37.5, -121.5, 'U', '']] },
      '000200': { blocks: [['2000', 5, 2, 36.9, -121.9, 'R', '']] },
    },
  };
  const b = bboxFromBundle(bundle);
  const padLat = 3218.688 / M_PER_DEG;
  assert.ok(Math.abs(b.s - (36.9 - padLat)) < 1e-6);
  assert.ok(Math.abs(b.n - (37.5 + padLat)) < 1e-6);
  // Longitude pad uses the poleward edge, so it is at least 2 mi everywhere.
  const padLng = 3218.688 / (M_PER_DEG * Math.cos(((37.5 + padLat) * Math.PI) / 180));
  assert.ok(Math.abs(b.w - (-122.0 - padLng)) < 1e-6);
  assert.ok(Math.abs(b.e - (-121.5 + padLng)) < 1e-6);
  assert.throws(() => bboxFromBundle({ tracts: {} }), /no populated blocks/);
});

test('buildQuery asks for every selector with an explicit bbox and a count', () => {
  const q = buildQuery({ s: 37.1, w: -122.2, n: 37.5, e: -121.2 });
  const bb = '(37.1,-122.2,37.5,-121.2)';
  for (const clause of [
    `node["shop"="vacant"]${bb}`,
    `way["shop"="vacant"]${bb}`,
    `node["disused:shop"]${bb}`,
    `way["disused:shop"]${bb}`,
    `relation["building"~"^(retail|commercial|supermarket)$"]${bb}`,
    `relation["landuse"="retail"]${bb}`,
    `nwr["shop"="supermarket"]${bb}`,
    `nwr["amenity"="fast_food"]${bb}`,
  ]) {
    assert.ok(q.includes(clause), clause);
  }
  assert.match(q, /way\["building"~"\^\(retail\|commercial\|supermarket\)\$"\]\(if: length\(\) >= \d+\)/);
  assert.match(q, /way\["landuse"="retail"\]\(if: length\(\) >= \d+\)/);
  assert.match(q, /out count;/);
  assert.match(q, /out geom;/);
  assert.doesNotMatch(q, /\[bbox:/); // a global bbox could clip out geom
});

test('perimeter prefilters are lossless: the minimum perimeter for each area threshold clears them', () => {
  const q = buildQuery(BBOX);
  const [bMin, rMin] = [...q.matchAll(/length\(\) >= (\d+)/g)].map((m) => Number(m[1]));
  // Isoperimetric inequality: perimeter >= 2*sqrt(pi*A) for any planar region.
  const minPerim = (sqft) => 2 * Math.sqrt(Math.PI * (sqft / SQFT_PER_M2));
  assert.ok(bMin < minPerim(MIN_BUILDING_SQFT) * 0.95, `${bMin} vs ${minPerim(MIN_BUILDING_SQFT)}`);
  assert.ok(rMin < minPerim(MIN_RETAIL_AREA_SQFT) * 0.95, `${rMin} vs ${minPerim(MIN_RETAIL_AREA_SQFT)}`);
});

// ---------------------------------------------------------------- validation

const countEl = (nodes, ways, relations) => ({
  type: 'count', id: 0,
  tags: { nodes: String(nodes), ways: String(ways), relations: String(relations), total: String(nodes + ways + relations) },
});
const okJson = (elements) => ({
  osm3s: { timestamp_osm_base: '2026-10-03T00:00:00Z' },
  elements: [
    countEl(elements.filter((e) => e.type === 'node').length, elements.filter((e) => e.type === 'way').length, elements.filter((e) => e.type === 'relation').length),
    ...elements,
  ],
});

test('validateOverpass accepts a complete response and strips the count element', () => {
  const els = [node(1, 37.42, -121.97, { shop: 'vacant' }), way(2, rect(37.42, -121.96, 20_000), { building: 'retail' })];
  const v = validateOverpass(okJson(els));
  assert.equal(v.elements.length, 2);
  assert.equal(v.osmBase, '2026-10-03T00:00:00Z');
});

test('validateOverpass rejects runtime-error remarks, count mismatches, empty and malformed results', () => {
  const els = [node(1, 37.42, -121.97, { shop: 'vacant' })];
  assert.throws(() => validateOverpass({ ...okJson(els), remark: 'runtime error: Query timed out in "query" at line 3 after 181 seconds.' }), /remark/);
  const short = okJson(els);
  short.elements.push(node(2, 37.4, -121.9, { shop: 'vacant' }));
  assert.throws(() => validateOverpass(short), /count/);
  assert.throws(() => validateOverpass(okJson([])), /empty/);
  assert.throws(() => validateOverpass({ elements: els }), /count/);
  assert.throws(() => validateOverpass({}), /elements/);
  assert.throws(() => validateOverpass(null), /elements/);
});

// ---------------------------------------------------------------- fetch

function res(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

test('fetchOverpass falls through 504 and runtime-error responses to the next mirror', async () => {
  const good = okJson([node(1, 37.42, -121.97, { shop: 'vacant' })]);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === ENDPOINTS[0]) return res(504, '<html>Gateway Timeout</html>');
    if (url === ENDPOINTS[1]) return res(200, { ...good, remark: 'runtime error: Query run out of memory' });
    return res(200, good);
  };
  const out = await fetchOverpass('[out:json];', { fetchImpl, sleep: async () => {}, attemptsPerEndpoint: 2 });
  assert.equal(out.endpoint, ENDPOINTS[2]);
  assert.equal(out.elements.length, 1);
  assert.deepEqual(calls.map((c) => c.url), [ENDPOINTS[0], ENDPOINTS[0], ENDPOINTS[1], ENDPOINTS[1], ENDPOINTS[2]]);
  for (const c of calls) {
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers['User-Agent'], USER_AGENT);
    assert.equal(new URLSearchParams(c.init.body).get('data'), '[out:json];');
  }
});

test('fetchOverpass backs off between attempts and throws once every mirror has failed', async () => {
  const waits = [];
  const fetchImpl = async () => res(429, 'Too Many Requests', { 'Retry-After': '7' });
  await assert.rejects(
    fetchOverpass('[out:json];', { fetchImpl, sleep: async (ms) => { waits.push(ms); }, attemptsPerEndpoint: 2 }),
    /all Overpass endpoints failed/,
  );
  assert.ok(waits.length >= 3);
  assert.ok(waits.every((ms) => ms > 0));
  assert.ok(waits.includes(7000)); // Retry-After honoured
});

test('fetchOverpass treats a network error or invalid JSON as a failed attempt', async () => {
  let n = 0;
  const good = okJson([node(1, 37.42, -121.97, { shop: 'vacant' })]);
  const fetchImpl = async () => {
    n++;
    if (n === 1) throw new TypeError('fetch failed');
    if (n === 2) return res(200, '{"elements": [');
    return res(200, good);
  };
  const out = await fetchOverpass('[out:json];', { fetchImpl, sleep: async () => {}, attemptsPerEndpoint: 2 });
  assert.equal(out.endpoint, ENDPOINTS[1]);
  assert.equal(n, 3);
});

// ---------------------------------------------------------------- candidates

test('cleanName trims, collapses whitespace, drops control characters, caps at 60', () => {
  assert.equal(cleanName('  Old   Kmart \n'), 'Old Kmart');
  assert.equal(cleanName('A\u0000B\u0007C'), 'ABC');
  assert.equal(cleanName(undefined), '');
  assert.equal(cleanName('x'.repeat(80)).length, 60);
});

test('vacant shops: shop=vacant and disused:shop nodes and ways; re-occupied premises are not vacant', () => {
  const els = [
    node(1, 37.42, -121.97, { shop: 'vacant', name: ' Former Store ' }),
    node(2, 37.43, -121.97, { 'disused:shop': 'supermarket' }),
    way(3, rect(37.44, -121.97, 5_000), { 'disused:shop': 'yes', building: 'retail' }),
    node(4, 37.45, -121.97, { 'disused:shop': 'clothes', shop: 'hairdresser' }), // re-occupied
    node(5, 37.46, -121.97, { 'disused:shop': 'no' }),
    node(6, 37.47, -121.97, { 'disused:shop': 'yes', amenity: 'place_of_worship' }), // re-used
    node(7, 37.48, -121.97, { 'disused:shop': 'hairdresser', craft: 'electronics_repair', name: 'Fast Repair' }),
    node(8, 37.48, -121.96, { 'disused:shop': 'clothes', leisure: 'fitness_centre' }),
    node(9, 37.48, -121.95, { 'disused:shop': 'cannabis', office: 'tax_advisor' }),
    node(10, 37.48, -121.94, { 'disused:shop': 'yes', healthcare: 'clinic' }),
    node(11, 37.48, -121.93, { 'disused:shop': 'yes', opening_hours: 'Mo-Fr 09:00-17:00', old_name: 'Was Here' }), // stale tags only
  ];
  const { sites, counts } = buildCandidates(els, BBOX);
  const byId = Object.fromEntries(sites.map((r) => [r[0], r]));
  assert.deepEqual(byId.n1, ['n1', 37.42, -121.97, 'vacant', null, 'Former Store']);
  assert.equal(byId.n2[3], 'vacant');
  assert.equal(byId.w3[3], 'vacant');
  assert.ok(Math.abs(byId.w3[4] - 5_000) <= 2); // building-tagged way: its footprint
  assert.equal(byId.n4, undefined);
  assert.equal(byId.n5, undefined);
  assert.equal(byId.n6, undefined);
  for (const id of ['n7', 'n8', 'n9', 'n10']) assert.equal(byId[id], undefined, id);
  assert.deepEqual(byId.n11, ['n11', 37.48, -121.93, 'vacant', null, '']); // name only, never old_name
  assert.deepEqual(counts, { vacant: 4, building: 0, commercial_building: 0, retail_area: 0 });
});

test('a disused:shop on a non-building polygon has no sqft (it is not a footprint)', () => {
  const { sites } = buildCandidates([way(7, rect(37.42, -121.97, 50_000), { 'disused:shop': 'yes' })], BBOX);
  assert.equal(sites[0][3], 'vacant');
  assert.equal(sites[0][4], null);
});

test('buildings: retail and commercial footprints of at least 10,000 sq ft, kept apart by kind', () => {
  const els = [
    way(10, rect(37.40, -121.97, 9_900), { building: 'retail' }),
    way(11, rect(37.41, -121.97, 10_100), { building: 'commercial', name: 'Plaza' }),
    way(12, rect(37.42, -121.97, 42_000, 3), { building: 'retail', name: 'Some Retailer' }),
    way(13, rect(37.43, -121.97, 50_000), { building: 'office' }),
    way(14, rect(37.44, -121.97, 50_000).slice(0, 4), { building: 'retail' }), // unclosed
  ];
  const { sites, counts, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['w11', 'w12']);
  const [w11, w12] = sites;
  // building=commercial is often offices: its own kind, so the label can say so.
  assert.equal(w11[3], 'commercial_building');
  assert.ok(Number.isInteger(w11[4]) && Math.abs(w11[4] - 10_100) <= 2);
  assert.equal(w11[1], 37.41);
  assert.equal(w11[2], -121.97);
  assert.equal(w12[3], 'building');
  // Names only for vacant shops: on any other feature the name is whoever is there now.
  assert.equal(w11[5], '');
  assert.equal(w12[5], '');
  assert.deepEqual(counts, { vacant: 0, building: 1, commercial_building: 1, retail_area: 0 });
  assert.ok(stats.invalidGeometry >= 1);
});

test('building=supermarket is a candidate only when vacant or disused', () => {
  const els = [
    way(15, rect(37.40, -121.97, 42_000), { building: 'supermarket' }), // no shop tag: may be open
    way(16, rect(37.41, -121.97, 42_000), { building: 'supermarket', shop: 'vacant', name: 'Old Mart' }),
    way(17, rect(37.42, -121.97, 42_000), { building: 'supermarket', 'disused:shop': 'supermarket' }),
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => [r[0], r[3], r[5]]), [['w16', 'vacant', 'Old Mart'], ['w17', 'vacant', '']]);
  assert.equal(stats.excludedSupermarketBuilding, 1);
});

test('buildings and retail areas in active use (any shop, amenity, office, healthcare, tourism, leisure, club or craft tag) are not candidates', () => {
  // Shapes of features seen in the 2026-10-03 extract (ids and names made up).
  const big = (i) => rect(37.40 + i * 0.005, -121.97, 40_000);
  const els = [
    way(80, big(0), { building: 'supermarket', shop: 'wholesale', name: 'Warehouse Club' }),
    way(81, big(1), { building: 'commercial', amenity: 'social_centre', name: 'Lodge 1' }),
    way(82, big(2), { building: 'retail', amenity: 'restaurant', cuisine: 'pizza' }),
    way(83, big(3), { building: 'commercial', amenity: 'casino' }),
    way(84, big(4), { building: 'commercial', tourism: 'hotel' }),
    way(85, big(5), { building: 'commercial', amenity: 'clinic' }),
    way(86, big(6), { building: 'retail', shop: 'car' }),
    way(87, big(7), { building: 'retail', shop: 'convenience', name: 'Corner Foods' }),
    way(88, big(8), { building: 'retail', shop: 'department_store' }),
    way(89, big(9), { building: 'commercial', office: 'company', name: 'Big Tech Building 48' }),
    way(90, big(10), { building: 'commercial', healthcare: 'dialysis' }),
    way(91, big(11), { building: 'retail', leisure: 'fitness_centre' }),
    way(92, big(12), { building: 'commercial', club: 'social' }),
    way(93, big(13), { building: 'commercial', craft: 'brewery' }),
    way(94, big(14), { building: 'retail', 'disused:shop': 'yes', office: 'company' }), // old shop, offices now
    way(95, rect(37.48, -121.97, 300_000), { landuse: 'retail', shop: 'mall', name: 'A Galleria' }),
    way(96, rect(37.49, -121.97, 300_000), { landuse: 'retail', shop: 'storage_rental' }),
    way(97, big(16), { building: 'retail', name: 'Strip Center' }), // control: no active use, stays
    way(98, rect(37.47, -121.90, 300_000), { landuse: 'retail' }), // control: stays
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['w97', 'w98']);
  assert.equal(stats.excludedOccupied, 17);
});

test('a retail area holding an operating supermarket is not a candidate (same rule as buildings)', () => {
  const els = [
    way(100, rect(37.40, -121.97, 500_000), { landuse: 'retail', name: 'Town Center' }),
    node(101, 37.40, -121.9701, { shop: 'supermarket', name: 'Open Mart' }), // inside w100
    way(102, rect(37.42, -121.97, 500_000), { landuse: 'retail' }),
    way(103, rect(37.42, -121.97, 30_000), { shop: 'supermarket' }), // supermarket polygon inside w102
    way(104, rect(37.44, -121.97, 500_000), { landuse: 'retail' }), // control: no supermarket
    node(105, 37.44, -121.97, { amenity: 'fast_food' }), // fast food inside does not exclude an area
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['w104']);
  assert.equal(stats.excludedContainsSupermarket, 2);
});

test('a vacant shop near the middle of a retail area does not replace the area (dedupe is for buildings)', () => {
  const els = [
    way(110, rect(37.42, -121.97, 500_000), { landuse: 'retail' }),
    node(111, 37.42, -121.97, { shop: 'vacant' }), // at the area's centroid
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['n111', 'w110']);
  assert.equal(stats.dedupedBuildings, 0);
});

test('operating supermarkets and fast food are never candidates, even in a large building', () => {
  const els = [
    way(20, rect(37.40, -121.97, 60_000), { building: 'supermarket', shop: 'supermarket', name: 'Open Mart' }),
    way(21, rect(37.41, -121.97, 60_000), { building: 'retail' }),
    node(22, 37.41, -121.97, { shop: 'supermarket', name: 'Open Mart 2' }), // inside w21
    way(23, rect(37.42, -121.97, 12_000), { building: 'retail', amenity: 'fast_food' }),
    way(24, rect(37.43, -121.97, 300_000), { landuse: 'retail', shop: 'supermarket' }),
    node(25, 37.44, -121.97, { shop: 'vacant', amenity: 'fast_food' }),
    way(26, rect(37.45, -121.97, 30_000), { building: 'retail' }), // control: stays
    way(27, rect(37.46, -121.97, 60_000), { building: 'commercial' }),
    node(28, 37.46, -121.97, { shop: 'supermarket' }), // inside w27
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['w26']);
  assert.ok(stats.excludedTagged >= 4);
  assert.equal(stats.excludedContainsSupermarket, 2);
});

test('a large building with a fast-food tenant inside stays (malls, strip centers); only the fast-food feature is excluded', () => {
  // Measured 2026-10-03: 150 of 1,041 counted 06085 buildings hold an amenity=fast_food
  // node; they are malls, warehouse-club food courts and strip centers, not fast-food lots.
  const els = [
    way(70, rect(37.42, -121.97, 800_000), { building: 'retail', name: 'Some Mall' }),
    node(71, 37.42, -121.97, { amenity: 'fast_food', name: 'Food Court Stand' }),
    way(72, rect(37.43, -121.97, 3_500), { building: 'retail', amenity: 'fast_food' }), // the restaurant itself
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['w70']);
  assert.equal(stats.buildingsContainingFastFood, 1);
});

test('retail areas: landuse=retail of at least 2 acres, at the centroid', () => {
  const els = [
    way(30, rect(37.40, -121.97, 2 * 43_560 - 500), { landuse: 'retail' }),
    way(31, rect(37.41, -121.96, 2 * 43_560 + 500), { landuse: 'retail', name: 'Center' }),
  ];
  const { sites, counts } = buildCandidates(els, BBOX);
  assert.deepEqual(sites, [['w31', 37.41, -121.96, 'retail_area', Math.round(polygonMetrics({ outers: [els[1].geometry], inners: [] }).sqft), '']]);
  assert.deepEqual(counts, { vacant: 0, building: 0, commercial_building: 0, retail_area: 1 });
});

test('multipolygon relations: assembled outers minus inners; non-multipolygon relations skipped', () => {
  const outer = rect(37.42, -121.97, 120_000);
  const hole = rect(37.42, -121.97, 40_000);
  const rel = {
    type: 'relation', id: 40,
    tags: { type: 'multipolygon', landuse: 'retail' },
    members: [
      { type: 'way', ref: 1, role: 'outer', geometry: outer.slice(0, 3) },
      { type: 'way', ref: 2, role: 'outer', geometry: outer.slice(2) },
      { type: 'way', ref: 3, role: 'inner', geometry: hole },
    ],
  };
  const rel2 = { type: 'relation', id: 41, tags: { type: 'building', building: 'retail' }, members: [] };
  const { sites, stats } = buildCandidates([rel, rel2], BBOX);
  assert.equal(sites.length, 0); // 80,000 sq ft net < 2 acres
  assert.equal(stats.skippedRelations, 1);
  rel.members[2].geometry = rect(37.42, -121.97, 10_000);
  const again = buildCandidates([rel], BBOX).sites;
  assert.equal(again.length, 1);
  assert.equal(again[0][0], 'r40');
  assert.ok(Math.abs(again[0][4] - 110_000) < 20);
});

test('candidates outside the bbox are dropped (centroid test)', () => {
  const els = [
    node(50, 37.6, -121.97, { shop: 'vacant' }),
    way(51, rect(37.29, -121.97, 40_000), { building: 'retail' }),
    node(52, 37.42, -121.97, { shop: 'vacant' }),
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]), ['n52']);
  assert.equal(stats.outsideBbox, 2);
});

test('dedupe: a vacant shop inside a counted building keeps both only if more than 50 m apart', () => {
  const lat = 37.42, lng = -121.97;
  const big = rect(lat, lng, 400_000, 0.25); // ~385 m north-south x 96 m east-west
  const els = [
    way(60, big, { building: 'retail' }),
    node(61, lat + metersToDegLat(30), lng, { shop: 'vacant' }), // inside, 30 m from centroid
    way(62, rect(lat + 0.01, lng, 400_000, 0.25), { building: 'retail' }),
    node(63, lat + 0.01 + metersToDegLat(120), lng, { shop: 'vacant' }), // inside, 120 m away
    node(64, lat + 0.02, lng, { shop: 'vacant' }), // in no building
  ];
  const { sites, stats } = buildCandidates(els, BBOX);
  assert.deepEqual(sites.map((r) => r[0]).sort(), ['n61', 'n63', 'n64', 'w62']);
  assert.equal(stats.dedupedBuildings, 1);
});

test('rows are sorted deterministically and ids are unique', () => {
  const els = [
    node(9, 37.42, -121.97, { shop: 'vacant' }),
    way(100, rect(37.43, -121.97, 20_000), { building: 'retail' }),
    node(10, 37.44, -121.97, { shop: 'vacant' }),
    way(8, rect(37.45, -121.97, 20_000), { building: 'commercial' }),
    node(10, 37.44, -121.97, { shop: 'vacant' }), // same element twice
  ];
  const a = buildCandidates(els, BBOX).sites.map((r) => r[0]);
  const b = buildCandidates([...els].reverse(), BBOX).sites.map((r) => r[0]);
  assert.deepEqual(a, ['n9', 'n10', 'w8', 'w100']);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- per county

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'site-candidates-'));
  mkdirSync(path.join(root, 'public', 'data', 'blocks'), { recursive: true });
  writeFileSync(
    path.join(root, 'public', 'data', 'blocks', '06085.json'),
    JSON.stringify({ tracts: { '504602': { blocks: [['1000', 9, 3, 37.42, -121.97, 'U', ''], ['1001', 9, 3, 37.43, -121.96, 'U', '']] } } }),
  );
  return root;
}

test('buildCounty writes the documented file shape', async () => {
  const root = fixtureRoot();
  try {
    const els = [node(1, 37.42, -121.97, { shop: 'vacant', name: 'Old Shop' }), way(2, rect(37.425, -121.965, 20_000), { building: 'retail' })];
    const fetchImpl = async () => res(200, okJson(els));
    const r = await buildCounty('06085', { root, fetchImpl, sleep: async () => {}, log: () => {}, now: () => new Date('2026-10-03T12:00:00Z') });
    assert.equal(r.ok, true);
    const doc = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'sites', '06085.json'), 'utf8'));
    assert.deepEqual(Object.keys(doc).slice(0, 4), ['retrievedAt', 'source', 'license', 'counts']);
    assert.equal(doc.retrievedAt, '2026-10-03T12:00:00.000Z');
    assert.equal(doc.source, 'OpenStreetMap via Overpass');
    assert.equal(doc.license, 'ODbL (© OpenStreetMap contributors)');
    assert.deepEqual(doc.counts, { vacant: 1, building: 1, commercial_building: 0, retail_area: 0 });
    assert.equal(doc.sites.length, 2);
    for (const row of doc.sites) {
      assert.equal(row.length, 6);
      assert.match(row[0], /^[nwr]\d+$/);
      assert.equal(row[1], Math.round(row[1] * 1e5) / 1e5);
      assert.equal(row[2], Math.round(row[2] * 1e5) / 1e5);
      assert.ok(['vacant', 'building', 'commercial_building', 'retail_area'].includes(row[3]));
      assert.ok(row[4] === null || Number.isInteger(row[4]));
      assert.equal(typeof row[5], 'string');
      if (row[3] !== 'vacant') assert.equal(row[5], '');
    }
    assert.deepEqual(readdirSync(path.join(root, 'public', 'data', 'sites')), ['06085.json']); // no temp files left
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildCounty writes nothing when every mirror fails, and leaves an earlier file untouched', async () => {
  const root = fixtureRoot();
  try {
    const fetchImpl = async () => res(504, 'Gateway Timeout');
    const r = await buildCounty('06085', { root, fetchImpl, sleep: async () => {}, log: () => {} });
    assert.equal(r.ok, false);
    assert.equal(existsSync(path.join(root, 'public', 'data', 'sites', '06085.json')), false);

    mkdirSync(path.join(root, 'public', 'data', 'sites'), { recursive: true });
    writeFileSync(path.join(root, 'public', 'data', 'sites', '06085.json'), '{"old":true}');
    const partial = okJson([node(1, 37.42, -121.97, { shop: 'vacant' })]);
    partial.remark = 'runtime error: Query timed out in "query" at line 9 after 180 seconds.';
    const r2 = await buildCounty('06085', { root, fetchImpl: async () => res(200, partial), sleep: async () => {}, log: () => {} });
    assert.equal(r2.ok, false);
    assert.equal(readFileSync(path.join(root, 'public', 'data', 'sites', '06085.json'), 'utf8'), '{"old":true}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
