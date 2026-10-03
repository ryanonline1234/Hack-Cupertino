// Point -> the 2020 census tract containing it -> USDA ERS's low-income and
// low-access test computed live on that tract's Census blocks (docs/07).
// buildCommunityData does the fetching; assembleCommunityData is the pure
// assembly so the rules can be tested without a network.
import { lookupPlace, lookupTract } from './tractLookup.js';
import { loadTractBlocks } from './blockLoader.js';
import { loadStoresNear } from './storeLoader.js';
import { loadErsTract } from './ersLoader.js';
import { defaultCdc, fetchCdcData } from './cdcFetch.js';
import { defaultCensus, fetchCensusData } from './censusFetch.js';
import { stateAbbrFromFips } from '../lib/stateCodes.js';
import {
  distanceBands,
  isBorderline,
  nearestDistances,
  nearestStore,
  populationLowAccessFromDistances,
} from '../engine/lowAccess.js';
import { evaluateFoodAccess } from '../engine/foodAccessVerdict.js';

export const URBAN_THRESHOLD_MI = 1;
export const RURAL_THRESHOLD_MI = 10;
// Stores are loaded this far around the tract; nearest distances past it are
// "over 30 mi", which is beyond either threshold anyway.
export const STORE_RADIUS_MI = 30;
// The map only needs nearby stores; the scenario uses each block's stored
// baseline distance instead, so it stays exact for rural T = 10 mi.
export const MAP_STORE_MARGIN_MI = 5;
// Puerto Rico (72), American Samoa (60) and the Northern Mariana Islands (69)
// run nutrition block grants (Puerto Rico's NAP and its equivalents) instead
// of SNAP, so USDA's SNAP retailer list, the store set this test counts, has
// no stores there. Distances to it would call every resident "beyond" and
// say nothing about real stores, so these tracts are never measured. Guam
// (66) and the US Virgin Islands (78) do run SNAP and have listed stores.
export const NON_SNAP_STATES = new Set(['72', '60', '69']);
// CDC PLACES and ACS feed only the community profile. Once the access inputs
// are in, the profile gets until this long after its requests started; a
// call still pending then is shown as the default profile and not cached.
export const PROFILE_DEADLINE_MS = 12_000;

const COMMUNITY_CACHE_TTL_MS = 1000 * 60 * 15;
// v3 (2026-10-02): the payload is the tract-level access test of docs/07.
// v2 entries hold the old 9-point foodAccess shape and must never be read;
// every write sweeps them (and expired v3 entries) out of localStorage.
const COMMUNITY_CACHE_FAMILY = 'fds:community:';
export const COMMUNITY_CACHE_PREFIX = 'fds:community:v3:';
const communityMemoryCache = new Map();

const MI_PER_DEG_LAT = 69;
const RAD = Math.PI / 180;

// Unknowns that a retry may fix. A payload carrying one is never cached, or
// a passing outage would stick for the whole TTL.
const FETCH_FAILURE_REASONS = new Set([
  'tract_unavailable',
  'blocks_unavailable',
  'stores_unavailable',
  'ers_unavailable',
]);
// Community-profile outcomes that may be cached: an answer, or a deployment
// without CENSUS_KEY (a retry can't fix that one).
const CACHEABLE_PROFILE = new Set(['ok', 'not_configured']);

export function resetCommunityCache() {
  communityMemoryCache.clear();
}

// ------------------------------------------------------------- assembly

function classifyUrban(e2025, blocks) {
  if (typeof e2025?.urban === 'boolean') return { urban: e2025.urban, urbanSource: 'ers_2025' };
  let urbanPop = 0;
  let ruralPop = 0;
  for (const b of blocks) {
    if (b.ur === 'U') urbanPop += b.pop;
    else if (b.ur === 'R') ruralPop += b.pop;
  }
  if (urbanPop > ruralPop) return { urban: true, urbanSource: 'block_ur' };
  if (ruralPop > urbanPop) return { urban: false, urbanSource: 'block_ur' };
  return { urban: null, urbanSource: null };
}

function boundsOf(points) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return minLat <= maxLat ? { minLat, maxLat, minLng, maxLng } : null;
}

// Box around bbox grown by `miles`, using the widest longitude degree so the
// box never comes up short at the poleward edge.
function grow(bbox, miles) {
  const dLat = miles / MI_PER_DEG_LAT;
  const edgeLat = Math.min(89, Math.max(Math.abs(bbox.minLat), Math.abs(bbox.maxLat)) + dLat);
  const dLng = miles / (MI_PER_DEG_LAT * Math.cos(edgeLat * RAD));
  return {
    minLat: bbox.minLat - dLat,
    maxLat: bbox.maxLat + dLat,
    minLng: bbox.minLng - dLng,
    maxLng: bbox.maxLng + dLng,
  };
}

const inBox = (box, s) => s.lat >= box.minLat && s.lat <= box.maxLat && s.lng >= box.minLng && s.lng <= box.maxLng;

const bool = (v) => (typeof v === 'boolean' ? v : null);
const shareFromPct = (v) => (typeof v === 'number' && Number.isFinite(v) ? v / 100 : null);
const yesNo = (v) => (v ? 'yes' : 'no');

// What a map's LILA and LA flags reveal about its income flag: LILA means
// low income; low access without LILA means not low income.
function impliedIncome({ lila, la }) {
  if (lila === true) return true;
  if (la === true && lila === false) return false;
  return null;
}

function buildReferences(ers, urban, verdict, lowIncome, lowAccess) {
  const ersDown = !ers || ers.status === 'unavailable';
  const e19 = ersDown ? null : ers.e2019;
  const e25 = ersDown || ers.status !== 'ok' ? null : ers.e2025;

  let lram2019;
  if (e19) {
    // ERS's own 2019 urban flag picks the share it published (1 mi or 10 mi).
    const urban19 = typeof e19.urban === 'boolean' ? e19.urban : urban;
    const share = urban19 === null ? null : shareFromPct(urban19 ? e19.lapop1share : e19.lapop10share);
    lram2019 = { lila: bool(e19.lila), la: bool(e19.la), share, reason: null };
  } else {
    const reason = ersDown ? 'unavailable' : ers.e2019Reason ?? 'missing_row';
    lram2019 = { lila: null, la: null, share: null, reason };
  }

  const sram2025 = e25
    ? { lila: bool(e25.sramLILA), la: bool(e25.sramLA), reason: null }
    : { lila: null, la: null, reason: ersDown ? 'unavailable' : 'missing_row' };

  return { lram2019, sram2025, differNote: differNote(verdict, lowIncome, lowAccess, lram2019, sram2025) };
}

// Names the input behind a disagreement between this estimate's verdict and
// a published map's LILA flag; null when they agree or can't be compared.
function differNote(verdict, lowIncome, lowAccess, lram2019, sram2025) {
  const ours = verdict.status === 'met' ? true : verdict.status === 'not_met' ? false : null;
  if (ours === null) return null;
  const notes = [];

  if (lram2019.lila !== null && lram2019.lila !== ours) {
    const li19 = impliedIncome(lram2019);
    if (li19 !== null && lowIncome !== null && li19 !== lowIncome) {
      notes.push(`income flag differs: 2019 ${yesNo(li19)}, 2025 ${yesNo(lowIncome)}`);
    }
    if (lram2019.la !== null && lowAccess !== null && lram2019.la !== lowAccess) {
      notes.push('access differs: the 2019 map used 2019 stores and 2010 Census population');
    }
  }

  if (sram2025.lila !== null && sram2025.lila !== ours) {
    const liSram = impliedIncome(sram2025);
    if (liSram !== null && lowIncome !== null && liSram !== lowIncome) {
      notes.push(`income flag differs: SRAM ${yesNo(liSram)}, 2025 ${yesNo(lowIncome)}`);
    }
    if (sram2025.la !== null && lowAccess !== null && sram2025.la !== lowAccess) {
      notes.push(
        lowAccess
          ? 'access differs: SRAM counts convenience and dollar stores'
          : 'access differs: the SRAM map reports low access that this supermarket-based estimate does not',
      );
    }
  }

  return notes.length ? notes.join('; ') : null;
}

// Order: no residents and no SNAP stores are permanent facts about the tract
// and outrank any load failure; failures then follow the City summary's
// order (blocks, stores, ERS) so both views name the same reason.
function accessUnknownReason({ tract, blocksResult, storesResult, ersDown, urban }) {
  if (!tract) return 'tract_unavailable';
  if (tract.pop === 0 || blocksResult?.status === 'no_residents') return 'no_residents';
  if (NON_SNAP_STATES.has(String(tract.geoid).slice(0, 2))) return 'stores_not_covered';
  if (blocksResult?.status === 'blocks_incomplete') return 'blocks_incomplete';
  if (blocksResult?.status !== 'ok') return 'blocks_unavailable';
  if (storesResult?.status !== 'ok') return 'stores_unavailable';
  // The ERS file didn't load: urban/rural is unknown. The block-UR majority
  // is only a stand-in for a MISSING row; ERS's own flag can disagree with
  // it (06085512100 is ERS-urban with rural-majority blocks).
  if (ersDown) return 'ers_unavailable';
  // Only reachable with no ERS Urban flag and no U/R majority in the blocks.
  if (urban === null) return 'urban_unavailable';
  return null;
}

function pointResult(lat, lng, storesResult, unknownReason) {
  if (unknownReason === 'stores_not_covered') return { miles: null, store: null, reason: unknownReason };
  if (storesResult?.status !== 'ok') {
    const reason = storesResult || !unknownReason ? 'stores_unavailable' : unknownReason;
    return { miles: null, store: null, reason };
  }
  const { miles, store } = nearestStore(lat, lng, storesResult.stores);
  if (!(miles <= STORE_RADIUS_MI)) return { miles: null, store: null, reason: 'over_30_mi' };
  return { miles, store, reason: null };
}

function placeMeta(placeResult) {
  const p = placeResult?.status === 'ok' ? placeResult.place : null;
  return p ? { geoid: p.geoid, name: p.name, kind: p.kind } : null;
}

// 'ok' | 'no_place' | 'unavailable'; a lookup never attempted (no tract) is
// 'unavailable', not a "no place" answer.
function placeStatus(placeResult) {
  if (placeResult?.status === 'ok' && placeResult.place) return 'ok';
  if (placeResult?.status === 'no_place') return 'no_place';
  return 'unavailable';
}

// Inputs are the loader results as returned (see the loaders for shapes):
//   tract: lookupTract(), blocks: loadTractBlocks(), stores: loadStoresNear()
//   (null when not attempted), ers: loadErsTract() (null = the call
//   rejected), place: lookupPlace(), health / demographics: CDC PLACES and
//   ACS objects, or null; profileStatus: { health, demographics } as set by
//   buildCommunityData ('ok' | 'unavailable' | 'timeout' | 'not_configured').
// Returns null only when the point is in no tract.
export function assembleCommunityData({
  lat,
  lng,
  tract: tractResult,
  blocks: blocksResult = null,
  stores: storesResult = null,
  ers = null,
  place = null,
  health = null,
  demographics = null,
  profileStatus = null,
  retrievedAt = new Date().toISOString(),
} = {}) {
  if (tractResult?.status === 'no_tract') return null;
  const tract = tractResult?.status === 'ok' ? tractResult.tract : null;

  const ersDown = Boolean(tract) && (!ers || ers.status === 'unavailable');
  const e2025 = ers?.status === 'ok' ? ers.e2025 : null;
  const lowIncome = bool(e2025?.lowIncome);
  const blocks = blocksResult?.status === 'ok' ? blocksResult.blocks : [];
  const stores = storesResult?.status === 'ok' ? storesResult.stores : [];
  const { urban, urbanSource } = ersDown ? { urban: null, urbanSource: null } : classifyUrban(e2025, blocks);
  const threshold = urban === null ? null : urban ? URBAN_THRESHOLD_MI : RURAL_THRESHOLD_MI;

  const unknownReason = accessUnknownReason({ tract, blocksResult, storesResult, ersDown, urban });
  const measurable = unknownReason !== 'stores_not_covered';
  const distances = measurable && blocks.length && storesResult?.status === 'ok' ? nearestDistances(blocks, stores) : null;

  let stats = { population: tract ? tract.pop : null, beyond: null, share: null, byShare: null, byCount: null, lowAccess: null };
  let bands = null;
  let borderline = null;
  if (!unknownReason) {
    stats = populationLowAccessFromDistances(blocks, distances, threshold);
    bands = distanceBands(blocks, distances, threshold);
    borderline = isBorderline(blocks, distances, threshold);
  }

  // USDA does not rate tracts without residents, and a tract the SNAP list
  // can't measure gets no estimate, whatever ERS says about income.
  const verdict = evaluateFoodAccess({
    lowIncome: unknownReason === 'no_residents' || unknownReason === 'stores_not_covered' ? null : lowIncome,
    lowAccess: stats.lowAccess,
    unknownReason,
  });
  const reason = unknownReason ?? (lowIncome === null ? 'income_unavailable' : null);

  // Infinity becomes null in JSON; the scenario reads null back as "no
  // counted store in range".
  const compactBlocks = blocks.map((b, i) => {
    const out = { pop: b.pop, hu: b.hu, lat: b.lat, lng: b.lng };
    if (distances) out.miles = Number.isFinite(distances[i]) ? distances[i] : null;
    return out;
  });

  const area = boundsOf([...blocks, { lat, lng }]);
  const mapBox = area && grow(area, MAP_STORE_MARGIN_MI);

  const access = {
    status: verdict.status,
    reason,
    threshold,
    urban,
    urbanSource,
    population: stats.population,
    beyond: stats.beyond,
    share: stats.share,
    byShare: stats.byShare,
    byCount: stats.byCount,
    lowAccess: stats.lowAccess,
    borderline,
    bands,
    lowIncome,
    verdict,
    references: buildReferences(tract ? ers : null, urban, verdict, lowIncome, stats.lowAccess),
    point: pointResult(lat, lng, storesResult, unknownReason),
    blocks: compactBlocks,
    blocksSource: blocksResult?.source ?? null,
    stores: mapBox ? stores.filter((s) => inBox(mapBox, s)) : [],
    storesDataset: storesResult?.status === 'ok' ? storesResult.dataset ?? null : null,
  };

  return {
    meta: {
      fips: tract?.geoid ?? null,
      stateAbbr: tract ? stateAbbrFromFips(tract.state) : null,
      stateFips: tract?.state ?? null,
      countyFips: tract ? tract.geoid.slice(0, 5) : null,
      tractName: tract?.name ?? null,
      lat,
      lng,
      place: placeMeta(place),
      placeStatus: placeStatus(place),
      profileStatus: profileStatus ?? {
        health: health ? 'ok' : 'unavailable',
        demographics: demographics ? 'ok' : 'unavailable',
      },
      retrievedAt,
    },
    access,
    health,
    demographics,
    ers: tract && ers ? ers : null,
  };
}

// ---------------------------------------------------------------- cache

// Keyed by the point (5 decimals, as the URL stores it) so a reload is served
// before any request; the verdict is per tract but `point` is per spot.
function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

function nowMs() {
  return Date.now();
}

function makeCacheMeta(status, ts) {
  const ageMs = Math.max(0, nowMs() - ts);
  return {
    status,
    ttlMs: COMMUNITY_CACHE_TTL_MS,
    ageMs,
    expiresInMs: Math.max(0, COMMUNITY_CACHE_TTL_MS - ageMs),
    cachedAt: new Date(ts).toISOString(),
  };
}

function withCacheMeta(payload, status, ts) {
  return {
    ...payload,
    meta: {
      ...payload.meta,
      cache: makeCacheMeta(status, ts),
    },
  };
}

function readLocalCache(key) {
  try {
    const raw = localStorage.getItem(`${COMMUNITY_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !parsed?.data) return null;
    if (nowMs() - parsed.ts > COMMUNITY_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storageKeys(storage) {
  const n = storage.length;
  if (!Number.isInteger(n) || typeof storage.key !== 'function') return [];
  const keys = [];
  for (let i = 0; i < n; i++) {
    const k = storage.key(i);
    if (typeof k === 'string') keys.push(k);
  }
  return keys;
}

// writeLocalCache writes `{"ts":<ms>,"data":...}`; reading ts off the front
// avoids parsing every cached payload on every write.
const TS_PREFIX = /^\{"ts":(\d+),"data":/;

function readableTs(raw) {
  if (typeof raw !== 'string') return null;
  const m = TS_PREFIX.exec(raw.slice(0, 40));
  if (m) return Number(m[1]);
  try {
    const parsed = JSON.parse(raw);
    return parsed?.ts && parsed?.data ? parsed.ts : null;
  } catch {
    return null;
  }
}

// Removes community entries that can never be served: older prefixes (v1/v2
// shapes), expired or unreadable v3 entries. With `all`, every community
// entry except `keep` goes (the quota retry: they're only a 15-minute cache).
function sweepCommunityCache(storage, keep, all = false) {
  for (const k of storageKeys(storage)) {
    if (!k.startsWith(COMMUNITY_CACHE_FAMILY) || k === keep) continue;
    let drop = all || !k.startsWith(COMMUNITY_CACHE_PREFIX);
    if (!drop) {
      const ts = readableTs(storage.getItem(k));
      drop = ts === null || nowMs() - ts > COMMUNITY_CACHE_TTL_MS;
    }
    if (drop) {
      try {
        storage.removeItem(k);
      } catch {
        // Keep sweeping.
      }
    }
  }
}

function isQuotaError(err) {
  return err?.name === 'QuotaExceededError'
    || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || err?.code === 22
    || err?.code === 1014;
}

function writeLocalCache(key, ts, data) {
  let storage;
  let value;
  try {
    storage = globalThis.localStorage;
    if (!storage) return;
    value = JSON.stringify({ ts, data });
  } catch {
    return; // private mode / blocked storage
  }
  const fullKey = `${COMMUNITY_CACHE_PREFIX}${key}`;
  try {
    sweepCommunityCache(storage, fullKey);
  } catch {
    // A failed sweep must not stop the write.
  }
  try {
    storage.setItem(fullKey, value);
    return;
  } catch (err) {
    if (!isQuotaError(err)) return;
  }
  try {
    sweepCommunityCache(storage, fullKey, true);
    storage.setItem(fullKey, value);
  } catch {
    // Still full: this payload just isn't cached.
  }
}

// --------------------------------------------------------------- fetching

const settledValue = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);

const TIMED_OUT = Symbol('profile deadline');

// Waits for the profile calls until `deadline` resolves; a call still pending
// then becomes the default profile with status 'timeout'.
async function settleProfile(calls, deadline, defaults) {
  const out = {};
  await Promise.all(Object.entries(calls).map(async ([name, promise]) => {
    // A call that has already answered wins even when the deadline has also
    // passed: race() takes the first settled entry in array order.
    const r = await Promise.race([promise, deadline]).catch(() => null);
    if (r === TIMED_OUT) out[name] = { status: 'timeout', data: defaults[name]() };
    else if (r && typeof r.status === 'string' && r.data) out[name] = r;
    else out[name] = { status: 'unavailable', data: defaults[name]() };
  }));
  return out;
}

export async function buildCommunityData(lat, lng, options = {}) {
  const { forceRefresh = false, profileDeadlineMs = PROFILE_DEADLINE_MS } = options;
  lat = Number(lat);
  lng = Number(lng);
  const key = cacheKey(lat, lng);

  if (!forceRefresh) {
    const memoryHit = communityMemoryCache.get(key);
    if (memoryHit && nowMs() - memoryHit.ts <= COMMUNITY_CACHE_TTL_MS) {
      return withCacheMeta(memoryHit.data, 'memory', memoryHit.ts);
    }

    const localHit = readLocalCache(key);
    if (localHit) {
      communityMemoryCache.set(key, localHit);
      return withCacheMeta(localHit.data, 'local', localHit.ts);
    }
  }

  const tractResult = await lookupTract(lat, lng).catch(() => ({ status: 'unavailable' }));
  if (tractResult.status === 'no_tract') return null;

  let parts = {};
  if (tractResult.status === 'ok') {
    const { tract } = tractResult;
    // The community profile (CDC PLACES, ACS) starts now, alongside the
    // access inputs, but only the access inputs are awaited in full.
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(0, profileDeadlineMs), TIMED_OUT);
    });
    try {
      const profileCalls = {
        health: fetchCdcData(stateAbbrFromFips(tract.state), tract.geoid),
        demographics: fetchCensusData(tract.geoid),
      };
      // Stores wait for the blocks so the tiles cover the tract's residents;
      // everything else runs alongside, and each part fails on its own.
      const blocksPromise = loadTractBlocks(tract).catch(() => ({ status: 'blocks_unavailable', blocks: [], population: null }));
      const storesPromise = blocksPromise.then((b) => {
        const area = boundsOf([...(b.status === 'ok' ? b.blocks : []), { lat, lng }]);
        return loadStoresNear(area, STORE_RADIUS_MI);
      });
      const [blocks, stores, ers, place] = await Promise.allSettled([
        blocksPromise,
        storesPromise,
        loadErsTract(tract.geoid),
        lookupPlace(lat, lng),
      ]);
      const profile = await settleProfile(profileCalls, deadline, { health: defaultCdc, demographics: defaultCensus });
      parts = {
        blocks: settledValue(blocks, { status: 'blocks_unavailable', blocks: [], population: null }),
        stores: settledValue(stores, { status: 'stores_unavailable', stores: [], dataset: null }),
        // A rejected ERS call is an outage, the same as status 'unavailable'.
        ers: settledValue(ers, null),
        place: settledValue(place, { status: 'unavailable', place: null }),
        health: profile.health.data,
        demographics: profile.demographics.data,
        profileStatus: { health: profile.health.status, demographics: profile.demographics.status },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const payload = assembleCommunityData({ lat, lng, tract: tractResult, ...parts });
  const ts = nowMs();
  const cacheable =
    !FETCH_FAILURE_REASONS.has(payload.access.reason) &&
    parts.blocks?.status !== 'blocks_unavailable' &&
    parts.stores?.status === 'ok' &&
    parts.ers != null &&
    parts.ers.status !== 'unavailable' &&
    parts.place?.status !== 'unavailable' &&
    CACHEABLE_PROFILE.has(parts.profileStatus?.health) &&
    CACHEABLE_PROFILE.has(parts.profileStatus?.demographics);
  if (cacheable) {
    communityMemoryCache.set(key, { ts, data: payload });
    writeLocalCache(key, ts, payload);
  }

  return withCacheMeta(payload, 'fresh', ts);
}
