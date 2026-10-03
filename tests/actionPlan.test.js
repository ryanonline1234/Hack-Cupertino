import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_ITEMS,
  NO_VEHICLE_MIN,
  PLAN_FOOTER,
  PLAN_TITLE,
  VERIFIED_SOURCES,
  buildActionPlan,
} from '../src/engine/actionPlan.js';
import { approxCount, fmtBeyond, fmtMiles, fmtShare, roundedCount } from '../src/lib/format.js';

// ---------------------------------------------------------------- fixtures
// Payload-shaped inputs (docs/07 access, ERS loader result, scenario result,
// docs/08 suggestSites result). Numbers are deliberately distinctive so the
// numbers-come-from-inputs check can't pass by coincidence.

const verdict = (status, qualifier) => ({ status, qualifier, reason: null });

function accessOf({ population, beyond, threshold = 1, urban = true, lowIncome, status, qualifier }) {
  const share = beyond / population;
  const byShare = share >= 0.33;
  const byCount = beyond >= 500;
  return {
    status,
    reason: null,
    threshold,
    urban,
    urbanSource: 'ers_2025',
    population,
    beyond,
    share,
    byShare,
    byCount,
    lowAccess: byShare || byCount,
    lowIncome,
    verdict: verdict(status, qualifier),
  };
}

// Low income + low access (Alviso-like), urban.
const MET = accessOf({ population: 2064, beyond: 1904, lowIncome: true, status: 'met', qualifier: 'li_la' });
// Low access, not low income (Los Altos Hills-like).
const LA_NOT_LI = accessOf({ population: 3127, beyond: 1337, lowIncome: false, status: 'not_met', qualifier: 'la_not_li' });
// Neither (Cupertino-like).
const NEITHER = accessOf({ population: 4413, beyond: 63, lowIncome: false, status: 'not_met', qualifier: 'neither' });
// Low income, not low access.
const LI_NOT_LA = accessOf({ population: 2871, beyond: 212, lowIncome: true, status: 'not_met', qualifier: 'li_not_la' });
// Not low access, income unknown (no ERS row).
const NOT_LA_INCOME_UNKNOWN = { ...NEITHER, lowIncome: null, verdict: verdict('not_met', 'not_la_income_unknown') };
// Rural, low access by count only, low income (Chinle-like), T = 10 mi.
const RURAL_MET = accessOf({
  population: 3486,
  beyond: 712,
  threshold: 10,
  urban: false,
  lowIncome: true,
  status: 'met',
  qualifier: 'li_la',
});
const UNKNOWN = {
  ...MET,
  lowIncome: null,
  verdict: { status: 'unknown', qualifier: 'la_income_unknown', reason: 'income_unavailable' },
};

const ers = (tractHUNV) => ({ status: 'ok', e2025: { urban: true, lowIncome: true, tractHUNV, povertyRate: 7.5 } });
const META_CA = { fips: '06085504602', stateFips: '06', stateAbbr: 'CA' };
const META_MS = { fips: '28151000600', stateFips: '28', stateAbbr: 'MS' };
const META_GU = { fips: '66010950100', stateFips: '66', stateAbbr: 'GU' };

const candidate = (id) => ({
  id,
  lat: 37.42105,
  lng: -121.9727,
  kind: 'vacant',
  // Third-party text: must never reach a `why`.
  label: 'Vacant shop · <b>Joe\'s</b> (OpenStreetMap)',
  name: '<b>Joe\'s</b>',
});

const pick = (id, gain, beyondAfter, population, lowAccessAfter, status) => ({
  candidate: candidate(id),
  gain,
  beyondAfter,
  shareAfter: beyondAfter / population,
  lowAccessAfter,
  verdictAfter: verdict(status, status === 'met' ? 'li_la' : 'li_not_la'),
});

// One site flips Alviso-like MET: 1904 - 1823 = 81 still beyond.
const FLIP_ONE = { source: 'blocks', picks: [pick('b1', 1823, 81, 2064, false, 'not_met')], flippedAt: 1, reason: null };
// Two sites: 540 left after the first (low access by count), 497 after the
// second (under 500: must show exact, never "≈500").
const FLIP_TWO = {
  source: 'commercial',
  picks: [pick('c1', 1364, 540, 2064, true, 'met'), pick('c2', 43, 497, 2064, false, 'not_met')],
  flippedAt: 2,
  reason: null,
};
const NO_FLIP = {
  source: 'blocks',
  picks: [pick('b1', 977, 927, 2064, true, 'met'), pick('b2', 288, 639, 2064, true, 'met')],
  flippedAt: null,
  reason: null,
};
const NOT_LOW_ACCESS = { source: 'blocks', picks: [], flippedAt: null, reason: 'not_low_access' };

const plan = (args) => buildActionPlan(args);
const ids = (items) => items.map((i) => i.id);
const byId = (items, id) => items.find((i) => i.id === id);

// Every combination the rules can see, for the cross-cutting checks.
const ALL_CASES = [];
for (const [access, suggestions] of [
  [MET, FLIP_ONE],
  [MET, FLIP_TWO],
  [MET, NO_FLIP],
  [MET, null],
  [LA_NOT_LI, null],
  [NEITHER, NOT_LOW_ACCESS],
  [LI_NOT_LA, NOT_LOW_ACCESS],
  [NOT_LA_INCOME_UNKNOWN, null],
  [RURAL_MET, null],
]) {
  for (const meta of [META_CA, META_MS, META_GU]) {
    for (const e of [ers(137), ers(41), null]) {
      ALL_CASES.push({ access, ers: e, scenario: null, suggestions, meta });
    }
  }
}

// ---------------------------------------------------------------- card

test('card title and footer are the docs/08 wording', () => {
  assert.equal(PLAN_TITLE, "Action plan · rules applied to this tract's numbers");
  assert.equal(PLAN_FOOTER, "Not advice from USDA; check each program's current eligibility.");
  assert.equal(MAX_ITEMS, 6);
});

test('item shape: id, title, why, action, sources [{ name, url }]', () => {
  for (const args of ALL_CASES) {
    for (const item of plan(args)) {
      assert.deepEqual(Object.keys(item).sort(), ['action', 'id', 'sources', 'title', 'why']);
      for (const k of ['id', 'title', 'why', 'action']) assert.equal(typeof item[k], 'string');
      for (const s of item.sources) assert.deepEqual(Object.keys(s).sort(), ['name', 'url']);
    }
  }
});

// ---------------------------------------------------------------- sources

test('VERIFIED_SOURCES: frozen, https, named, with what the page says and the date checked', () => {
  assert.ok(Object.isFrozen(VERIFIED_SOURCES));
  const entries = Object.values(VERIFIED_SOURCES);
  assert.ok(entries.length >= 5);
  for (const s of entries) {
    assert.ok(Object.isFrozen(s));
    assert.match(s.url, /^https:\/\/[a-z0-9.-]+\.[a-z]+\//);
    assert.ok(s.name.length > 0);
    assert.ok(s.says.length > 20);
    assert.match(s.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(new Set(entries.map((s) => s.url)).size, entries.length, 'no duplicate URLs');
});

test('every URL any plan links is in VERIFIED_SOURCES, with the same name', () => {
  const verified = new Map(Object.values(VERIFIED_SOURCES).map((s) => [s.url, s.name]));
  let linked = 0;
  for (const args of ALL_CASES) {
    for (const item of plan(args)) {
      for (const s of item.sources) {
        assert.ok(verified.has(s.url), `unverified link ${s.url} in ${item.id}`);
        assert.equal(s.name, verified.get(s.url));
        linked++;
      }
    }
  }
  assert.ok(linked > 0);
});

test('FreshWorks is linked only for California tracts, and only once it is verified', () => {
  const fw = VERIFIED_SOURCES.caFreshWorks;
  const urls = (meta) => byId(plan({ access: MET, ers: ers(41), meta }), 'financing').sources.map((s) => s.url);
  for (const meta of [META_MS, META_GU, null]) {
    for (const u of urls(meta)) assert.doesNotMatch(u, /freshworks/i);
  }
  if (fw) assert.ok(urls(META_CA).includes(fw.url));
  else for (const u of urls(META_CA)) assert.doesNotMatch(u, /freshworks/i);
  // The state can come from the tract GEOID when stateFips is missing.
  if (fw) assert.ok(urls({ fips: '06085504602' }).includes(fw.url));
});

// ---------------------------------------------------------------- rule 1: suggested sites

test('rule site: one suggested site that flips the verdict', () => {
  const item = byId(plan({ access: MET, ers: ers(41), suggestions: FLIP_ONE, meta: META_CA }), 'site_grocery');
  assert.ok(item);
  assert.equal(item.title, 'Site a full-line grocery store near suggested site 1');
  assert.match(item.why, /^The first suggested site would bring ≈1,820 more residents within 1 mile/);
  assert.match(item.why, /81 residents \(4%\) would still live beyond 1 mile/);
  assert.match(item.why, /no longer meet USDA's test/);
  assert.deepEqual(item.sources, []);
});

test('rule site: two sites to flip; a count under 500 after the flip shows exact', () => {
  const item = byId(plan({ access: MET, ers: ers(41), suggestions: FLIP_TWO, meta: META_CA }), 'site_grocery');
  assert.equal(item.title, 'Site full-line grocery stores near suggested sites 1 and 2');
  assert.match(item.why, /^The first two suggested sites would bring ≈1,360 and 43 more residents/);
  assert.match(item.why, /497 residents \(24%\) would still live beyond 1 mile/);
  assert.doesNotMatch(item.why, /≈500/);
});

test('rule site: a share under 33% after the flip never reads as 33%', () => {
  const small = accessOf({ population: 1200, beyond: 900, lowIncome: true, status: 'met', qualifier: 'li_la' });
  const s = { source: 'blocks', picks: [pick('b1', 505, 395, 1200, false, 'not_met')], flippedAt: 1, reason: null };
  const item = byId(plan({ access: small, suggestions: s, meta: META_MS }), 'site_grocery');
  assert.match(item.why, /≈400 residents \(just under 33%\)/);
});

test('rule site: with the user\'s stores already placed, the why says so', () => {
  const scenario = { counting: 1, nonCounting: 0, after: { verdict: verdict('met', 'li_la') } };
  const item = byId(plan({ access: MET, scenario, suggestions: FLIP_ONE, meta: META_CA }), 'site_grocery');
  assert.match(item.why, /^With the stores you placed, the first suggested site would bring/);
});

test('rule site: zero left beyond reads as words, not "0 residents (0%)"', () => {
  const s = { source: 'blocks', picks: [pick('b1', 1904, 0, 2064, false, 'not_met')], flippedAt: 1, reason: null };
  const item = byId(plan({ access: MET, suggestions: s, meta: META_CA }), 'site_grocery');
  assert.match(item.why, /no resident would still live beyond 1 mile/);
});

test('rule site does not fire without a flip', () => {
  for (const suggestions of [null, undefined, NO_FLIP, NOT_LOW_ACCESS, { picks: [] }]) {
    assert.equal(byId(plan({ access: MET, suggestions, meta: META_CA }), 'site_grocery'), undefined);
  }
  // The start was already NOT MET (the user's pins flipped it): nothing to flip.
  const scenario = { counting: 1, after: { verdict: verdict('not_met', 'li_not_la') } };
  assert.equal(byId(plan({ access: MET, scenario, suggestions: FLIP_ONE, meta: META_CA }), 'site_grocery'), undefined);
  // A baseline that isn't MET can't be flipped by suggestions.
  assert.equal(byId(plan({ access: LA_NOT_LI, suggestions: FLIP_ONE, meta: META_CA }), 'site_grocery'), undefined);
});

test('rule site: a malformed pick drops the item instead of printing null', () => {
  const bad = { ...FLIP_ONE, picks: [{ ...FLIP_ONE.picks[0], gain: NaN }] };
  assert.equal(byId(plan({ access: MET, suggestions: bad, meta: META_CA }), 'site_grocery'), undefined);
});

// ---------------------------------------------------------------- rule 2: SNAP and WIC

test('rule snap_wic: low access and low income', () => {
  const item = byId(plan({ access: MET, ers: ers(41), meta: META_MS }), 'snap_wic');
  assert.equal(item.title, 'Make sure a new store can take SNAP and WIC');
  assert.match(item.why, /≈1,900 of 2,060 residents \(92%\) live more than 1 mile from a counted supermarket/);
  assert.deepEqual(
    item.sources.map((s) => s.url),
    [VERIFIED_SOURCES.snapRetailerApply.url, VERIFIED_SOURCES.wicRetailers.url],
  );
  assert.match(item.action, /state WIC agency/);
});

test('rule snap_wic does not fire unless low access and low income', () => {
  for (const access of [LA_NOT_LI, NEITHER, LI_NOT_LA, NOT_LA_INCOME_UNKNOWN]) {
    assert.equal(byId(plan({ access, meta: META_MS }), 'snap_wic'), undefined, access.verdict.qualifier);
  }
});

// ---------------------------------------------------------------- rule 3: distance

test(`rule cover_distance: ${NO_VEHICLE_MIN}+ no-vehicle households (ERS TractHUNV)`, () => {
  const item = byId(plan({ access: MET, ers: ers(137), meta: META_MS }), 'cover_distance');
  assert.equal(item.title, "Cover distance a single store can't");
  assert.match(item.why, /ERS counts ≈140 households in this tract without a vehicle/);
  assert.deepEqual(item.sources.map((s) => s.url), [VERIFIED_SOURCES.snapOnline.url]);
  assert.match(item.action, /SNAP online/);
  // Exactly at the cutoff fires; one under doesn't (urban).
  assert.ok(byId(plan({ access: MET, ers: ers(100), meta: META_MS }), 'cover_distance'));
  assert.equal(byId(plan({ access: MET, ers: ers(99), meta: META_MS }), 'cover_distance'), undefined);
});

test('rule cover_distance: rural tract, whatever the vehicle count', () => {
  const item = byId(plan({ access: RURAL_MET, ers: ers(41), meta: META_MS }), 'cover_distance');
  assert.match(item.why, /^This tract is rural: USDA's distance limit is 10 miles/);
  assert.match(item.why, /≈710 of 3,490 residents live beyond it/);
  const both = byId(plan({ access: RURAL_MET, ers: ers(137), meta: META_MS }), 'cover_distance');
  assert.match(both.why, /10 miles.*≈140 households/);
});

test('rule cover_distance does not fire for an urban tract under the cutoff or without ERS', () => {
  for (const e of [ers(41), ers(null), { status: 'missing_row', e2025: null }, null, undefined]) {
    assert.equal(byId(plan({ access: MET, ers: e, meta: META_MS }), 'cover_distance'), undefined);
  }
});

test('rule cover_distance: Guam and the USVI get no "order online" advice (not available there yet)', () => {
  const gu = byId(plan({ access: MET, ers: ers(137), meta: META_GU }), 'cover_distance');
  const ms = byId(plan({ access: MET, ers: ers(137), meta: META_MS }), 'cover_distance');
  assert.notEqual(gu.action, ms.action);
  assert.match(gu.action, /isn't available in Guam or the US Virgin Islands yet/);
  const vi = byId(plan({ access: MET, ers: ers(137), meta: { fips: '78010970100' } }), 'cover_distance');
  assert.equal(vi.action, gu.action);
});

// ---------------------------------------------------------------- rule 4: incentives

test('rule incentives: low income, with or without low access', () => {
  for (const access of [MET, LI_NOT_LA, RURAL_MET]) {
    const item = byId(plan({ access, meta: META_MS }), 'incentives');
    assert.equal(item.title, 'Make healthy food cheaper, not just closer');
    assert.match(item.action, /Gus Schumacher Nutrition Incentive Program \(GusNIP\)/);
    assert.deepEqual(item.sources.map((s) => s.url), [VERIFIED_SOURCES.gusnip.url]);
  }
  assert.match(byId(plan({ access: MET, meta: META_MS }), 'incentives').why, /this tract of ≈2,060 residents as low income/);
});

test('rule incentives does not fire when not low income or income unknown', () => {
  for (const access of [LA_NOT_LI, NEITHER, NOT_LA_INCOME_UNKNOWN]) {
    assert.equal(byId(plan({ access, meta: META_MS }), 'incentives'), undefined);
  }
});

// ---------------------------------------------------------------- rule 5: financing

test('rule financing: low access and low income', () => {
  const item = byId(plan({ access: MET, meta: META_MS }), 'financing');
  assert.equal(item.title, 'Financing for a grocery in a low-income, low-access area');
  assert.match(item.why, /meets USDA's low-income, low-access test: ≈1,900 of 2,060 residents/);
  assert.ok(item.sources.some((s) => s.url === VERIFIED_SOURCES.hffi.url));
  assert.match(item.action, /Healthy Food Financing Initiative/);
});

test('rule financing does not fire unless low access and low income', () => {
  for (const access of [LA_NOT_LI, NEITHER, LI_NOT_LA, NOT_LA_INCOME_UNKNOWN]) {
    assert.equal(byId(plan({ access, meta: META_CA }), 'financing'), undefined);
  }
});

// ---------------------------------------------------------------- rule 6: low access, not low income

test('rule not_low_income: low access, not low income', () => {
  const item = byId(plan({ access: LA_NOT_LI, meta: META_CA }), 'not_low_income');
  assert.equal(
    item.title,
    "Access is limited, but this isn't a low-income tract, so USDA's test isn't met and low-income financing programs may not apply",
  );
  assert.match(item.why, /≈1,340 of 3,130 residents \(43%\) live more than 1 mile/);
  assert.match(item.why, /ERS doesn't flag the tract as low income/);
});

test('rule not_low_income does not fire otherwise', () => {
  for (const access of [MET, NEITHER, LI_NOT_LA, NOT_LA_INCOME_UNKNOWN, RURAL_MET]) {
    assert.equal(byId(plan({ access, meta: META_CA }), 'not_low_income'), undefined);
  }
});

// ---------------------------------------------------------------- rule 7: not low access

test('rule affordability: not low access', () => {
  for (const access of [NEITHER, LI_NOT_LA, NOT_LA_INCOME_UNKNOWN]) {
    const item = byId(plan({ access, meta: META_CA }), 'affordability');
    assert.equal(item.title, "Distance isn't the barrier here; affordability may be");
    assert.match(item.why, /under both of USDA's low-access limits/);
    assert.deepEqual(
      item.sources.map((s) => s.url),
      [VERIFIED_SOURCES.gusnip.url, VERIFIED_SOURCES.snapProgram.url],
    );
  }
  assert.match(byId(plan({ access: NEITHER, meta: META_CA }), 'affordability').why, /^63 of 4,410 residents \(1%\)/);
  assert.match(byId(plan({ access: LI_NOT_LA, meta: META_CA }), 'affordability').why, /ERS flags the tract as low income/);
});

test('rule affordability does not fire when low access', () => {
  for (const access of [MET, LA_NOT_LI, RURAL_MET]) {
    assert.equal(byId(plan({ access, meta: META_CA }), 'affordability'), undefined);
  }
});

// ---------------------------------------------------------------- whole plan

test('unknown verdict or missing access gives an empty plan', () => {
  assert.deepEqual(plan({ access: UNKNOWN, ers: ers(137), suggestions: FLIP_ONE, meta: META_CA }), []);
  assert.deepEqual(plan({ access: null }), []);
  assert.deepEqual(plan({}), []);
  assert.deepEqual(buildActionPlan(), []);
});

test('order follows the docs/08 table; at most 6 items; ids unique', () => {
  const full = plan({ access: MET, ers: ers(137), suggestions: FLIP_ONE, meta: META_CA });
  assert.deepEqual(ids(full), ['site_grocery', 'snap_wic', 'cover_distance', 'incentives', 'financing']);
  assert.deepEqual(ids(plan({ access: LA_NOT_LI, ers: ers(137), meta: META_CA })), ['cover_distance', 'not_low_income']);
  assert.deepEqual(ids(plan({ access: LI_NOT_LA, ers: ers(137), meta: META_CA })), [
    'cover_distance',
    'incentives',
    'affordability',
  ]);
  for (const args of ALL_CASES) {
    const items = plan(args);
    assert.ok(items.length <= MAX_ITEMS);
    assert.equal(new Set(ids(items)).size, items.length);
  }
});

test('every why quotes at least one number', () => {
  for (const args of ALL_CASES) {
    for (const item of plan(args)) assert.match(item.why, /\d/, `${item.id}: ${item.why}`);
  }
});

// Collects every way the guarded formatters can print each number in the
// inputs, then reduces those strings to their numeric tokens.
const TOKEN = /\d[\d,]*(?:\.\d+)?/g;
function allowedTokens(inputs) {
  const out = new Set();
  const add = (s) => {
    if (typeof s === 'string') for (const t of s.match(TOKEN) ?? []) out.add(t);
  };
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      add(String(v));
      add(approxCount(v));
      add(roundedCount(v));
      for (const flag of [true, false, undefined]) {
        add(fmtBeyond(v, flag));
        add(fmtShare(v, flag));
      }
      add(fmtMiles(v));
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(inputs);
  return out;
}
const unexplained = (text, allowed) => (text.match(TOKEN) ?? []).filter((t) => !allowed.has(t));

test('the numbers check catches a number that is not in the inputs (negative control)', () => {
  const allowed = allowedTokens({ access: MET, ers: ers(137), meta: META_MS });
  assert.deepEqual(unexplained('about 45 employees per store', allowed), ['45']);
  assert.deepEqual(unexplained('≈1,900 of 2,060 residents (92%)', allowed), []);
});

test('every number in every why comes from the inputs, through the guarded formatters', () => {
  let checked = 0;
  for (const args of ALL_CASES) {
    const allowed = allowedTokens(args);
    for (const item of plan(args)) {
      assert.deepEqual(unexplained(item.why, allowed), [], `${item.id}: ${item.why}`);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

test('titles and actions are fixed strings: different numbers, same text', () => {
  // Population x3 and beyond +7 keep every fixture on the same side of both
  // low-access limits, so only the numbers change.
  const scaled = (a) =>
    accessOf({
      population: a.population * 3 + 7,
      beyond: a.beyond + 7,
      threshold: a.threshold,
      urban: a.urban,
      lowIncome: a.lowIncome,
      status: a.status,
      qualifier: a.verdict.qualifier,
    });
  for (const access of [MET, LA_NOT_LI, NEITHER, LI_NOT_LA, RURAL_MET]) {
    const a = plan({ access, ers: ers(137), suggestions: access === MET ? FLIP_ONE : null, meta: META_CA });
    const b = plan({ access: scaled(access), ers: ers(911), suggestions: access === MET ? FLIP_ONE : null, meta: META_CA });
    assert.deepEqual(ids(a), ids(b));
    assert.deepEqual(a.map((i) => i.title), b.map((i) => i.title));
    assert.deepEqual(a.map((i) => i.action), b.map((i) => i.action));
    for (const i of a) assert.doesNotMatch(`${i.title} ${i.action}`, /≈|%/);
  }
});

test('third-party text from candidates never reaches the plan', () => {
  for (const args of ALL_CASES) {
    for (const item of plan(args)) {
      assert.doesNotMatch(JSON.stringify(item), /Joe|<b>/);
    }
  }
});

test('pure: same input, same plan; inputs are not mutated', () => {
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  };
  const args = deepFreeze(structuredClone({ access: MET, ers: ers(137), suggestions: FLIP_TWO, meta: META_CA }));
  assert.deepEqual(plan(args), plan(args));
});
