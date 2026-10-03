#!/usr/bin/env node
// Post-build guard: fail the build if dist/ contains a private key.
//
// Vite inlines every import.meta.env.VITE_* value into the client bundle, and
// that is how the Census and LLM keys ended up in production. This scans the
// built files for (a) the value of every private env var — plain and
// URL-encoded — and (b) known key shapes, and exits 1 on any hit. It never
// prints a value: only the file, the variable name or pattern, and a length.
//
// Usage: node scripts/check-bundle-for-keys.mjs [distDir]   (default: dist)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always treated as private when set, whatever their length.
const PRIVATE_NAMES = [
  'CENSUS_KEY',
  'VITE_CENSUS_KEY',
  'OPEN_ROUTER_API_KEY',
  'VITE_OPEN_ROUTER_API_KEY',
  'LLMAPI_KEY',
  'VITE_ANTHROPIC_KEY',
  'ANTHROPIC_API_KEY',
];
// Any other upper-case env var whose name looks like a credential is private
// too (upper-case only, so npm_package_keywords_* and friends don't count).
const PRIVATE_NAME_PATTERN = /^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*$/;
const MIN_VALUE_LENGTH = 12;
// Public by design (raster tile key, sent in every tile URL).
const PUBLIC_NAMES = new Set(['VITE_CARTO_KEY']);

const KEY_SHAPES = [
  { name: 'pattern:openrouter', re: /sk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: 'pattern:anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'pattern:openai', re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: 'pattern:llmapi', re: /llmapi_[A-Za-z0-9]{20,}/ },
  { name: 'pattern:census-key-param', re: /[?&]key=[0-9a-f]{40}(?![0-9a-f])/ },
];

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

function privateValues(env) {
  const out = [];
  for (const [name, raw] of Object.entries(env)) {
    if (PUBLIC_NAMES.has(name) || typeof raw !== 'string') continue;
    const value = raw.trim();
    const listed = PRIVATE_NAMES.includes(name);
    if (!listed && !PRIVATE_NAME_PATTERN.test(name)) continue;
    if (value.length < (listed ? 8 : MIN_VALUE_LENGTH)) continue;
    out.push({ name, value });
  }
  return out;
}

export function findLeakedKeys({ dir, env }) {
  const candidates = privateValues(env);
  const findings = [];
  for (const file of listFiles(dir)) {
    const buf = readFileSync(file);
    const rel = path.relative(dir, file);
    for (const { name, value } of candidates) {
      const encoded = encodeURIComponent(value);
      if (buf.includes(value) || (encoded !== value && buf.includes(encoded))) {
        findings.push({ file: rel, name, length: value.length });
      }
    }
    const text = buf.toString('latin1');
    for (const shape of KEY_SHAPES) {
      const match = text.match(shape.re);
      if (match) findings.push({ file: rel, name: shape.name, length: match[0].length });
    }
  }
  return findings;
}

async function main() {
  const root = process.cwd();
  const dir = path.resolve(root, process.argv[2] || 'dist');
  if (!existsSync(dir)) {
    console.error(`[key-guard] ${dir} does not exist; run the build first.`);
    process.exit(1);
  }

  // Same sources Vite reads at build time, plus the real process env (Vercel).
  const { loadEnv } = await import('vite');
  const env = { ...loadEnv('production', root, ''), ...process.env };

  for (const name of PRIVATE_NAMES) {
    if (name.startsWith('VITE_') && env[name]) {
      console.warn(`[key-guard] warning: ${name} is set. VITE_ vars are inlined if any client code reads them; remove it.`);
    }
  }

  const findings = findLeakedKeys({ dir, env });
  if (findings.length) {
    for (const f of findings) {
      console.error(`[key-guard] FAIL ${f.file}: contains ${f.name} (length ${f.length})`);
    }
    console.error('[key-guard] A private key would ship to the browser. Build failed.');
    process.exit(1);
  }
  console.log(`[key-guard] ok: no private key values or key shapes in ${path.relative(root, dir) || dir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
