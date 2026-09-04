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
 * The provider behind this is chosen by LLM_PROVIDER (default: openrouter)
 * and is not disclosed to the browser.
 *
 * Request:  { metrics: { lowAccessPct, diabetesPct, ..., isFoodDesert, isRural } }
 * Response: { daily_reality: string, what_would_change: string }
 */

import { guardRequest } from './_guard.js';
import {
  LlmConfigError,
  LlmUpstreamError,
  generateNarrative,
  requiredKeyName,
  sanitizeMetrics,
} from './_llm.js';

/*
 * Tighter than the other endpoints, and tighter than it used to be.
 *
 * OpenRouter's free tier allows roughly 20 requests/minute and 200/day PER
 * KEY -- shared across every visitor, not per user. A 10/min per-IP limit is
 * looser than that in aggregate: three visitors could exhaust the upstream
 * minute budget while each stays inside their own. 6/min keeps a single
 * client from monopolising a shared allowance, and the browser's 6-hour
 * narrative cache absorbs the repeat traffic.
 */
const RATE_LIMIT = { limit: 6, windowMs: 60_000 };

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
    // Catch by type, not by string-matching the message. The old code looked
    // for 'ANTHROPIC_API_KEY' in the text, which silently stopped working the
    // moment a different provider was configured.
    if (err instanceof LlmConfigError) {
      console.error(`[llmapi] not configured (need ${requiredKeyName()}):`, err.message);
      res.status(500).json({ error: 'Narrative service is not configured' });
      return;
    }

    const status = err instanceof LlmUpstreamError && err.status ? err.status : 502;
    console.error(`[llmapi] generation failed (${status}):`, String(err?.message || err));

    /*
     * 429 is passed through rather than flattened to 502 so the browser's
     * backoff still works. On a shared free tier the daily cap is a normal
     * operating condition, so it gets its own message the UI can show.
     */
    if (status === 429) {
      res.status(429).json({
        error: 'Narrative rate limit reached',
        detail: 'The shared free-tier request budget is exhausted. Try again shortly.',
      });
      return;
    }

    res.status(status).json({ error: 'Narrative generation failed' });
  }
}
