import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeAppState,
  encodeAppState,
  MAX_SHARED_PINS,
} from '../src/lib/urlState.js';

test('pins survive an encode/decode round trip (4-decimal precision)', () => {
  const pins = [
    { lat: 37.338208, lng: -121.886329 },
    { lat: 37.341234, lng: -121.890111 },
  ];
  const encoded = encodeAppState({ lat: 37.339, lng: -121.894, pins });
  const decoded = decodeAppState(`#${encoded}`);
  assert.equal(decoded.pins.length, 2);
  assert.ok(Math.abs(decoded.pins[0].lat - 37.3382) < 1e-9);
  assert.ok(Math.abs(decoded.pins[0].lng - -121.8863) < 1e-9);
  assert.ok(Math.abs(decoded.pins[1].lat - 37.3412) < 1e-9);
});

test('no pins key is emitted when the pin list is empty or absent', () => {
  assert.ok(!encodeAppState({ lat: 1, lng: 2, pins: [] }).includes('pins='));
  assert.ok(!encodeAppState({ lat: 1, lng: 2 }).includes('pins='));
  assert.equal(decodeAppState('#lat=1&lng=2').pins, undefined);
});

test('encode caps pins at MAX_SHARED_PINS and drops invalid coords', () => {
  const pins = Array.from({ length: MAX_SHARED_PINS + 5 }, (_, i) => ({
    lat: 37 + i * 0.001,
    lng: -122,
  }));
  pins.push({ lat: NaN, lng: 0 }, { lat: 200, lng: 0 }, null);
  const decoded = decodeAppState(`#${encodeAppState({ pins })}`);
  assert.equal(decoded.pins.length, MAX_SHARED_PINS);
});

test('decode ignores malformed pin segments but keeps valid ones', () => {
  const decoded = decodeAppState('#lat=37&lng=-122&pins=abc;37.5;91,0;37.1234,-121.5678;1,2,3');
  assert.equal(decoded.pins.length, 1);
  assert.deepEqual(decoded.pins[0], { lat: 37.1234, lng: -121.5678 });
});

test('existing fields still decode alongside pins', () => {
  const decoded = decodeAppState('#lat=37.339&lng=-121.894&layout=split&bh=320&sw=560&hl=1&pins=37.3,-121.8');
  assert.equal(decoded.layout, 'split');
  assert.equal(decoded.bottomPanelHeight, 320);
  assert.equal(decoded.splitPanelWidth, 560);
  assert.equal(decoded.highlight, true);
  assert.equal(decoded.pins.length, 1);
});
