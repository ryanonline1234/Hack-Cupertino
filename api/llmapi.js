// Vercel serverless function: server-side proxy for the AI narrative API.
//
// Two reasons this needs to live server-side:
//
//  1. Browser CORS: the upstream LLM API does not consistently send
//     Access-Control-Allow-Origin for arbitrary browser origins.
//  2. Key safety: a client-side key would be bundled into the production
//     JS, meaning anyone could extract it. Moving the call here lets us
//     read the key from a server-only env var (OPEN_ROUTER_API_KEY)
//     without ever shipping it to the browser.
//
// Front-end usage (AICard.jsx):
//   POST /api/llmapi { messages, model, temperature, max_tokens }
//
// We forward exactly that to OpenRouter's OpenAI-compatible endpoint
// (https://openrouter.ai/api/v1/chat/completions).
//
// NOTE: vercel.json must NOT contain a rewrite for /api/llmapi — the
// rewrite would shadow this function and forward the request upstream
// without the Authorization header.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Kept as a fallback for older deployments that still carry an LLMApi key.
const LEGACY_LLMAPI_URL = 'https://api.llmapi.ai/v1/chat/completions';
// Verified against https://openrouter.ai/api/v1/models (public, no auth).
// The old bare `claude-3-5-haiku` has no such OpenRouter ID and caused
// upstream 5xx responses, so the server maps it explicitly.
const OPENROUTER_PRIMARY_MODEL = 'anthropic/claude-haiku-4.5';
const OPENROUTER_FALLBACK_MODEL = 'anthropic/claude-3-haiku';

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function postChatCompletions(url, headers, payload) {
  const upstream = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  return { status: upstream.status, text };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  // Primary: server-only OpenRouter key. Fallbacks keep existing local/dev
  // setups working (LLMAPI_KEY, then the legacy public VITE_ANTHROPIC_KEY).
  const openRouterKey = process.env.OPEN_ROUTER_API_KEY;
  const apiKey =
    openRouterKey || process.env.LLMAPI_KEY || process.env.VITE_ANTHROPIC_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPEN_ROUTER_API_KEY not configured' });
    return;
  }
  const useOpenRouter = Boolean(openRouterKey);

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // The front end stays provider-agnostic: a bare/legacy model name maps
  // to the verified primary; an already-prefixed ID passes through
  // unchanged (lets us switch models without a client deploy).
  const requestedModel = body.model || 'claude-3-5-haiku';
  const primaryModel = !useOpenRouter
    ? requestedModel
    : (requestedModel.includes('/') ? requestedModel : OPENROUTER_PRIMARY_MODEL);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (useOpenRouter) {
    headers['HTTP-Referer'] = 'https://github.com/ryanonline1234/Hack-Cupertino';
    headers['X-Title'] = 'NutriPlan.AI — Food Desert Impact Simulator';
  }

  const payloadFor = (model) => ({
    model,
    max_tokens: body.max_tokens ?? 600,
    temperature: body.temperature ?? 0.45,
    messages: body.messages || [],
  });

  const isRetryable = (status) => status === 429 || (status >= 500 && status <= 599);

  try {
    const url = useOpenRouter ? OPENROUTER_URL : LEGACY_LLMAPI_URL;
    let result = await postChatCompletions(url, headers, payloadFor(primaryModel));

    // Transient provider errors: retry once, then try the fallback model.
    if (useOpenRouter && isRetryable(result.status)) {
      await wait(1200);
      result = await postChatCompletions(url, headers, payloadFor(primaryModel));
    }
    if (useOpenRouter && isRetryable(result.status) && primaryModel !== OPENROUTER_FALLBACK_MODEL) {
      console.error(`[llmapi] primary model ${primaryModel} -> ${result.status}, trying fallback. Body: ${result.text.slice(0, 300)}`);
      result = await postChatCompletions(url, headers, payloadFor(OPENROUTER_FALLBACK_MODEL));
    }

    if (result.status < 200 || result.status >= 300) {
      console.error(`[llmapi] upstream ${result.status}. Body: ${result.text.slice(0, 300)}`);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(result.status).send(result.text);
  } catch (err) {
    console.error(`[llmapi] fetch failed: ${String(err?.message || err)}`);
    res.status(502).json({ error: 'Upstream LLM API failed', detail: String(err?.message || err) });
  }
}
