import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateFoodAccess } from '../src/engine/foodAccessVerdict.js';

// [lowIncome, lowAccess] -> expected, with no unknownReason supplied.
const TRUTH_TABLE = [
  [true, true, { status: 'met', qualifier: 'li_la', reason: null }],
  [true, false, { status: 'not_met', qualifier: 'li_not_la', reason: null }],
  [true, null, { status: 'unknown', qualifier: 'unknown', reason: 'unknown' }],
  [false, true, { status: 'not_met', qualifier: 'la_not_li', reason: null }],
  [false, false, { status: 'not_met', qualifier: 'neither', reason: null }],
  [false, null, { status: 'not_met', qualifier: 'not_li_access_unknown', reason: null }],
  [null, true, { status: 'unknown', qualifier: 'la_income_unknown', reason: 'income_unavailable' }],
  [null, false, { status: 'not_met', qualifier: 'not_la_income_unknown', reason: null }],
  [null, null, { status: 'unknown', qualifier: 'unknown', reason: 'unknown' }],
];

test('full 3x3 truth table', () => {
  for (const [lowIncome, lowAccess, expected] of TRUTH_TABLE) {
    assert.deepEqual(
      evaluateFoodAccess({ lowIncome, lowAccess }),
      expected,
      `lowIncome=${lowIncome} lowAccess=${lowAccess}`,
    );
  }
});

test('false wins: a known false is NOT MET whatever the other input is', () => {
  for (const other of [true, false, null]) {
    assert.equal(evaluateFoodAccess({ lowIncome: false, lowAccess: other }).status, 'not_met');
    assert.equal(evaluateFoodAccess({ lowIncome: other, lowAccess: false }).status, 'not_met');
  }
});

test('unknown access carries the supplied reason', () => {
  for (const reason of ['tract_unavailable', 'no_tract', 'no_residents', 'blocks_unavailable', 'blocks_incomplete', 'stores_unavailable']) {
    assert.deepEqual(evaluateFoodAccess({ lowIncome: true, lowAccess: null, unknownReason: reason }), {
      status: 'unknown',
      qualifier: 'unknown',
      reason,
    });
    assert.deepEqual(evaluateFoodAccess({ lowIncome: null, lowAccess: null, unknownReason: reason }), {
      status: 'unknown',
      qualifier: 'unknown',
      reason,
    });
  }
});

test('missing income with low access is always income_unavailable', () => {
  assert.deepEqual(
    evaluateFoodAccess({ lowIncome: null, lowAccess: true, unknownReason: 'stores_unavailable' }),
    { status: 'unknown', qualifier: 'la_income_unknown', reason: 'income_unavailable' },
  );
});

test('a known verdict ignores unknownReason', () => {
  assert.deepEqual(
    evaluateFoodAccess({ lowIncome: true, lowAccess: true, unknownReason: 'stores_unavailable' }),
    { status: 'met', qualifier: 'li_la', reason: null },
  );
  assert.deepEqual(
    evaluateFoodAccess({ lowIncome: false, lowAccess: null, unknownReason: 'blocks_unavailable' }),
    { status: 'not_met', qualifier: 'not_li_access_unknown', reason: null },
  );
});

test('ERS 1/0 flags read as booleans; anything else is unknown', () => {
  assert.equal(evaluateFoodAccess({ lowIncome: 1, lowAccess: true }).qualifier, 'li_la');
  assert.equal(evaluateFoodAccess({ lowIncome: 0, lowAccess: true }).qualifier, 'la_not_li');
  for (const odd of [undefined, NaN, '1', 'true', 2, {}]) {
    assert.equal(evaluateFoodAccess({ lowIncome: odd, lowAccess: true }).qualifier, 'la_income_unknown');
    assert.equal(evaluateFoodAccess({ lowIncome: true, lowAccess: odd }).qualifier, 'unknown');
  }
  assert.deepEqual(evaluateFoodAccess(), { status: 'unknown', qualifier: 'unknown', reason: 'unknown' });
});
