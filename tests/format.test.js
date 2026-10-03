import assert from 'node:assert/strict';
import test from 'node:test';

import { approxCount, cdcFigure, fmtBeyond, fmtMiles, fmtShare, roundedCount } from '../src/lib/format.js';

test('approxCount is exact below 100 and about the nearest 10 above', () => {
  assert.equal(approxCount(0), '0');
  assert.equal(approxCount(84), '84');
  assert.equal(approxCount(99.4), '99');
  assert.equal(approxCount(329), '≈330');
  assert.equal(approxCount(2064), '≈2,060');
  assert.equal(approxCount(NaN), null);
  assert.equal(approxCount(undefined), null);
});

test('roundedCount is approxCount without the sign, for denominators', () => {
  assert.equal(roundedCount(2064), '2,060');
  assert.equal(roundedCount(84), '84');
  assert.equal(roundedCount(null), null);
});

test('329 of 1000: the share under 33% never shows as 33%', () => {
  // 32.9% rounds to 33, but byShare is false: it is under the limit.
  assert.equal(fmtShare(329 / 1000, false), 'just under 33%');
  assert.equal(fmtBeyond(329, false), '≈330');
});

test('497 of 1600: a count under 500 shows exact rather than ≈500', () => {
  assert.equal(fmtBeyond(497, false), '497');
  assert.equal(fmtShare(497 / 1600, false), '31%');
});

test('every count from 495 to 499 shows exact; 494 still rounds', () => {
  for (const n of [495, 496, 497, 498, 499]) assert.equal(fmtBeyond(n, false), String(n));
  assert.equal(fmtBeyond(494, false), '≈490');
});

test('500 is at the count limit and may show as ≈500', () => {
  assert.equal(fmtBeyond(500, true), '≈500');
  assert.equal(fmtBeyond(504, true), '≈500');
  assert.equal(fmtBeyond(1904, true), '≈1,900');
});

test('without a byCount flag the count limit is read from the value itself', () => {
  assert.equal(fmtBeyond(497), '497');
  assert.equal(fmtBeyond(497, null), '497');
  assert.equal(fmtBeyond(500), '≈500');
  assert.equal(fmtBeyond(NaN, false), null);
});

test('share 0.3299 is just under 33%; 0.33 is at the limit', () => {
  assert.equal(fmtShare(0.3299, false), 'just under 33%');
  assert.equal(fmtShare(0.33, true), '33%');
  assert.equal(fmtShare(0.3449, true), '34%');
});

test('LRAM 2019 reference: 32.5-32.99% reads "just under 33%" with byShare = share >= 0.33', () => {
  for (const s of [0.325, 0.3275, 0.3299]) assert.equal(fmtShare(s, s >= 0.33), 'just under 33%');
  assert.equal(fmtShare(0.3249, 0.3249 >= 0.33), '32%');
  assert.equal(fmtShare(0.33, 0.33 >= 0.33), '33%');
});

test('a share with no limit (no byShare) is plain whole percent', () => {
  assert.equal(fmtShare(0.329), '33%');
  assert.equal(fmtShare(0.329, null), '33%');
});

test('share extremes never show 0% or 100% for a non-zero / non-total share', () => {
  assert.equal(fmtShare(0), '0%');
  assert.equal(fmtShare(0.004), 'under 1%');
  assert.equal(fmtShare(0.996), 'over 99%');
  assert.equal(fmtShare(1), '100%');
  assert.equal(fmtShare(NaN), null);
});

test('fmtMiles: tenths under 10, whole miles above, a floor at 0.1', () => {
  assert.equal(fmtMiles(0.04), 'under 0.1 mi');
  assert.equal(fmtMiles(1.26), '1.3 mi');
  assert.equal(fmtMiles(12.4), '12 mi');
  assert.equal(fmtMiles(Infinity), null);
});

test('cdcFigure: a CDC PLACES call that failed is never shown as "not published"', () => {
  // meta.profileStatus.health from the normalizer: 'ok' | 'unavailable' | 'timeout'.
  assert.deepEqual(cdcFigure(13.2, 'ok'), { value: 13.2, label: null, note: null });
  assert.deepEqual(cdcFigure(0, 'ok'), { value: null, label: 'not published', note: 'CDC PLACES returned no figure for this tract.' });
  // The fetch falls back to an all-zero profile on failure: zeros then mean nothing.
  assert.deepEqual(cdcFigure(0, 'unavailable'), { value: null, label: 'unavailable', note: "CDC PLACES didn't load for this search." });
  assert.deepEqual(cdcFigure(0, 'timeout'), { value: null, label: 'unavailable', note: "CDC PLACES didn't answer in time." });
  // No status (older payloads): the figure decides, as before.
  assert.deepEqual(cdcFigure(9, undefined), { value: 9, label: null, note: null });
  assert.deepEqual(cdcFigure(undefined, undefined).label, 'not published');
});
