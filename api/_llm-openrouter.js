/*
 * OpenRouter provider -- the default.
 *
 * OpenAI-compatible chat-completions API, which lets us reach the free model
 * tier. Two things differ materially from the Anthropic path:
 *
 * 1. Structured output is best-effort. OpenRouter forwards `strict: true`,
 *    but enforcement depends on the underlying provider -- some guarantee a
 *    schema-conforming reply, others merely translate the schema and hope.
 *    Free models are the least reliable here, so `parseNarrativeContent`
 *    below recovers from four progressively messier shapes. On the Anthropic
 *    path none of that is needed.
 *
 * 2. Rate limits are shared, not per-user. The free tier allows roughly 20
 *    requests/minute and 200/day PER KEY, across every visitor to the site.
 *    A 429 from upstream is therefore normal operation, not an anomaly, and
 *    is passed through with its status so the client can back off and the UI
 *    can explain itself.
 */

import { LlmConfigError, LlmUpstreamError } from './_llm-errors.js';
import { SYSTEM_PROMPT, buildNarrativePrompt, narrativeJsonSchema } from './_llm-prompt.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/*
 * `openrouter/free` is a router: it picks among the currently-available free
 * models and filters for the capabilities a request needs, structured output
 * included. Free model IDs churn -- they are deprecated and renamed often --
 * so pinning one is a maintenance liability. The cost is that which model
 * answers varies, so narrative tone varies between tracts.
 *
 * Pin a specific model with LLM_MODEL if you want consistency.
 */
export const DEFAULT_MODEL = 'openrouter/free';

const MAX_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 45_000;

// ── Response parsing ────────────────────────────────────────────────────────
function usable(parsed) {
  const first = typeof parsed?.daily_reality === 'string' ? parsed.daily_reality.trim() : '';
  const second = typeof parsed?.what_would_change === 'string' ? parsed.what_would_change.trim() : '';
  return first && second ? { daily_reality: first, what_would_change: second } : null;
}

function tryJson(text) {
  try {
    return usable(JSON.parse(text));
  } catch {
    return null;
  }
}

/*
 * Pull the first balanced {...} out of a string. A model that wraps its JSON
 * in prose ("Here is the output: {...}  Hope that helps!") defeats a plain
 * JSON.parse but is trivially recoverable.
 */
function extractBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/*
 * Recover the two-paragraph narrative from whatever the model actually sent,
 * in descending order of how well it followed instructions.
 *
 * Step 5 is the sentence-midpoint split that was deleted when this app moved
 * to guaranteed structured output. It is back because a free model cannot
 * promise the shape. That is a real cost of the free tier, not an oversight.
 */
export function parseNarrativeContent(content) {
  const text = String(content || '').trim();
  if (!text) return null;

  // 1. Clean JSON.
  const direct = tryJson(text);
  if (direct) return direct;

  // 2. Fenced code block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryJson(fenced[1].trim());
    if (parsed) return parsed;
  }

  // 3. JSON embedded in prose.
  const balanced = extractBalancedObject(text);
  if (balanced) {
    const parsed = tryJson(balanced);
    if (parsed) return parsed;
  }

  // 4. Plain prose that respected the two-paragraph instruction.
  const blocks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    return { daily_reality: blocks[0], what_would_change: blocks[1] };
  }

  // 5. One block: split at the sentence midpoint. Lossy, and deliberately last.
  // Trim each sentence before joining: the match keeps the leading space that
  // followed the previous full stop, so joining with ' ' would double it.
  const sentences = (blocks[0] || '')
    .match(/[^.!?]+[.!?]+/g)
    ?.map((s) => s.trim())
    .filter(Boolean);

  if (sentences && sentences.length >= 2) {
    const pivot = Math.ceil(sentences.length / 2);
    return {
      daily_reality: sentences.slice(0, pivot).join(' '),
      what_would_change: sentences.slice(pivot).join(' '),
    };
  }

  return null;
}

// ── Request ─────────────────────────────────────────────────────────────────
export async function generateNarrative(metrics) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmConfigError('OPENROUTER_API_KEY is not configured');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    // Optional attribution headers; OpenRouter uses them for its rankings.
    'X-Title': 'Food Desert Simulator',
  };
  const siteUrl = process.env.OPENROUTER_SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  if (siteUrl) headers['HTTP-Referer'] = siteUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.LLM_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildNarrativePrompt(metrics) },
        ],
        // Honoured natively by some models, approximated by others, ignored by
        // a few. parseNarrativeContent covers the last two cases.
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'community_narrative',
            strict: true,
            schema: narrativeJsonSchema(),
          },
        },
      }),
    });
  } catch (err) {
    throw new LlmUpstreamError(
      controller.signal.aborted ? 'OpenRouter request timed out' : String(err?.message || err),
      null,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Status is carried, not flattened: 429 has to stay 429 so the browser
    // backs off instead of retrying straight into the daily cap.
    throw new LlmUpstreamError(
      `OpenRouter request failed: ${res.status} ${detail.slice(0, 200)}`,
      res.status,
    );
  }

  const json = await res.json().catch(() => null);

  // OpenRouter reports upstream provider failures in-band, with HTTP 200.
  if (json?.error) {
    throw new LlmUpstreamError(
      `OpenRouter provider error: ${json.error.message || 'unknown'}`,
      Number.isInteger(json.error.code) ? json.error.code : null,
    );
  }

  const narrative = parseNarrativeContent(json?.choices?.[0]?.message?.content);
  if (!narrative) {
    throw new LlmUpstreamError('Model returned no usable narrative', null);
  }
  return narrative;
}
