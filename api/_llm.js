/*
 * Narrative generation -- provider dispatch.
 *
 * This file used to hold the Anthropic client, the prompt and the schema all
 * at once, with a header claiming it was "the only place that knows about
 * Anthropic". That was nearly true, and the nearly cost us: api/llmapi.js
 * detected misconfiguration by string-matching the env var name out of an
 * error message, and depended on the Anthropic SDK's numeric `.status`.
 *
 * The pieces now live apart:
 *   _llm-prompt.js     prompt, schema, metric sanitisation  (provider-neutral)
 *   _llm-errors.js     LlmConfigError / LlmUpstreamError    (typed, catchable)
 *   _llm-openrouter.js OpenRouter -- the default
 *   _llm-anthropic.js  Anthropic  -- LLM_PROVIDER=anthropic
 *
 * Adding a provider means one module exporting `generateNarrative(metrics)`
 * that returns { daily_reality, what_would_change } and throws the two error
 * types above. Nothing else changes.
 */

import { LlmConfigError, LlmUpstreamError } from './_llm-errors.js';
import * as openrouter from './_llm-openrouter.js';
import * as anthropic from './_llm-anthropic.js';

export { LlmConfigError, LlmUpstreamError };
export { sanitizeMetrics } from './_llm-prompt.js';

const PROVIDERS = { openrouter, anthropic };
const DEFAULT_PROVIDER = 'openrouter';

export function activeProviderName() {
  return (process.env.LLM_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
}

/*
 * The env var name this deployment needs set, used for operator-facing log
 * messages. Deliberately not surfaced to the browser -- the client has no
 * business knowing which provider backs the narrative.
 */
export function requiredKeyName() {
  return activeProviderName() === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
}

export async function generateNarrative(metrics) {
  const name = activeProviderName();
  const provider = PROVIDERS[name];

  if (!provider) {
    throw new LlmConfigError(
      `LLM_PROVIDER "${name}" is not recognised; expected one of: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }

  return provider.generateNarrative(metrics);
}
