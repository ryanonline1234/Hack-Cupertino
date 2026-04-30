// Vercel serverless function: server-side proxy for Overpass.
//
// Direct browser calls to overpass-api.de fail in production with HTTP 406
// "Origin not allowed by Access-Control-Allow-Origin". Routing through
// /api/overpass on the same Vercel origin avoids the cross-origin policy.
//
// We rotate through several Overpass mirrors so a single endpoint outage
// doesn't take down distance-based food-desert classification.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const REQUEST_TIMEOUT_MS = 12000;

async function tryEndpoint(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'food-desert-simulator/1.0' },
    });
    if (!upstream.ok) throw new Error(`Overpass ${upstream.status}`);
    return await upstream.text();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body =
    typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (req.body && JSON.stringify(req.body)) || '';

  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const text = await tryEndpoint(endpoint, body);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      res.status(200).send(text);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  res.status(502).json({ error: 'All Overpass endpoints failed', detail: String(lastError?.message || lastError) });
}
