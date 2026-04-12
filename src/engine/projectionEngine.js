import { CORRELATIONS, SOURCES } from './correlations.js';

export function projectImpact(communityData) {
  if (!communityData) return null;

  const { foodAccess, health, demographics } = communityData;
  const { pctLowAccess1mi, pctNoVehicleLowAccess } = foodAccess;
  const { diabetes, obesity } = health;
  const { population, noVehicleHouseholds } = demographics;

  return {
    foodAccess: {
      pctLowAccessReduction: pctLowAccess1mi * CORRELATIONS.vehicleBurdenReduction,
      residentsGainingAccess: Math.round(population * (pctLowAccess1mi / 100) * 0.85),
      noVehicleHouseholdsHelped: Math.round(noVehicleHouseholds * CORRELATIONS.vehicleBurdenReduction),
    },
    health: {
      diabetesNewRate: diabetes * (1 - CORRELATIONS.diabetesReductionRelative),
      diabetesReductionPct: diabetes * CORRELATIONS.diabetesReductionRelative,
      obesityNewRate: obesity * (1 - CORRELATIONS.obesityReductionRelative),
      obesityReductionPct: obesity * CORRELATIONS.obesityReductionRelative,
      estimatedCasesAvoided: Math.round(population * 0.01 * CORRELATIONS.diabetesReductionRelative),
    },
    economic: {
      jobsMin: CORRELATIONS.jobsCreatedMin,
      jobsMax: CORRELATIONS.jobsCreatedMax,
      annualLocalImpact: Math.round(CORRELATIONS.avgGroceryAnnualRevenue * CORRELATIONS.economicMultiplier),
    },
    sources: SOURCES,
  };
}
