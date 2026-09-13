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

// No timeouts anywhere in this path (owner call): no per-endpoint abort,
// no watchdog. Instead ALL mirrors are queried in parallel and the first
// success wins (Promise.any) — a hung mirror like kumi.systems can never
// wedge the pipeline, and fast failures (HTTP 504 etc.) just lose the
// race. Costs 3× upstream load per query; the traffic here is tiny.
// Response shape: { status, text, winner } so logs show which mirror won.
async function tryEndpoint(url, body) {
  const upstream = await fetch(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'food-desert-simulator/1.0' },
  });
  if (!upstream.ok) throw new Error(`Overpass ${upstream.status} from ${url}`);
  return { status: upstream.status, text: await upstream.text(), winner: url };
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

  try {
    const result = await Promise.any(ENDPOINTS.map((endpoint) => tryEndpoint(endpoint, body)));
    console.log(`[overpass] won by ${result.winner} (${result.status})`);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).send(result.text);
    return;
  } catch (err) {
    const detail = err?.errors?.map((e) => String(e?.message || e)).join(' | ') || String(err?.message || err);
    console.error(`[overpass] all mirrors failed: ${detail.slice(0, 300)}`);
    res.status(502).json({ error: 'All Overpass endpoints failed', detail });
  }
}
