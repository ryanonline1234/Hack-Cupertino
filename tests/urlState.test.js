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
  // Pins now carry a store format; a link without pt= means supermarket.
  assert.deepEqual(decoded.pins[0], { lat: 37.1234, lng: -121.5678, format: 's' });
});

test('existing fields still decode alongside pins', () => {
  const decoded = decodeAppState('#lat=37.339&lng=-121.894&layout=split&bh=320&sw=560&hl=1&pins=37.3,-121.8');
  assert.equal(decoded.layout, 'split');
  assert.equal(decoded.bottomPanelHeight, 320);
  assert.equal(decoded.splitPanelWidth, 560);
  assert.equal(decoded.highlight, true);
  assert.equal(decoded.pins.length, 1);
});

// ------------------------------------------------- store formats (pt=)

const STORE_TOKENS = ['s', 'g', 'd', 'f'];

test('legacy link (pins= only, no pt=) decodes every pin as a supermarket', () => {
  const decoded = decodeAppState('#lat=37.42&lng=-121.97&pins=37.4210,-121.9727;37.4300,-121.9800');
  assert.deepEqual(decoded.pins, [
    { lat: 37.421, lng: -121.9727, format: 's' },
    { lat: 37.43, lng: -121.98, format: 's' },
  ]);
});

test('formats survive an encode/decode round trip, index-aligned with pins', () => {
  const pins = STORE_TOKENS.map((format, i) => ({ lat: 37 + i / 100, lng: -122 + i / 100, format }));
  const encoded = encodeAppState({ lat: 37, lng: -122, pins });
  const params = new URLSearchParams(encoded);
  assert.equal(params.get('pt'), 's;g;d;f');
  const decoded = decodeAppState(`#${encoded}`);
  assert.deepEqual(decoded.pins.map((p) => p.format), STORE_TOKENS);
  assert.deepEqual(decoded.pins.map((p) => p.lat), [37, 37.01, 37.02, 37.03]);
});

test('encode emits no pt= when every pin is a supermarket (old links stay old)', () => {
  const encoded = encodeAppState({ pins: [{ lat: 37, lng: -122, format: 's' }, { lat: 38, lng: -122 }] });
  assert.ok(encoded.includes('pins='));
  assert.ok(!encoded.includes('pt='));
  assert.ok(!encodeAppState({ pins: [] }).includes('pt='));
});

test('encode maps a missing or unknown format to s', () => {
  const encoded = encodeAppState({
    pins: [
      { lat: 37, lng: -122, format: 'g' },
      { lat: 37.1, lng: -122, format: 'mega-mart' },
      { lat: 37.2, lng: -122 },
    ],
  });
  assert.equal(new URLSearchParams(encoded).get('pt'), 'g;s;s');
});

test('decode: invalid, empty or missing tokens fall back to s', () => {
  const decoded = decodeAppState('#pins=37,-122;37.1,-122;37.2,-122;37.3,-122;37.4,-122&pt=g;x;;D');
  assert.deepEqual(decoded.pins.map((p) => p.format), ['g', 's', 's', 's', 's']);
});

test('decode ignores surplus tokens beyond the pin list', () => {
  const decoded = decodeAppState('#pins=37,-122&pt=d;g;f');
  assert.deepEqual(decoded.pins, [{ lat: 37, lng: -122, format: 'd' }]);
});

test('pins and tokens are paired before invalid pins are dropped', () => {
  // The second pin is invalid; its token 'g' must go with it rather than
  // sliding onto the third pin.
  const decoded = decodeAppState('#pins=37,-122;bad;37.2,-122;91,0;37.4,-122&pt=d;g;f;s;g');
  assert.deepEqual(decoded.pins, [
    { lat: 37, lng: -122, format: 'd' },
    { lat: 37.2, lng: -122, format: 'f' },
    { lat: 37.4, lng: -122, format: 'g' },
  ]);
});

test('encode pairs formats before dropping invalid pins', () => {
  const encoded = encodeAppState({
    pins: [
      { lat: 37, lng: -122, format: 'd' },
      { lat: NaN, lng: -122, format: 'g' },
      null,
      { lat: 37.2, lng: -122, format: 'f' },
    ],
  });
  const decoded = decodeAppState(`#${encoded}`);
  assert.deepEqual(decoded.pins, [
    { lat: 37, lng: -122, format: 'd' },
    { lat: 37.2, lng: -122, format: 'f' },
  ]);
});

test('the pin cap applies to formats too', () => {
  const pins = Array.from({ length: MAX_SHARED_PINS + 3 }, (_, i) => ({
    lat: 37 + i * 0.001,
    lng: -122,
    format: i % 2 ? 'g' : 's',
  }));
  const encoded = encodeAppState({ pins });
  const params = new URLSearchParams(encoded);
  assert.equal(params.get('pins').split(';').length, MAX_SHARED_PINS);
  assert.equal(params.get('pt').split(';').length, MAX_SHARED_PINS);
  const decoded = decodeAppState(`#${encoded}`);
  assert.equal(decoded.pins.length, MAX_SHARED_PINS);
  assert.deepEqual(decoded.pins.slice(0, 3).map((p) => p.format), ['s', 'g', 's']);
});

test('pins encode with 4 decimals', () => {
  const encoded = encodeAppState({ pins: [{ lat: 37.421049, lng: -121.972651, format: 'g' }] });
  assert.equal(new URLSearchParams(encoded).get('pins'), '37.4210,-121.9727');
});

// ------------------------------------------------------- lat/lng decode

test('a hash without lat/lng does not decode to 0,0', () => {
  const decoded = decodeAppState('#pins=37.3,-121.8&layout=split');
  assert.equal(decoded.lat, undefined);
  assert.equal(decoded.lng, undefined);
  assert.equal(decoded.pins.length, 1);
  assert.equal(decoded.layout, 'split');
});

test('empty or one-sided lat/lng is ignored', () => {
  for (const hash of ['#lat=&lng=', '#lat=37.3', '#lng=-121.8', '#lat=37.3&lng=', '#lat=%20&lng=%20']) {
    const decoded = decodeAppState(hash);
    assert.equal(decoded.lat, undefined, hash);
    assert.equal(decoded.lng, undefined, hash);
  }
});

test('lat=0&lng=0 is still a valid, explicit location', () => {
  assert.deepEqual(decodeAppState('#lat=0&lng=0'), { lat: 0, lng: 0 });
});
