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
      // ~2.7 people per household, and ~77% of residents 18+. Both are
      // separate ACS variables now: grocery trips are per household, and CDC
      // prevalence rates are adults-only.
      households: 4500,
      adultPopulation: 9200,
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

// ── Commute-hours saved: a per-household figure ─────────────────────────────

test('commute-hours saved scales with household count, not population', () => {
  // The regression this guards: commuteHoursSavedAnnual used to be derived
  // from `population`, so it moved when population moved and ignored
  // households entirely. Holding households fixed while doubling population
  // must leave the figure unchanged.
  const base = projectImpact(makeCommunityData());
  const morePeopleSameHouseholds = projectImpact(
    makeCommunityData({ demographics: { population: 24000 } }),
  );

  assert.equal(
    base.simulation.commuteHoursSavedAnnual,
    morePeopleSameHouseholds.simulation.commuteHoursSavedAnnual,
  );
});

test('commute-hours saved doubles when households double', () => {
  const base = projectImpact(makeCommunityData());
  const doubled = projectImpact(
    makeCommunityData({ demographics: { households: 9000 } }),
  );

  assert.ok(base.simulation.commuteHoursSavedAnnual > 0);
  assert.ok(
    Math.abs(doubled.simulation.commuteHoursSavedAnnual - base.simulation.commuteHoursSavedAnnual * 2) < 1e-6,
  );
});

test('commute-hours saved is null when household count is unavailable', () => {
  const impact = projectImpact(
    makeCommunityData({ demographics: { households: null } }),
  );

  // Null, not 0: "we do not know" must not render as "no benefit".
  assert.equal(impact.simulation.commuteHoursSavedAnnual, null);
  assert.ok(
    impact.simulation.executiveSummary.some((line) => line.includes('cannot be estimated')),
  );
});

// ── Diabetes cases avoided: an adults-only figure ───────────────────────────

test('diabetes cases avoided is based on the adult population', () => {
  const base = projectImpact(makeCommunityData());
  const moreAdults = projectImpact(
    makeCommunityData({ demographics: { adultPopulation: 18400 } }),
  );

  assert.ok(base.health.estimatedCasesAvoided > 0);
  assert.equal(moreAdults.health.estimatedCasesAvoided, base.health.estimatedCasesAvoided * 2);
});

test('diabetes cases avoided ignores total population', () => {
  // Children are not in the CDC prevalence denominator, so a larger total
  // population with the same adult count must not change the estimate.
  const base = projectImpact(makeCommunityData());
  const moreChildren = projectImpact(
    makeCommunityData({ demographics: { population: 30000 } }),
  );

  assert.equal(base.health.estimatedCasesAvoided, moreChildren.health.estimatedCasesAvoided);
});

test('diabetes cases avoided is null when adult population is unavailable', () => {
  const impact = projectImpact(
    makeCommunityData({ demographics: { adultPopulation: null } }),
  );

  assert.equal(impact.health.estimatedCasesAvoided, null);
});

// ── Missing demographics must not read as zero impact ───────────────────────

test('economic projections are null when population is unavailable', () => {
  const impact = projectImpact(
    makeCommunityData({ demographics: { population: null } }),
  );

  // Previously censusFetch returned population: 0 on failure, so this path
  // produced a confident "$0 annual impact, 3 jobs" instead of "unknown".
  assert.equal(impact.economic.annualLocalImpact, null);
  assert.equal(impact.economic.annualCapturedSales, null);
  assert.equal(impact.economic.jobsMin, null);
  assert.equal(impact.economic.jobsMax, null);
  assert.equal(impact.foodAccess.residentsGainingAccess, null);
});

test('no-vehicle households helped is null when the source count is unavailable', () => {
  const impact = projectImpact(
    makeCommunityData({ demographics: { noVehicleHouseholds: null } }),
  );

  assert.equal(impact.foodAccess.noVehicleHouseholdsHelped, null);
});

// ── Missing CDC coverage must not read as zero health burden ────────────────

test('health projections are null when CDC prevalence is unavailable', () => {
  const impact = projectImpact(
    makeCommunityData({ health: { diabetes: null, obesity: null } }),
  );

  // Previously cdcFetch returned 0 for a tract outside PLACES coverage, so
  // this path produced a confident "0% diabetes, 0 cases avoided". Now null.
  assert.equal(impact.health.diabetesReductionPct, null);
  assert.equal(impact.health.obesityReductionPct, null);
  assert.equal(impact.health.diabetesNewRate, null);
  assert.equal(impact.health.obesityNewRate, null);
  assert.equal(impact.health.estimatedCasesAvoided, null);
});

test('a missing prevalence never renders as NaN in the summary', () => {
  const impact = projectImpact(
    makeCommunityData({ health: { diabetes: null, obesity: null } }),
  );

  for (const line of impact.simulation.executiveSummary) {
    assert.doesNotMatch(line, /NaN/, `summary line contains NaN: ${line}`);
  }
  assert.ok(
    impact.simulation.executiveSummary.some((l) => l.includes('prevalence unavailable')),
  );
});

test('a genuine zero prevalence is still projected, not treated as missing', () => {
  const impact = projectImpact(
    makeCommunityData({ health: { diabetes: 0, obesity: 0 } }),
  );

  assert.equal(impact.health.diabetesReductionPct, 0);
  assert.equal(impact.health.estimatedCasesAvoided, 0);
});
