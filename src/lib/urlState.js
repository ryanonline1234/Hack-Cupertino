/*
 * Encodes the analyzed-location and panel layout into the URL hash so a
 * page reload (or a copied link) restores the same view.
 *
 * Format:
 *   #lat=37.339&lng=-121.894&layout=split&bh=320&sw=560&hl=1
 *
 * Fields:
 *   lat, lng → analyzed location (will trigger pipeline run on hydrate)
 *   layout   → 'bottom' | 'split' (panel layout)
 *   bh       → bottom-strip panel height in px
 *   sw       → split-column panel width in px
 *   hl       → '1' if highlight food sources mode was on (informational
 *              hint for child components; the feature lives in StreetsGlView)
 *
 * We use the URL hash (not search params) so the history doesn't pollute
 * server-side rendering or bust the cache when the user shares a link.
 */

export function encodeAppState(state) {
  const params = new URLSearchParams();

  if (Number.isFinite(state.lat) && Number.isFinite(state.lng)) {
    params.set('lat', Number(state.lat).toFixed(5));
    params.set('lng', Number(state.lng).toFixed(5));
  }
  if (state.layout === 'split' || state.layout === 'bottom') {
    params.set('layout', state.layout);
  }
  if (Number.isFinite(state.bottomPanelHeight)) {
    params.set('bh', String(Math.round(state.bottomPanelHeight)));
  }
  if (Number.isFinite(state.splitPanelWidth)) {
    params.set('sw', String(Math.round(state.splitPanelWidth)));
  }
  if (state.highlight) params.set('hl', '1');

  return params.toString();
}

export function decodeAppState(hashOrSearch) {
  const cleaned = (hashOrSearch || '').replace(/^[#?]/, '');
  if (!cleaned) return {};
  const params = new URLSearchParams(cleaned);
  const result = {};

  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    result.lat = lat;
    result.lng = lng;
  }

  const layout = params.get('layout');
  if (layout === 'split' || layout === 'bottom') {
    result.layout = layout;
  }

  const bh = Number(params.get('bh'));
  if (Number.isFinite(bh) && bh > 0 && bh < 4000) {
    result.bottomPanelHeight = bh;
  }

  const sw = Number(params.get('sw'));
  if (Number.isFinite(sw) && sw > 0 && sw < 4000) {
    result.splitPanelWidth = sw;
  }

  if (params.get('hl') === '1') {
    result.highlight = true;
  }

  return result;
}

/*
 * Replaces the URL hash without scrolling or pushing a new history entry.
 * The caller is responsible for debouncing — we don't want to hammer
 * history API on every drag of the resize splitter.
 */
export function writeAppStateToHash(state) {
  if (typeof window === 'undefined') return;
  const next = encodeAppState(state);
  const desired = next ? `#${next}` : '';
  // Avoid no-op writes; some browsers still register a history change.
  if (window.location.hash === desired) return;
  try {
    const url = `${window.location.pathname}${window.location.search}${desired}`;
    window.history.replaceState(null, '', url);
  } catch {
    // Some embedded contexts disallow replaceState; fall back to hash assignment.
    try { window.location.hash = next; } catch { /* noop */ }
  }
}
