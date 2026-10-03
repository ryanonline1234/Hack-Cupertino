import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_MAX_SITES, blockCandidates, suggestSites } from '../src/engine/suggestSites.js';
import { evaluatePlacedStoreScenario } from '../src/engine/scenarioEngine.js';
import { PIN_DECIMALS, haversineMiles, roundCoord } from '../src/lib/geo.js';
import { decodeAppState, encodeAppState } from '../src/lib/urlState.js';
import { BLOCK_SITE_KIND, BLOCK_SITE_LABEL } from '../src/lib/siteLabels.js';
import { STORE_RADIUS_MI, assembleCommunityData } from '../src/pipeline/normalizer.js';
import { loadTractBlocks } from '../src/pipeline/blockLoader.js';
import { loadStoresNear } from '../src/pipeline/storeLoader.js';
import { loadErsTract } from '../src/pipeline/ersLoader.js';
import { stubFetch } from './helpers/mockVercelRes.js';

// ------------------------------------------------------------ fixtures

const C = { lat: 37.42, lng: -121.97 };
const MI_PER_DEG_LAT = 69.0933; // 3958.8 mi * pi / 180, the haversine radius
const dLat = (mi) => mi / MI_PER_DEG_LAT;
const dLng = (mi, lat = C.lat) => mi / (MI_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

// A point `east` / `north` miles from C.
function at(east, north) {
  const lat = C.lat + dLat(north);
  return { lat, lng: C.lng + dLng(east, lat) };
}

// A payload block (`access.blocks` shape). miles: null = no counted store in
// the loaded radius, which the scenario reads as Infinity.
function block(east, north, pop, miles = null) {
  return { pop, hu: Math.round(pop / 2.5), ...at(east, north), miles };
}

function site(id, east, north, extra = {}) {
  return { id, ...at(east, north), label: `site ${id}`, kind: 'building', sqft: 20_000, ...extra };
}

const ids = (result) => result.picks.map((p) => p.candidate.id);

// Every pick's gain is exactly the drop in residents beyond T, and positive.
function assertGainsConsistent(result, startBeyond) {
  let prev = startBeyond;
  for (const p of result.picks) {
    assert.ok(Number.isInteger(p.gain) && p.gain > 0, `gain ${p.gain}`);
    assert.equal(p.gain, prev - p.beyondAfter);
    prev = p.beyondAfter;
  }
}

// ------------------------------------------------- golden tracts (committed data)

// Offline: the loaders read the committed public/data snapshot through a
// stubbed fetch, and the payload is assembled by the real normalizer, so the
// blocks carry exactly the baseline miles the app computes. Points are the
// tracts' TIGERweb internal points (as in tests/normalizer.test.js).
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function boundsOf(points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

async function goldenCommunity(geoid, lat, lng) {
  const bundle = JSON.parse(readFileSync(`${PUBLIC_DIR}/data/blocks/${geoid.slice(0, 5)}.json`, 'utf8'));
  const entry = bundle.tracts[geoid.slice(5)];
  const tract = { geoid, state: geoid.slice(0, 2), county: geoid.slice(2, 5), tract: geoid.slice(5), name: entry.name, pop: entry.pop };
  const stub = stubFetch((url) => {
    if (!url.startsWith('/data/')) throw new Error(`unexpected fetch ${url}`);
    const file = `${PUBLIC_DIR}${url}`;
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const blocks = await loadTractBlocks(tract);
    const stores = await loadStoresNear(boundsOf([...blocks.blocks, { lat, lng }]), STORE_RADIUS_MI);
    const ers = await loadErsTract(geoid);
    return assembleCommunityData({ lat, lng, tract: { status: 'ok', tract }, blocks, stores, ers });
  } finally {
    stub.restore();
  }
}

function suggestFor(data, extra = {}) {
  const { access } = data;
  return suggestSites({ blocks: access.blocks, threshold: access.threshold, lowIncome: access.lowIncome, ...extra });
}

test('golden: Alviso 06085504602 with block candidates finds the village (gain >= 1,800) and flips with it', async () => {
  const data = await goldenCommunity('06085504602', 37.44966, -121.99401);
  assert.equal(data.access.status, 'met');
  const result = suggestFor(data, { candidates: blockCandidates(data.access.blocks) });
  assert.equal(result.source, 'blocks');
  assert.equal(result.reason, null);
  assert.ok(result.picks[0].gain >= 1800, `gain ${result.picks[0].gain}`);
  assert.equal(result.picks[0].candidate.label, BLOCK_SITE_LABEL);
  // The village is around the docs/07 village pin (37.42105, -121.9727).
  const { lat, lng } = result.picks[0].candidate;
  assert.ok(haversineMiles(lat, lng, 37.42105, -121.9727) < 1, `${lat},${lng}`);
  assert.equal(result.flippedAt, 1);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].lowAccessAfter, false);
  assert.equal(result.picks[0].verdictAfter.status, 'not_met');
  assertGainsConsistent(result, data.access.beyond);

  // Adding the pick as a supermarket pin gives the scenario engine's numbers.
  const scenario = evaluatePlacedStoreScenario(data, [{ lat, lng, format: 's' }]);
  assert.equal(scenario.after.beyond, result.picks[0].beyondAfter);
  assert.equal(scenario.after.share, result.picks[0].shareAfter);
  assert.equal(scenario.flipped, true);

  // Omitting candidates falls back to the same block candidates.
  assert.deepEqual(suggestFor(data), result);
});

test('golden: Greenville MS 28151000600 flips with one site', async () => {
  const data = await goldenCommunity('28151000600', 33.40168, -91.06553);
  assert.equal(data.access.status, 'met');
  const result = suggestFor(data);
  assert.equal(result.source, 'blocks');
  assert.equal(result.picks.length, 1);
  assert.equal(result.flippedAt, 1);
  assert.equal(result.picks[0].verdictAfter.status, 'not_met');
  assertGainsConsistent(result, data.access.beyond);
  const { lat, lng } = result.picks[0].candidate;
  assert.equal(evaluatePlacedStoreScenario(data, [{ lat, lng }]).after.beyond, result.picks[0].beyondAfter);
});

test('golden: Cupertino 06085508101 is not low access, so nothing is suggested', async () => {
  const data = await goldenCommunity('06085508101', 37.3229, -122.0323);
  assert.equal(data.access.lowAccess, false);
  const result = suggestFor(data);
  assert.equal(result.reason, 'not_low_access');
  assert.deepEqual(result.picks, []);
  assert.equal(result.flippedAt, null);
});

// ------------------------------------------------------------ synthetic

// Three clusters 5 mi apart, all beyond T = 1 mi: A (800) at C, B (600) 5 mi
// east, D (550) 5 mi west, plus 600 residents already within T.
function threeClusters() {
  return [
    block(0, 0, 400), block(0.1, 0, 400),
    block(5, 0, 300), block(5.1, 0, 300),
    block(-5, 0, 300), block(-5.1, 0, 250),
    block(0, 3, 600, 0.4),
  ];
}
const CLUSTER_SITES = [site('a', 0.05, 0), site('b', 5.05, 0), site('d', -5.05, 0)];

test('greedy max-coverage: the biggest gain first, stopping at the flip', () => {
  const blocks = threeClusters();
  const result = suggestSites({ blocks, threshold: 1, candidates: CLUSTER_SITES, lowIncome: true });
  assert.equal(result.source, 'commercial');
  assert.equal(result.reason, null);
  // 1,950 beyond -> 1,150 -> 550 (still >= 500) -> 0 (not low access).
  assert.deepEqual(ids(result), ['a', 'b', 'd']);
  assert.deepEqual(result.picks.map((p) => p.gain), [800, 600, 550]);
  assert.deepEqual(result.picks.map((p) => p.beyondAfter), [1150, 550, 0]);
  assert.deepEqual(result.picks.map((p) => p.lowAccessAfter), [true, true, false]);
  assert.deepEqual(result.picks.map((p) => p.verdictAfter.status), ['met', 'met', 'not_met']);
  assert.equal(result.picks[2].shareAfter, 0);
  assert.equal(result.flippedAt, 3);
  assertGainsConsistent(result, 1950);
});

test('maxSites caps the picks; no flip within the cap is flippedAt null', () => {
  const result = suggestSites({ blocks: threeClusters(), threshold: 1, candidates: CLUSTER_SITES, lowIncome: true, maxSites: 2 });
  assert.deepEqual(ids(result), ['a', 'b']);
  assert.equal(result.flippedAt, null);
  assert.equal(result.reason, null);
  assert.equal(DEFAULT_MAX_SITES, 3);
  for (const maxSites of [0, -1, 1.5, Number.NaN, '2']) {
    assert.throws(() => suggestSites({ blocks: threeClusters(), threshold: 1, maxSites }), RangeError);
  }
});

test('stops at the flip even with sites left to place and residents still to gain', () => {
  // 900 + 100 beyond, 2,000 within: low access (1,000 beyond, 33%). The site
  // at the 900 clears it; the 100 left 6 mi east could still be gained.
  const blocks = [block(0, 0, 900), block(6, 0, 100), block(0, 3, 2000, 0.2)];
  const candidates = [site('x', 0.1, 0), site('y', -0.1, 0), site('far', 6.1, 0)];
  const result = suggestSites({ blocks, threshold: 1, candidates, lowIncome: true, maxSites: 3 });
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].gain, 900);
  assert.equal(result.picks[0].beyondAfter, 100);
  assert.equal(result.flippedAt, 1);
});

test('stops at gain 0 when no candidate brings anyone else within T', () => {
  // Only cluster A has candidates near it; B and D stay beyond.
  const candidates = [site('a1', 0.05, 0), site('a2', 0.06, 0.02)];
  const result = suggestSites({ blocks: threeClusters(), threshold: 1, candidates, lowIncome: true });
  assert.equal(result.source, 'commercial');
  // Both gain 800; a2 is nearer the population-weighted center, which the
  // 600 residents 3 mi north pull up to about 0.7 mi north of A.
  assert.deepEqual(ids(result), ['a2']);
  assert.equal(result.picks[0].gain, 800);
  assert.equal(result.picks[0].lowAccessAfter, true);
  assert.equal(result.flippedAt, null);
  assert.equal(result.reason, null);
});

test('gain is never negative and always the drop in residents beyond T', () => {
  const blocks = [];
  for (let i = 0; i < 40; i++) blocks.push(block((i % 8) * 0.7, Math.floor(i / 8) * 0.7, 50 + ((i * 37) % 90), i % 5 === 0 ? 0.8 : 3));
  const candidates = blocks.map((b, i) => ({ id: `c${i}`, lat: b.lat + 0.001, lng: b.lng - 0.001, label: 'x', kind: 'vacant' }));
  const startBeyond = blocks.filter((b) => !(b.miles <= 1)).reduce((s, b) => s + b.pop, 0);
  const result = suggestSites({ blocks, threshold: 1, candidates, lowIncome: true, maxSites: 10 });
  assert.ok(result.picks.length > 1);
  assertGainsConsistent(result, startBeyond);
});

test('deterministic: same input, same picks, whatever the candidate order', () => {
  const blocks = [];
  for (let i = 0; i < 30; i++) blocks.push(block((i % 6) * 0.9, Math.floor(i / 6) * 0.9, 40 + ((i * 53) % 70)));
  const candidates = [];
  for (let i = 0; i < 60; i++) candidates.push(site(`s${String(i).padStart(2, '0')}`, (i % 10) * 0.5, Math.floor(i / 10) * 0.7));
  const args = { blocks, threshold: 1, candidates, lowIncome: true, maxSites: 3 };
  const first = suggestSites(args);
  assert.deepEqual(suggestSites(args), first);
  const reversed = suggestSites({ ...args, candidates: [...candidates].reverse() });
  assert.deepEqual(ids(reversed), ids(first));
  assert.deepEqual(reversed.picks.map((p) => p.gain), first.picks.map((p) => p.gain));
});

test('existing counting pins are applied first; other formats and bad pins change nothing', () => {
  const blocks = threeClusters();
  const pinA = { ...at(0.05, 0), format: 's' };
  const withPin = suggestSites({ blocks, threshold: 1, candidates: CLUSTER_SITES, lowIncome: true, existingPins: [pinA] });
  assert.deepEqual(ids(withPin), ['b', 'd']);
  assert.deepEqual(withPin.picks.map((p) => p.beyondAfter), [550, 0]);
  assert.equal(withPin.flippedAt, 2);
  assertGainsConsistent(withPin, 1150);

  // A missing format means supermarket, as in share links.
  const noFormat = suggestSites({ blocks, threshold: 1, candidates: CLUSTER_SITES, lowIncome: true, existingPins: [at(0.05, 0)] });
  assert.deepEqual(ids(noFormat), ['b', 'd']);

  const ignored = [
    { ...at(0.05, 0), format: 'g' },
    { ...at(0.05, 0), format: 'd' },
    { ...at(0.05, 0), format: 'f' },
    { lat: Number.NaN, lng: C.lng, format: 's' },
    { lat: 91, lng: C.lng, format: 's' },
    null,
  ];
  const noCount = suggestSites({ blocks, threshold: 1, candidates: CLUSTER_SITES, lowIncome: true, existingPins: ignored });
  assert.deepEqual(ids(noCount), ['a', 'b', 'd']);
  assert.deepEqual(suggestSites({ blocks, threshold: 1, candidates: CLUSTER_SITES, lowIncome: true, existingPins: 'nope' }).picks.length, 3);
});

test('pins that already clear low access leave nothing to suggest', () => {
  const blocks = [block(0, 0, 900), block(0, 3, 2000, 0.2)];
  const result = suggestSites({ blocks, threshold: 1, lowIncome: true, existingPins: [{ ...at(0.1, 0), format: 's' }] });
  assert.equal(result.reason, 'not_low_access');
  assert.deepEqual(result.picks, []);
});

test('unknown_baseline when access is Unknown', () => {
  const good = threeClusters();
  const cases = [
    { blocks: good, threshold: null },
    { blocks: good, threshold: Number.NaN },
    { blocks: good, threshold: 0 },
    { blocks: [], threshold: 1 },
    { blocks: undefined, threshold: 1 },
    // A payload without baseline miles (stores didn't load).
    { blocks: good.map((b) => ({ pop: b.pop, hu: b.hu, lat: b.lat, lng: b.lng })), threshold: 1 },
    { blocks: good.map((b, i) => (i === 2 ? { ...b, miles: Number.NaN } : b)), threshold: 1 },
    // No residents.
    { blocks: good.map((b) => ({ ...b, pop: 0 })), threshold: 1 },
  ];
  for (const c of cases) {
    const result = suggestSites({ ...c, candidates: CLUSTER_SITES, lowIncome: true });
    assert.equal(result.reason, 'unknown_baseline');
    assert.deepEqual(result.picks, []);
    assert.equal(result.flippedAt, null);
  }
  assert.equal(suggestSites().reason, 'unknown_baseline');
});

test('commercial candidates that gain nothing fall back to the tract\'s blocks', () => {
  const blocks = threeClusters();
  const far = [site('far1', 0, 20), site('far2', 30, 0)];
  const result = suggestSites({ blocks, threshold: 1, candidates: far, lowIncome: true });
  assert.equal(result.source, 'blocks');
  assert.equal(result.reason, null);
  assert.equal(result.picks.length, 3);
  for (const p of result.picks) {
    assert.equal(p.candidate.kind, BLOCK_SITE_KIND);
    assert.equal(p.candidate.label, BLOCK_SITE_LABEL);
  }
  // Candidates with no valid coordinates or id are dropped, not used.
  const junk = [{ id: 'nolat', lng: C.lng }, { lat: C.lat, lng: C.lng }, { id: {}, ...C }, null];
  assert.equal(suggestSites({ blocks, threshold: 1, candidates: junk, lowIncome: true }).source, 'blocks');
});

test('roundCoord: the pin and share-link precision (4 decimals), idempotent, and what a share link replays', () => {
  assert.equal(PIN_DECIMALS, 4);
  for (const x of [37.413565, -121.964005, 33.41356, -91.06259, 37.4212499999, 0.00005, -0.00005, 12.34565]) {
    const r = roundCoord(x);
    assert.equal(r, Number(x.toFixed(4)));
    assert.equal(roundCoord(r), r);
    // A share link replays the same number (as a longitude; as a latitude too when it is one).
    const pin = { lat: Math.abs(x) <= 90 ? x : 37.4, lng: x, format: 's' };
    const [back] = decodeAppState(encodeAppState({ lat: 37.4, lng: -121.9, pins: [pin] })).pins;
    assert.equal(back.lng, r);
    assert.equal(back.lat, roundCoord(pin.lat));
  }
  assert.equal(roundCoord(37.123456, 5), 37.12346);
});

test('blockCandidates are at pin precision, so an added pick lands where it was scored', () => {
  const blocks = [{ pop: 9, hu: 3, lat: 37.4135612, lng: -121.9640087, miles: null }, block(0.3, 0.2, 5)];
  for (const c of blockCandidates(blocks)) {
    assert.equal(c.lat, roundCoord(c.lat));
    assert.equal(c.lng, roundCoord(c.lng));
  }
  assert.deepEqual(
    blockCandidates(blocks).map(({ lat, lng }) => [lat, lng]),
    blocks.map((b) => [roundCoord(b.lat), roundCoord(b.lng)]),
  );
});

test('blockCandidates: one per populated block, fixed label, stable ids', () => {
  const blocks = [block(0, 0, 10), block(1, 0, 0), block(2, 0, 5), { pop: 3, hu: 1, lat: Number.NaN, lng: C.lng, miles: null }];
  const cands = blockCandidates(blocks);
  assert.deepEqual(cands.map((c) => c.id), ['block-0', 'block-2']);
  for (const c of cands) {
    assert.equal(c.kind, BLOCK_SITE_KIND);
    assert.equal(c.label, BLOCK_SITE_LABEL);
  }
  assert.deepEqual(blockCandidates(undefined), []);
  // Ids sort in block order past ten blocks.
  const many = blockCandidates(Array.from({ length: 12 }, (_, i) => block(i, 0, 1)));
  assert.deepEqual(many.map((c) => c.id), [...many.map((c) => c.id)].sort());
});

test('a tract that is low access but not low income: picks clear low access, no verdict flip', () => {
  const result = suggestSites({ blocks: threeClusters(), threshold: 1, candidates: CLUSTER_SITES, lowIncome: false });
  assert.deepEqual(ids(result), ['a', 'b', 'd']);
  assert.equal(result.picks[2].lowAccessAfter, false);
  assert.deepEqual(result.picks.map((p) => p.verdictAfter.qualifier), ['la_not_li', 'la_not_li', 'neither']);
  assert.equal(result.flippedAt, null);
  // Income unknown: Unknown -> NOT MET is not a flip either, but it still stops.
  const unknownIncome = suggestSites({ blocks: threeClusters(), threshold: 1, candidates: CLUSTER_SITES, lowIncome: null });
  assert.equal(unknownIncome.picks.length, 3);
  assert.equal(unknownIncome.picks[2].verdictAfter.status, 'not_met');
  assert.equal(unknownIncome.flippedAt, null);
});

// Tie-breaks. Three blocks of 100 on an east-west line at 0, 0.45 and 0.9 mi
// (population-weighted center at 0.45 mi), none within T. P sits 0.51 mi
// north of the center: nearer the center, nobody within 1/2 mi. Q sits 0.3 mi
// south of the west block: 0.54 mi from the center, the west block within
// 1/2 mi. Both bring all 300 residents within 1 mi (and within 10 mi).
const TIE_BLOCKS = [block(0, 0, 100), block(0.45, 0, 100), block(0.9, 0, 100)];
const P = site('p', 0.45, 0.51);
const Q = site('q', 0, -0.3);

test('tie on gain, urban: more residents within 1/2 mi wins', () => {
  const result = suggestSites({ blocks: TIE_BLOCKS, threshold: 1, candidates: [P, Q], lowIncome: true });
  assert.equal(result.picks[0].gain, 300);
  assert.deepEqual(ids(result), ['q']);
});

test('tie on gain, rural: the 1/2 mi rule is skipped and the site nearer the center wins', () => {
  const result = suggestSites({ blocks: TIE_BLOCKS, threshold: 10, candidates: [Q, P], lowIncome: true });
  assert.equal(result.picks[0].gain, 300);
  assert.deepEqual(ids(result), ['p']);
});

test('full tie: the smaller candidate id wins (numbers numerically)', () => {
  const spot = { lat: C.lat + dLat(0.1), lng: C.lng + dLng(0.45) };
  const strings = [{ id: 'site-b', ...spot }, { id: 'site-a', ...spot }, { id: 'site-c', ...spot }];
  assert.deepEqual(ids(suggestSites({ blocks: TIE_BLOCKS, threshold: 1, candidates: strings, lowIncome: true })), ['site-a']);
  const numbers = [{ id: 10, ...spot }, { id: 9, ...spot }];
  assert.deepEqual(ids(suggestSites({ blocks: TIE_BLOCKS, threshold: 1, candidates: numbers, lowIncome: true })), [9]);
});

test('fast enough: 3,000 candidates x 200 blocks', () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const blocks = Array.from({ length: 200 }, () => block(rand() * 4, rand() * 4, 10 + Math.floor(rand() * 90)));
  const candidates = Array.from({ length: 3000 }, (_, i) => site(i, rand() * 6 - 1, rand() * 6 - 1));
  const t0 = performance.now();
  const result = suggestSites({ blocks, threshold: 1, candidates, lowIncome: true });
  const ms = performance.now() - t0;
  assert.ok(result.picks.length > 0);
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});
