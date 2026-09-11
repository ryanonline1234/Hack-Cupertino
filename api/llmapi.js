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

  // OpenRouter model IDs are provider-prefixed (e.g.
  // "anthropic/claude-3-5-haiku"). Map the bare client model name so the
  // front end can stay provider-agnostic; pass through anything already
  // prefixed unchanged.
  let model = body.model || 'claude-3-5-haiku';
  if (useOpenRouter && !model.includes('/')) {
    model = `anthropic/${model}`;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (useOpenRouter) {
    headers['HTTP-Referer'] = 'https://github.com/ryanonline1234/Hack-Cupertino';
    headers['X-Title'] = 'NutriPlan.AI — Food Desert Impact Simulator';
  }

  try {
    const upstream = await fetch(
      useOpenRouter ? OPENROUTER_URL : LEGACY_LLMAPI_URL,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: body.max_tokens ?? 600,
          temperature: body.temperature ?? 0.45,
          messages: body.messages || [],
        }),
      },
    );

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Upstream LLM API failed', detail: String(err?.message || err) });
  }
}
