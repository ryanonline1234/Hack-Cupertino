import assert from 'node:assert/strict';
import test from 'node:test';

import handler, { buildOverpassQuery } from '../api/overpass.js';
import { mockRes, stubFetch } from './helpers/mockVercelRes.js';

const SAN_JOSE = { lat: 37.3362, lng: -121.8906 };

function post(body, headers = {}) {
  return { method: 'POST', headers, body };
}

test('rejects non-POST methods', async () => {
  const res = mockRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('rejects raw Overpass QL instead of relaying it', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    const res = mockRes();
    await handler(post('[out:json];node["amenity"="bar"](50,7,51,8);out;'), res);
    assert.equal(res.statusCode, 400);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('rejects bodies larger than the cap', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    const res = mockRes();
    await handler(post(JSON.stringify({ ...SAN_JOSE, pad: 'x'.repeat(400) })), res);
    assert.equal(res.statusCode, 413);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('rejects missing, non-numeric and out-of-range coordinates', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    const bad = [
      {},
      { lat: '37.3', lng: '-121.9' },
      { lat: Number.NaN, lng: -121.9 },
      { lat: 51.5, lng: -0.12 }, // London
      { lat: 37.3, lng: 121.9 }, // sign flip lands in Asia
      { lat: 95, lng: -100 },
    ];
    for (const body of bad) {
      const res = mockRes();
      await handler(post(JSON.stringify(body)), res);
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('builds the supermarket query itself and races the mirrors', async () => {
  const stub = stubFetch(async (url) => {
    if (url.includes('overpass-api.de')) return new Response('{"elements":[]}', { status: 200 });
    return new Response('busy', { status: 504 });
  });
  try {
    const res = mockRes();
    await handler(post(JSON.stringify(SAN_JOSE)), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, '{"elements":[]}');
    assert.equal(stub.calls.length, 3);
    for (const call of stub.calls) {
      assert.equal(call.init.body, buildOverpassQuery(SAN_JOSE.lat, SAN_JOSE.lng));
    }
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    stub.restore();
  }
});

test('accepts an already-parsed object body (Vercel JSON parsing)', async () => {
  const stub = stubFetch(async () => new Response('{"elements":[]}', { status: 200 }));
  try {
    const res = mockRes();
    await handler(post({ ...SAN_JOSE }), res);
    assert.equal(res.statusCode, 200);
  } finally {
    stub.restore();
  }
});

test('the server-built query is the supermarket query with a 50-mile radius', () => {
  const query = buildOverpassQuery(SAN_JOSE.lat, SAN_JOSE.lng);
  assert.equal(
    query,
    '[out:json][timeout:25];(node["shop"="supermarket"](around:80467,37.3362,-121.8906);way["shop"="supermarket"](around:80467,37.3362,-121.8906););out center;',
  );
});

test('returns 502 when every mirror fails', async () => {
  const stub = stubFetch(async () => new Response('down', { status: 503 }));
  try {
    const res = mockRes();
    await handler(post(JSON.stringify(SAN_JOSE)), res);
    assert.equal(res.statusCode, 502);
  } finally {
    stub.restore();
  }
});

test('a body that fails Vercel JSON parsing gets 400, not a crash', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '24' },
    };
    // Vercel's req.body is a lazy getter that throws on invalid JSON.
    Object.defineProperty(req, 'body', {
      get() { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); },
    });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('the size cap applies to the raw body, not the re-serialized object', async () => {
  const stub = stubFetch(() => { throw new Error('must not reach upstream'); });
  try {
    const res = mockRes();
    // Vercel hands over a parsed object; the raw request was 100 kB of padding.
    await handler(post({ ...SAN_JOSE }, { 'content-length': '100000' }), res);
    assert.equal(res.statusCode, 413);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
