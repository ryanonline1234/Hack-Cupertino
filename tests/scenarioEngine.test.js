import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePlacedStoreScenario } from '../src/engine/scenarioEngine.js';

function community({ avg, rural = false, desert = true }) {
  return {
    foodAccess: {
      isRural: rural,
      communityAverageSupermarketMiles: avg,
      isFoodDesert: desert,
      finalDesignation: desert ? 'designated' : 'not_designated',
      isTwentyFivePlusMiles: false,
      usdaLilaFlag: false,
      // One far store so the only nearby option is the placed one.
      stores: [{ id: 'n/1', lat: 37.0, lng: -122.5, name: 'Far Mart', distanceMiles: 30 }],
    },
  };
}

const CENTER = { lat: 37.339, lng: -121.894 };

test('empty placed list returns null', () => {
  assert.equal(evaluatePlacedStoreScenario(community({ avg: 2.4 }), [], CENTER), null);
  assert.equal(evaluatePlacedStoreScenario(null, [{ lat: 1, lng: 2 }], CENTER), null);
});

test('placed store drops the average', () => {
  const result = evaluatePlacedStoreScenario(
    community({ avg: 2.4 }),
    [{ lat: 37.34, lng: -121.895 }],
    CENTER,
  );
  assert.ok(result);
  assert.equal(result.placedCount, 1);
  assert.ok(result.afterAvg < result.beforeAvg);
  // One store can't cover a ±1.5mi sample spread past the 1mi urban rule —
  // the average improves but the designation honestly holds.
  assert.equal(result.beforeLabel, 'designated');
  assert.equal(result.afterLabel, 'designated');
  assert.equal(result.flipped, false);
});

test('enough placed coverage flips a rural designation', () => {
  const result = evaluatePlacedStoreScenario(
    community({ avg: 6.0, rural: true }),
    [{ lat: 37.34, lng: -121.895 }],
    CENTER,
  );
  assert.ok(result);
  assert.equal(result.beforeLabel, 'designated');
  assert.equal(result.afterLabel, 'not designated');
  assert.equal(result.flipped, true);
});

test('distant placed store barely moves the average', () => {
  const near = evaluatePlacedStoreScenario(
    community({ avg: 2.4 }),
    [{ lat: 37.34, lng: -121.895 }],
    CENTER,
  );
  const far = evaluatePlacedStoreScenario(
    community({ avg: 2.4 }),
    [{ lat: 38.5, lng: -123.0 }],
    CENTER,
  );
  assert.ok(near.afterAvg < far.afterAvg);
});

test('invalid placed points are ignored', () => {
  const result = evaluatePlacedStoreScenario(
    community({ avg: 2.4 }),
    [{ lat: NaN, lng: 0 }, { lat: 37.34, lng: -121.895 }],
    CENTER,
  );
  assert.equal(result.placedCount, 1);
});
