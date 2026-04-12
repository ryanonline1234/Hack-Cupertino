import assert from 'node:assert/strict';
import test from 'node:test';

import { projectImpact } from '../src/engine/projectionEngine.js';
import { CORRELATIONS } from '../src/engine/correlations.js';

function makeCommunityData(overrides = {}) {
  return {
    foodAccess: {
      pctLowAccess1mi: 45,
      pctLowAccess10mi: 45,
      pctNoVehicleLowAccess: 8,
      qualifyingLowAccessPct: 45,
      isRural: false,
      isFoodDesert: true,
      modelFoodDesertAssumption: true,
      ...overrides.foodAccess,
    },
    health: {
      diabetes: 12,
      obesity: 33,
      ...overrides.health,
    },
    demographics: {
      population: 12000,
      noVehicleHouseholds: 800,
      medianIncome: 55000,
      pctPoverty: 18,
      ...overrides.demographics,
    },
    meta: {
      lat: 37.77,
      lng: -122.41,
      ...overrides.meta,
    },
  };
}

test('annual local impact equals captured sales times multiplier', () => {
  const impact = projectImpact(makeCommunityData());

  assert.equal(
    impact.economic.annualLocalImpact,
    Math.round(impact.economic.annualCapturedSales * CORRELATIONS.economicMultiplier)
  );
});

test('annual captured sales are capped for very large tracts', () => {
  const impact = projectImpact(
    makeCommunityData({
      foodAccess: { qualifyingLowAccessPct: 80, pctNoVehicleLowAccess: 15 },
      demographics: { population: 250000, medianIncome: 65000, pctPoverty: 10 },
    })
  );

  assert.equal(impact.economic.annualCapturedSalesCapped, true);
  assert.ok(impact.economic.annualCapturedSales <= impact.economic.annualRevenueCap);
  assert.ok(impact.economic.annualCapturedSalesRaw >= impact.economic.annualCapturedSales);
});

test('higher low-access need produces higher local impact', () => {
  const lowerNeed = projectImpact(
    makeCommunityData({
      foodAccess: { qualifyingLowAccessPct: 25 },
    })
  );

  const higherNeed = projectImpact(
    makeCommunityData({
      foodAccess: { qualifyingLowAccessPct: 70 },
    })
  );

  assert.ok(higherNeed.economic.annualLocalImpact > lowerNeed.economic.annualLocalImpact);
});
