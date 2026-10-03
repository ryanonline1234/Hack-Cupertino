import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Client-readable env vars that are public by design. Anything else read via
// import.meta.env.VITE_* would be inlined into the bundle.
const PUBLIC_VITE_VARS = new Set(['VITE_CARTO_KEY']);

const BANNED_STRINGS = [
  '/api/llmapi',
  'openrouter.ai',
  'OPEN_ROUTER_API_KEY',
  'VITE_OPEN_ROUTER_API_KEY',
  'VITE_ANTHROPIC_KEY',
  'LLMAPI_KEY',
  'VITE_CENSUS_KEY',
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function shippedSourceFiles() {
  const roots = ['src', 'api'].flatMap((d) => walk(path.join(ROOT, d)));
  const singles = ['index.html', 'vite.config.js', 'vite-plugin-api-dev.js', 'vercel.json', '.env.example']
    .map((f) => path.join(ROOT, f))
    .filter(existsSync);
  return [...roots, ...singles];
}

test('the runtime LLM relay and narrative card are gone', () => {
  assert.equal(existsSync(path.join(ROOT, 'api/llmapi.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'src/components/AICard.jsx')), false);
});

test('no shipped source references the LLM path or retired key names', () => {
  const hits = [];
  for (const file of shippedSourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const banned of BANNED_STRINGS) {
      if (text.includes(banned)) hits.push(`${path.relative(ROOT, file)}: ${banned}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('client code reads only public VITE_ env vars', () => {
  const hits = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
      if (!PUBLIC_VITE_VARS.has(match[1])) hits.push(`${path.relative(ROOT, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('vercel.json no longer exposes a raw Census API pass-through', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const destinations = (config.rewrites || []).map((r) => r.destination);
  assert.ok(!destinations.some((d) => d.startsWith('https://api.census.gov')));
});

// Turn a vercel.json source like "/api/x/:path(a|b)" into a RegExp.
function sourceToRegExp(source) {
  const pattern = source.replace(/:[A-Za-z]+\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g, '($1)');
  return new RegExp(`^${pattern}$`);
}

test('pass-through rewrites cover exactly the upstream paths the app calls', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const sources = (config.rewrites || []).map((r) => r.source);
  for (const source of sources) {
    assert.ok(!source.includes('*'), `wildcard rewrite left in vercel.json: ${source}`);
  }
  const matchers = sources.map(sourceToRegExp);
  const covered = (p) => matchers.some((re) => re.test(p));

  const used = [
    '/api/cdc/resource/cwsq-ngmh.json',
    '/api/census-geocoder/geocoder/geographies/coordinates',
    '/api/census-geocoder/geocoder/locations/onelineaddress',
    '/api/nominatim/reverse',
    '/api/nominatim/search',
  ];
  for (const p of used) assert.ok(covered(p), `no rewrite for ${p}`);

  const unused = [
    '/api/nominatim/ui/search.html',
    '/api/nominatim/status',
    '/api/cdc/resource/other.json',
    '/api/census-geocoder/geocoder/',
    '/api/census-geocoder/',
  ];
  for (const p of unused) assert.ok(!covered(p), `rewrite still forwards ${p}`);
});
