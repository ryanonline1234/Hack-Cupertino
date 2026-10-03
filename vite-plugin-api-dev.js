// Runs the Vercel functions in api/ under `vite` and `vite preview`, so local
// dev exercises the same handlers production does instead of proxying around
// them. Only the routes listed here are mounted; the remaining /api/* paths
// are plain pass-through proxies (vite.config.js server.proxy).
//
// Server-only env vars (e.g. CENSUS_KEY) are copied from .env into
// process.env for the handlers. They have no VITE_ prefix, so Vite never
// exposes them to client code.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

const ROUTES = {
  '/api/acs': 'api/acs.js',
  '/api/overpass': 'api/overpass.js',
};
const SERVER_ENV = ['CENSUS_KEY'];
const MAX_BODY_BYTES = 16 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Mirror the parts of Vercel's request/response helpers the handlers use.
function adapt(req, res, url, rawBody) {
  req.query = {};
  for (const [name, value] of url.searchParams) {
    req.query[name] = name in req.query ? [].concat(req.query[name], value) : value;
  }
  const isJson = (req.headers['content-type'] || '').includes('application/json');
  if (rawBody && isJson) {
    try {
      req.body = JSON.parse(rawBody);
    } catch {
      req.body = rawBody;
    }
  } else {
    req.body = rawBody;
  }

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
    return res;
  };
}

function middleware(root) {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const file = ROUTES[url.pathname];
    if (!file) {
      next();
      return;
    }
    try {
      const rawBody = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
      adapt(req, res, url, rawBody);
      const { default: handler } = await import(pathToFileURL(path.join(root, file)).href);
      await handler(req, res);
    } catch (err) {
      res.statusCode = err?.status || 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.status ? err.message : 'Local API handler failed' }));
    }
  };
}

export default function apiDev() {
  let root = process.cwd();
  return {
    name: 'food-desert-api-dev',
    configResolved(config) {
      root = config.root;
      const env = loadEnv(config.mode, config.envDir || config.root, '');
      for (const name of SERVER_ENV) {
        if (env[name] && !process.env[name]) process.env[name] = env[name];
      }
    },
    // Registered directly (not returned as a post hook) so these routes run
    // before Vite's own proxy middleware.
    configureServer(server) {
      server.middlewares.use(middleware(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(root));
    },
  };
}
