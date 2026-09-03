/*
 * Runs the api/*.js serverless handlers inside the Vite dev server.
 *
 * Why this exists
 * ---------------
 * `npm run dev` starts Vite, which serves the SPA but does not execute
 * anything in api/. Previously that did not matter: /api/llmapi and
 * /api/census were plain proxy rewrites, so dev and production took different
 * but equivalent paths.
 *
 * That is no longer true. Those endpoints now hold real logic — request
 * validation, the narrative prompt, and the server-only API keys — so dev has
 * to run the same code production does, or local testing proves nothing.
 *
 * This adapts Vite's Connect-style (req, res) to the Vercel handler signature:
 * it buffers and parses the body, and shims res.status/.json/.send. Handlers
 * are imported per request so edits take effect without restarting the server.
 */

const HANDLED_ROUTES = ['/api/llmapi', '/api/overpass', '/api/census'];
const MAX_BODY_BYTES = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Vercel handlers call res.status(n).json(x); Node's ServerResponse does not
// have those, so add them.
function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    res.end(typeof payload === 'string' ? payload : String(payload));
    return res;
  };
  return res;
}

export default function apiDevPlugin() {
  return {
    name: 'food-desert-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (!HANDLED_ROUTES.includes(path)) {
          next();
          return;
        }

        try {
          req.body = await readBody(req);
        } catch (err) {
          decorateResponse(res).status(413).json({ error: String(err.message) });
          return;
        }

        try {
          const mod = await server.ssrLoadModule(`.${path}.js`);
          await mod.default(req, decorateResponse(res));
        } catch (err) {
          server.config.logger.error(`[api-dev] ${path} failed: ${err?.stack || err}`);
          if (!res.writableEnded) {
            decorateResponse(res).status(500).json({ error: 'Dev handler failed' });
          }
        }
      });
    },
  };
}
