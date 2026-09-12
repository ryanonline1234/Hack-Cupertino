import assert from 'node:assert/strict';
import test from 'node:test';

import { stripInstructionEcho } from '../src/lib/narrativeSanitize.js';

// Captured from a live session: the free model restated the prompt's
// formatting instructions (and thought aloud) instead of answering. The
// sanitizer must remove the instruction echo while keeping the data
// sentences that follow it.
const LEAKED = `We need exactly two short paragraphs, no headers or bullet points. Plain English, human language, grounded only in provided numbers. No hype, no hedging. Avoid jargon and disclaimers. Must not use bullet points. Must not exceed two paragraphs. Must be short paragraphs (maybe 3-5 sentences each). Must not use bullet points. Must not use headers. Must not include any extra text. Must be exactly two paragraphs separated by a blank line.

We need to describe daily food access: Food desert false, low grocery access within 1 mile urban = 0.0%, households without vehicle and low access = 0.0%, median income high, poverty low. So daily access: residents likely have easy access to grocery stores, maybe within walking distance or short drive, high income, low poverty. So we can say: Most residents live within a mile of a grocery store, few lack vehicles, etc. Use numbers: 0.0% low access, 0.0% households without vehicle and low access. So daily access: essentially everyone can reach a store easily.`;

const META_MARKERS = [
  'two short paragraphs',
  'no headers',
  'bullet points',
  'Must not',
  'blank line',
  'No hype',
  'Avoid jargon',
  'Plain English, human language',
];

test('instruction echo is stripped from a leaked model reply', () => {
  const clean = stripInstructionEcho(LEAKED);
  for (const marker of META_MARKERS) {
    assert.ok(!clean.includes(marker), `leaked marker still present: ${marker}`);
  }
});

test('data sentences survive the strip', () => {
  const clean = stripInstructionEcho(LEAKED);
  assert.ok(clean.includes('0.0%'), 'data sentence was removed');
  assert.ok(clean.includes('within a mile of a grocery store'), 'data sentence was removed');
});

test('a clean two-paragraph narrative passes through unchanged', () => {
  const ok = 'Most residents live within a mile of a grocery store.\n\nA new store would shave the average trip further.';
  assert.equal(stripInstructionEcho(ok), ok);
});

test('empty / non-string input returns empty string', () => {
  assert.equal(stripInstructionEcho(''), '');
  assert.equal(stripInstructionEcho(null), '');
});
