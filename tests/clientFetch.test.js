import assert from 'node:assert/strict';
import test from 'node:test';

import { getCensusData } from '../src/pipeline/censusFetch.js';
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
