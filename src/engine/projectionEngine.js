import { CORRELATIONS, SOURCES } from './correlations.js';
import { summarizeSimulation } from './simulationEngine.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

/*
 * Census fields are nullable now (see src/pipeline/censusFetch.js): null means
 * the source had no value for this tract, as distinct from a real zero. Any
 * projection derived from a missing input has to stay null rather than quietly
 * becoming 0, or the UI presents "no data" as a finding of "no impact".
 */
function isNum(value) {
  return Number.isFinite(value);
}

function summaryNumber(value, { digits = 0, prefix = '' } = {}) {
  if (!isNum(value)) return 'an unknown number of';
  return `${prefix}${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function toExecutiveSummary({ simulation, pctLowAccessReduction, commuteHoursSavedAnnual, annualLocalImpact, diabetesReductionPct }) {
  const lines = [
    `Placed infrastructure coverage score is ${(simulation.coverageScore * 100).toFixed(0)}%, cutting low-access burden by approximately ${pctLowAccessReduction.toFixed(1)} percentage points in this tract.`,
  ];

  lines.push(
    isNum(commuteHoursSavedAnnual)
      ? `Projected travel friction drops enough to save about ${summaryNumber(commuteHoursSavedAnnual)} household commute-hours per year.`
      : 'Commute-hours saved cannot be estimated: household counts are unavailable for this tract.',
  );

  lines.push(
    isNum(annualLocalImpact)
      ? `Modeled local impact is about ${summaryNumber(annualLocalImpact, { prefix: '$' })} annually, with diabetes prevalence improving by roughly ${diabetesReductionPct.toFixed(2)} percentage points.`
      : `Local economic impact cannot be estimated without tract population; diabetes prevalence would improve by roughly ${diabetesReductionPct.toFixed(2)} percentage points.`,
  );

  return lines;
}

export function projectImpact(communityData, scenario = {}) {
  if (!communityData) return null;

  const { foodAccess, health, demographics, meta } = communityData;
    const foodDesertForModel = foodAccess.isFoodDesert == null
      ? Boolean(foodAccess.modelFoodDesertAssumption)
      : Boolean(foodAccess.isFoodDesert);

  const { pctLowAccess1mi, pctLowAccess10mi, pctNoVehicleLowAccess } = foodAccess;
  const { diabetes, obesity } = health;
  const { population, adultPopulation, households, noVehicleHouseholds, medianIncome, pctPoverty } = demographics;

  const qualifyingLowAccessPct = Number(
    foodAccess.qualifyingLowAccessPct ||
      (foodAccess.isRural ? pctLowAccess10mi : pctLowAccess1mi) ||
      0
  );

  const simulation = summarizeSimulation({
    center: scenario.center || { lat: meta?.lat, lng: meta?.lng },
    pins: scenario.pins || [],
  });

  const lowAccessIntensity = clamp01((qualifyingLowAccessPct + pctNoVehicleLowAccess * 0.7) / 100);
  const povertyIntensity = clamp01((pctPoverty || 0) / 35);
  const incomeScale = clamp01((medianIncome || 0) / 90_000);

  const accessReductionFactor = clamp(
    simulation.coverageScore * (0.28 + lowAccessIntensity * 0.47),
    0.08,
    0.78,
  );
  const pctLowAccessReduction = qualifyingLowAccessPct * accessReductionFactor;
  const residentsGainingAccess = isNum(population)
    ? Math.round(population * (pctLowAccessReduction / 100))
    : null;
  const noVehicleHouseholdsHelped = isNum(noVehicleHouseholds)
    ? Math.round(
      noVehicleHouseholds * clamp(simulation.coverageScore * (0.35 + lowAccessIntensity * 0.4), 0.08, 0.85),
    )
    : null;

  const healthEffectFactor = clamp(simulation.coverageScore * (0.35 + lowAccessIntensity * 0.65), 0.08, 1);
  const diabetesReductionPct = diabetes * CORRELATIONS.diabetesReductionRelative * healthEffectFactor;
  const obesityReductionPct = obesity * CORRELATIONS.obesityReductionRelative * healthEffectFactor;

  /*
   * Diabetes cases avoided.
   *
   * Two problems with the previous version:
   *   `Math.round(population * (diabetes/100) * (diabetesReductionPct / Math.max(diabetes, 0.1)) * 0.55)`
   *
   * 1. Wrong denominator. `population` is ACS B01003_001E — every resident,
   *    including children. CDC PLACES diabetes prevalence is measured among
   *    adults 18+, so children were being counted as cases avoidable. We now
   *    use the 18+ population (ACS B09021_001E).
   * 2. Obscured algebra. diabetesReductionPct is itself
   *    `diabetes * diabetesReductionRelative * healthEffectFactor`, so the
   *    `diabetesReductionPct / diabetes` term cancels to exactly
   *    `diabetesReductionRelative * healthEffectFactor`. Written out, the
   *    expression says what it means.
   *
   * The trailing 0.55 is a persistence haircut: not everyone who gains access
   * sustains the dietary change. It is a modeling assumption, not a measured
   * value — see src/engine/correlations.js.
   */
  const DIABETES_PERSISTENCE_FACTOR = 0.55;
  const diabetesCasesAvoided = isNum(adultPopulation)
    ? Math.round(
      adultPopulation
        * (diabetes / 100)
        * CORRELATIONS.diabetesReductionRelative
        * healthEffectFactor
        * DIABETES_PERSISTENCE_FACTOR,
    )
    : null;

  // Economic demand is bounded by access need and a practical one-store revenue ceiling.
  const captureRate = clamp(
    0.05 + simulation.coverageScore * 0.2 + lowAccessIntensity * 0.08 - povertyIntensity * 0.06,
    0.04,
    0.28,
  );
  const perCapitaSpend = CORRELATIONS.perCapitaGrocerySpend * (0.78 + incomeScale * 0.27);
  const accessNeedFactor = clamp(qualifyingLowAccessPct / 100, 0.2, 1);
  const annualRevenueCap = CORRELATIONS.avgGroceryAnnualRevenue * (0.7 + incomeScale * 0.6);
  // Every figure below is per-resident demand, so without a population count
  // there is nothing to project. Null beats a confident $0.
  const annualCapturedSalesRaw = isNum(population)
    ? population * perCapitaSpend * captureRate * accessNeedFactor
    : null;
  const annualCapturedSales = isNum(annualCapturedSalesRaw)
    ? Math.min(annualCapturedSalesRaw, annualRevenueCap)
    : null;
  const annualCapturedSalesCapped = isNum(annualCapturedSalesRaw)
    && annualCapturedSalesRaw > annualCapturedSales;
  const annualLocalImpact = isNum(annualCapturedSales)
    ? Math.round(annualCapturedSales * CORRELATIONS.economicMultiplier)
    : null;

  const baseJobs = isNum(annualCapturedSales)
    ? annualCapturedSales / CORRELATIONS.revenuePerJob
    : null;
  const jobsMin = isNum(baseJobs) ? Math.max(3, Math.floor(baseJobs * 0.8)) : null;
  const jobsMax = isNum(baseJobs) ? Math.max(jobsMin + 2, Math.ceil(baseJobs * 1.2)) : null;

  const hourlyWage = medianIncome > 0
    ? clamp(medianIncome / 2080, 10, 65)
    : CORRELATIONS.defaultHourlyWage;

  const baselineTravelMinutes = clamp(12 + qualifyingLowAccessPct * 0.45 + pctNoVehicleLowAccess * 0.38, 8, 70);
  const travelDropRate = clamp(simulation.coverageScore * (0.38 + lowAccessIntensity * 0.36), 0.1, 0.72);
  const newTravelMinutes = baselineTravelMinutes * (1 - travelDropRate);

  const baseBasketCost = CORRELATIONS.baseBasketCost;
  const conveniencePremiumBefore = baseBasketCost * (foodDesertForModel ? 0.15 : 0.07);
  const conveniencePremiumAfter = conveniencePremiumBefore * (1 - clamp(simulation.coverageScore * 0.78, 0.12, 0.88));

  const timeSurchargeBefore = (baselineTravelMinutes / 60) * hourlyWage;
  const timeSurchargeAfter = (newTravelMinutes / 60) * hourlyWage;

  const totalAccessCostBefore = baseBasketCost + conveniencePremiumBefore + timeSurchargeBefore;
  const totalAccessCostAfter = baseBasketCost + conveniencePremiumAfter + timeSurchargeAfter;

  /*
   * Commute-hours saved per year.
   *
   * This previously read:
   *   const householdsAffected = population * clamp01(qualifyingLowAccessPct / 100);
   *
   * The name said households; the value was people. Multiplying that by 52
   * trips a year asserted that every resident — including children — makes a
   * weekly grocery run, overstating the headline figure by roughly average
   * household size (~2.5x). Grocery trips are a per-household behaviour, so
   * the count has to be households (ACS B11001_001E).
   */
  const householdsAffected = isNum(households)
    ? households * clamp01(qualifyingLowAccessPct / 100)
    : null;
  const commuteHoursSavedAnnual = isNum(householdsAffected)
    ? householdsAffected * CORRELATIONS.groceryTripsPerYear * Math.max((baselineTravelMinutes - newTravelMinutes) / 60, 0)
    : null;

  const executiveSummary = toExecutiveSummary({
    simulation,
    pctLowAccessReduction,
    commuteHoursSavedAnnual,
    annualLocalImpact,
    diabetesReductionPct,
  });

  return {
    foodAccess: {
      pctLowAccessReduction,
      residentsGainingAccess,
      noVehicleHouseholdsHelped,
    },
    health: {
      diabetesNewRate: Math.max(diabetes - diabetesReductionPct, 0),
      diabetesReductionPct,
      obesityNewRate: Math.max(obesity - obesityReductionPct, 0),
      obesityReductionPct,
      estimatedCasesAvoided: diabetesCasesAvoided,
    },
    economic: {
      jobsMin,
      jobsMax,
      annualLocalImpact,
      annualCapturedSales: isNum(annualCapturedSales) ? Math.round(annualCapturedSales) : null,
      annualCapturedSalesRaw: isNum(annualCapturedSalesRaw) ? Math.round(annualCapturedSalesRaw) : null,
      annualRevenueCap: Math.round(annualRevenueCap),
      annualCapturedSalesCapped,
      captureRate,
    },
    trueCost: {
      baseBasketCost,
      hourlyWage,
      baselineTravelMinutes,
      newTravelMinutes,
      timeSurchargeBefore,
      timeSurchargeAfter,
      conveniencePremiumBefore,
      conveniencePremiumAfter,
      totalAccessCostBefore,
      totalAccessCostAfter,
      tripSavings: totalAccessCostBefore - totalAccessCostAfter,
      foodDesertAssumptionUsed: foodDesertForModel,
      foodDesertAssumptionMethod: foodAccess.modelFoodDesertAssumptionMethod || 'model_assumption_final_designation',
    },
    simulation: {
      ...simulation,
      commuteHoursSavedAnnual,
      executiveSummary,
    },
    sources: SOURCES,
  };
}
