/*
 * Provider-neutral half of the narrative feature: the prompt, the output
 * schema, and metric sanitisation. Nothing in this file knows or cares which
 * model answers.
 *
 * Split out of api/_llm.js when OpenRouter became the default provider, so
 * that adding or swapping a provider never means re-deriving the prompt or
 * re-implementing the injection defense.
 */

import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

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
    const raw_ = raw[field];

    /*
     * Check for absence BEFORE coercing. Number(null) is 0 and Number('') is
     * 0, both of which pass Number.isFinite -- so coercing first silently
     * turned "this source had no value" into a hard zero, and the prompt then
     * told the model the tract had $0 median income. That is the exact bug
     * this null-handling exists to prevent, reintroduced at the boundary.
     */
    if (raw_ == null || raw_ === '') {
      clean[field] = null;
      continue;
    }

    const n = Number(raw_);
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


/*
 * The same schema in two shapes, from one definition.
 *
 * Anthropic's SDK takes the zod object through its own helper; OpenRouter
 * takes plain JSON Schema in an OpenAI-style envelope. `zodOutputFormat`
 * already produces `{ type, schema }`, so we unwrap and rewrap it rather than
 * maintaining a second hand-written copy that could drift.
 */
export const NARRATIVE_SCHEMA = NarrativeSchema;

export function narrativeJsonSchema() {
  const { schema } = zodOutputFormat(NarrativeSchema);
  return schema;
}
