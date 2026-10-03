import assert from 'node:assert/strict';
import test from 'node:test';

import { getCensusData } from '../src/pipeline/censusFetch.js';
import { getNearestSupermarketDistance } from '../src/pipeline/storeDistanceFetch.js';
import { jsonResponse, stubFetch } from './helpers/mockVercelRes.js';

const EMPTY_CENSUS = {
  medianIncome: 0,
  population: 0,
  pctPoverty: 0,
  noVehicleHouseholds: 0,
  stateMedianFamilyIncome: 0,
};

test('census data comes from the same-origin /api/acs function, keyless', async () => {
  const payload = {
    medianIncome: 93681,
    population: 2056,
    pctPoverty: 7.5,
    noVehicleHouseholds: 42,
    stateMedianFamilyIncome: 96334,
  };
  const stub = stubFetch(async () => jsonResponse(payload));
  try {
    const data = await getCensusData('06085504602');
    assert.deepEqual(data, payload);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, '/api/acs?fips=06085504602');
    assert.ok(!/key=/i.test(stub.calls[0].url));
  } finally {
    stub.restore();
  }
});

test('census fetch falls back to defaults on a bad FIPS or a failed call', async () => {
  const stub = stubFetch(async () => new Response('down', { status: 502 }));
  try {
    assert.deepEqual(await getCensusData('not-a-fips'), EMPTY_CENSUS);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(await getCensusData('06085504602'), EMPTY_CENSUS);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('store lookup posts coordinates (not query text) to /api/overpass only', async () => {
  const stub = stubFetch(async () => jsonResponse({
    elements: [{ type: 'node', id: 1, lat: 40.1001, lon: -75.2001, tags: { name: 'Corner Market' } }],
  }));
  try {
    const result = await getNearestSupermarketDistance(40.1, -75.2);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, '/api/overpass');
    assert.deepEqual(JSON.parse(stub.calls[0].init.body), { lat: 40.1, lng: -75.2 });
    assert.equal(result.source, 'osm_overpass:/api/overpass');
    assert.equal(result.stores[0].name, 'Corner Market');
  } finally {
    stub.restore();
  }
});

test('store lookup reports unavailable instead of trying third-party mirrors', async () => {
  const stub = stubFetch(async () => new Response('bad gateway', { status: 502 }));
  try {
    const result = await getNearestSupermarketDistance(41.2, -76.3);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, '/api/overpass');
    assert.equal(result.source, 'unavailable');
    assert.equal(result.nearestSupermarketMiles, null);
  } finally {
    stub.restore();
  }
});
