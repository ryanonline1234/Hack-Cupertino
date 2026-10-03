// Labels for suggested sites (docs/08 §1). Fixed strings; the only
// third-party text is a vacant shop's OpenStreetMap name, escaped in
// siteLabel because Leaflet writes string tooltips with innerHTML. React text
// nodes escape on their own, so they take siteLabelText (same words, name
// unescaped) to avoid showing "&amp;" on screen. Other sites never show a
// name: on a building or retail area in use, the name is the business there
// now, and the label would read as a plan to replace it.
import { escapeHtml } from './storeTooltip.js';

export const BLOCK_SITE_KIND = 'block';
// True however blocks were reached: no site file, a failed one, no
// commercial site that brings anyone within T, or the visitor's choice.
export const BLOCK_SITE_LABEL = 'Inside a populated Census block (not a commercial site)';
export const SUGGEST_SITES_CAVEAT =
  "Distance only. Ignores land, zoning, cost, and whether a grocer would open there. Commercial sites are existing OpenStreetMap features; the app doesn't know whether they're available.";
export const SQFT_PER_ACRE = 43_560;

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// "≈12,000": a building footprint to the nearest 1,000 sq ft. null when the
// size is missing or rounds to nothing, so no label claims a size it lacks.
export function fmtFootprintSqft(sqft) {
  if (!positive(sqft)) return null;
  const rounded = Math.round(sqft / 1000) * 1000;
  return rounded > 0 ? `≈${rounded.toLocaleString('en-US')}` : null;
}

// "2.3": an area given in sq ft, as acres to one decimal.
export function fmtAcres(sqft) {
  if (!positive(sqft)) return null;
  const tenths = Math.round((sqft / SQFT_PER_ACRE) * 10);
  return tenths > 0
    ? (tenths / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : null;
}

function nameSuffix(name, escape) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return ` · ${escape ? escapeHtml(trimmed) : trimmed}`;
}

function label(site, escape) {
  if (!site || typeof site !== 'object') return null;
  const { kind, sqft } = site;
  if (kind === BLOCK_SITE_KIND) return BLOCK_SITE_LABEL;
  if (kind === 'vacant') return `Vacant shop${nameSuffix(site.name, escape)} (OpenStreetMap)`;
  if (kind === 'building') {
    const size = fmtFootprintSqft(sqft);
    return size && `Retail building, ${size} sq ft footprint (OpenStreetMap)`;
  }
  if (kind === 'commercial_building') {
    const size = fmtFootprintSqft(sqft);
    return size && `Commercial building (offices or shops), ${size} sq ft footprint (OpenStreetMap)`;
  }
  if (kind === 'retail_area') {
    const acres = fmtAcres(sqft);
    return acres && `Retail area, ≈${acres} acres (OpenStreetMap)`;
  }
  return null;
}

// site: { kind: 'vacant' | 'building' | 'commercial_building' | 'retail_area'
//   | 'block', sqft?, name? }; the name shows for vacant shops only.
// -> the label with the name HTML-escaped, or null for an unknown kind or a
// building / retail area without a usable size.
export function siteLabel(site) {
  return label(site, true);
}

// The same label with the name as plain text, for React (which escapes).
export function siteLabelText(site) {
  return label(site, false);
}
