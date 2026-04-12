import { coordsToGeo } from './geocoder.js';
import { getUsdaData } from './usdaFetch.js';
import { getCdcData } from './cdcFetch.js';
import { getCensusData } from './censusFetch.js';
import { getNearestSupermarketDistance } from './storeDistanceFetch.js';
import { evaluateFoodDesertDesignation } from '../engine/foodDesertEvaluation.js';

const COMMUNITY_CACHE_TTL_MS = 1000 * 60 * 15;
const COMMUNITY_CACHE_PREFIX = 'fds:community:';
const communityMemoryCache = new Map();

function cacheKey(fips, lat, lng) {
  return `${fips}:${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
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

function writeLocalCache(key, ts, data) {
  try {
    localStorage.setItem(`${COMMUNITY_CACHE_PREFIX}${key}`, JSON.stringify({ ts, data }));
  } catch {
    // Ignore quota/private-mode failures.
  }
}

export async function buildCommunityData(lat, lng, options = {}) {
  const { forceRefresh = false } = options;
  const geo = await coordsToGeo(lat, lng);
  if (!geo) return null;

  const { fips, stateAbbr, zip } = geo;
  const key = cacheKey(fips, lat, lng);

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

  const [usdaData, cdcData, censusData, storeDistanceData] = await Promise.all([
    getUsdaData(fips),
    getCdcData(stateAbbr, fips),
    getCensusData(fips),
    getNearestSupermarketDistance(lat, lng),
  ]);

  const qualifyingLowAccessPct = Number(
    usdaData.qualifyingLowAccessPct ||
      (usdaData.isRural ? usdaData.pctLowAccess10mi : usdaData.pctLowAccess1mi) ||
      0
  );
  const lowAccessPopulationCount = Number(usdaData.lowAccessPopulationCount || 0);
  const lowAccessByShare = qualifyingLowAccessPct >= 33;
  const lowAccessByCount = lowAccessPopulationCount >= 500;
  const isLowAccess = lowAccessByShare || lowAccessByCount;

  const lowIncomeByPoverty =
    Boolean(usdaData.lowIncomeByPoverty) || Number(censusData.pctPoverty || 0) >= 20;

  const tractMedianFamilyIncome = Number(usdaData.medianFamilyIncome || 0);
  const stateMedianFamilyIncome = Number(censusData.stateMedianFamilyIncome || 0);
  const incomeThreshold80Pct = stateMedianFamilyIncome > 0 ? stateMedianFamilyIncome * 0.8 : 0;
  const lowIncomeByIncomeThreshold =
    tractMedianFamilyIncome > 0 &&
    incomeThreshold80Pct > 0 &&
    tractMedianFamilyIncome <= incomeThreshold80Pct;

  const isLowIncome = lowIncomeByPoverty || lowIncomeByIncomeThreshold;

  const communityAverageSupermarketMiles = Number.isFinite(storeDistanceData?.communityAverageSupermarketMiles)
    ? Number(storeDistanceData.communityAverageSupermarketMiles)
    : (Number.isFinite(storeDistanceData?.nearestSupermarketMiles)
      ? Number(storeDistanceData.nearestSupermarketMiles)
      : null);

  const centerNearestSupermarketMiles = Number.isFinite(storeDistanceData?.centerNearestSupermarketMiles)
    ? Number(storeDistanceData.centerNearestSupermarketMiles)
    : null;

  const designation = evaluateFoodDesertDesignation({
    isRural: usdaData.isRural,
    nearestSupermarketMiles: communityAverageSupermarketMiles,
    isTwentyFivePlusMiles: storeDistanceData?.isTwentyFivePlusMiles,
    usdaLilaFlag: usdaData.usdaLilaFlag,
    unavailableMode: 'unknown',
  });

  const modelFoodDesertAssumption = designation.isFoodDesert == null
    ? Boolean(usdaData.usdaLilaFlag)
    : designation.isFoodDesert;

  const modelFoodDesertAssumptionMethod = designation.isFoodDesert == null
    ? 'model_assumption_usda_fallback'
    : 'model_assumption_final_designation';

  const vehicleAccessConcern =
    Number(censusData.noVehicleHouseholds || 0) >= 100 &&
    Number(usdaData.pctNoVehicleLowAccess || 0) > 0;

  const foodAccess = {
    ...usdaData,
    isFoodDesert: designation.isFoodDesert,
    finalDesignation: designation.finalDesignation,
    distanceDesignation: designation.distanceDesignation,
    usdaDesignation: designation.usdaDesignation,
    sourceDisagreement: designation.sourceDisagreement,
    sourceAgreement: designation.sourceAgreement,
    sourceComparable: designation.sourceComparable,
    designationMethod: designation.designationMethod,
    lowAccessByShare,
    lowAccessByCount,
    isLowAccess,
    lowIncomeByPoverty,
    lowIncomeByIncomeThreshold,
    isLowIncome,
    incomeThreshold80Pct,
    stateMedianFamilyIncome,
    vehicleAccessConcern,
    distanceThresholdMiles: designation.distanceThresholdMiles,
    distanceRuleEvaluable: designation.distanceRuleEvaluable,
    isFoodDesertByDistanceRule: designation.isFoodDesertByDistanceRule,
    nearestSupermarketMiles: designation.nearestSupermarketMiles,
    communityAverageSupermarketMiles,
    centerNearestSupermarketMiles,
    distanceModel: storeDistanceData?.distanceModel || 'community_average_sampled',
    communityDistanceSampleCount: Number(storeDistanceData?.communityDistanceSampleCount || 0),
    isTwentyFivePlusMiles: storeDistanceData?.isTwentyFivePlusMiles ?? null,
    nearestDistanceCheckedRadiusMiles: storeDistanceData?.checkedRadiusMiles ?? 50,
    nearestDistanceSource: storeDistanceData?.source || 'unavailable',
    modelFoodDesertAssumption,
    modelFoodDesertAssumptionMethod,
  };

  const payload = {
    meta: {
      fips,
      zip,
      lat,
      lng,
      stateAbbr,
      retrievedAt: new Date().toISOString(),
    },
    foodAccess,
    health: { ...cdcData },
    demographics: { ...censusData },
  };

  const ts = nowMs();
  const cacheEntry = { ts, data: payload };
  communityMemoryCache.set(key, cacheEntry);
  writeLocalCache(key, ts, payload);

  return withCacheMeta(payload, 'fresh', ts);
}
