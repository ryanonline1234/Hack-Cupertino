import { CORRELATIONS, SOURCES } from './correlations.js';
import { summarizeSimulation } from './simulationEngine.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function toExecutiveSummary({ simulation, pctLowAccessReduction, commuteHoursSavedAnnual, annualLocalImpact, diabetesReductionPct }) {
  return [
    `Placed infrastructure coverage score is ${(simulation.coverageScore * 100).toFixed(0)}%, cutting low-access burden by approximately ${pctLowAccessReduction.toFixed(1)} percentage points in this tract.`,
    `Projected travel friction drops enough to save about ${Math.round(commuteHoursSavedAnnual).toLocaleString()} neighborhood commute-hours per year.`,
    `Modeled local impact is about $${Math.round(annualLocalImpact).toLocaleString()} annually, with diabetes prevalence improving by roughly ${diabetesReductionPct.toFixed(2)} percentage points.`,
  ];
}

export function projectImpact(communityData, scenario = {}) {
  if (!communityData) return null;

  const { foodAccess, health, demographics, meta } = communityData;
  const { pctLowAccess1mi, pctNoVehicleLowAccess } = foodAccess;
  const { diabetes, obesity } = health;
  const { population, noVehicleHouseholds, medianIncome, pctPoverty } = demographics;

  const simulation = summarizeSimulation({
    center: scenario.center || { lat: meta?.lat, lng: meta?.lng },
    pins: scenario.pins || [],
  });

  const lowAccessIntensity = clamp01((pctLowAccess1mi + pctNoVehicleLowAccess * 0.7) / 100);
  const povertyIntensity = clamp01((pctPoverty || 0) / 35);
  const incomeScale = clamp01((medianIncome || 0) / 90_000);

  const accessReductionFactor = clamp(
    simulation.coverageScore * (0.28 + lowAccessIntensity * 0.47),
    0.08,
    0.78,
  );
  const pctLowAccessReduction = pctLowAccess1mi * accessReductionFactor;
  const residentsGainingAccess = Math.round(population * (pctLowAccessReduction / 100));
  const noVehicleHouseholdsHelped = Math.round(
    noVehicleHouseholds * clamp(simulation.coverageScore * (0.35 + lowAccessIntensity * 0.4), 0.08, 0.85),
  );

  const healthEffectFactor = clamp(simulation.coverageScore * (0.35 + lowAccessIntensity * 0.65), 0.08, 1);
  const diabetesReductionPct = diabetes * CORRELATIONS.diabetesReductionRelative * healthEffectFactor;
  const obesityReductionPct = obesity * CORRELATIONS.obesityReductionRelative * healthEffectFactor;

  const diabetesCasesAvoided = Math.round(population * (diabetes / 100) * (diabetesReductionPct / Math.max(diabetes, 0.1)) * 0.55);

  const captureRate = clamp(0.07 + simulation.coverageScore * 0.3 + lowAccessIntensity * 0.1 - povertyIntensity * 0.05, 0.06, 0.45);
  const perCapitaSpend = CORRELATIONS.perCapitaGrocerySpend * (0.85 + incomeScale * 0.35);
  const annualCapturedSales = population * perCapitaSpend * captureRate;
  const annualLocalImpact = Math.round(annualCapturedSales * CORRELATIONS.economicMultiplier);

  const baseJobs = annualCapturedSales / CORRELATIONS.revenuePerJob;
  const jobsMin = Math.max(3, Math.floor(baseJobs * 0.8));
  const jobsMax = Math.max(jobsMin + 2, Math.ceil(baseJobs * 1.2));

  const hourlyWage = medianIncome > 0
    ? clamp(medianIncome / 2080, 10, 65)
    : CORRELATIONS.defaultHourlyWage;

  const baselineTravelMinutes = clamp(12 + pctLowAccess1mi * 0.45 + pctNoVehicleLowAccess * 0.38, 8, 70);
  const travelDropRate = clamp(simulation.coverageScore * (0.38 + lowAccessIntensity * 0.36), 0.1, 0.72);
  const newTravelMinutes = baselineTravelMinutes * (1 - travelDropRate);

  const baseBasketCost = CORRELATIONS.baseBasketCost;
  const conveniencePremiumBefore = baseBasketCost * (foodAccess.isFoodDesert ? 0.15 : 0.07);
  const conveniencePremiumAfter = conveniencePremiumBefore * (1 - clamp(simulation.coverageScore * 0.78, 0.12, 0.88));

  const timeSurchargeBefore = (baselineTravelMinutes / 60) * hourlyWage;
  const timeSurchargeAfter = (newTravelMinutes / 60) * hourlyWage;

  const totalAccessCostBefore = baseBasketCost + conveniencePremiumBefore + timeSurchargeBefore;
  const totalAccessCostAfter = baseBasketCost + conveniencePremiumAfter + timeSurchargeAfter;

  const householdsAffected = population * clamp01(pctLowAccess1mi / 100);
  const commuteHoursSavedAnnual =
    householdsAffected * CORRELATIONS.groceryTripsPerYear * Math.max((baselineTravelMinutes - newTravelMinutes) / 60, 0);

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
      annualCapturedSales: Math.round(annualCapturedSales),
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
    },
    simulation: {
      ...simulation,
      commuteHoursSavedAnnual,
      executiveSummary,
    },
    sources: SOURCES,
  };
}
