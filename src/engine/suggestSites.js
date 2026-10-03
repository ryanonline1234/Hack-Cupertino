// Suggest sites (docs/08 §1): where supermarkets would change the measured
// result. Greedy max-coverage over candidate points: each step takes the
// candidate that brings the most residents newly within the tract's limit T,
// then every block's distance becomes min(current, distance to the pick).
// Distance only: nothing here knows about land, zoning, cost or retailers.
// Pure; distances use the same haversine and the same `<= T` test as the
// scenario engine, so adding a pick as a supermarket pin reproduces its
// numbers exactly, provided the candidate sits at pin precision (4 decimals,
// roundCoord): blockCandidates and the site loader put them there, because a
// pin rounded after scoring can move a block across T.
import { haversineMiles, roundCoord } from '../lib/geo.js';
import { BLOCK_SITE_KIND, BLOCK_SITE_LABEL } from '../lib/siteLabels.js';
import { evaluateFoodAccess } from './foodAccessVerdict.js';
import { nearestDistances, populationLowAccessFromDistances } from './lowAccess.js';

export const DEFAULT_MAX_SITES = 3;

// T is 1 mi exactly for urban tracts and 10 mi for rural ones
// (URBAN_THRESHOLD_MI / RURAL_THRESHOLD_MI in the normalizer), so the
// threshold alone says whether the urban half-mile tie-break applies.
const URBAN_THRESHOLD_MI = 1;
const HALF_MILE = 0.5;

// Pins as the scenario engine reads them: a missing or unknown format means
// supermarket ('s'), the only format that joins the store set.
const PIN_FORMATS = ['s', 'g', 'd', 'f'];
const COUNTING_FORMAT = 's';

// The candidate prefilter box: 69 mi per degree of latitude is under the
// haversine sphere's 69.09, and longitude is taken at the box's poleward
// edge, so the box over-covers; the slack absorbs any remaining rounding.
const MI_PER_DEG_LAT = 69;
const BOX_SLACK = 1.01;
const RAD = Math.PI / 180;

const validPoint = (p) =>
  Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

const pinFormat = (format) => (PIN_FORMATS.includes(format) ? format : COUNTING_FORMAT);

const validId = (id) => typeof id === 'string' || Number.isFinite(id);

// Numbers numerically, before strings; strings by UTF-16 code units, which
// is locale-independent and so the same on every device.
function compareIds(a, b) {
  const an = typeof a === 'number';
  const bn = typeof b === 'number';
  if (an && bn) return a - b;
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// One candidate per populated block internal point, for tracts without
// commercial-site data, at pin precision (see the header). Ids are
// zero-padded block indexes, so they sort in block order.
export function blockCandidates(blocks) {
  if (!Array.isArray(blocks)) return [];
  const width = String(Math.max(0, blocks.length - 1)).length;
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!(b?.pop > 0) || !validPoint(b)) continue;
    out.push({
      id: `block-${String(i).padStart(width, '0')}`,
      lat: roundCoord(b.lat),
      lng: roundCoord(b.lng),
      label: BLOCK_SITE_LABEL,
      kind: BLOCK_SITE_KIND,
    });
  }
  return out;
}

// Baseline miles from the payload (null = no counted store in range ->
// Infinity), then the counting pins, exactly as the scenario engine applies
// them. null when the baseline can't be measured.
function startingDistances(blocks, threshold, existingPins) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  if (!blocks.every((b) => b && (b.miles === null || Number.isFinite(b.miles)))) return null;
  const base = Float64Array.from(blocks, (b) => (b.miles === null ? Infinity : b.miles));
  const pins = Array.isArray(existingPins) ? existingPins : [];
  const counting = pins.filter((p) => validPoint(p) && pinFormat(p.format) === COUNTING_FORMAT);
  if (counting.length === 0) return base;
  const toPins = nearestDistances(blocks, counting);
  return base.map((d, i) => Math.min(d, toPins[i]));
}

function searchBox(blocks, members, miles) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const i of members) {
    const { lat, lng } = blocks[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const reach = miles * BOX_SLACK;
  const dLat = reach / MI_PER_DEG_LAT;
  const edgeLat = Math.min(89, Math.max(Math.abs(minLat), Math.abs(maxLat)) + dLat);
  const dLng = reach / (MI_PER_DEG_LAT * Math.cos(edgeLat * RAD));
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng };
}

const inBox = (box, p) => p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng;

function greedy({ blocks, threshold, start, startStats, candidates, maxSites, lowIncome }) {
  const urban = threshold === URBAN_THRESHOLD_MI;
  const current = Float64Array.from(start);

  // Only populated blocks with coordinates can be brought within T.
  const members = [];
  let popSum = 0;
  let latSum = 0;
  let lngSum = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!(b.pop > 0) || !validPoint(b)) continue;
    members.push(i);
    popSum += b.pop;
    latSum += b.pop * b.lat;
    lngSum += b.pop * b.lng;
  }
  const none = { picks: [], flippedAt: null, reason: 'no_gain' };
  if (members.length === 0) return none;
  const center = { lat: latSum / popSum, lng: lngSum / popSum };

  // A candidate outside the box is farther than T from every block: it can
  // never gain anyone, so it would never be picked.
  const box = searchBox(blocks, members, threshold);
  const pool = candidates.filter((c) => inBox(box, c));
  if (pool.length === 0) return none;

  // Which blocks each candidate puts within T (and within 1/2 mi, urban),
  // computed once; CSR layout: candidate k owns cover[coverAt[k] .. coverAt[k + 1]).
  const cover = [];
  const coverAt = new Int32Array(pool.length + 1);
  const half = [];
  const halfAt = new Int32Array(pool.length + 1);
  const centerMiles = new Float64Array(pool.length);
  for (let k = 0; k < pool.length; k++) {
    const c = pool[k];
    for (const i of members) {
      const d = haversineMiles(blocks[i].lat, blocks[i].lng, c.lat, c.lng);
      if (d <= threshold) cover.push(i);
      if (urban && d <= HALF_MILE) half.push(i);
    }
    coverAt[k + 1] = cover.length;
    halfAt[k + 1] = half.length;
    centerMiles[k] = haversineMiles(center.lat, center.lng, c.lat, c.lng);
  }

  const beyond = Uint8Array.from(current, (d) => (d <= threshold ? 0 : 1));
  const beyondHalf = Uint8Array.from(current, (d) => (d <= HALF_MILE ? 0 : 1));
  const sumBeyond = (list, at, flags, k) => {
    let n = 0;
    for (let j = at[k]; j < at[k + 1]; j++) if (flags[list[j]]) n += blocks[list[j]].pop;
    return n;
  };

  // Tie-breaks after gain: more residents newly within 1/2 mi (urban only;
  // the same order as "more residents within 1/2 mi after"), nearer the
  // population-weighted center, smaller id, then input order.
  const beats = (a, b) => {
    if (urban) {
      const ha = sumBeyond(half, halfAt, beyondHalf, a);
      const hb = sumBeyond(half, halfAt, beyondHalf, b);
      if (ha !== hb) return ha > hb;
    }
    if (centerMiles[a] !== centerMiles[b]) return centerMiles[a] < centerMiles[b];
    const byId = compareIds(pool[a].id, pool[b].id);
    return byId !== 0 ? byId < 0 : a < b;
  };

  const startVerdict = evaluateFoodAccess({ lowIncome, lowAccess: startStats.lowAccess });
  const used = new Uint8Array(pool.length);
  const picks = [];
  let flippedAt = null;
  while (picks.length < maxSites) {
    let bestGain = 0;
    let best = -1;
    for (let k = 0; k < pool.length; k++) {
      if (used[k]) continue;
      const gain = sumBeyond(cover, coverAt, beyond, k);
      if (gain === 0 || gain < bestGain) continue;
      if (gain > bestGain || beats(k, best)) {
        bestGain = gain;
        best = k;
      }
    }
    if (best < 0) break;

    used[best] = 1;
    const pick = pool[best];
    for (let i = 0; i < blocks.length; i++) {
      const d = haversineMiles(blocks[i].lat, blocks[i].lng, pick.lat, pick.lng);
      if (d < current[i]) {
        current[i] = d;
        if (d <= threshold) beyond[i] = 0;
        if (d <= HALF_MILE) beyondHalf[i] = 0;
      }
    }
    const after = populationLowAccessFromDistances(blocks, current, threshold);
    const verdictAfter = evaluateFoodAccess({ lowIncome, lowAccess: after.lowAccess });
    picks.push({
      candidate: pick,
      gain: bestGain,
      beyondAfter: after.beyond,
      shareAfter: after.share,
      lowAccessAfter: after.lowAccess,
      verdictAfter,
    });
    if (after.lowAccess === false) {
      if (startVerdict.status === 'met' && verdictAfter.status === 'not_met') flippedAt = picks.length;
      break;
    }
  }
  return { picks, flippedAt, reason: picks.length ? null : 'no_gain' };
}

// blocks: access.blocks ({ pop, hu, lat, lng, miles }, baseline miles).
// threshold: access.threshold (T miles). lowIncome: access.lowIncome.
// candidates: [{ id, lat, lng, label, kind, sqft?, name? }]; omitted or
//   empty means the tract's populated block internal points, which are also
//   the fallback when no candidate gains anyone. Candidates without a valid
//   point or a string / finite-number id are dropped.
// existingPins: [{ lat, lng, format }]; counting ('s' or missing) pins are
//   applied first, so suggestions build on the user's scenario.
// maxSites: a positive integer (RangeError otherwise).
// -> { source: 'commercial' | 'blocks',
//      picks: [{ candidate, gain, beyondAfter, shareAfter, lowAccessAfter, verdictAfter }],
//      flippedAt: number | null, reason: null | 'not_low_access' | 'no_gain' | 'unknown_baseline' }
// Stops at maxSites, at gain 0, or after the pick that ends low access.
// flippedAt is the number of picks after which the verdict goes from MET to
// NOT MET (the scenario engine's `flipped`); null when it doesn't, including
// tracts that aren't low income. 'not_low_access' also covers a scenario
// whose existing pins have already ended low access. With no picks, source
// says where picks would have come from.
export function suggestSites({
  blocks,
  threshold,
  candidates,
  existingPins = [],
  maxSites = DEFAULT_MAX_SITES,
  lowIncome,
} = {}) {
  if (!Number.isInteger(maxSites) || maxSites < 1) {
    throw new RangeError(`maxSites must be a positive integer, got ${String(maxSites)}`);
  }
  const supplied = Array.isArray(candidates) ? candidates.filter((c) => validPoint(c) && validId(c?.id)) : [];
  const suppliedSource = supplied.length && !supplied.every((c) => c.kind === BLOCK_SITE_KIND) ? 'commercial' : 'blocks';
  const empty = (source, reason) => ({ source, picks: [], flippedAt: null, reason });

  const start = startingDistances(blocks, threshold, existingPins);
  if (!start) return empty(suppliedSource, 'unknown_baseline');
  const startStats = populationLowAccessFromDistances(blocks, start, threshold);
  if (startStats.lowAccess === null) return empty(suppliedSource, 'unknown_baseline');
  if (startStats.lowAccess === false) return empty(suppliedSource, 'not_low_access');

  const run = (pool) => greedy({ blocks, threshold, start, startStats, candidates: pool, maxSites, lowIncome });
  if (supplied.length) {
    const result = run(supplied);
    if (result.picks.length || suppliedSource === 'blocks') return { source: suppliedSource, ...result };
  }
  return { source: 'blocks', ...run(blockCandidates(blocks)) };
}
