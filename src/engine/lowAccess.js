// USDA ERS low-access rule on Census blocks: a block's residents are "beyond"
// when the block's internal point is more than T miles (straight line) from
// the nearest counted store; a tract is low access when >= 33% or >= 500 of
// its residents are beyond. Pure functions, no fetch.
import { EARTH_RADIUS_MILES, haversineMiles } from '../lib/geo.js';

export const SHARE_THRESHOLD = 0.33;
export const COUNT_THRESHOLD = 500;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
// ~3.5 mi of latitude. Urban lookups touch a few cells; rural ones (nearest
// store 20-30 mi out) a few hundred array slots, which is still cheap.
const CELL_DEG = 0.05;
// Bounds the dense cell table if someone passes a continent of stores.
const MAX_CELLS = 4_000_000;
// Slack on the search box so float rounding can't drop a store sitting at
// exactly the current best distance (1e-7 degrees is about 1 cm).
const BOX_EPS_DEG = 1e-7;

// Stores bucketed into a dense lat/lng grid over their bounding box, laid out
// CSR-style: the stores of cell c are slots start[c] .. start[c + 1] - 1.
function buildStoreIndex(stores) {
  const kept = [];
  for (const s of stores) {
    if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng)) kept.push(s);
  }
  const n = kept.length;
  if (n === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const s of kept) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  }
  const cell = Math.max(CELL_DEG, Math.sqrt(((maxLat - minLat) * (maxLng - minLng)) / MAX_CELLS));
  const y0 = Math.floor(minLat / cell);
  const x0 = Math.floor(minLng / cell);
  const ny = Math.floor(maxLat / cell) - y0 + 1;
  const nx = Math.floor(maxLng / cell) - x0 + 1;

  const start = new Int32Array(ny * nx + 1);
  const cellOf = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const c = (Math.floor(kept[k].lat / cell) - y0) * nx + (Math.floor(kept[k].lng / cell) - x0);
    cellOf[k] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < ny * nx; c++) start[c + 1] += start[c];

  const next = start.slice(0, ny * nx);
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const ref = new Array(n);
  for (let k = 0; k < n; k++) {
    const slot = next[cellOf[k]]++;
    lat[slot] = kept[k].lat;
    lng[slot] = kept[k].lng;
    ref[slot] = kept[k];
  }
  return { cell, y0, x0, ny, nx, start, lat, lng, ref };
}

function scanCells(index, qLat, qLng, yLo, yHi, xLo, xHi, best) {
  const { nx, ny, start, lat, lng } = index;
  if (yLo < 0) yLo = 0;
  if (xLo < 0) xLo = 0;
  if (yHi > ny - 1) yHi = ny - 1;
  if (xHi > nx - 1) xHi = nx - 1;
  for (let y = yLo; y <= yHi; y++) {
    const row = y * nx;
    for (let x = xLo; x <= xHi; x++) {
      for (let k = start[row + x], end = start[row + x + 1]; k < end; k++) {
        const d = haversineMiles(qLat, qLng, lat[k], lng[k]);
        if (d < best.miles) {
          best.miles = d;
          best.slot = k;
        }
      }
    }
  }
}

function scanAll(index, qLat, qLng, best) {
  for (let k = 0; k < index.lat.length; k++) {
    const d = haversineMiles(qLat, qLng, index.lat[k], index.lng[k]);
    if (d < best.miles) {
      best.miles = d;
      best.slot = k;
    }
  }
}

// Exact nearest store. Phase 1 grows square rings of cells around the query
// until any store turns up, giving an upper bound. Phase 2 scans every cell
// that could hold a store within that bound: |dLat| <= d/R, and |dLng| <=
// asin(sin(d/R) / cos(lat)) while the circle stays clear of the poles.
function queryNearest(index, qLat, qLng, best) {
  best.miles = Infinity;
  best.slot = -1;
  const { cell, y0, x0, ny, nx } = index;
  const gy = Math.floor(qLat / cell) - y0;
  const gx = Math.floor(qLng / cell) - x0;

  const outY = gy < 0 ? -gy : gy >= ny ? gy - ny + 1 : 0;
  const outX = gx < 0 ? -gx : gx >= nx ? gx - nx + 1 : 0;
  const rMax = Math.max(gy, ny - 1 - gy, gx, nx - 1 - gx);
  for (let r = Math.max(outY, outX); r <= rMax && best.slot < 0; r++) {
    if (r === 0) {
      scanCells(index, qLat, qLng, gy, gy, gx, gx, best);
      continue;
    }
    scanCells(index, qLat, qLng, gy - r, gy - r, gx - r, gx + r, best);
    scanCells(index, qLat, qLng, gy + r, gy + r, gx - r, gx + r, best);
    scanCells(index, qLat, qLng, gy - r + 1, gy + r - 1, gx - r, gx - r, best);
    scanCells(index, qLat, qLng, gy - r + 1, gy + r - 1, gx + r, gx + r, best);
  }

  const dRad = best.miles / EARTH_RADIUS_MILES;
  const dLatDeg = dRad * DEG + BOX_EPS_DEG;
  let xLo = 0;
  let xHi = nx - 1;
  if (Math.abs(qLat) + dLatDeg < 90) {
    const s = Math.sin(dRad) / Math.cos(qLat * RAD);
    if (s < 1) {
      const dLngDeg = Math.asin(s) * DEG + BOX_EPS_DEG;
      // The grid doesn't wrap at +/-180 deg; fall back to scanning everything.
      if (qLng - dLngDeg < -180 || qLng + dLngDeg > 180) {
        scanAll(index, qLat, qLng, best);
        return best;
      }
      xLo = Math.floor((qLng - dLngDeg) / cell) - x0;
      xHi = Math.floor((qLng + dLngDeg) / cell) - x0;
    }
  }
  const yLo = Math.floor((qLat - dLatDeg) / cell) - y0;
  const yHi = Math.floor((qLat + dLatDeg) / cell) - y0;
  scanCells(index, qLat, qLng, yLo, yHi, xLo, xHi, best);
  return best;
}

// Miles from each block to its nearest store: Infinity when there are no
// stores, NaN for a block without valid coordinates.
export function nearestDistances(blocks, stores) {
  const out = new Float64Array(blocks.length);
  const index = buildStoreIndex(stores);
  if (!index) return out.fill(Infinity);
  const best = { miles: Infinity, slot: -1 };
  for (let i = 0; i < blocks.length; i++) {
    const { lat, lng } = blocks[i];
    out[i] = Number.isFinite(lat) && Number.isFinite(lng) ? queryNearest(index, lat, lng, best).miles : NaN;
  }
  return out;
}

// One query doesn't repay building the grid; a linear scan is O(stores) too.
// Skips the same invalid stores the grid does, so both agree on the set.
export function nearestStore(lat, lng, stores) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { miles: NaN, store: null };
  let miles = Infinity;
  let store = null;
  for (const s of stores) {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const d = haversineMiles(lat, lng, s.lat, s.lng);
    if (d < miles) {
      miles = d;
      store = s;
    }
  }
  return { miles, store };
}

function assertAligned(blocks, distances) {
  if (distances.length !== blocks.length) {
    throw new RangeError(`distances (${distances.length}) must align with blocks (${blocks.length})`);
  }
}

// A distance that isn't a number (NaN) is never counted as within T; the
// block loader is expected to reject such blocks before they get here.
export function populationLowAccessFromDistances(blocks, distances, thresholdMi) {
  assertAligned(blocks, distances);
  let population = 0;
  let beyond = 0;
  for (let i = 0; i < blocks.length; i++) {
    const { pop } = blocks[i];
    if (!(pop > 0)) continue;
    population += pop;
    if (!(distances[i] <= thresholdMi)) beyond += pop;
  }
  if (population === 0) {
    return { population: 0, beyond: 0, share: null, byShare: null, byCount: null, lowAccess: null };
  }
  const share = beyond / population;
  const byShare = share >= SHARE_THRESHOLD;
  const byCount = beyond >= COUNT_THRESHOLD;
  return { population, beyond, share, byShare, byCount, lowAccess: byShare || byCount };
}

export function populationLowAccess(blocks, stores, thresholdMi) {
  return populationLowAccessFromDistances(blocks, nearestDistances(blocks, stores), thresholdMi);
}

// T * 11 / 10 rather than T * 1.1 so T = 10 gives 11, not 11.000000000000002.
export function distanceBands(blocks, distances, thresholdMi) {
  assertAligned(blocks, distances);
  const t = thresholdMi;
  const t11 = (t * 11) / 10;
  const t15 = (t * 3) / 2;
  const residents = [0, 0, 0];
  for (let i = 0; i < blocks.length; i++) {
    const { pop } = blocks[i];
    if (!(pop > 0)) continue;
    const d = distances[i];
    if (d <= t) continue;
    if (d <= t11) residents[0] += pop;
    else if (d <= t15) residents[1] += pop;
    else residents[2] += pop;
  }
  return [
    { fromMi: t, toMi: t11, residents: residents[0] },
    { fromMi: t11, toMi: t15, residents: residents[1] },
    { fromMi: t15, toMi: null, residents: residents[2] },
  ];
}

export function isBorderline(blocks, distances, thresholdMi) {
  const tight = populationLowAccessFromDistances(blocks, distances, (thresholdMi * 9) / 10);
  const loose = populationLowAccessFromDistances(blocks, distances, (thresholdMi * 11) / 10);
  return tight.lowAccess !== loose.lowAccess;
}
