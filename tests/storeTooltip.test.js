import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { escapeHtml, storeTooltipLabel } from '../src/lib/storeTooltip.js';

test('escapeHtml neutralises markup characters', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('an OpenStreetMap store name cannot inject HTML into the tooltip', () => {
  const label = storeTooltipLabel({ name: '<img src=x onerror="alert(1)">', distanceMiles: 1.234 });
  assert.ok(!label.includes('<'), label);
  assert.equal(label, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; · 1.2 mi');
});

test('tooltip falls back to a generic name and skips a missing distance', () => {
  assert.equal(storeTooltipLabel({}), 'Supermarket');
  assert.equal(storeTooltipLabel({ name: "Trader Joe's" }), 'Trader Joe&#39;s');
});

test('MapView builds store tooltips through the escaping helper', () => {
  const source = readFileSync(new URL('../src/components/MapView.jsx', import.meta.url), 'utf8');
  assert.match(source, /bindTooltip\(\s*storeTooltipLabel\(s\)/);
});
