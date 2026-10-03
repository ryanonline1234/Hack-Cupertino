// Placed-store scenarios: what USDA ERS's tract test would say if supermarkets
// opened at the pinned spots. Pure recompute on the baseline payload from
// buildCommunityData: same blocks, same T, same income flag; each block's
// distance becomes min(baseline, nearest counting pin). Only supermarket pins
// (format 's') join the store set, so small grocers, dollar stores, farmers
// markets, duplicates and far-away pins change nothing by construction.
import {
  COUNT_THRESHOLD,
  SHARE_THRESHOLD,
  nearestDistances,
  populationLowAccessFromDistances,
} from './lowAccess.js';
import { evaluateFoodAccess } from './foodAccessVerdict.js';

const PIN_FORMATS = ['s', 'g', 'd', 'f'];
const COUNTING_FORMAT = 's';
const HALF_MILE = 0.5;
// ERS TractHUNV apportioned by housing units is too rough to show below this.
const MIN_NO_VEHICLE_ESTIMATE = 20;

// A missing or unknown format means supermarket, as it does in share links.
function pinFormat(format) {
  return PIN_FORMATS.includes(format) ? format : COUNTING_FORMAT;
}

function validPin(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

// Payloads carry each block's baseline miles (null = no counted store within
// the loaded radius). Without them, recompute from the payload's stores.
function baselineDistances(access) {
  const { blocks } = access;
  if (blocks.every((b) => b.miles === null || Number.isFinite(b.miles))) {
    return Float64Array.from(blocks, (b) => (b.miles === null ? Infinity : b.miles));
  }
  return nearestDistances(blocks, Array.isArray(access.stores) ? access.stores : []);
}

function side(blocks, distances, threshold, lowIncome) {
  const stats = populationLowAccessFromDistances(blocks, distances, threshold);
  return { ...stats, verdict: evaluateFoodAccess({ lowIncome, lowAccess: stats.lowAccess }) };
}

function residentsWithin(blocks, distances, miles) {
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].pop > 0 && distances[i] <= miles) n += blocks[i].pop;
  }
  return n;
}

function housingShareBeyond(blocks, distances, miles) {
  let total = 0;
  let beyond = 0;
  for (let i = 0; i < blocks.length; i++) {
    const hu = blocks[i].hu > 0 ? blocks[i].hu : 0;
    total += hu;
    if (!(distances[i] <= miles)) beyond += hu;
  }
  return total > 0 ? beyond / total : null;
}

// Largest `beyond` that is no longer low access. The step down re-checks with
// the engine's own comparison: 0.33 * 300 is 99, and 99 / 300 is still >= 0.33.
function maxBeyondNotLowAccess(population) {
  let b = Math.min(COUNT_THRESHOLD - 1, Math.floor(population * SHARE_THRESHOLD));
  while (b > 0 && b / population >= SHARE_THRESHOLD) b--;
  return b;
}

function gapAfter(after) {
  if (after.lowAccess !== true) return null;
  return {
    residentsOver: after.byCount ? after.beyond - (COUNT_THRESHOLD - 1) : null,
    shareOverPct: after.byShare ? after.share * 100 - SHARE_THRESHOLD * 100 : null,
    residentsToClear: after.beyond - maxBeyondNotLowAccess(after.population),
  };
}

// pins: [{ lat, lng, format }], format 's' | 'g' | 'd' | 'f' (default 's').
// Returns null with no valid pins, no blocks, or no known baseline.
export function evaluatePlacedStoreScenario(communityData, pins) {
  const access = communityData?.access;
  const blocks = access?.blocks;
  if (!Array.isArray(pins) || !Array.isArray(blocks) || blocks.length === 0) return null;
  if (!Number.isFinite(access.threshold) || typeof access.lowAccess !== 'boolean') return null;

  const placed = pins.filter(validPin);
  if (placed.length === 0) return null;
  const counting = placed.filter((p) => pinFormat(p.format) === COUNTING_FORMAT);

  const threshold = access.threshold;
  const lowIncome = access.lowIncome ?? null;
  const base = baselineDistances(access);
  const toPins = nearestDistances(blocks, counting);
  const next = base.map((d, i) => Math.min(d, toPins[i]));

  const before = side(blocks, base, threshold, lowIncome);
  const after = side(blocks, next, threshold, lowIncome);

  const halfMile = access.urban === true
    ? { before: residentsWithin(blocks, base, HALF_MILE), after: residentsWithin(blocks, next, HALF_MILE) }
    : null;

  let noVehicleEstimate = null;
  const hunv = communityData.ers?.e2025?.tractHUNV;
  const shareBefore = housingShareBeyond(blocks, base, HALF_MILE);
  if (Number.isFinite(hunv) && shareBefore !== null && hunv * shareBefore >= MIN_NO_VEHICLE_ESTIMATE) {
    noVehicleEstimate = { before: hunv * shareBefore, after: hunv * housingShareBeyond(blocks, next, HALF_MILE) };
  }

  return {
    counting: counting.length,
    nonCounting: placed.length - counting.length,
    before,
    after,
    broughtWithin: before.beyond - after.beyond,
    flipped: before.verdict.status === 'met' && after.verdict.status === 'not_met',
    gap: gapAfter(after),
    halfMile,
    noVehicleEstimate,
  };
}
