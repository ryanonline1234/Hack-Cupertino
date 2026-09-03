/*
 * POST /api/llmapi — generate the community narrative for one tract.
 *
 * What changed and why
 * --------------------
 * This endpoint used to accept a caller-supplied `messages` array and forward
 * it verbatim to api.llmapi.ai with our API key, from any origin, with no rate
 * limit. That is an open LLM proxy: anyone who read the network tab on the
 * deployed site could send it arbitrary prompts on our account.
 *
 * It now accepts only `{ metrics }` — a fixed set of numbers, each coerced to
 * a number or null before use. The prompt is built server-side in api/_llm.js
 * from a template the caller cannot influence. There is no request shape that
 * makes this endpoint say something we did not write.
 *
 * Request:  { metrics: { lowAccessPct, diabetesPct, ..., isFoodDesert, isRural } }
 * Response: { daily_reality: string, what_would_change: string }
 */

import { guardRequest } from './_guard.js';
import { generateNarrative, sanitizeMetrics } from './_llm.js';

// Deliberately tighter than the other endpoints: every call here costs money.
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export default async function handler(req, res) {
  const guard = guardRequest(req, res, RATE_LIMIT);
  if (!guard) return;

  const metrics = sanitizeMetrics(guard.body.metrics);
  if (!metrics) {
    res.status(400).json({ error: 'Request must include a metrics object' });
    return;
  }

  try {
    const narrative = await generateNarrative(metrics);
    // The browser caches narratives for 6h itself; no shared cache here,
    // because the response is specific to one tract's numbers.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(narrative);
  } catch (err) {
    const message = String(err?.message || err);

    // A missing key is our misconfiguration, not the caller's fault, and is
    // worth distinguishing in logs from an upstream failure.
    if (message.includes('ANTHROPIC_API_KEY')) {
      console.error('[llmapi] not configured:', message);
      res.status(500).json({ error: 'Narrative service is not configured' });
      return;
    }

    console.error('[llmapi] generation failed:', message);
    // Pass through the upstream status when we have one so the client's
    // existing backoff can tell 429 and 5xx apart from a hard failure.
    const status = Number.isInteger(err?.status) ? err.status : 502;
    res.status(status).json({ error: 'Narrative generation failed' });
  }
}
