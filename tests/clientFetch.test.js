import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchCdcData, getCdcData } from '../src/pipeline/cdcFetch.js';
import { fetchCensusData, getCensusData } from '../src/pipeline/censusFetch.js';
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

// ------------------------------------------------- timeouts (CDC PLACES, ACS)

const EMPTY_CDC = { diabetes: 0, obesity: 0, bphigh: 0, mhlth: 0, checkup: 0 };

test('CDC and ACS calls carry a timeout signal when the runtime has AbortSignal.timeout', async () => {
  const stub = stubFetch(async (url) => (url.startsWith('/api/acs') ? jsonResponse({}) : jsonResponse([])));
  try {
    await getCdcData('CA', '06085504602');
    await getCensusData('06085504602');
    assert.equal(stub.calls.length, 2);
    for (const call of stub.calls) {
      assert.ok(call.init?.signal instanceof AbortSignal, call.url);
      assert.equal(call.init.signal.aborted, false);
    }
  } finally {
    stub.restore();
  }
});

test('without AbortSignal.timeout the calls still go out, with no signal', async () => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = undefined;
  const stub = stubFetch(async (url) => (url.startsWith('/api/acs') ? jsonResponse({}) : jsonResponse([])));
  try {
    await getCdcData('CA', '06085504602');
    await getCensusData('06085504602');
    assert.equal(stub.calls.length, 2);
    assert.ok(stub.calls.every((c) => !c.init?.signal));
  } finally {
    stub.restore();
    AbortSignal.timeout = original;
  }
});

test('a timed-out CDC or ACS call falls back to the defaults (and says so to the normalizer)', async () => {
  const timeout = () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const stub = stubFetch(timeout);
  try {
    assert.deepEqual(await getCdcData('CA', '06085504602'), EMPTY_CDC);
    assert.deepEqual(await getCensusData('06085504602'), EMPTY_CENSUS);
    assert.deepEqual(await fetchCdcData('CA', '06085504602'), { status: 'unavailable', data: EMPTY_CDC });
    assert.deepEqual(await fetchCensusData('06085504602'), { status: 'unavailable', data: EMPTY_CENSUS });
  } finally {
    stub.restore();
  }
});

test('fetchCdcData / fetchCensusData report ok, unavailable and not_configured', async () => {
  let stub = stubFetch(async (url) => (url.startsWith('/api/acs')
    ? jsonResponse({ population: 10 })
    : jsonResponse([{ measureid: 'OBESITY', datavaluetypeid: 'CrdPrv', data_value: '30.2' }])));
  try {
    assert.deepEqual(await fetchCdcData('CA', '06085504602'), { status: 'ok', data: { ...EMPTY_CDC, obesity: 30.2 } });
    assert.deepEqual(await fetchCensusData('06085504602'), { status: 'ok', data: { ...EMPTY_CENSUS, population: 10 } });
  } finally {
    stub.restore();
  }

  // 503 = this deployment has no CENSUS_KEY: a retry can't fix it.
  const warn = console.warn;
  console.warn = () => {};
  stub = stubFetch(async (url) => (url.startsWith('/api/acs')
    ? jsonResponse({ error: 'not configured' }, 503)
    : new Response('bad gateway', { status: 502 })));
  try {
    assert.deepEqual(await fetchCensusData('06085504602'), { status: 'not_configured', data: EMPTY_CENSUS });
    assert.deepEqual(await fetchCdcData('CA', '06085504602'), { status: 'unavailable', data: EMPTY_CDC });
    assert.deepEqual(await fetchCensusData('bad'), { status: 'unavailable', data: EMPTY_CENSUS });
  } finally {
    stub.restore();
    console.warn = warn;
  }
});
