// Vercel serverless function: server-side proxy for LLMApi (Claude via
// OpenAI-compatible interface). Two reasons this needs to live server-side:
//
//  1. Browser CORS: api.llmapi.ai does not consistently send
//     Access-Control-Allow-Origin for arbitrary browser origins.
//  2. Key safety: VITE_ANTHROPIC_KEY is currently bundled into the client
//     payload, meaning anyone can extract it from the production bundle.
//     Moving the call here lets us read the key from a server-only env var
//     (LLMAPI_KEY) without ever shipping it to the browser.
//
// Front-end usage (AICard.jsx):
//   POST /api/llmapi { messages, model, temperature, max_tokens }
//
// We forward exactly that to api.llmapi.ai/v1/chat/completions.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  // Prefer the server-only LLMAPI_KEY in production. Fall back to the public
  // VITE_ANTHROPIC_KEY only so existing local/dev setups keep working.
  const apiKey = process.env.LLMAPI_KEY || process.env.VITE_ANTHROPIC_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'LLMAPI_KEY not configured' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  try {
    const upstream = await fetch('https://api.llmapi.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model || 'claude-3-5-haiku',
        max_tokens: body.max_tokens ?? 600,
        temperature: body.temperature ?? 0.45,
        messages: body.messages || [],
      }),
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Upstream LLMApi failed', detail: String(err?.message || err) });
  }
}
