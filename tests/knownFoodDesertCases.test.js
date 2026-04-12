import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';

import { evaluateFoodDesertDesignation } from '../src/engine/foodDesertEvaluation.js';
import { getUsdaData } from '../src/pipeline/usdaFetch.js';
import { installUsdaCsvFetchMock } from './helpers/mockUsdaCsvFetch.js';

const FIXTURE_PATH = new URL('./fixtures/known-food-desert-cases.json', import.meta.url);
const KNOWN_CASES = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

let restoreFetch;

before(() => {
  restoreFetch = installUsdaCsvFetchMock();
});

after(() => {
  if (restoreFetch) restoreFetch();
});

test('fixture file contains web sources and expected designations', () => {
  assert.ok(Array.isArray(KNOWN_CASES));
  assert.ok(KNOWN_CASES.length >= 6);

  for (const knownCase of KNOWN_CASES) {
    assert.ok(knownCase.id);
    assert.ok(knownCase.tractFips);
    assert.equal(typeof knownCase.expectedUsdaLila, 'boolean');
    assert.ok(
      knownCase.sourceUrl?.startsWith('https://www.ers.usda.gov/'),
      `Fixture ${knownCase.id} must cite USDA web source`
    );
  }
});

for (const knownCase of KNOWN_CASES) {
  test(`USDA audit: ${knownCase.id}`, async () => {
    const usda = await getUsdaData(knownCase.tractFips);

    assert.equal(
      usda.hasUsdaMatch,
      true,
      `No USDA match for ${knownCase.tractFips} (${knownCase.locationLabel})`
    );

    assert.equal(
      usda.usdaLilaFlag,
      knownCase.expectedUsdaLila,
      `USDA mismatch for ${knownCase.tractFips}. Source: ${knownCase.sourceUrl}`
    );

    const unknownEvaluation = evaluateFoodDesertDesignation({
      isRural: usda.isRural,
      nearestSupermarketMiles: null,
      isTwentyFivePlusMiles: null,
      usdaLilaFlag: usda.usdaLilaFlag,
    });

    const fallbackEvaluation = evaluateFoodDesertDesignation({
      isRural: usda.isRural,
      nearestSupermarketMiles: null,
      isTwentyFivePlusMiles: null,
      usdaLilaFlag: usda.usdaLilaFlag,
      unavailableMode: 'usda_fallback',
    });

    assert.equal(
      unknownEvaluation.finalDesignation,
      'unknown',
      `Unknown-mode should not auto-label ${knownCase.tractFips}`
    );

    assert.equal(
      fallbackEvaluation.isFoodDesert,
      knownCase.expectedUsdaLila,
      `Fallback designation mismatch for ${knownCase.tractFips}`
    );

    assert.ok(
      fallbackEvaluation.designationMethod.startsWith('distance_rule_unavailable'),
      `Expected unavailable-distance method for ${knownCase.tractFips}`
    );
  });
}

test('distance rule can diverge from USDA flag when live distance is available', async () => {
  const usda = await getUsdaData('20139010200');
  assert.equal(usda.usdaLilaFlag, false);

  const distanceDriven = evaluateFoodDesertDesignation({
    isRural: true,
    nearestSupermarketMiles: 12,
    isTwentyFivePlusMiles: false,
    usdaLilaFlag: usda.usdaLilaFlag,
  });

  assert.equal(distanceDriven.isFoodDesert, true);
  assert.equal(distanceDriven.designationMethod, 'distance_rule_rural_5mi');
  assert.equal(distanceDriven.sourceDisagreement, true);
});

test('distance-first and USDA-first outcomes can diverge across sample tracts', async () => {
  const sampleTracts = KNOWN_CASES.slice(0, 8).map((knownCase) => knownCase.tractFips);
  let disagreements = 0;

  for (const tractFips of sampleTracts) {
    const usda = await getUsdaData(tractFips);

    const distanceFirst = evaluateFoodDesertDesignation({
      isRural: usda.isRural,
      nearestSupermarketMiles: usda.isRural ? 12 : 1.2,
      isTwentyFivePlusMiles: false,
      usdaLilaFlag: usda.usdaLilaFlag,
    });

    const usdaFirst = evaluateFoodDesertDesignation({
      isRural: usda.isRural,
      nearestSupermarketMiles: null,
      isTwentyFivePlusMiles: null,
      usdaLilaFlag: usda.usdaLilaFlag,
      unavailableMode: 'usda_fallback',
    });

    if (distanceFirst.finalDesignation !== usdaFirst.finalDesignation) disagreements += 1;
  }

  assert.ok(disagreements > 0, 'Expected at least one disagreement between distance-first and USDA-first sample outcomes');
});
