/*
 * Typed errors for the narrative providers.
 *
 * These exist to close a leak in the old provider seam: api/llmapi.js used to
 * detect a misconfigured deployment by string-matching 'ANTHROPIC_API_KEY'
 * against the thrown message, and relied on the Anthropic SDK attaching a
 * numeric `.status` to upstream failures. Both assumptions break under any
 * other provider -- and the second one breaks quietly, collapsing every
 * upstream failure to 502 so the browser's 429-aware backoff stops
 * distinguishing rate limits. That matters a great deal on a free tier with a
 * 200-request daily cap.
 *
 * Own file rather than living in _llm.js so providers can import them without
 * a circular dependency back through the dispatcher.
 */

/** The deployment is missing configuration. Our fault, not the caller's. */
export class LlmConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

/** The upstream provider failed. `status` is its HTTP status when we have one. */
export class LlmUpstreamError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'LlmUpstreamError';
    this.status = Number.isInteger(status) ? status : null;
  }
}
