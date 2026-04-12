import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateFoodDesertDesignation } from '../src/engine/foodDesertEvaluation.js';

test('urban tracts require at least 1 mile', () => {
  const belowThreshold = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: 0.99,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  const atThreshold = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: 1,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  assert.equal(belowThreshold.distanceThresholdMiles, 1);
  assert.equal(belowThreshold.isFoodDesert, false);
  assert.equal(belowThreshold.finalDesignation, 'not_designated');
  assert.equal(atThreshold.isFoodDesert, true);
  assert.equal(atThreshold.finalDesignation, 'designated');
  assert.equal(atThreshold.designationMethod, 'distance_rule_urban_1mi');
});

test('rural tracts require at least 5 miles', () => {
  const belowThreshold = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: 4.99,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  const atThreshold = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: 5,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  assert.equal(belowThreshold.distanceThresholdMiles, 5);
  assert.equal(belowThreshold.isFoodDesert, false);
  assert.equal(atThreshold.isFoodDesert, true);
  assert.equal(atThreshold.designationMethod, 'distance_rule_rural_5mi');
});

test('25+ mile signal marks food desert even without a distance value', () => {
  const result = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: null,
    isTwentyFivePlusMiles: true,
    usdaLilaFlag: false,
  });

  assert.equal(result.distanceRuleEvaluable, true);
  assert.equal(result.isFoodDesertByDistanceRule, true);
  assert.equal(result.isFoodDesert, true);
});

test('distance-unavailable now returns explicit Unknown by default', () => {
  const unknownResult = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: null,
    isTwentyFivePlusMiles: null,
    usdaLilaFlag: true,
  });

  assert.equal(unknownResult.distanceRuleEvaluable, false);
  assert.equal(unknownResult.isFoodDesert, null);
  assert.equal(unknownResult.finalDesignation, 'unknown');
  assert.equal(unknownResult.designationMethod, 'distance_rule_unavailable_unknown');
});

test('can opt into USDA fallback when distance providers are unavailable', () => {
  const positiveFallback = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: null,
    isTwentyFivePlusMiles: null,
    usdaLilaFlag: true,
    unavailableMode: 'usda_fallback',
  });

  const negativeFallback = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: null,
    isTwentyFivePlusMiles: null,
    usdaLilaFlag: false,
    unavailableMode: 'usda_fallback',
  });

  assert.equal(positiveFallback.distanceRuleEvaluable, false);
  assert.equal(positiveFallback.isFoodDesert, true);
  assert.equal(positiveFallback.finalDesignation, 'designated');
  assert.equal(
    positiveFallback.designationMethod,
    'distance_rule_unavailable_usda_fallback'
  );

  assert.equal(negativeFallback.distanceRuleEvaluable, false);
  assert.equal(negativeFallback.isFoodDesert, false);
  assert.equal(negativeFallback.finalDesignation, 'not_designated');
  assert.equal(negativeFallback.designationMethod, 'distance_rule_unavailable');
});

test('invalid distance values are normalized and treated as unavailable', () => {
  const result = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: 'not-a-number',
    isTwentyFivePlusMiles: null,
    usdaLilaFlag: false,
  });

  assert.equal(result.nearestSupermarketMiles, null);
  assert.equal(result.distanceRuleEvaluable, false);
  assert.equal(result.isFoodDesert, null);
  assert.equal(result.finalDesignation, 'unknown');
});

test('marks disagreement when distance and USDA labels differ', () => {
  const result = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: 12,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  assert.equal(result.distanceDesignation, 'designated');
  assert.equal(result.usdaDesignation, 'not_designated');
  assert.equal(result.sourceComparable, true);
  assert.equal(result.sourceDisagreement, true);
});

test('custom threshold overrides can flip the final designation', () => {
  const baseline = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: 0.9,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
  });

  const loweredThreshold = evaluateFoodDesertDesignation({
    isRural: false,
    nearestSupermarketMiles: 0.9,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: false,
    urbanThresholdMiles: 0.8,
  });

  assert.equal(baseline.finalDesignation, 'not_designated');
  assert.equal(loweredThreshold.finalDesignation, 'designated');
});
