import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXAMPLE_LOCATIONS,
  geocodeAddress,
  placeKindFromNominatim,
  suggestionFromNominatim,
  verdictTag,
} from '../src/lib/locationSearch.js';
import {
  STORE_FORMATS,
  STORE_LIST_NOT_COVERED_TEXT,
  STORE_LIST_UNAVAILABLE_TEXT,
  noCountedStoresText,
  placedPinLabel,
  storeFormatInfo,
  storeLayerStatus,
} from '../src/lib/storeFormats.js';
import { MAX_SHARED_PINS, PIN_FORMATS } from '../src/lib/urlState.js';

// Trimmed Nominatim jsonv2 + addressdetails=1 responses, captured live
// 2026-10-02 (countrycodes=us, first hit unless noted).
const NOMINATIM = {
  sanJose: {
    name: 'San Jose',
    display_name: 'San Jose, Santa Clara County, California, United States',
    category: 'boundary', type: 'administrative', addresstype: 'city', place_rank: 16,
    address: { city: 'San Jose', county: 'Santa Clara County', state: 'California', country_code: 'us' },
    lat: '37.3361663', lon: '-121.8905910',
  },
  alviso: {
    name: 'Alviso',
    display_name: 'Alviso, San Jose, Santa Clara County, California, 95002, United States',
    category: 'boundary', type: 'administrative', addresstype: 'suburb', place_rank: 18,
    address: { suburb: 'Alviso', city: 'San Jose', county: 'Santa Clara County', postcode: '95002', country_code: 'us' },
    lat: '37.4260510', lon: '-121.9752373',
  },
  cupertinoLibrary: {
    name: 'Cupertino Library',
    display_name: 'Cupertino Library, 10800, Torre Avenue, Cupertino, Santa Clara County, California, 95014, United States',
    category: 'amenity', type: 'library', addresstype: 'amenity', place_rank: 30,
    address: { amenity: 'Cupertino Library', house_number: '10800', road: 'Torre Avenue', city: 'Cupertino', postcode: '95014', country_code: 'us' },
    lat: '37.3178237', lon: '-122.0289235',
  },
  zip95014: {
    name: '95014',
    display_name: '95014, Cupertino, Santa Clara County, California, United States',
    category: 'place', type: 'postcode', addresstype: 'postcode', place_rank: 21,
    address: { postcode: '95014', city: 'Cupertino', county: 'Santa Clara County', country_code: 'us' },
    lat: '37.3178092', lon: '-122.0372281',
  },
  santaClaraCounty: {
    name: 'Santa Clara County',
    display_name: 'Santa Clara County, California, United States',
    category: 'boundary', type: 'administrative', addresstype: 'county', place_rank: 12,
    address: { county: 'Santa Clara County', state: 'California', country_code: 'us' },
    lat: '37.2333253', lon: '-121.6846349',
  },
  // First hit for "Chinle": the boundary relation, addresstype locality.
  chinleLocality: {
    name: 'Chinle',
    display_name: 'Chinle, Apache County, Arizona, United States',
    category: 'boundary', type: 'administrative', addresstype: 'locality', place_rank: 25,
    address: { locality: 'Chinle', town: 'Chinle', county: 'Apache County', state: 'Arizona', country_code: 'us' },
    lat: '36.1501434', lon: '-109.5670685',
  },
  // Second hit for "Chinle": the place node, addresstype town.
  chinleTown: {
    name: 'Chinle',
    display_name: 'Chinle, Apache County, Arizona, United States',
    category: 'place', type: 'town', addresstype: 'town', place_rank: 18,
    address: { town: 'Chinle', county: 'Apache County', state: 'Arizona', country_code: 'us' },
    lat: '36.1621322', lon: '-109.5812730',
  },
};

test('placeKindFromNominatim: city, neighborhood, address', () => {
  assert.equal(placeKindFromNominatim(NOMINATIM.sanJose), 'city');
  assert.equal(placeKindFromNominatim(NOMINATIM.alviso), 'neighborhood');
  assert.equal(placeKindFromNominatim(NOMINATIM.cupertinoLibrary), 'address');
});

test('placeKindFromNominatim: postcodes, counties and localities are other', () => {
  assert.equal(placeKindFromNominatim(NOMINATIM.zip95014), 'other');
  assert.equal(placeKindFromNominatim(NOMINATIM.santaClaraCounty), 'other');
  // addresstype locality is not in the city list, has no house number and
  // ranks below 26.
  assert.equal(placeKindFromNominatim(NOMINATIM.chinleLocality), 'other');
  assert.equal(placeKindFromNominatim(NOMINATIM.chinleTown), 'city');
});

test('placeKindFromNominatim: the remaining city and neighborhood types', () => {
  for (const addresstype of ['town', 'village', 'municipality']) {
    assert.equal(placeKindFromNominatim({ addresstype, place_rank: 16 }), 'city', addresstype);
  }
  for (const addresstype of ['neighbourhood', 'quarter', 'city_district']) {
    assert.equal(placeKindFromNominatim({ addresstype, place_rank: 20 }), 'neighborhood', addresstype);
  }
});

test('placeKindFromNominatim: a house number or place_rank >= 26 is an address', () => {
  assert.equal(placeKindFromNominatim({ addresstype: 'building', place_rank: 20, address: { house_number: '1' } }), 'address');
  assert.equal(placeKindFromNominatim({ addresstype: 'road', place_rank: 26, address: {} }), 'address');
  assert.equal(placeKindFromNominatim({ addresstype: 'road', place_rank: 25, address: {} }), 'other');
});

test('placeKindFromNominatim: junk input is other, never a throw', () => {
  assert.equal(placeKindFromNominatim(null), 'other');
  assert.equal(placeKindFromNominatim(undefined), 'other');
  assert.equal(placeKindFromNominatim('San Jose'), 'other');
  assert.equal(placeKindFromNominatim({}), 'other');
});

test('suggestions carry placeKind and the short placeName', () => {
  const sj = suggestionFromNominatim(NOMINATIM.sanJose);
  assert.equal(sj.placeKind, 'city');
  assert.equal(sj.placeName, 'San Jose');
  assert.equal(sj.cls, 'boundary');
  assert.ok(Math.abs(sj.lat - 37.3361663) < 1e-9);
  assert.equal(suggestionFromNominatim(NOMINATIM.alviso).placeName, 'Alviso');
  assert.equal(suggestionFromNominatim(NOMINATIM.cupertinoLibrary).placeName, 'Cupertino Library');
  // A nameless hit falls back to the first part of display_name.
  const nameless = suggestionFromNominatim({ ...NOMINATIM.cupertinoLibrary, name: '' });
  assert.equal(nameless.placeName, 'Cupertino Library');
});

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });

test('geocodeAddress requests jsonv2 with address details and returns placeKind/placeName', async () => {
  const urls = [];
  await withFetch(async (url) => {
    urls.push(String(url));
    return json([NOMINATIM.sanJose]);
  }, async () => {
    const r = await geocodeAddress('San Jose');
    assert.deepEqual(r, { lat: 37.3361663, lng: -121.890591, placeKind: 'city', placeName: 'San Jose' });
  });
  assert.match(urls[0], /format=jsonv2/);
  assert.match(urls[0], /addressdetails=1/);
});

test('Census-geocoder fallback results are addresses', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('nominatim')) return json([], false);
    return json({
      result: {
        addressMatches: [{
          matchedAddress: '10800 TORRE AVE, CUPERTINO, CA, 95014',
          coordinates: { x: -122.02892, y: 37.31782 },
        }],
      },
    });
  }, async () => {
    const r = await geocodeAddress('10800 Torre Ave Cupertino');
    assert.equal(r.placeKind, 'address');
    assert.equal(r.placeName, '10800 TORRE AVE');
    assert.ok(Math.abs(r.lat - 37.31782) < 1e-9);
  });
});

const validCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

test('every example location has valid coordinates and a known tag', () => {
  const labels = new Set();
  for (const loc of EXAMPLE_LOCATIONS) {
    assert.ok(validCoord(loc.lat, loc.lng), loc.label);
    assert.ok(!labels.has(loc.label), `duplicate label ${loc.label}`);
    labels.add(loc.label);
    assert.ok(loc.verdict === undefined || loc.verdict === 'met' || loc.verdict === 'not_met', loc.label);
    if (loc.placeKind !== undefined) assert.ok(['city', 'neighborhood', 'address', 'other'].includes(loc.placeKind), loc.label);
  }
});

test('every example pin has valid lat/lng and a store format', () => {
  const withPins = EXAMPLE_LOCATIONS.filter((loc) => loc.pins !== undefined);
  assert.ok(withPins.length >= 1, 'the Alviso example carries a pin');
  for (const loc of withPins) {
    assert.ok(Array.isArray(loc.pins) && loc.pins.length > 0, loc.label);
    assert.ok(loc.pins.length <= MAX_SHARED_PINS, loc.label);
    for (const pin of loc.pins) {
      assert.ok(validCoord(pin.lat, pin.lng), `${loc.label} pin`);
      assert.ok(PIN_FORMATS.includes(pin.format), `${loc.label} pin format ${pin.format}`);
      // A demo pin sits near its example point (well under 5 mi).
      assert.ok(Math.abs(pin.lat - loc.lat) < 0.07 && Math.abs(pin.lng - loc.lng) < 0.07, `${loc.label} pin is far`);
    }
  }
});

test('the San Jose chip is a city search; tagged chips are not', () => {
  const sj = EXAMPLE_LOCATIONS.find((l) => l.label === 'San Jose, CA');
  assert.equal(sj.placeKind, 'city');
  assert.equal(sj.placeName, 'San Jose');
  assert.equal(sj.verdict, undefined);
  for (const label of ['Detroit, MI', 'Compton, CA']) {
    assert.equal(EXAMPLE_LOCATIONS.find((l) => l.label === label).verdict, undefined, label);
  }
});

test('the Alviso chip tags the result before the store and says the store flips it', () => {
  const alviso = EXAMPLE_LOCATIONS.find((l) => l.label === 'Alviso, San Jose');
  // The tag is the tract as it is today; the placed village store is what
  // changes it, so the note must not read as "meets the test with a store".
  assert.equal(alviso.verdict, 'met');
  assert.equal(alviso.note, 'then a store in the village flips it');
  assert.doesNotMatch(alviso.note, /^with\b/i);
  assert.ok(alviso.pins.every((p) => p.format === 's'), 'only a counting store can flip the test');
});

test('verdictTag labels and the no-claim default', () => {
  assert.equal(verdictTag({ verdict: 'met' }).text, 'Meets test');
  assert.equal(verdictTag({ verdict: 'not_met' }).text, "Doesn't meet");
  assert.equal(verdictTag({}), null);
  assert.equal(verdictTag({ verdict: 'designated' }), null);
});

test('store formats match the share-link tokens; only supermarkets count', () => {
  assert.deepEqual(STORE_FORMATS.map((f) => f.code), PIN_FORMATS);
  assert.deepEqual(STORE_FORMATS.filter((f) => f.counts).map((f) => f.code), ['s']);
  for (const f of STORE_FORMATS) assert.equal(Boolean(f.note), !f.counts, f.code);
  assert.equal(storeFormatInfo('x').code, 's');
  assert.equal(placedPinLabel('s'), 'Your store · Supermarket or supercenter (counts)');
  assert.equal(placedPinLabel('d'), "Your store · Dollar store (doesn't count)");
});

test('store layer status: an unloaded SNAP list is never described as "no stores"', () => {
  assert.equal(storeLayerStatus(3, true), 'stores');
  // Stores on hand mean the list loaded, whatever the flag says.
  assert.equal(storeLayerStatus(3, false), 'stores');
  assert.equal(storeLayerStatus(0, true), 'none');
  assert.equal(storeLayerStatus(0, false), 'unavailable');
  // A missing flag with an empty list makes no "no stores" claim either.
  assert.equal(storeLayerStatus(0, undefined), 'unavailable');
  assert.equal(storeLayerStatus(NaN, true), 'none');
  assert.equal(noCountedStoresText(5), 'No counted supermarkets within about 5 mi of this tract');
  assert.equal(STORE_LIST_UNAVAILABLE_TEXT, "SNAP store list didn't load");
});

test('store layer status: a territory without SNAP is not called "no counted supermarkets"', () => {
  // stores_not_covered: the list loaded but SNAP doesn't operate there, so an
  // empty layer says nothing about real supermarkets nearby.
  assert.equal(storeLayerStatus(0, true, true), 'not_covered');
  assert.equal(storeLayerStatus(0, false, true), 'not_covered');
  assert.equal(storeLayerStatus(0, undefined, true), 'not_covered');
  // Stores on hand are still drawn; the flag defaults to false.
  assert.equal(storeLayerStatus(2, true, true), 'stores');
  assert.equal(storeLayerStatus(0, true, false), 'none');
  assert.equal(storeLayerStatus(0, true), 'none');
  assert.equal(STORE_LIST_NOT_COVERED_TEXT, "No SNAP stores listed here: this territory doesn't run SNAP");
});
