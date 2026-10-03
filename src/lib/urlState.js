/*
 * Encodes the analyzed-location and panel layout into the URL hash so a
 * page reload (or a copied link) restores the same view.
 *
 * Format:
 *   #lat=37.339&lng=-121.894&layout=split&bh=320&sw=560&hl=1&pins=37.3390,-121.8940;37.3412,-121.8901&pt=s;g
 *
 * Fields:
 *   lat, lng → analyzed location (will trigger pipeline run on hydrate)
 *   layout   → 'bottom' | 'split' (panel layout)
 *   bh       → bottom-strip panel height in px
 *   sw       → split-column panel width in px
 *   hl       → '1' if highlight food sources mode was on (informational
 *              hint for child components; the feature lives in StreetsGlView)
 *   pins     → placed-store scenario pins as lat,lng pairs joined by ';'.
 *              Restored after the pipeline runs on hydrate, so a copied link
 *              replays the full "place a store" scenario with no database —
 *              the URL is the share payload.
 *   pt       → store format per pin, index-aligned with pins and joined by
 *              ';': s (supermarket/supercenter), g (small grocery), d (dollar
 *              store), f (farmers/mobile market). A missing or unknown token
 *              means s, which is what every link from before pt= meant.
 *              Omitted when every pin is s.
 *
 * We use the URL hash (not search params) so the history doesn't pollute
 * server-side rendering or bust the cache when the user shares a link.
 */

// Placed pins share the Sim Lab 10-pin cap so a link can never encode more
// pins than the UI itself allows.
export const MAX_SHARED_PINS = 10;

export const PIN_FORMATS = ['s', 'g', 'd', 'f'];
const DEFAULT_PIN_FORMAT = 's';

function pinFormat(token) {
  return PIN_FORMATS.includes(token) ? token : DEFAULT_PIN_FORMAT;
}

// 4 decimals ≈ 11 m precision — plenty for a scenario pin, keeps links short.
function formatPin(pin) {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null;
  if (Math.abs(pin.lat) > 90 || Math.abs(pin.lng) > 180) return null;
  return `${Number(pin.lat).toFixed(4)},${Number(pin.lng).toFixed(4)}`;
}

function parsePin(segment) {
  const parts = String(segment || '').split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function readNumber(params, key) {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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

  if (Array.isArray(state.pins) && state.pins.length > 0) {
    // Pair each pin with its format before dropping invalid pins, so the two
    // lists can't drift out of alignment.
    const encoded = state.pins
      .slice(0, MAX_SHARED_PINS)
      .map((pin) => ({ segment: formatPin(pin), token: pinFormat(pin?.format) }))
      .filter((p) => p.segment);
    if (encoded.length > 0) {
      params.set('pins', encoded.map((p) => p.segment).join(';'));
      if (encoded.some((p) => p.token !== DEFAULT_PIN_FORMAT)) {
        params.set('pt', encoded.map((p) => p.token).join(';'));
      }
    }
  }

  return params.toString();
}

export function decodeAppState(hashOrSearch) {
  const cleaned = (hashOrSearch || '').replace(/^[#?]/, '');
  if (!cleaned) return {};
  const params = new URLSearchParams(cleaned);
  const result = {};

  // Number(null) and Number('') are 0, so an absent or empty key must be
  // ruled out first or a pins-only hash would land at 0,0.
  const lat = readNumber(params, 'lat');
  const lng = readNumber(params, 'lng');
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
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

  const rawPins = params.get('pins');
  if (typeof rawPins === 'string' && rawPins.length > 0) {
    const tokens = (params.get('pt') || '').split(';');
    const pins = rawPins
      .split(';')
      .slice(0, MAX_SHARED_PINS)
      .map((segment, i) => {
        const pin = parsePin(segment);
        return pin && { ...pin, format: pinFormat(tokens[i]) };
      })
      .filter(Boolean);
    if (pins.length > 0) result.pins = pins;
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
