import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCK_SITE_KIND,
  BLOCK_SITE_LABEL,
  SQFT_PER_ACRE,
  SUGGEST_SITES_CAVEAT,
  fmtAcres,
  fmtFootprintSqft,
  siteLabel,
  siteLabelText,
} from '../src/lib/siteLabels.js';

// The fixed strings of docs/08 §1, verbatim.

test('the blocks label and the caveat are the docs/08 strings', () => {
  assert.equal(BLOCK_SITE_KIND, 'block');
  // True whichever way blocks were reached (no site file, a failed file, no
  // commercial site that helps, or the visitor's choice).
  assert.equal(BLOCK_SITE_LABEL, 'Inside a populated Census block (not a commercial site)');
  assert.equal(
    SUGGEST_SITES_CAVEAT,
    "Distance only. Ignores land, zoning, cost, and whether a grocer would open there. Commercial sites are existing OpenStreetMap features; the app doesn't know whether they're available.",
  );
  assert.equal(siteLabel({ kind: 'block' }), BLOCK_SITE_LABEL);
  // A block has no third-party name to show, even if one is passed.
  assert.equal(siteLabel({ kind: 'block', name: 'Somewhere' }), BLOCK_SITE_LABEL);
});

test('vacant shop: optional name, never a size', () => {
  assert.equal(siteLabel({ kind: 'vacant' }), 'Vacant shop (OpenStreetMap)');
  assert.equal(siteLabel({ kind: 'vacant', name: 'Old Video Store', sqft: 5000 }), 'Vacant shop · Old Video Store (OpenStreetMap)');
});

test('retail building: footprint rounded to the nearest 1,000 sq ft', () => {
  assert.equal(siteLabel({ kind: 'building', sqft: 12_345 }), 'Retail building, ≈12,000 sq ft footprint (OpenStreetMap)');
  assert.equal(siteLabel({ kind: 'building', sqft: 12_500 }), 'Retail building, ≈13,000 sq ft footprint (OpenStreetMap)');
  assert.equal(fmtFootprintSqft(9_999), '≈10,000');
  assert.equal(fmtFootprintSqft(1_499), '≈1,000');
});

test('commercial building (OSM building=commercial, often offices) says so', () => {
  assert.equal(
    siteLabel({ kind: 'commercial_building', sqft: 28_400 }),
    'Commercial building (offices or shops), ≈28,000 sq ft footprint (OpenStreetMap)',
  );
  assert.equal(siteLabel({ kind: 'commercial_building', sqft: 0 }), null);
});

test('only a vacant shop shows its OpenStreetMap name: on any other site it is the business there now', () => {
  assert.equal(siteLabel({ kind: 'building', sqft: 104_800, name: 'Plaza' }), 'Retail building, ≈105,000 sq ft footprint (OpenStreetMap)');
  assert.equal(
    siteLabel({ kind: 'commercial_building', sqft: 28_000, name: 'Big Tech Building 48' }),
    'Commercial building (offices or shops), ≈28,000 sq ft footprint (OpenStreetMap)',
  );
  assert.equal(siteLabel({ kind: 'retail_area', sqft: 100_000, name: 'Town Center' }), 'Retail area, ≈2.3 acres (OpenStreetMap)');
  assert.equal(siteLabelText({ kind: 'building', sqft: 20_000, name: 'Lodge 643' }), 'Retail building, ≈20,000 sq ft footprint (OpenStreetMap)');
  assert.equal(siteLabel({ kind: 'vacant', name: 'Former Market' }), 'Vacant shop · Former Market (OpenStreetMap)');
});

test('retail area: acres to one decimal', () => {
  assert.equal(SQFT_PER_ACRE, 43_560);
  assert.equal(siteLabel({ kind: 'retail_area', sqft: 2 * SQFT_PER_ACRE }), 'Retail area, ≈2.0 acres (OpenStreetMap)');
  assert.equal(siteLabel({ kind: 'retail_area', sqft: 100_000 }), 'Retail area, ≈2.3 acres (OpenStreetMap)');
  assert.equal(fmtAcres(1_234.56 * SQFT_PER_ACRE), '1,234.6');
  assert.equal(fmtAcres(0.25 * SQFT_PER_ACRE), '0.3');
});

test('a size that is missing, not positive, or rounds to zero gives no label (never a made-up size)', () => {
  for (const sqft of [undefined, null, Number.NaN, Infinity, 0, -5000, '12000', 499]) {
    assert.equal(siteLabel({ kind: 'building', sqft }), null, `building sqft ${String(sqft)}`);
    assert.equal(fmtFootprintSqft(sqft), null);
  }
  for (const sqft of [undefined, null, 0, -1, 0.04 * SQFT_PER_ACRE]) {
    assert.equal(siteLabel({ kind: 'retail_area', sqft }), null, `area sqft ${String(sqft)}`);
    assert.equal(fmtAcres(sqft), null);
  }
});

test('unknown kinds and bad input give null', () => {
  assert.equal(siteLabel({ kind: 'supermarket', sqft: 40_000 }), null);
  assert.equal(siteLabel({}), null);
  assert.equal(siteLabel(null), null);
  assert.equal(siteLabel(undefined), null);
  assert.equal(siteLabelText(null), null);
});

test('blank and non-string names are left out; names are trimmed', () => {
  for (const name of [undefined, null, '', '   ', 42, {}]) {
    assert.equal(siteLabel({ kind: 'vacant', name }), 'Vacant shop (OpenStreetMap)', `name ${String(name)}`);
  }
  assert.equal(siteLabel({ kind: 'vacant', name: '  Corner Market \n' }), 'Vacant shop · Corner Market (OpenStreetMap)');
});

test('a third-party name cannot inject HTML into the label', () => {
  const label = siteLabel({ kind: 'vacant', name: '<img src=x onerror="alert(1)">' });
  assert.ok(!label.includes('<'), label);
  assert.equal(label, 'Vacant shop · &lt;img src=x onerror=&quot;alert(1)&quot;&gt; (OpenStreetMap)');
  assert.ok(!siteLabel({ kind: 'building', sqft: 20_000, name: '<b>x</b>' }).includes('<'));
  assert.equal(siteLabel({ kind: 'vacant', name: "Lucky's & Co" }), 'Vacant shop · Lucky&#39;s &amp; Co (OpenStreetMap)');
});

test('siteLabelText is the same label with the name unescaped, for React text nodes', () => {
  assert.equal(siteLabelText({ kind: 'vacant', name: "Lucky's & Co" }), "Vacant shop · Lucky's & Co (OpenStreetMap)");
  assert.equal(siteLabelText({ kind: 'retail_area', sqft: 100_000 }), siteLabel({ kind: 'retail_area', sqft: 100_000 }));
  assert.equal(siteLabelText({ kind: 'block' }), BLOCK_SITE_LABEL);
  assert.equal(siteLabelText({ kind: 'building', sqft: 0 }), null);
});
