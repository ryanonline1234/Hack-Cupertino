import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findLeakedKeys } from '../scripts/check-bundle-for-keys.mjs';

// Fake values shaped like the real ones. None of these is a live key.
const FAKE_CENSUS = '0123456789abcdef0123456789abcdef01234567';
const FAKE_LLMAPI = `llmapi_${'a1b2c3d4'.repeat(8)}`;
const FAKE_CARTO = 'cb1_public_tile_key_for_test_only';

function makeDist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-guard-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('flags a private env value inlined into the bundle, without echoing it', () => {
  const dir = makeDist({ 'assets/app.js': `fetch("/x?key=${FAKE_CENSUS}")` });
  try {
    const findings = findLeakedKeys({ dir, env: { CENSUS_KEY: FAKE_CENSUS } });
    assert.ok(findings.length >= 1);
    assert.equal(findings[0].file, path.join('assets', 'app.js'));
    assert.equal(findings[0].name, 'CENSUS_KEY');
    assert.ok(!JSON.stringify(findings).includes(FAKE_CENSUS), 'findings must not contain the value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags a URL-encoded copy of a private value', () => {
  const value = 'abc/def+ghi=jkl/mno+pqr';
  const dir = makeDist({ 'assets/app.js': `const u = "${encodeURIComponent(value)}";` });
  try {
    const findings = findLeakedKeys({ dir, env: { SOME_API_TOKEN: value } });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, 'SOME_API_TOKEN');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags known key shapes even when the env does not hold them', () => {
  const dir = makeDist({ 'assets/app.js': `const k = "${FAKE_LLMAPI}";` });
  try {
    const findings = findLeakedKeys({ dir, env: {} });
    assert.equal(findings.length, 1);
    assert.match(findings[0].name, /pattern/);
    assert.ok(!JSON.stringify(findings).includes(FAKE_LLMAPI));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes a clean bundle and allows the public CARTO tile key', () => {
  const dir = makeDist({
    'index.html': '<html></html>',
    'assets/app.js': `const tiles = "https://basemaps.cartocdn.com/x?api_key=${FAKE_CARTO}";`,
  });
  try {
    const findings = findLeakedKeys({
      dir,
      env: { VITE_CARTO_KEY: FAKE_CARTO, CENSUS_KEY: FAKE_CENSUS, SHORT_KEY: 'abc' },
    });
    assert.deepEqual(findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
