import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../api/acs.js';
import { jsonResponse, mockRes, stubFetch } from './helpers/mockVercelRes.js';

const FAKE_KEY = 'test-census-key-0000000000000000000000000';

function get(query) {
  return { method: 'GET', headers: {}, query };
}

async function withKey(value, fn) {
  const previous = process.env.CENSUS_KEY;
  if (value == null) delete process.env.CENSUS_KEY;
  else process.env.CENSUS_KEY = value;
  try {
    await fn();
  } finally {
    if (previous == null) delete process.env.CENSUS_KEY;
    else process.env.CENSUS_KEY = previous;
  }
}

function censusUpstream(url) {
  if (url.includes('for=tract')) {
    return jsonResponse([
      ['B19013_001E', 'B01003_001E', 'B17001_002E', 'B25044_003E', 'B25044_010E', 'state', 'county', 'tract'],
      ['93681', '2056', '154', '12', '30', '06', '085', '504602'],
    ]);
  }
  return jsonResponse([['B19113_001E', 'state'], ['96334', '06']]);
}

test('rejects non-GET methods', async () => {
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('rejects anything but an 11-digit tract FIPS', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    await withKey(FAKE_KEY, async () => {
      for (const fips of [undefined, '', '0608550460', '060855046021', '06085504602&get=NAME', ['06085504602', '1']]) {
        const res = mockRes();
        await handler(get({ fips }), res);
        assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(fips)}`);
      }
    });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('returns 503 when the server has no Census key', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    await withKey(null, async () => {
      const res = mockRes();
      await handler(get({ fips: '06085504602' }), res);
      assert.equal(res.statusCode, 503);
    });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('queries a fixed variable list for the tract and its state', async () => {
  const stub = stubFetch(async (url) => censusUpstream(url));
  try {
    await withKey(FAKE_KEY, async () => {
      const res = mockRes();
      await handler(get({ fips: '06085504602' }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        medianIncome: 93681,
        population: 2056,
        pctPoverty: (154 / 2056) * 100,
        noVehicleHouseholds: 42,
        stateMedianFamilyIncome: 96334,
      });
      assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY), 'response must not echo the key');
    });

    assert.equal(stub.calls.length, 2);
    const [tractUrl, stateUrl] = stub.calls.map((c) => new URL(c.url));
    for (const url of [tractUrl, stateUrl]) {
      assert.equal(url.origin, 'https://api.census.gov');
      assert.equal(url.pathname, '/data/2022/acs/acs5');
      assert.equal(url.searchParams.get('key'), FAKE_KEY);
    }
    assert.equal(tractUrl.searchParams.get('get'), 'B19013_001E,B01003_001E,B17001_002E,B25044_003E,B25044_010E');
    assert.equal(tractUrl.searchParams.get('for'), 'tract:504602');
    assert.equal(tractUrl.searchParams.get('in'), 'state:06 county:085');
    assert.equal(stateUrl.searchParams.get('get'), 'B19113_001E');
    assert.equal(stateUrl.searchParams.get('for'), 'state:06');
  } finally {
    stub.restore();
  }
});

test('returns 502 when the tract query fails upstream', async () => {
  const stub = stubFetch(async () => new Response('nope', { status: 500 }));
  try {
    await withKey(FAKE_KEY, async () => {
      const res = mockRes();
      await handler(get({ fips: '06085504602' }), res);
      assert.equal(res.statusCode, 502);
      assert.ok(!JSON.stringify(res.body ?? '').includes(FAKE_KEY));
    });
  } finally {
    stub.restore();
  }
});

test('a failed state query still returns the tract figures', async () => {
  const stub = stubFetch(async (url) => (
    url.includes('for=tract') ? censusUpstream(url) : new Response('nope', { status: 500 })
  ));
  try {
    await withKey(FAKE_KEY, async () => {
      const res = mockRes();
      await handler(get({ fips: '06085504602' }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.population, 2056);
      assert.equal(res.body.stateMedianFamilyIncome, 0);
    });
  } finally {
    stub.restore();
  }
});
