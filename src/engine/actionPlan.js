// Rules-based action plan (docs/08 §2): the tract's computed facts turned into
// a short, sourced checklist. No model, no fetch. Titles and actions are fixed
// strings. Every `why` quotes only numbers that are already in the inputs,
// through the panel's guarded formatters, so a count under one of USDA's
// limits never reads as at or over it. Candidate labels and names
// (third-party OpenStreetMap text) are never quoted.
import { approxCount, fmtBeyond, fmtMiles, fmtShare, roundedCount } from '../lib/format.js';

export const PLAN_TITLE = "Action plan · rules applied to this tract's numbers";
export const PLAN_FOOTER = "Not advice from USDA; check each program's current eligibility.";
export const MAX_ITEMS = 6;
// ERS TractHUNV (housing units without a vehicle) at or above this adds the
// "cover distance" item.
export const NO_VEHICLE_MIN = 100;

// Program pages, each fetched with curl and read on the date given. Only
// these URLs may appear in a plan (docs/08: a link that can't be verified is
// dropped with its item).
//
// fns.usda.gov now redirects to fna.usda.gov ("Food and Nutrition
// Administration"); the old FNS paths (/snap/retailer/apply, /wic/retailers,
// /snap/online-purchasing) return 404 there, so the links below are the
// current FNA paths.
//
// Checked and NOT verified on 2026-10-03, so not linked:
// - USDA Rural Development's HFFI page (rd.usda.gov/hffi and
//   /about-rd/initiatives/healthy-food-financing-initiative): HTTP 403
//   "Access Denied" to a scripted fetch. The Reinvestment Fund page below
//   covers the financing item.
// - California FreshWorks (www.cafreshworks.com): HTTP 500, WordPress "There
//   has been a critical error on this website", on two tries; its former
//   administrator's page (ncclf.org/california-freshworks, now
//   communityvisionca.org) is 404. Once a page verifies, add it here as
//   `caFreshWorks` and the financing item links it for California tracts.
const src = (name, url, says, checked) => Object.freeze({ name, url, says, checked });

export const VERIFIED_SOURCES = Object.freeze({
  snapRetailerApply: src(
    'USDA Food and Nutrition Administration: How do I apply to accept SNAP benefits?',
    'https://www.fna.usda.gov/snap/retailer/apply-to-accept',
    'Retail food stores and farmers markets apply online at no cost; USDA\'s Food and Nutrition Administration is the only source that authorizes SNAP retailers.',
    '2026-10-03',
  ),
  wicRetailers: src(
    'USDA Food and Nutrition Administration: WIC and retail grocery stores',
    'https://www.fna.usda.gov/wic/partner/retailer',
    'Each state is responsible for authorizing stores to accept WIC, considering food prices, the owner\'s business integrity (including any SNAP disqualification) and the variety and quantity of foods; contact the state agency.',
    '2026-10-03',
  ),
  snapOnline: src(
    'USDA Food and Nutrition Administration: Stores accepting SNAP online',
    'https://www.fna.usda.gov/snap/online',
    'SNAP online purchasing retailers by state; available in all 50 states and DC, not yet in Guam or the US Virgin Islands.',
    '2026-10-03',
  ),
  snapProgram: src(
    'USDA Food and Nutrition Administration: Supplemental Nutrition Assistance Program (SNAP)',
    'https://www.fna.usda.gov/snap/supplemental-nutrition-assistance-program',
    'SNAP provides food benefits to low-income families to supplement their grocery budget; links to eligibility and how to apply.',
    '2026-10-03',
  ),
  gusnip: src(
    'USDA NIFA: Gus Schumacher Nutrition Incentive Program (GusNIP)',
    'https://www.nifa.usda.gov/grants/programs/gus-schumacher-nutrition-incentive-program',
    'Competitive grants (7 U.S.C. 7517) for projects that give income-eligible consumers incentives to buy fruits and vegetables, and for produce prescriptions.',
    '2026-10-03',
  ),
  hffi: src(
    "America's Healthy Food Financing Initiative (Reinvestment Fund, in partnership with USDA)",
    'https://www.investinginfood.com/',
    'HFFI, administered by Reinvestment Fund in partnership with USDA, provides grants, loans and technical assistance to healthy food retailers and food enterprises in underserved areas.',
    '2026-10-03',
  ),
});

// SNAP online purchasing isn't running in Guam (66) or the US Virgin Islands
// (78) yet, per the snapOnline page on 2026-10-03.
const NO_SNAP_ONLINE = new Set(['66', '78']);
const CALIFORNIA = '06';

const SITE_TITLES = [
  null,
  'Site a full-line grocery store near suggested site 1',
  'Site full-line grocery stores near suggested sites 1 and 2',
  'Site full-line grocery stores near suggested sites 1, 2 and 3',
];
const SITE_TITLE_MANY = 'Site full-line grocery stores near the suggested sites';
const SITE_ACTION_ONE =
  "Look for a full-line grocer (a supermarket or supercenter, the only store type USDA's test counts) for a spot near the suggested site. The ranking is by distance only; land, zoning, cost and grocer interest still need checking.";
const SITE_ACTION_MANY =
  "Look for full-line grocers (supermarkets or supercenters, the only store type USDA's test counts) for spots near the suggested sites. The ranking is by distance only; land, zoning, cost and grocer interest still need checking.";
const COUNT_WORDS = [null, null, 'two', 'three', 'four', 'five', 'six'];

const DISTANCE_ACTION =
  "Check which stores deliver SNAP online orders here, and ask the transit agency or a mobile market about a regular stop. These don't change USDA's test, which counts only supermarkets.";
const DISTANCE_ACTION_NO_ONLINE =
  "Ask the transit agency or a mobile market about a regular stop (SNAP online purchasing isn't available in Guam or the US Virgin Islands yet). These don't change USDA's test, which counts only supermarkets.";

const INCENTIVE_ACTION =
  'Look for, or propose, a project funded by the Gus Schumacher Nutrition Incentive Program (GusNIP): USDA grants that give income-eligible shoppers incentives to buy fruits and vegetables.';

const FINANCING_ACTION =
  "Look at America's Healthy Food Financing Initiative (Reinvestment Fund with USDA), which offers grants, loans and technical assistance to food retailers in underserved areas.";
const FINANCING_ACTION_CA = `${FINANCING_ACTION} California FreshWorks is a California fund for the same purpose.`;

// ------------------------------------------------------------- helpers

// The limit is 1 or 10 mi; written the way the access panel writes it.
function limitWord(t) {
  if (t === 1) return '1 mile';
  if (Number.isInteger(t) && t > 0) return `${t} miles`;
  return fmtMiles(t);
}

const residentsWord = (n) => (n === 1 ? 'resident' : 'residents');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function joinList(parts) {
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function stateOf(meta) {
  if (typeof meta?.stateFips === 'string' && meta.stateFips) return meta.stateFips;
  return typeof meta?.fips === 'string' ? meta.fips.slice(0, 2) : null;
}

const sourceLink = (key) => {
  const s = VERIFIED_SOURCES[key];
  return s ? { name: s.name, url: s.url } : null;
};

// "≈1,900 of 2,060 residents (92%) live more than 1 mile from a counted
// supermarket", or null when any number is missing.
function accessLine(access) {
  const beyond = fmtBeyond(access.beyond, access.byCount);
  const population = roundedCount(access.population);
  const share = fmtShare(access.share, access.byShare);
  const limit = limitWord(access.threshold);
  if (!beyond || !population || !share || !limit) return null;
  return `${beyond} of ${population} ${residentsWord(access.population)} (${share}) live more than ${limit} from a counted supermarket`;
}

// The picks up to and including the first one whose verdict-after is NOT
// MET, when the start (the baseline, or the user's placed stores) is MET.
// Read from the picks themselves rather than flippedAt, so the rule doesn't
// depend on whether flippedAt counts from 0 or 1.
function flipPicks(access, scenario, suggestions) {
  const picks = Array.isArray(suggestions?.picks) ? suggestions.picks : [];
  const start = scenario?.after?.verdict ?? access.verdict;
  if (picks.length === 0 || start?.status !== 'met') return null;
  const k = picks.findIndex((p) => p?.verdictAfter?.status === 'not_met');
  return k < 0 ? null : picks.slice(0, k + 1);
}

// ------------------------------------------------------------- rules
// Each returns an item or null. The order of RULES is the docs/08 table.

function siteRule({ access, scenario, suggestions }) {
  const used = flipPicks(access, scenario, suggestions);
  if (!used) return null;
  const last = used[used.length - 1];
  const gains = used.map((p) => approxCount(p?.gain));
  const limit = limitWord(access.threshold);
  // After the flip the tract is no longer low access, so both limits are
  // unmet and the guards apply.
  const notLowAccess = last.lowAccessAfter === false ? false : undefined;
  const left = fmtBeyond(last.beyondAfter, notLowAccess);
  const leftShare = fmtShare(last.shareAfter, notLowAccess);
  if (gains.some((g) => !g) || !limit || !left || !leftShare) return null;

  const n = used.length;
  const which = n === 1
    ? 'the first suggested site'
    : COUNT_WORDS[n] ? `the first ${COUNT_WORDS[n]} suggested sites` : 'the suggested sites';
  const subject = scenario?.counting > 0 ? `With the stores you placed, ${which}` : capitalize(which);
  const brought = n === 1
    ? `would bring ${gains[0]} more ${residentsWord(used[0].gain)} within ${limit} of a counted supermarket`
    : `would bring ${joinList(gains)} more residents within ${limit} of a counted supermarket, site by site`;
  const remaining = last.beyondAfter === 0
    ? `no resident would still live beyond ${limit}`
    : `${left} ${residentsWord(last.beyondAfter)} (${leftShare}) would still live beyond ${limit}`;

  return {
    id: 'site_grocery',
    title: SITE_TITLES[n] ?? SITE_TITLE_MANY,
    why: `${subject} ${brought}; ${remaining}, so the tract would no longer meet USDA's test.`,
    action: n === 1 ? SITE_ACTION_ONE : SITE_ACTION_MANY,
    sourceKeys: [],
  };
}

function snapWicRule({ access }) {
  if (access.lowAccess !== true || access.lowIncome !== true) return null;
  const line = accessLine(access);
  if (!line) return null;
  return {
    id: 'snap_wic',
    title: 'Make sure a new store can take SNAP and WIC',
    why: `ERS flags the tract as low income, and ${line}. SNAP and WIC can be spent only at stores authorized to take them.`,
    action:
      'Ask any new grocer to apply to accept SNAP (free, online, with USDA\'s Food and Nutrition Administration) and to apply for WIC with the state WIC agency, which authorizes WIC stores.',
    sourceKeys: ['snapRetailerApply', 'wicRetailers'],
  };
}

function distanceRule({ access, ers, meta }) {
  const hunv = ers?.e2025?.tractHUNV;
  const manyNoVehicle = Number.isFinite(hunv) && hunv >= NO_VEHICLE_MIN;
  const rural = access.urban === false;
  if (!manyNoVehicle && !rural) return null;

  const parts = [];
  if (rural) {
    const limit = limitWord(access.threshold);
    const beyond = fmtBeyond(access.beyond, access.byCount);
    const population = roundedCount(access.population);
    if (!limit) return null;
    parts.push(
      beyond && population
        ? `This tract is rural: USDA's distance limit is ${limit}, and ${beyond} of ${population} ${residentsWord(access.population)} live beyond it`
        : `This tract is rural: USDA's distance limit is ${limit}`,
    );
  }
  if (manyNoVehicle) {
    parts.push(`${rural ? 'ERS also counts' : 'ERS counts'} ${approxCount(hunv)} households in this tract without a vehicle`);
  }
  return {
    id: 'cover_distance',
    title: "Cover distance a single store can't",
    why: `${parts.join('; ')}.`,
    action: NO_SNAP_ONLINE.has(stateOf(meta)) ? DISTANCE_ACTION_NO_ONLINE : DISTANCE_ACTION,
    sourceKeys: ['snapOnline'],
  };
}

function incentivesRule({ access }) {
  if (access.lowIncome !== true) return null;
  const population = approxCount(access.population);
  if (!population) return null;
  return {
    id: 'incentives',
    title: 'Make healthy food cheaper, not just closer',
    why: `ERS flags this tract of ${population} ${residentsWord(access.population)} as low income.`,
    action: INCENTIVE_ACTION,
    sourceKeys: ['gusnip'],
  };
}

function financingRule({ access, meta }) {
  if (access.lowAccess !== true || access.lowIncome !== true) return null;
  const line = accessLine(access);
  if (!line) return null;
  const caFund = stateOf(meta) === CALIFORNIA && VERIFIED_SOURCES.caFreshWorks;
  return {
    id: 'financing',
    title: 'Financing for a grocery in a low-income, low-access area',
    why: `By this estimate the tract meets USDA's low-income, low-access test: ${line}.`,
    action: caFund ? FINANCING_ACTION_CA : FINANCING_ACTION,
    sourceKeys: caFund ? ['hffi', 'caFreshWorks'] : ['hffi'],
  };
}

function notLowIncomeRule({ access }) {
  if (access.lowAccess !== true || access.lowIncome !== false) return null;
  const line = accessLine(access);
  if (!line) return null;
  return {
    id: 'not_low_income',
    title:
      "Access is limited, but this isn't a low-income tract, so USDA's test isn't met and low-income financing programs may not apply",
    why: `${line}, but ERS doesn't flag the tract as low income.`,
    action:
      "Check each program's own eligibility rules for this tract before counting on low-income financing; a new store can still apply to accept SNAP.",
    sourceKeys: ['snapRetailerApply', 'hffi'],
  };
}

function affordabilityRule({ access }) {
  if (access.lowAccess !== false) return null;
  const line = accessLine(access);
  if (!line) return null;
  const income = access.lowIncome === true ? ' ERS flags the tract as low income.' : '';
  return {
    id: 'affordability',
    title: "Distance isn't the barrier here; affordability may be",
    why: `${line}, under both of USDA's low-access limits.${income}`,
    action:
      'Help eligible residents sign up for SNAP, and look for a GusNIP project nearby: GusNIP funds incentives for income-eligible shoppers to buy fruits and vegetables.',
    sourceKeys: ['gusnip', 'snapProgram'],
  };
}

const RULES = [siteRule, snapWicRule, distanceRule, incentivesRule, financingRule, notLowIncomeRule, affordabilityRule];

// buildActionPlan({ access, ers, scenario, suggestions, meta }) ->
// [{ id, title, why, action, sources: [{ name, url }] }], at most MAX_ITEMS.
//   access:      payload.access (docs/07); the plan is empty unless its
//                verdict is MET or NOT MET.
//   ers:         payload.ers (loadErsTract result); reads e2025.tractHUNV.
//   scenario:    evaluatePlacedStoreScenario result or null; the user's
//                placed stores are the start the suggestions build on.
//   suggestions: suggestSites result or null.
//   meta:        payload.meta; the state comes from stateFips (or fips).
// An item whose sources aren't all in VERIFIED_SOURCES is dropped.
export function buildActionPlan({ access, ers = null, scenario = null, suggestions = null, meta = null } = {}) {
  const status = access?.verdict?.status;
  if (status !== 'met' && status !== 'not_met') return [];
  const ctx = { access, ers, scenario, suggestions, meta };
  const items = [];
  for (const rule of RULES) {
    const item = rule(ctx);
    if (!item) continue;
    const sources = item.sourceKeys.map(sourceLink);
    if (sources.some((s) => !s)) continue;
    items.push({ id: item.id, title: item.title, why: item.why, action: item.action, sources });
  }
  return items.slice(0, MAX_ITEMS);
}
