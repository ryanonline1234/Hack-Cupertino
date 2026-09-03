/*
 * Shared request guard for every serverless function in this directory.
 *
 * Why this exists
 * ---------------
 * Before this module, `api/llmapi.js` and `api/overpass.js` were open relays:
 * they accepted a POST from any origin, forwarded the caller's own payload
 * upstream, and paid for it with our credentials. Anyone who opened devtools
 * on the deployed site had a free, unmetered LLM endpoint on our key, and a
 * free anonymous relay for arbitrary Overpass queries against volunteer-run
 * OSM mirrors.
 *
 * Every handler now runs `guardRequest` first. It enforces, in order:
 *   1. POST only.
 *   2. The request comes from an origin we recognise.
 *   3. The caller is under their per-IP rate limit.
 *   4. The body is JSON and below a hard size cap.
 *
 * The handler then builds its own upstream request from validated fields.
 * No handler forwards a caller-supplied payload verbatim any more.
 */

// ── Origin allowlist ────────────────────────────────────────────────────────
// Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment; VERCEL_URL is
// the per-deployment preview host. ALLOWED_ORIGINS lets an operator add extra
// hosts (custom domain, staging) as a comma-separated list without a code
// change. Local dev ports are always allowed — they cannot reach a production
// deployment, so they only matter when running `vercel dev` locally.
const LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const vercelHosts = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]
    .filter(Boolean)
    .map((host) => `https://${host}`);

  return new Set([...LOCAL_ORIGINS, ...vercelHosts, ...fromEnv]);
}

/*
 * A same-origin fetch from a browser sends no Origin header on some request
 * shapes, so a missing Origin is not by itself proof of abuse. We accept it
 * only when the Referer points at a host we allow; a cross-origin caller that
 * strips both headers is refused.
 */
function originIsAllowed(req) {
  const allowed = allowedOrigins();
  const origin = req.headers.origin;

  if (origin) return allowed.has(origin);

  const referer = req.headers.referer;
  if (!referer) return false;

  try {
    return allowed.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────
/*
 * Best-effort in-memory token bucket, keyed by client IP.
 *
 * Honest limitation: Vercel serverless instances are ephemeral and there may
 * be many of them, so this state is per-instance and resets on cold start. It
 * raises the cost of casual abuse (a script hammering the endpoint from one
 * IP) but it is NOT a hard guarantee. If this app ever takes real traffic,
 * swap this for a shared store — `@upstash/ratelimit` over Vercel KV is the
 * drop-in — and keep the same call signature below.
 */
const buckets = new Map();
const BUCKET_SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // First entry is the originating client; the rest are proxy hops.
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function sweepExpired(now, windowMs) {
  if (now - lastSweep < BUCKET_SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > windowMs) buckets.delete(key);
  }
}

function underRateLimit(req, { limit, windowMs }) {
  const now = Date.now();
  sweepExpired(now, windowMs);

  const key = `${clientIp(req)}:${req.url}`;
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((windowMs - (now - entry.windowStart)) / 1000),
    };
  }

  entry.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

// ── Body parsing ────────────────────────────────────────────────────────────
const DEFAULT_MAX_BODY_BYTES = 8 * 1024;

function parseJsonBody(req, maxBytes) {
  const raw = typeof req.body === 'string'
    ? req.body
    : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : req.body == null
        ? ''
        : JSON.stringify(req.body);

  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { error: 'Request body too large' };
  }

  if (!raw) return { value: {} };

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Body must be a JSON object' };
    }
    return { value: parsed };
  } catch {
    return { error: 'Body must be valid JSON' };
  }
}

/*
 * Run every check and, on failure, write the response and return null so the
 * handler can `if (!guard) return;` and stop. On success returns the parsed
 * body plus the resolved origin, which the handler echoes back in the CORS
 * header — a specific origin, never the `*` these endpoints used to send.
 */
export function guardRequest(req, res, options = {}) {
  const {
    limit = 20,
    windowMs = 60_000,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  } = options;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST only' });
    return null;
  }

  if (!originIsAllowed(req)) {
    // Deliberately terse: do not disclose the allowlist to an unknown caller.
    res.status(403).json({ error: 'Origin not allowed' });
    return null;
  }

  const rate = underRateLimit(req, { limit, windowMs });
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    res.status(429).json({ error: 'Rate limit exceeded' });
    return null;
  }

  const body = parseJsonBody(req, maxBodyBytes);
  if (body.error) {
    res.status(400).json({ error: body.error });
    return null;
  }

  const origin = req.headers.origin
    || (req.headers.referer ? new URL(req.headers.referer).origin : null);

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  return { body: body.value, origin };
}

// ── Small shared validators ─────────────────────────────────────────────────
export function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validLatitude(value) {
  const n = finiteNumber(value);
  return n != null && n >= -90 && n <= 90 ? n : null;
}

export function validLongitude(value) {
  const n = finiteNumber(value);
  return n != null && n >= -180 && n <= 180 ? n : null;
}

export function clampNumber(value, min, max, fallback) {
  const n = finiteNumber(value);
  if (n == null) return fallback;
  return Math.min(max, Math.max(min, n));
}
