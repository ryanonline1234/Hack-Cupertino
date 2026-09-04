/*
 * Anthropic provider. Not the default any more -- select it with
 * LLM_PROVIDER=anthropic.
 *
 * Kept rather than deleted so switching back is an environment-variable
 * change instead of a rewrite. It is also the reference implementation: a
 * provider with native structured-output support needs no response-parsing
 * fallback, which the OpenRouter path does.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LlmConfigError, LlmUpstreamError } from './_llm-errors.js';
import { NARRATIVE_SCHEMA, SYSTEM_PROMPT, buildNarrativePrompt } from './_llm-prompt.js';

export const DEFAULT_MODEL = 'claude-opus-5';

/*
 * max_tokens covers thinking as well as visible output. Thinking is on by
 * default on Opus 5, so a small budget truncates mid-sentence. `effort: low`
 * suits this task -- a short, grounded rewrite of numbers we already have.
 *
 * Note there is no `temperature`: it is removed on current Anthropic models
 * and sending it returns a 400.
 */
const MAX_TOKENS = 2048;
const EFFORT = 'low';

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LlmConfigError('ANTHROPIC_API_KEY is not configured');
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function generateNarrative(metrics) {
  let response;
  try {
    response = await getClient().messages.parse({
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: EFFORT,
        format: zodOutputFormat(NARRATIVE_SCHEMA),
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildNarrativePrompt(metrics) }],
    });
  } catch (err) {
    if (err instanceof LlmConfigError) throw err;
    // The SDK attaches a numeric status; carry it so the caller can pass a
    // 429 through as a 429.
    throw new LlmUpstreamError(String(err?.message || err), err?.status ?? null);
  }

  const parsed = response.parsed_output;
  if (!parsed?.daily_reality || !parsed?.what_would_change) {
    throw new LlmUpstreamError('Model returned no usable narrative', null);
  }
  return parsed;
}
