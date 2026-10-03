// Placed-store formats (docs/07 "Store customization"). Codes match the pt=
// tokens in src/lib/urlState.js and the formats src/engine/scenarioEngine.js
// reads: only 's' joins the counted store set, so the other three can never
// change the test result. A missing or unknown code means 's', as in links.
export const DEFAULT_STORE_FORMAT = 's';

export const STORE_FORMATS = [
  { code: 's', label: 'Supermarket or supercenter', counts: true, note: null },
  {
    code: 'g',
    label: 'Small grocery or corner store',
    counts: false,
    note: "USDA's supermarket-based measure doesn't count small grocers.",
  },
  {
    code: 'd',
    label: 'Dollar store',
    counts: false,
    note: "USDA's supermarket-based measure excludes dollar stores.",
  },
  {
    code: 'f',
    label: 'Farmers or mobile market',
    counts: false,
    note: 'Neither USDA map counts farmers or mobile markets.',
  },
];

export function storeFormatInfo(code) {
  return STORE_FORMATS.find((f) => f.code === code) ?? STORE_FORMATS[0];
}

// Fixed strings only, so it is safe as Leaflet tooltip HTML.
export function placedPinLabel(code) {
  const f = storeFormatInfo(code);
  return `Your store · ${f.label} (${f.counts ? 'counts' : "doesn't count"})`;
}

/*
 * What the map legend may say about the counted (SNAP) store layer.
 * 'stores' when there are stores to draw; 'not_covered' when the tract is in
 * a territory that doesn't run SNAP (access.reason 'stores_not_covered'), so
 * an empty layer says nothing about real supermarkets; 'none' only when the
 * SNAP list loaded (`loaded === true`, i.e. access.storesDataset is set) and
 * has no counted store near the tract; otherwise 'unavailable' — a list that
 * failed to load is never described as "no stores".
 */
export const STORE_LIST_UNAVAILABLE_TEXT = "SNAP store list didn't load";
export const STORE_LIST_NOT_COVERED_TEXT = "No SNAP stores listed here: this territory doesn't run SNAP";

export function noCountedStoresText(marginMi) {
  return `No counted supermarkets within about ${marginMi} mi of this tract`;
}

export function storeLayerStatus(count, loaded, notCovered = false) {
  if (Number.isFinite(count) && count > 0) return 'stores';
  if (notCovered === true) return 'not_covered';
  return loaded === true ? 'none' : 'unavailable';
}
