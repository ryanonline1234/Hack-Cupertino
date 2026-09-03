/*
 * Claude client and narrative generation.
 *
 * What changed and why
 * --------------------
 * Previously the browser built the entire prompt (AICard.jsx) and POSTed a raw
 * `messages` array to a proxy that forwarded it verbatim to api.llmapi.ai, a
 * third-party OpenAI-compatible aggregator, asking for the alias
 * "claude-3-5-haiku". Three problems with that:
 *
 *   1. Security. A caller-supplied `messages` array means the endpoint will say
 *      anything you ask it to, on our key. Prompt construction now happens
 *      here, from a fixed template, over numbers we have validated.
 *   2. Indirection. The aggregator sat between us and the model for no benefit
 *      we were using. This now calls Anthropic directly via the official SDK.
 *   3. Fragility. The model was asked for "exactly two paragraphs" and the
 *      client re-split the reply at a sentence midpoint when it disobeyed.
 *      Structured output makes the two-field shape a guarantee instead.
 *
 * Swapping model or provider
 * --------------------------
 * Model: set LLM_MODEL. Nothing else needs to change.
 * Provider: this file is the only place that knows about Anthropic. Replace
 * `generateNarrative` and keep its signature and return shape, and no caller
 * changes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// Current Anthropic model IDs carry no date suffix. Override with LLM_MODEL.
export const DEFAULT_MODEL = 'claude-opus-5';

/*
 * max_tokens has to cover thinking as well as visible output. Thinking is on
 * by default on Opus 5, so the old value of 600 would have truncated the reply
 * mid-sentence. `effort: low` suits this task — a short, grounded rewrite of
 * numbers we already computed — and keeps the token spend down.
 *
 * Note there is no `temperature` here. It is removed on current models and
 * sending it returns a 400; the previous code sent 0.45.
 */
const MAX_TOKENS = 2048;
const EFFORT = 'low';

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/*
 * The narrative is two fields, not two paragraphs of prose we have to re-split.
 * `client.messages.parse` validates the reply against this schema for us.
 */
const NarrativeSchema = z.object({
  daily_reality: z
    .string()
    .describe('One paragraph, plain English, on what daily food access looks like for residents here. Specific and human, not clinical.'),
  what_would_change: z
    .string()
    .describe('One paragraph on what would realistically change if a grocery store opened, grounded in the supplied numbers. No jargon, no disclaimers.'),
});

/*
 * Only these fields cross the network boundary, and every one is coerced to a
 * number or null before it reaches the prompt. This is the injection defense:
 * no caller-supplied string is ever interpolated into the template.
 */
const NUMERIC_FIELDS = [
  'lowAccessPct',
  'diabetesPct',
  'obesityPct',
  'medianIncome',
  'povertyPct',
  'noVehicleLowAccessPct',
  'residentsGainingAccess',
  'diabetesReductionPct',
  'jobsMin',
  'jobsMax',
  'annualLocalImpact',
];

export function sanitizeMetrics(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const clean = {};
  for (const field of NUMERIC_FIELDS) {
    const n = Number(raw[field]);
    // null is meaningful: it means the upstream source had no value for this
    // tract. The template renders it as "unavailable" rather than as zero.
    clean[field] = Number.isFinite(n) ? n : null;
  }

  // isFoodDesert is deliberately tri-state: true, false, or null for Unknown.
  clean.isFoodDesert = raw.isFoodDesert === true
    ? true
    : raw.isFoodDesert === false
      ? false
      : null;
  clean.isRural = raw.isRural === true;

  return clean;
}

// ── Prompt template ─────────────────────────────────────────────────────────
function num(value, { suffix = '', prefix = '', digits = 1 } = {}) {
  if (value == null) return 'unavailable';
  return `${prefix}${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

function whole(value, { prefix = '' } = {}) {
  if (value == null) return 'unavailable';
  return `${prefix}${Math.round(Number(value)).toLocaleString('en-US')}`;
}

function designationLabel(isFoodDesert) {
  if (isFoodDesert === true) return 'yes';
  if (isFoodDesert === false) return 'no';
  return 'unknown — the evidence needed to decide was unavailable';
}

export const SYSTEM_PROMPT =
  'You are a civic-health narrative writer. Write clear, human language grounded only in the numbers provided. '
  + 'Avoid hype and avoid hedging. Never use bullet points. '
  + 'When a value is given as "unavailable", say plainly that it is not known — never guess it, and never treat it as zero.';

export function buildNarrativePrompt(m) {
  const lowAccessRule = m.isRural ? '10 miles (rural)' : '1 mile (urban)';

  return `Analyze food access for a US census tract and describe it for a general audience.

Community data:
- Classified as a food desert: ${designationLabel(m.isFoodDesert)}
- Population with low grocery access (within ${lowAccessRule}): ${num(m.lowAccessPct, { suffix: '%' })}
- Diabetes prevalence (adults): ${num(m.diabetesPct, { suffix: '%' })}
- Obesity prevalence (adults): ${num(m.obesityPct, { suffix: '%' })}
- Median household income: ${whole(m.medianIncome, { prefix: '$' })}
- Poverty rate: ${num(m.povertyPct, { suffix: '%' })}
- Households with no vehicle and low access: ${num(m.noVehicleLowAccessPct, { suffix: '%' })}

Projected impact of adding one grocery store:
- Residents gaining access: ${whole(m.residentsGainingAccess)}
- Diabetes rate change: ${m.diabetesReductionPct == null ? 'unavailable' : `-${num(m.diabetesReductionPct)} percentage points`}
- Jobs created: ${m.jobsMin == null || m.jobsMax == null ? 'unavailable' : `${whole(m.jobsMin)}–${whole(m.jobsMax)}`}
- Annual local economic impact: ${whole(m.annualLocalImpact, { prefix: '$' })}

Write two short paragraphs. Do not repeat the numbers as a list; work them into the prose.`;
}

// ── Generation ──────────────────────────────────────────────────────────────
/*
 * Returns { daily_reality, what_would_change }. Throws on API failure so the
 * handler can map it to a status code; the browser keeps its own retry,
 * de-duplication and caching layer on top of this.
 */
export async function generateNarrative(metrics) {
  const response = await getClient().messages.parse({
    model: process.env.LLM_MODEL || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: EFFORT,
      format: zodOutputFormat(NarrativeSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildNarrativePrompt(metrics) }],
  });

  // parsed_output is null when the reply did not satisfy the schema.
  const parsed = response.parsed_output;
  if (!parsed?.daily_reality || !parsed?.what_would_change) {
    throw new Error('Model returned no usable narrative');
  }

  return parsed;
}
