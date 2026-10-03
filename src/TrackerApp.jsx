import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import FeatureNav from './components/FeatureNav';
import StreetsGlView from './components/StreetsGlView';
import LocationGate from './components/LocationGate';
import MobileResultsView from './components/MobileResultsView';
import ScenarioResultCard from './components/ScenarioResultCard';
import DesignationAtlasView from './components/DesignationAtlasView';
import CommunityStatsPanel from './components/CommunityStatsPanel';
import AgentStatusFeed from './components/AgentStatusFeed';
import ResizeHandle from './components/ResizeHandle';
import { buildCommunityData } from './pipeline/normalizer';
import { evaluatePlacedStoreScenario } from './engine/scenarioEngine';
import { loadPlaceSummary } from './pipeline/placeLoader';
import { haversineMiles } from './lib/geo';
import { MAX_SHARED_PINS, PIN_FORMATS, decodeAppState, writeAppStateToHash } from './lib/urlState';
import { DEFAULT_STORE_FORMAT, placedPinLabel, storeFormatInfo } from './lib/storeFormats';
import { approxCount, fmtBeyond, fmtMiles, fmtShare } from './lib/format';

const PANEL_HEIGHT_KEY = 'fds:layout:bottomHeight';
const PANEL_WIDTH_KEY = 'fds:layout:splitWidth';
const MIN_PANEL_HEIGHT = 140;
const MIN_PANEL_WIDTH = 320;
const DEFAULT_BOTTOM_VH = 0.30;
const DEFAULT_SPLIT_VW = 0.50;
// Same cap as share links, so a link can always hold every pin the UI allows.
const MAX_PINS = MAX_SHARED_PINS;
// Undo keeps this many earlier pin arrays.
const PIN_HISTORY_CAP = 20;
// Headings TrackerApp moves focus to (ids set in CommunityStatsPanel and
// CitySummary). A request waits this long for its heading to render.
const VERDICT_HEADING_ID = 'fds-verdict-heading';
const CITY_SUMMARY_HEADING_ID = 'fds-city-summary-heading';
const FOCUS_WAIT_MS = 60000;
// Fetch failures a fresh request can fix (the verdict card's Try again).
// Community-profile call outcomes other than 'ok' (normalizer profileStatus).
const PROFILE_FAILURE_LOG = {
  unavailable: "didn't load (Fresh Data tries again)",
  timeout: "didn't answer in time (Fresh Data tries again)",
  not_configured: 'not configured on this deployment (no Census API key)',
};
const RETRY_REASONS = new Set(['tract_unavailable', 'blocks_unavailable', 'stores_unavailable', 'ers_unavailable']);

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function readStoredSize(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = Number(window.localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch {
    return fallback;
  }
}

/*
 * TrackerApp owns the search, the analysis payload (communityData, see
 * src/pipeline/normalizer.js), the placed-store pins and the URL hash.
 * Everything shown about a tract is derived from that payload; the scenario
 * is a pure recompute (src/engine/scenarioEngine.js) on the same blocks with
 * the pins added, so nothing here fetches when a pin moves.
 */

// Boot lines describe standby state, not readiness: no source has been
// contacted until the first search, so nothing here claims "ready/online".
const INITIAL_LOGS = [
  { id: 0, text: 'System initialized. Nothing has been fetched yet — pick a location to begin.', type: 'system' },
  { id: 1, text: 'Per search: Census TIGERweb (tract, blocks), the dated SNAP store list and USDA ERS 2025 files, CDC PLACES and Census ACS.', type: 'info' },
  { id: 3, text: 'Awaiting location input…', type: 'info' },
];

const VERDICT_LABEL = { met: 'MEETS TEST', not_met: 'DOES NOT MEET', unknown: 'UNKNOWN' };

const CITY_REASON_LOG = {
  no_place: 'no Census place boundary was found',
  place_unavailable: 'the city boundary did not load from Census TIGERweb',
  place_incomplete: "the blocks inside the city boundary don't add up to the city's 2020 population",
  no_residents: 'the place had no residents in the 2020 Census',
  blocks_unavailable: 'the 2020 Census blocks for the city did not load',
  blocks_incomplete: "one tract's blocks don't add up to its 2020 population",
  tracts_unavailable: 'the census tract details did not load from Census TIGERweb',
  stores_unavailable: 'part of the SNAP store list around the city did not load',
  ers_unavailable: 'a USDA ERS county file did not load',
  stores_not_covered: "SNAP doesn't operate here (this territory uses a nutrition block grant instead), so there are no SNAP stores to measure from",
  urban_unavailable: 'one tract has no urban/rural flag',
};

const QUALIFIER_LOG = {
  li_la: 'low income and low access',
  la_not_li: 'low access, not low income',
  li_not_la: 'low income, not low access',
  neither: 'neither low income nor low access',
  not_la_income_unknown: 'not low access; income flag missing',
  not_li_access_unknown: 'not low income; access not computed',
  la_income_unknown: 'low access; income flag missing',
  unknown: 'inputs missing',
};

const REASON_LOG = {
  tract_unavailable: 'Census TIGERweb did not answer the tract lookup',
  no_tract: 'the point is outside every US census tract',
  no_residents: 'the tract has no residents, and USDA does not rate those',
  blocks_unavailable: 'the 2020 Census blocks for this tract did not load',
  blocks_incomplete: "the loaded blocks don't add up to the tract's 2020 population",
  stores_unavailable: 'part of the SNAP store list near this tract did not load',
  income_unavailable: 'USDA ERS has no 2025 income row for this tract',
  urban_unavailable: 'neither ERS nor the Census blocks say whether the tract is urban or rural',
  ers_unavailable: 'the USDA ERS file for this county did not load, so the urban/rural limit and the income flag are unknown',
  stores_not_covered: "SNAP doesn't operate here (this territory uses a nutrition block grant instead), so the SNAP store list has no stores to measure from",
};

// Log formatting (src/lib/format.js): counts to about the nearest 10 (exact
// below 100), shares to whole percent, never a value under a limit shown as
// at or over it.
const approx = (n) => approxCount(n) ?? 'n/a';
const pct = (share, byShare) => fmtShare(share, byShare) ?? 'n/a';

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function isValidPoint(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function normalizeFormat(format) {
  return PIN_FORMATS.includes(format) ? format : DEFAULT_STORE_FORMAT;
}

// Share links carry pins to 4 decimals and the location to 5
// (src/lib/urlState.js). Rounding the live values the same way makes the
// result on screen exactly what the link replays.
const roundTo = (x, decimals) => Number(Number(x).toFixed(decimals));

// Placed pins plus an undo history of earlier pin arrays (newest last).
// Every change a visitor makes (add, remove, format, clear) pushes the array
// it replaced, so Undo also brings back a cleared set.
const EMPTY_PIN_STATE = { pins: [], history: [] };
function pinsReducer(state, action) {
  const commit = (pins) => ({ pins, history: [...state.history, state.pins].slice(-PIN_HISTORY_CAP) });
  switch (action.type) {
    case 'add':
      return state.pins.length >= MAX_PINS ? state : commit([...state.pins, action.pin]);
    case 'format': {
      const pin = state.pins.find((p) => p.id === action.id);
      if (!pin || pin.format === action.format) return state;
      return commit(state.pins.map((p) => (p.id === action.id ? { ...p, format: action.format } : p)));
    }
    case 'remove':
      return state.pins.some((p) => p.id === action.id) ? commit(state.pins.filter((p) => p.id !== action.id)) : state;
    case 'clear':
      return state.pins.length === 0 ? state : commit([]);
    case 'undo':
      if (state.history.length === 0) return state;
      return { pins: state.history[state.history.length - 1], history: state.history.slice(0, -1) };
    case 'reset':
      return { pins: action.pins ?? [], history: action.history ?? [] };
    default:
      return state;
  }
}

let pinSeq = 0;
let logSeq = 0;
function makePinId() {
  pinSeq += 1;
  return `pin-${Date.now().toString(36)}-${pinSeq}`;
}

function Panels({
  communityData,
  loading,
  lastSearch,
  onSummarizeCity,
  citySummary,
  onCitySummaryTract,
  onCloseCitySummary,
  onRetryCitySummary,
  onRetry,
  dataError,
  logs,
}) {
  return (
    <>
      <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-[150px] md:min-h-0">
        <CommunityStatsPanel
          communityData={communityData}
          loading={loading}
          lastSearch={lastSearch}
          onSummarizeCity={onSummarizeCity}
          citySummary={citySummary}
          onCitySummaryTract={onCitySummaryTract}
          onCloseCitySummary={onCloseCitySummary}
          onRetryCitySummary={onRetryCitySummary}
          onRetry={onRetry}
        />
      </div>

      {dataError && (
        <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-[150px] md:min-h-0">
          <div
            className="h-full flex items-center justify-center text-sm text-center px-4"
            style={{ color: 'var(--danger)' }}
          >
            {dataError}
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-[120px] md:min-h-0">
        <AgentStatusFeed logs={logs} loading={loading} />
      </div>
    </>
  );
}

export default function TrackerApp({ onHome }) {
  // URL hash hydration: if the page was loaded with #lat=…&lng=…&layout=…
  // we restore that state and auto-trigger the analysis once mounted.
  // Decoded once so the initial render uses the right panel layout.
  const [initialUrlState] = useState(() =>
    typeof window !== 'undefined' ? decodeAppState(window.location.hash) : {},
  );
  const hasInitialPoint = Number.isFinite(initialUrlState.lat) && Number.isFinite(initialUrlState.lng);

  const [communityData, setCommunityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapCenter, setMapCenter] = useState(() =>
    hasInitialPoint
      ? { lat: initialUrlState.lat, lng: initialUrlState.lng }
      : { lat: 37.773, lng: -122.418 },
  );
  // Location-first boot: the heavy Streets GL iframe stays unmounted until
  // the visitor picks a place (or arrives via a #lat/#lng deep link), so we
  // never burn load time on a default city nobody asked for.
  const [locationPicked, setLocationPicked] = useState(hasInitialPoint);
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [dataError, setDataError] = useState('');
  const [layout, setLayout] = useState(initialUrlState.layout || 'bottom');
  // Unconditional (above the mode early-return): phones force the bottom
  // panel arrangement since side-by-side thirds break at 360px wide.
  const isMobile = useIsMobile();
  const [mode, setMode] = useState('atlas');
  // Placed stores: [{ id, lat, lng, format, createdAt }], format in s|g|d|f,
  // with the undo history (see pinsReducer).
  const [pinState, dispatchPins] = useReducer(pinsReducer, EMPTY_PIN_STATE);
  const pins = pinState.pins;
  const canUndo = pinState.history.length > 0;
  // What the visitor searched for ({ placeKind, placeName }) — drives the
  // City notice. Null after a map-click re-analysis or a shared-link load.
  const [lastSearch, setLastSearch] = useState(null);
  // City summary (docs/07, src/pipeline/placeLoader.js): { status:
  // 'loading'|'ok'|'unknown', place, progress, result } or null. It outlives
  // the tract below it while the visitor opens tracts from its table; any
  // other search closes it.
  const [citySummary, setCitySummary] = useState(null);
  const citySummaryNonceRef = useRef(0);
  const citySummaryAbortRef = useRef(null);
  // Rapid re-searches can resolve out of order. The nonce drops stale
  // responses; the newest search owns the loading flag and all state updates.
  const searchNonceRef = useRef(0);
  // Pins waiting for the analysis to load: from a shared link (#pins=…), an
  // example chip, or a refresh of the same point. Replayed once
  // communityData arrives; a manual search clears them so they never leak
  // into a location the visitor picked themselves.
  const pendingPinsRef = useRef(
    Array.isArray(initialUrlState.pins) && initialUrlState.pins.length > 0
      ? { pins: initialUrlState.pins, source: 'shared link' }
      : null,
  );
  // A heading to focus once it renders ({ id, until }): the verdict after Try
  // again, a City-summary row or clearing the stores; the City summary after
  // Summarize. Applied by the effect after every render, below.
  const pendingFocusRef = useRef(null);

  const scenarioResult = useMemo(
    () => evaluatePlacedStoreScenario(communityData, pins),
    [communityData, pins],
  );

  // Counted SNAP stores for the map, plus the fields the map surfaces read
  // (a stable id, a display name and the distance from the searched point).
  const mapStores = useMemo(() => {
    const stores = communityData?.access?.stores;
    if (!Array.isArray(stores)) return [];
    return stores.map((s, i) => ({
      ...s,
      id: `snap-${i}-${s.lat},${s.lng}`,
      name: s.name || (s.type === 'S' ? 'Super store' : 'Supermarket'),
      distanceMiles: haversineMiles(mapCenter.lat, mapCenter.lng, s.lat, s.lng),
    }));
  }, [communityData, mapCenter.lat, mapCenter.lng]);

  // Placed pins in the shape the map draws, carrying their format so the map
  // can tell counting pins (supermarkets) from non-counting ones.
  const placedStores = useMemo(
    () => pins.map((p) => ({
      id: `placed-${p.id}`,
      pinId: p.id,
      lat: p.lat,
      lng: p.lng,
      format: p.format,
      counts: storeFormatInfo(p.format).counts,
      name: placedPinLabel(p.format),
      distanceMiles: haversineMiles(mapCenter.lat, mapCenter.lng, p.lat, p.lng),
      placed: true,
    })),
    [pins, mapCenter.lat, mapCenter.lng],
  );

  const [bottomPanelHeight, setBottomPanelHeight] = useState(() =>
    Number.isFinite(initialUrlState.bottomPanelHeight)
      ? initialUrlState.bottomPanelHeight
      : readStoredSize(
          PANEL_HEIGHT_KEY,
          typeof window !== 'undefined' ? Math.round(window.innerHeight * DEFAULT_BOTTOM_VH) : 280,
        ),
  );
  const [splitPanelWidth, setSplitPanelWidth] = useState(() =>
    Number.isFinite(initialUrlState.splitPanelWidth)
      ? initialUrlState.splitPanelWidth
      : readStoredSize(
          PANEL_WIDTH_KEY,
          typeof window !== 'undefined' ? Math.round(window.innerWidth * DEFAULT_SPLIT_VW) : 480,
        ),
  );

  // Persist resize state. Quiet about quota errors so private-mode browsers
  // don't break the UI.
  useEffect(() => {
    try { window.localStorage.setItem(PANEL_HEIGHT_KEY, String(bottomPanelHeight)); } catch { /* noop */ }
  }, [bottomPanelHeight]);
  useEffect(() => {
    try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(splitPanelWidth)); } catch { /* noop */ }
  }, [splitPanelWidth]);

  // Reclamp on window resize so a too-large panel never crowds the viewport.
  useEffect(() => {
    function clampToViewport() {
      setBottomPanelHeight((h) => Math.min(Math.max(h, MIN_PANEL_HEIGHT), Math.round(window.innerHeight * 0.85)));
      setSplitPanelWidth((w) => Math.min(Math.max(w, MIN_PANEL_WIDTH), Math.round(window.innerWidth * 0.85)));
    }
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  // Mirror app state into the URL hash so refreshing or sharing a link
  // restores the same view — location plus placed stores with their formats
  // (pins= and pt=, see src/lib/urlState.js), so the URL alone replays the
  // scenario with no database. Debounced to avoid churn during splitter
  // drags. Plain function, not useCallback: callers always want fresh state.
  function writeHashNow(extra = {}) {
    writeAppStateToHash({
      lat: communityData ? mapCenter.lat : null,
      lng: communityData ? mapCenter.lng : null,
      layout,
      bottomPanelHeight,
      splitPanelWidth,
      pins: communityData ? pins : [],
      ...extra,
    });
  }
  useEffect(() => {
    const t = setTimeout(writeHashNow, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityData, mapCenter.lat, mapCenter.lng, layout, bottomPanelHeight, splitPanelWidth, pins]);

  const maxBottomHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.85) : 1200;
  const maxSplitWidth = typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.85) : 1600;
  const defaultBottomHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight * DEFAULT_BOTTOM_VH) : 280;
  const defaultSplitWidth = typeof window !== 'undefined' ? Math.round(window.innerWidth * DEFAULT_SPLIT_VW) : 480;

  const addLog = useCallback((text, type = 'info') => {
    // A counter, not Date.now() + Math.random(): at today's epoch a double
    // keeps only ~1/4096 of a millisecond, so lines logged in the same
    // millisecond could share a React key.
    logSeq += 1;
    const id = `log-${logSeq}`;
    setLogs((prev) => [
      ...prev.slice(-24),
      { id, text, type },
    ]);
  }, []);

  function handleGateSelect(lat, lng, options = {}) {
    setLocationPicked(true);
    handleLocationSearch(lat, lng, options);
  }

  // What the pipeline did, step by step, from the payload it returned.
  // placeKind: what was searched ('city' drives the place-lookup line).
  function logAnalysis(data, placeKind = null) {
    const { meta, access } = data;
    const cache = meta?.cache;
    if (cache?.status === 'memory' || cache?.status === 'local') {
      const mins = Math.ceil(Number(cache.expiresInMs || 0) / 60000);
      addLog(`Served from the ${cache.status} cache (refreshes in ${mins}m); no source was re-queried.`, 'info');
    }

    if (!meta?.fips) {
      addLog(`Census tract: not found — ${REASON_LOG.tract_unavailable}.`, 'warning');
    } else {
      addLog(`Tract: ${meta.tractName || meta.fips} (${meta.fips}${meta.stateAbbr ? `, ${meta.stateAbbr}` : ''})`, 'success');
      if (meta.place?.name) addLog(`Place at this point: ${meta.place.name}`, 'info');
      if (placeKind === 'city' && meta.placeStatus === 'unavailable') {
        addLog("Place lookup (TIGERweb) didn't answer — city name not confirmed.", 'warning');
      }

      const blocks = Array.isArray(access.blocks) ? access.blocks : [];
      if (blocks.length > 0) {
        const source = access.blocksSource === 'bundled' ? 'bundled county file' : access.blocksSource === 'tigerweb' ? 'TIGERweb, live' : 'source not recorded';
        addLog(`2020 Census blocks: ${plural(blocks.length, 'populated block')}, ${approx(access.population)} residents (${source})`, 'success');
      } else if (['no_residents', 'blocks_unavailable', 'blocks_incomplete'].includes(access.reason)) {
        addLog(`2020 Census blocks: not used — ${REASON_LOG[access.reason]}.`, 'warning');
      }

      if (access.reason === 'stores_not_covered') {
        addLog(`SNAP store list: not used — ${REASON_LOG.stores_not_covered}.`, 'warning');
      } else if (access.storesDataset) {
        const date = String(access.storesDataset.date || '').slice(0, 10) || 'undated';
        const n = Array.isArray(access.stores) ? access.stores.length : 0;
        addLog(`SNAP store list of ${date}: ${plural(n, 'counted store')} within the tract and 5 mi around it`, 'success');
      } else if (access.reason === 'stores_unavailable') {
        addLog(`SNAP store list: not used — ${REASON_LOG.stores_unavailable}.`, 'warning');
      }

      if (typeof access.lowIncome === 'boolean') {
        addLog(`USDA ERS 2025 low-income flag: ${access.lowIncome ? 'yes' : 'no'}`, 'info');
      } else if (access.reason === 'ers_unavailable') {
        addLog(`USDA ERS 2025 low-income flag: unknown — ${REASON_LOG.ers_unavailable}.`, 'warning');
      } else if (access.reason !== 'no_residents') {
        addLog(`USDA ERS 2025 low-income flag: missing — ${REASON_LOG.income_unavailable}.`, 'warning');
      }

      if (Number.isFinite(access.threshold)) {
        const from = access.urbanSource === 'ers_2025' ? 'ERS 2025 Urban flag' : 'majority of block residents';
        addLog(`Distance limit: ${access.threshold} mi (${access.urban ? 'urban' : 'rural'}, from the ${from})`, 'info');
      }

      if (typeof access.lowAccess === 'boolean') {
        addLog(
          `Low access: ${fmtBeyond(access.beyond, access.byCount) ?? 'n/a'} of ${approx(access.population)} residents (${pct(access.share, access.byShare)}) live beyond ${access.threshold} mi → ${access.lowAccess ? 'yes' : 'no'} (limits: 33% or 500)`,
          'info',
        );
      }
    }

    const verdict = access?.verdict;
    if (verdict) {
      addLog(
        `Verdict (estimate): ${VERDICT_LABEL[verdict.status] || 'UNKNOWN'} — ${QUALIFIER_LOG[verdict.qualifier] || 'inputs missing'}`,
        verdict.status === 'not_met' ? 'info' : 'warning',
      );
      const reason = verdict.status === 'unknown' ? verdict.reason || access.reason : null;
      if (reason) addLog(`Unknown because ${REASON_LOG[reason] || 'an input was missing'}.`, 'warning');
    }
    if (RETRY_REASONS.has(access?.reason)) {
      addLog('Try again (in the tract view) re-runs this search without cached results.', 'info');
    }

    const point = access?.point;
    if (Number.isFinite(point?.miles)) {
      addLog(`From the searched spot: nearest counted supermarket ${fmtMiles(point.miles)} (straight line)`, 'info');
    } else if (point?.reason === 'over_30_mi') {
      addLog('From the searched spot: no counted supermarket within 30 mi', 'info');
    }

    // A failed or timed-out profile call carries all-zero defaults: name the
    // failure (meta.profileStatus) rather than "no figures returned".
    const profileStatus = meta?.profileStatus || {};
    const health = data.health;
    if (profileStatus.health === 'unavailable' || profileStatus.health === 'timeout') {
      if (meta?.fips) addLog(`CDC PLACES: ${PROFILE_FAILURE_LOG[profileStatus.health]}`, 'warning');
    } else if (health && (health.diabetes > 0 || health.obesity > 0)) {
      addLog(`CDC PLACES: diabetes ${pct(health.diabetes / 100)}, obesity ${pct(health.obesity / 100)}`, 'info');
    } else if (meta?.fips) {
      addLog('CDC PLACES: no figures returned for this tract', 'warning');
    }
    const demo = data.demographics;
    if (PROFILE_FAILURE_LOG[profileStatus.demographics]) {
      if (meta?.fips) addLog(`Census ACS: ${PROFILE_FAILURE_LOG[profileStatus.demographics]}`, 'warning');
    } else if (!(demo && (demo.population > 0 || demo.medianIncome > 0 || demo.pctPoverty > 0)) && meta?.fips) {
      addLog('Census ACS: no figures returned for this tract', 'warning');
    }

    addLog('Analysis complete.', 'success');
  }

  async function handleLocationSearch(rawLat, rawLng, options = {}) {
    const opts = options || {};
    // The location a share link would carry (5 decimals), so a link replays
    // exactly this analysis.
    const lat = roundTo(rawLat, 5);
    const lng = roundTo(rawLng, 5);
    const forceRefresh = Boolean(opts.forceRefresh);
    const samePoint = lat === mapCenter.lat && lng === mapCenter.lng;
    const mySearch = searchNonceRef.current + 1;
    searchNonceRef.current = mySearch;
    // A focus request belongs to the action that made it; callers that want
    // one (Try again, a City-summary row) set it after this call.
    pendingFocusRef.current = null;
    // What was searched, for the log: a refresh of the same spot keeps it.
    const placeKind = opts.placeKind ?? (forceRefresh && samePoint ? lastSearch?.placeKind ?? null : null);

    // Pins to replay once this search's analysis loads.
    if (Array.isArray(opts.pins) && opts.pins.length > 0) {
      pendingPinsRef.current = { pins: opts.pins, source: 'example' };
    } else if (forceRefresh && samePoint && communityData && pins.length > 0) {
      pendingPinsRef.current = { pins, source: 'refresh', history: pinState.history };
    } else if (!opts.fromSharedLink) {
      pendingPinsRef.current = null;
    }

    // Opening a tract from the City summary table keeps the summary; any
    // other search closes it (and stops one still loading).
    if (!opts.keepCitySummary) closeCitySummary();

    // The City notice follows what was searched. A map click (no placeKind)
    // clears it; a refresh of the same spot keeps it.
    if (opts.placeKind) {
      setLastSearch({ placeKind: opts.placeKind, placeName: opts.placeName ?? null });
    } else if (!(forceRefresh && samePoint)) {
      setLastSearch(null);
    }

    setLoading(true);
    setCommunityData(null);
    setDataError('');
    setMapCenter({ lat, lng });
    dispatchPins({ type: 'reset' });

    addLog(`Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}${opts.placeName ? ` (${opts.placeName})` : ''}`, 'system');
    if (forceRefresh) addLog('Refresh requested: skipping cached results for this point.', 'info');
    addLog('Running the access test: tract → 2020 Census blocks → SNAP store tiles → ERS 2025 flags…', 'info');

    try {
      const data = await buildCommunityData(lat, lng, { forceRefresh });
      if (!data) throw new Error('No census tract found. Try a different US location.');
      // A newer search started while this one was in flight — its results
      // would paint the wrong community, so drop them silently. The newer
      // search owns the loading flag; leave it alone here.
      if (mySearch !== searchNonceRef.current) return;

      logAnalysis(data, placeKind);
      setCommunityData(data);
    } catch (err) {
      // Stale search: a newer one owns the UI — don't paint its error or
      // touch its loading flag.
      if (mySearch !== searchNonceRef.current) return;
      pendingFocusRef.current = null;
      addLog(`Error: ${err?.message || 'Pipeline failure'}`, 'error');
      setDataError(err?.message || 'Unable to load data for this location.');
    } finally {
      if (mySearch === searchNonceRef.current) setLoading(false);
    }
  }

  function closeCitySummary() {
    citySummaryNonceRef.current += 1;
    citySummaryAbortRef.current?.abort();
    citySummaryAbortRef.current = null;
    setCitySummary(null);
  }

  // place: meta.place plus the searched tract's county (for the bundled check).
  async function runCitySummary(place) {
    if (!place?.geoid) return;
    const nonce = citySummaryNonceRef.current + 1;
    citySummaryNonceRef.current = nonce;
    citySummaryAbortRef.current?.abort();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    citySummaryAbortRef.current = controller;
    const current = () => nonce === citySummaryNonceRef.current;

    setCitySummary({ status: 'loading', place, progress: null, result: null });
    addLog(`City summary: ${place.name || place.geoid} — loading every 2020 Census block inside the city boundary…`, 'system');
    try {
      const result = await loadPlaceSummary(place, {
        signal: controller?.signal,
        onProgress: (progress) => {
          if (current()) setCitySummary((s) => (s && s.status === 'loading' ? { ...s, progress } : s));
        },
      });
      if (!current()) return;
      setCitySummary({ status: result.status === 'ok' ? 'ok' : 'unknown', place, progress: null, result });
      if (result.status === 'ok') {
        const source = result.source === 'bundled' ? 'bundled county file' : 'TIGERweb, live';
        addLog(
          `City summary (estimate): ${approx(result.population)} residents in ${plural(result.tractCount, 'tract')} (${source}); ${approx(result.beyond)} (${pct(result.share)}) beyond their tract's limit; ${approx(result.meeting.residents)} (${pct(result.meeting.share)}) in ${plural(result.meeting.tracts, 'tract')} meeting the test`,
          'success',
        );
      } else {
        addLog(`City summary: unknown — ${CITY_REASON_LOG[result.reason] || 'an input did not load'}. No partial totals shown.`, 'warning');
      }
    } catch (err) {
      if (!current()) return;
      setCitySummary({ status: 'unknown', place, progress: null, result: { status: 'unknown', reason: 'failed' } });
      addLog(`City summary: stopped — ${err?.message || 'unexpected error'}.`, 'error');
    } finally {
      if (current()) citySummaryAbortRef.current = null;
    }
  }

  function requestFocus(id) {
    pendingFocusRef.current = { id, until: Date.now() + FOCUS_WAIT_MS };
  }

  // Moves focus to a requested heading once it is in the DOM (a tract that is
  // still loading renders its verdict later). Runs after every render.
  useEffect(() => {
    const request = pendingFocusRef.current;
    if (!request) return;
    if (Date.now() > request.until) {
      pendingFocusRef.current = null;
      return;
    }
    const el = document.getElementById(request.id);
    if (!el) return;
    pendingFocusRef.current = null;
    el.focus();
  });

  function handleSummarizeCity() {
    const meta = communityData?.meta;
    if (!meta?.place) return;
    runCitySummary({ ...meta.place, countyFips: meta.countyFips });
    requestFocus(CITY_SUMMARY_HEADING_ID);
  }

  function handleCitySummaryTract(row) {
    if (!Number.isFinite(row?.intptLat) || !Number.isFinite(row?.intptLng)) return;
    addLog(`City summary: opening census tract ${row.basename}`, 'info');
    handleLocationSearch(row.intptLat, row.intptLng, { keepCitySummary: true });
    requestFocus(VERDICT_HEADING_ID);
  }

  // The verdict card's Try again: the same search (same spot, same searched
  // place, same pins) without cached results.
  function handleRetry() {
    if (loading) return;
    handleLocationSearch(mapCenter.lat, mapCenter.lng, { forceRefresh: true, keepCitySummary: Boolean(citySummary) });
    requestFocus(VERDICT_HEADING_ID);
  }

  // One line per scenario change, from the computed result: logged, and
  // announced to screen readers by the status region in the render. A change
  // that leaves the line identical (dollar store -> corner store) logs nothing.
  const threshold = communityData?.access?.threshold;
  const scenarioLine = useMemo(() => {
    if (!scenarioResult) return null;
    const { counting, nonCounting, before, after, flipped } = scenarioResult;
    const beyond = (side) => fmtBeyond(side.beyond, side.byCount) ?? 'n/a';
    const text = counting === 0
      ? `Scenario: ${plural(nonCounting, 'placed store')}, none a supermarket — USDA's supermarket-based test is unchanged.`
      : `Scenario (computed): ${plural(counting, 'counting store')}${nonCounting ? `, ${nonCounting} not counted` : ''} — residents beyond ${threshold} mi ${beyond(before)} → ${beyond(after)}; test ${VERDICT_LABEL[before.verdict.status]} → ${VERDICT_LABEL[after.verdict.status]}`;
    return { text, flipped };
  }, [scenarioResult, threshold]);
  const lastScenarioLogRef = useRef('');
  useEffect(() => {
    if (!scenarioLine) {
      lastScenarioLogRef.current = '';
      return;
    }
    if (scenarioLine.text === lastScenarioLogRef.current) return;
    lastScenarioLogRef.current = scenarioLine.text;
    addLog(scenarioLine.text, scenarioLine.flipped ? 'success' : 'info');
  }, [scenarioLine, addLog]);

  function addPin(plat, plng, format = DEFAULT_STORE_FORMAT) {
    if (!communityData) {
      addLog('Load a location before placing a store.', 'warning');
      return;
    }
    // 4 decimals, as a share link carries it.
    const pin = {
      id: makePinId(),
      lat: roundTo(Number.isFinite(plat) ? plat : mapCenter.lat, 4),
      lng: roundTo(Number.isFinite(plng) ? plng : mapCenter.lng, 4),
      format: normalizeFormat(format),
      createdAt: Date.now(),
    };
    if (!isValidPoint(pin)) return;
    if (pins.length >= MAX_PINS) {
      addLog(`Store limit reached (${MAX_PINS}). Remove, undo or clear to place another.`, 'warning');
      return;
    }
    dispatchPins({ type: 'add', pin });
    addLog(`Placed: ${storeFormatInfo(pin.format).label} at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`, 'success');
  }

  function setPinFormat(id, format) {
    if (!PIN_FORMATS.includes(format)) return;
    const pin = pins.find((p) => p.id === id);
    if (!pin || pin.format === format) return;
    dispatchPins({ type: 'format', id, format });
    addLog(`Store changed to: ${storeFormatInfo(format).label}`, 'info');
  }

  // Removed from the scenario card. Removing the last store unmounts the
  // card, so focus moves to the verdict heading (the card itself focuses the
  // next store otherwise).
  function removePin(id) {
    if (!pins.some((p) => p.id === id)) return;
    dispatchPins({ type: 'remove', id });
    if (pins.length === 1) requestFocus(VERDICT_HEADING_ID);
    addLog('Placed store removed', 'info');
  }

  // Steps back one change (add, remove, format or clear).
  function undoPin() {
    const { history } = pinState;
    if (history.length === 0) return;
    const restored = history[history.length - 1];
    dispatchPins({ type: 'undo' });
    addLog(`Undo: back to ${restored.length === 0 ? 'no placed stores' : plural(restored.length, 'placed store')}`, 'info');
  }

  // opts.fromCard: the scenario card's Clear all, whose card unmounts with
  // the stores, so focus moves to the verdict heading.
  function clearPins(opts) {
    if (pins.length === 0) return;
    dispatchPins({ type: 'clear' });
    if (opts?.fromCard) requestFocus(VERDICT_HEADING_ID);
    addLog('Placed stores cleared (Undo brings them back); showing the tract as it is', 'info');
  }

  // Fires once the analysis delivers data: pending pins (shared link,
  // example chip, refresh) become real pins with their formats, and the
  // scenario recomputes from them.
  useEffect(() => {
    if (!communityData || !pendingPinsRef.current) return;
    const { pins: pending, source, history = [] } = pendingPinsRef.current;
    pendingPinsRef.current = null;
    const now = Date.now();
    // 4 decimals, as a share link carries them (example chips may carry more).
    const fresh = pending
      .filter(isValidPoint)
      .slice(0, MAX_PINS)
      .map((p, i) => ({
        id: makePinId(),
        lat: roundTo(p.lat, 4),
        lng: roundTo(p.lng, 4),
        format: normalizeFormat(p.format),
        createdAt: now + i,
      }));
    if (fresh.length === 0) return;
    // A refresh keeps the undo history; a link or an example starts fresh.
    dispatchPins({ type: 'reset', pins: fresh, history });
    addLog(`Restored ${plural(fresh.length, 'placed store')} from the ${source}.`, 'success');
    // communityData arriving is the trigger; the ref carries the pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityData]);

  // Copy a replay link for the current location + placed stores. Forces a
  // synchronous hash write first so the copied URL never lags the 250 ms
  // debounced mirror.
  async function handleShareScenario() {
    if (!communityData) return;
    // Scenario links open with sources highlighted (hl=1): the map boots
    // with the highlight layer on so the shared stores are visible.
    writeHashNow(pins.length > 0 ? { highlight: true } : {});
    const url = window.location.href;
    const confirm = () => addLog('Link copied — opening it replays this location and its placed stores.', 'success');
    try {
      await navigator.clipboard.writeText(url);
      confirm();
    } catch {
      // Clipboard API blocked (permissions / insecure context): legacy
      // execCommand fallback, then fall back to showing the link in the log.
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        confirm();
      } catch {
        addLog(`Copy this link to share the scenario: ${url}`, 'warning');
      }
    }
  }

  // Auto-run the pipeline once on mount when a lat/lng was supplied via the
  // URL hash. We guard with a ref so this fires exactly once per page load.
  const didHydrateRef = useRef(false);
  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;
    if (hasInitialPoint) {
      addLog('Restoring location from shared link…', 'system');
      handleLocationSearch(initialUrlState.lat, initialUrlState.lng, { fromSharedLink: true });
    }
    // We only want the URL hydrate to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose a dev-only manual trigger without re-installing the global on
  // every render, and clean it up when the component unmounts.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__testPinDrop = handleLocationSearch;
    return () => {
      if (window.__testPinDrop === handleLocationSearch) {
        delete window.__testPinDrop;
      }
    };
    // We intentionally update the global whenever the closure changes so
    // tests always invoke the latest handler.
  });

  // The designation atlas is a map; phones get the info-only results page
  // instead (see the isMobile early-return below), so atlas mode never
  // renders on small screens.
  if (mode === 'designation' && !isMobile) {
    return (
      <div
        className="app-canvas flex flex-col h-screen overflow-hidden"
        style={{ height: '100dvh' }}
      >
        <FeatureNav
          communityData={communityData}
          loading={loading}
          layout={layout}
          mode={mode}
          onModeChange={setMode}
          onToggleLayout={() => setLayout((value) => (value === 'bottom' ? 'split' : 'bottom'))}
          onHome={onHome}
        />
        <div className="flex-1 min-h-0 relative">
          <DesignationAtlasView />
        </div>
      </div>
    );
  }

  // "Summarize {City}" shows only for a city search whose point has a
  // Census place (the panel also requires the names to match), and not
  // while a summary is open.
  const canSummarize = Boolean(communityData?.meta?.place) && lastSearch?.placeKind === 'city' && !citySummary;
  const panelProps = {
    communityData,
    loading,
    lastSearch,
    onSummarizeCity: canSummarize ? handleSummarizeCity : undefined,
    citySummary,
    onCitySummaryTract: handleCitySummaryTract,
    onCloseCitySummary: closeCitySummary,
    onRetryCitySummary: citySummary?.place ? () => runCitySummary(citySummary.place) : undefined,
    onRetry: handleRetry,
    dataError,
    logs,
  };

  // Phones stack the three panels vertically in a capped scroll region;
  // side-by-side thirds would be unreadable at 360px wide.
  const panelStrip = (
    <div
      className="shrink-0 flex flex-col md:flex-row gap-3 p-3 overflow-y-auto md:overflow-visible"
      style={{
        height: isMobile ? 'min(52dvh, 460px)' : `${bottomPanelHeight}px`,
        background: 'rgba(12, 22, 18, 0.55)',
      }}
    >
      <Panels {...panelProps} />
    </div>
  );

  const panelColumn = (
    <div
      className="flex flex-col gap-3 p-3 overflow-y-auto"
      style={{
        width: `${splitPanelWidth}px`,
        background: 'rgba(12, 22, 18, 0.55)',
      }}
    >
      <Panels {...panelProps} />
    </div>
  );

  // Scenario card: renders nothing without pins, so it is safe to mount
  // unconditionally (map overlay on desktop, stacked on mobile — including
  // pins replayed from a shared link or an example chip). Pins are editable
  // from the card on both.
  const scenarioCard = (
    <ScenarioResultCard
      scenario={scenarioResult}
      communityData={communityData}
      pins={pins}
      onSetPinFormat={setPinFormat}
      onRemovePin={removePin}
      onClearPins={clearPins}
    />
  );

  // Screen-reader announcement of each scenario change (the log's line).
  const scenarioStatus = (
    <p className="sr-only" role="status" aria-live="polite">
      {scenarioLine?.text ?? ''}
    </p>
  );

  // Phones skip the map shell entirely: no Streets GL iframe, no 2D canvas.
  // The lookup on mobile is an info-only page (tract test, references,
  // profile, scenario) with search + share.
  if (isMobile) {
    return (
      <div
        className="app-canvas flex flex-col h-screen overflow-hidden"
        style={{ height: '100dvh' }}
      >
        <div className="flex-1 min-h-0">
          <MobileResultsView
            locationPicked={locationPicked}
            communityData={communityData}
            loading={loading}
            dataError={dataError}
            onGateSelect={handleGateSelect}
            onShareScenario={handleShareScenario}
            panels={<Panels {...panelProps} />}
            scenario={scenarioCard}
            hasPins={pins.length > 0}
            onHome={onHome}
          />
        </div>
        {scenarioStatus}
      </div>
    );
  }

  const streetsView = (
    <StreetsGlView
      lat={mapCenter.lat}
      lng={mapCenter.lng}
      isLoading={loading}
      hasData={!!communityData}
      onSearch={handleLocationSearch}
      onUndoPin={undoPin}
      canUndo={canUndo}
      onClearPins={clearPins}
      onShareScenario={handleShareScenario}
      // StreetsGlView wraps a non-null card in its overlay box; the card is
      // empty without pins, so pass null then and no box mounts.
      scenarioCard={pins.length > 0 ? scenarioCard : null}
      placedStores={placedStores}
      onPlaceStore={(plat, plng, format = DEFAULT_STORE_FORMAT) => addPin(plat, plng, format)}
      stores={mapStores}
      storesLoaded={communityData?.access?.storesDataset != null}
      storesNotCovered={communityData?.access?.reason === 'stores_not_covered'}
    />
  );

  return (
    <div
      className="app-canvas flex flex-col h-screen overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <FeatureNav
        communityData={communityData}
        loading={loading}
        layout={layout}
        mode={mode}
        onModeChange={setMode}
        onToggleLayout={() => setLayout((value) => (value === 'bottom' ? 'split' : 'bottom'))}
        onHome={onHome}
      />

      <div className="flex-1 overflow-hidden min-h-0">
        {layout === 'bottom' ? (
          <div className="flex flex-col h-full">
            <div className="flex-1 relative min-h-0">
              {locationPicked || communityData ? streetsView : <LocationGate onSelect={handleGateSelect} />}
            </div>
            <ResizeHandle
              orientation="horizontal"
              size={bottomPanelHeight}
              onSize={setBottomPanelHeight}
              min={MIN_PANEL_HEIGHT}
              max={maxBottomHeight}
              defaultSize={defaultBottomHeight}
            />
            {panelStrip}
          </div>
        ) : (
          <div className="flex h-full">
            <div className="flex-1 relative min-h-0">
              {locationPicked || communityData ? streetsView : <LocationGate onSelect={handleGateSelect} />}
            </div>
            <ResizeHandle
              orientation="vertical"
              size={splitPanelWidth}
              onSize={setSplitPanelWidth}
              min={MIN_PANEL_WIDTH}
              max={maxSplitWidth}
              defaultSize={defaultSplitWidth}
            />
            {panelColumn}
          </div>
        )}
      </div>
      {scenarioStatus}
    </div>
  );
}
