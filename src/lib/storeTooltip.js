const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Leaflet writes string tooltip content with innerHTML, and store names come
// from the USDA SNAP retailer list (third-party text). Escape before it
// reaches the map.
export function storeTooltipLabel(store) {
  const name = escapeHtml(store?.name || 'Supermarket');
  const miles = Number.isFinite(store?.distanceMiles) ? ` · ${store.distanceMiles.toFixed(1)} mi` : '';
  return `${name}${miles}`;
}
