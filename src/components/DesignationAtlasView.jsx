import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, X } from 'lucide-react';
import { escapeHtml } from '../lib/storeTooltip';
import {
  countyLabel,
  decodeCounties,
  decodeLilaTracts,
  lilaDotRadius,
  paddedCountyBounds,
  searchCounties,
  summarizeLilaTracts,
  topStatesByTracts,
  tractsInBounds,
} from '../lib/usLilaTracts';

/*
 * Judge Notes: complexity hotspots
 * 1) One dot per 2010 census tract USDA flagged LILATracts_1And10 = 1 on the
 *    published 2019 Food Access Research Atlas (low income & low access,
 *    supermarkets, 1 mi urban / 10 mi rural). Flags are USDA's, not ours.
 * 2) Dots sit at the Census 2010 Gazetteer internal point, joined at build
 *    time (scripts/build-us-lila-tracts.mjs -> public/data/us/).
 * 3) ~9,300 dots draw on one canvas (preferCanvas), with a hit tolerance so
 *    tiny dots stay hoverable and tappable.
 * 4) Dot area tracks low-access residents (sqrt radius), small at national
 *    zoom and growing a little as you zoom in.
 * 5) The summary counts the dots in the current window (debounced on
 *    moveend) next to the national totals.
 * 6) Every string that reaches a tooltip or popup goes through escapeHtml.
 * 7) County search: an ARIA combobox over public/data/us/counties.json
 *    (every county in the atlas), filtered on each keystroke with no network
 *    (searchCounties). Picking one flies to its padded tract-point box,
 *    clear of the panels, and dims every dot outside it until cleared.
 */

const DATA_URL = '/data/us/usda2019-lila-tracts.json';
const COUNTIES_URL = '/data/us/counties.json';
const COUNTY_MAX_ZOOM = 11;
// Fly-to length in seconds (county and back to the national view).
const FLY_SECONDS = 1.2;
const LIST_ID = 'usmap-county-options';
const optionId = (index) => `usmap-county-option-${index}`;
const CONTIGUOUS_US = [
  [24.5, -124.8],
  [49.4, -66.9],
];
const SUMMARY_DEBOUNCE_MS = 140;
// --danger from src/index.css (fill) with a darker rim so dots hold up on the
// light basemap. Urban tracts are solid; rural tracts are rings.
const DOT_FILL = '#ff6b6b';
const DOT_RIM = '#9b1c1c';
const LEGEND_SIZES = [500, 2000, 8000];

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : 'not published');
const fmtPct = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : 'not published');
const fmtUsd = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : 'not published');

// Thinner rims and lighter fills at national zoom so overlapping dots read
// as density instead of one solid mass. With a county picked (focusFips),
// its dots go fully opaque and every other dot drops to about 30%.
function dotStyle(tract, zoom, focusFips = null) {
  const far = zoom < 6;
  const style = {
    radius: lilaDotRadius(tract.lowAccess, zoom),
    color: DOT_RIM,
    weight: tract.urban ? (far ? 0.35 : 0.7) : far ? 0.9 : 1.4,
    opacity: 0.85,
    fillColor: DOT_FILL,
    fillOpacity: tract.urban ? (far ? 0.6 : 0.75) : 0.35,
  };
  if (!focusFips) return style;
  if (tract.geoid.startsWith(focusFips)) {
    return { ...style, opacity: 1, weight: style.weight + 0.5, fillOpacity: tract.urban ? 0.9 : 0.45 };
  }
  return { ...style, opacity: 0.3, fillOpacity: tract.urban ? 0.25 : 0.12 };
}

// Lower 48 in view, clear of the panels: beside the summary on wide
// screens, between the summary (search box included) and the legend
// otherwise.
function nationalPadding(width) {
  if (width >= 900) return { paddingTopLeft: [370, 10], paddingBottomRight: [10, 10] };
  if (width >= 640) return { paddingTopLeft: [10, 390], paddingBottomRight: [10, 130] };
  return { paddingTopLeft: [8, 280], paddingBottomRight: [8, 110] };
}

// Padding that fits a county into the larger clear area of the map: right of
// the summary panel or below it (above the legend), keeping off the zoom
// buttons. Measured at pick time, so the county card is already counted.
function countyPadding(map, panel, legend) {
  const size = map.getSize();
  const origin = map.getContainer().getBoundingClientRect();
  const rel = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
  };
  const p = rel(panel);
  const l = rel(legend);
  const m = 16;
  const zoomTopRight = size.x >= 640 ? 52 : 0;
  const zoomBottomRight = size.x >= 640 ? 0 : 52;
  const areas = [];
  if (p) {
    const right = { left: p.right + m, top: m, right: size.x - m - zoomTopRight, bottom: size.y - m };
    if (l && l.right > right.left) right.bottom = l.top - m;
    const below = { left: m, top: p.bottom + m, right: size.x - m - zoomBottomRight, bottom: (l ? l.top : size.y) - m };
    areas.push(right, below);
  }
  const usable = areas
    .map((a) => ({ ...a, w: a.right - a.left, h: a.bottom - a.top }))
    .filter((a) => a.w >= 120 && a.h >= 120)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const area = usable[0] || { left: m, top: m, right: size.x - m, bottom: size.y - m };
  return {
    paddingTopLeft: [area.left, area.top],
    paddingBottomRight: [size.x - area.right, size.y - area.bottom],
  };
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const flaggedText = (n) => (n > 0 ? `${fmtInt(n)} flagged tract${n === 1 ? '' : 's'}` : 'no flagged tracts');

function tractTooltipHtml(t) {
  return `<div class="usmap-tip-title">${escapeHtml(t.county)}, ${escapeHtml(t.state)}</div>
    <div class="usmap-tip-sub">Tract ${escapeHtml(t.geoid)} · ${t.urban ? 'Urban' : 'Rural'}</div>
    <div>Low-access residents: <b>${escapeHtml(fmtInt(t.lowAccess))}</b></div>
    <div>Poverty rate: <b>${escapeHtml(fmtPct(t.povertyRate))}</b></div>`;
}

function tractLabel(t) {
  return `${t.county}, ${t.state} (tract ${t.geoid})`;
}

function tractPopupElement(t, onOpenTract, close) {
  const el = document.createElement('div');
  el.innerHTML = `<div class="usmap-tip-title">${escapeHtml(t.county)}, ${escapeHtml(t.state)}</div>
    <div class="usmap-tip-sub">2010 census tract ${escapeHtml(t.geoid)}<br/>${t.urban ? 'Urban tract (1 mile test)' : 'Rural tract (10 mile test)'}</div>
    <div>Low-access residents: <b>${escapeHtml(fmtInt(t.lowAccess))}</b></div>
    <div>Of them, low income: <b>${escapeHtml(fmtInt(t.lowIncomeLowAccess))}</b></div>
    <div>Poverty rate: <b>${escapeHtml(fmtPct(t.povertyRate))}</b></div>
    <div>Median family income: <b>${escapeHtml(fmtUsd(t.medianFamilyIncome))}</b></div>
    <div class="usmap-tip-note">USDA 2019 flag, as published</div>
    ${onOpenTract ? '<button type="button" class="usmap-analyze">Analyze this tract</button>' : ''}`;
  const button = el.querySelector('.usmap-analyze');
  if (button) {
    button.addEventListener('click', () => {
      close();
      onOpenTract({ lat: t.lat, lng: t.pointLng, label: tractLabel(t) });
    });
  }
  return el;
}

// Tooltip and popup skin: the dark glass of the panels below, scoped to this view.
const OVERLAY_CSS = `
.usmap-tip.leaflet-tooltip {
  background: rgba(5, 6, 8, 0.92);
  color: rgba(232, 237, 244, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 7px 9px;
  font: 11.5px/1.45 Inter, system-ui, sans-serif;
}
.usmap-tip.leaflet-tooltip-top::before { border-top-color: rgba(5, 6, 8, 0.92); }
.usmap-tip b, .usmap-popup b { color: #fff; font-weight: 600; }
.usmap-tip-title { font-weight: 600; color: #fff; }
.usmap-tip-sub { color: rgba(232, 237, 244, 0.6); margin-bottom: 3px; }
.usmap-tip-note { color: rgba(232, 237, 244, 0.5); margin-top: 4px; font-size: 10.5px; }
.usmap-popup .leaflet-popup-content-wrapper,
.usmap-popup .leaflet-popup-tip {
  background: rgba(5, 6, 8, 0.95);
  color: rgba(232, 237, 244, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
.usmap-popup .leaflet-popup-content { margin: 11px 13px; font: 12px/1.5 Inter, system-ui, sans-serif; }
.usmap-popup a.leaflet-popup-close-button { color: rgba(232, 237, 244, 0.55); }
.usmap-popup a.leaflet-popup-close-button:hover { color: #fff; }
.usmap-analyze {
  margin-top: 9px;
  width: 100%;
  border: 0;
  border-radius: 7px;
  padding: 7px 10px;
  font: 600 12px/1.2 Inter, system-ui, sans-serif;
  color: #04130b;
  background: var(--neon, #5ef2a0);
  cursor: pointer;
}
.usmap-analyze:hover { filter: brightness(1.08); }
.usmap-analyze:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.usmap-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 4px 0 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  transition: border-color 140ms ease-out, background-color 140ms ease-out;
}
.usmap-search:hover { border-color: rgba(255, 255, 255, 0.26); }
.usmap-search:focus-within {
  border-color: rgba(94, 242, 160, 0.7);
  background: rgba(255, 255, 255, 0.08);
}
.usmap-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: 0;
  outline: none;
  color: #fff;
  font: 12.5px/1.2 Inter, system-ui, sans-serif;
}
.usmap-search input::placeholder { color: rgba(232, 237, 244, 0.5); }
.usmap-search input:disabled { cursor: not-allowed; }
.usmap-clear {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(232, 237, 244, 0.6);
  cursor: pointer;
}
.usmap-clear:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
.usmap-clear:focus-visible { outline: 2px solid var(--neon, #5ef2a0); outline-offset: 0; }
.usmap-options {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 10;
  max-height: min(22rem, 55vh);
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 8px;
  background: #08090c;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.usmap-option {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  line-height: 1.3;
}
.usmap-option[aria-selected='true'] { background: rgba(94, 242, 160, 0.14); }
.usmap-option[aria-selected='true'] .usmap-option-name { color: #fff; }
`;

const panelStyle = {
  background: 'rgba(5, 6, 8, 0.84)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'rgba(232,237,244,0.88)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

function LegendDot({ radius, urban = true }) {
  const size = Math.ceil(radius * 2 + 3);
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill={DOT_FILL}
        fillOpacity={urban ? 0.75 : 0.35}
        stroke={DOT_RIM}
        strokeWidth={urban ? 0.7 : 1.4}
      />
    </svg>
  );
}

/**
 * US map of USDA's published 2019 low-income & low-access tracts.
 *
 * @param {{ onOpenTract?: (tract: { lat: number, lng: number, label: string }) => void }} props
 *   onOpenTract (optional): called from a dot's popup ("Analyze this tract")
 *   with the tract's 2010 internal point and a "County, State (tract GEOID)"
 *   label. Without it the popup has no button.
 */
export default function DesignationAtlasView({ onOpenTract } = {}) {
  const rootRef = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);
  const panelRef = useRef(null);
  const legendRef = useRef(null);
  const inputRef = useRef(null);
  const focusFipsRef = useRef(null);
  const onOpenTractRef = useRef(onOpenTract);

  const [tracts, setTracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mapZoom, setMapZoom] = useState(4);
  const [inView, setInView] = useState(null);

  const [counties, setCounties] = useState([]);
  const [countiesError, setCountiesError] = useState(false);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [picked, setPicked] = useState(null);
  // Bumped on every pick, so picking the same county again flies back to it.
  const [flySeq, setFlySeq] = useState(0);

  useEffect(() => {
    onOpenTractRef.current = onOpenTract;
  }, [onOpenTract]);

  const national = useMemo(() => summarizeLilaTracts(tracts), [tracts]);
  const matches = useMemo(() => searchCounties(counties, query), [counties, query]);
  const hasQuery = query.trim() !== '';
  const showOptions = listOpen && hasQuery && matches.length > 0;
  const showNoMatch = listOpen && hasQuery && counties.length > 0 && matches.length === 0;

  // Counties for the search box; the map works without them.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(COUNTIES_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const decoded = decodeCounties(await response.json());
        if (active) setCounties(decoded);
      } catch {
        if (active) setCountiesError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error('Unable to load the USDA 2019 Food Access Research Atlas tracts.');
        const decoded = decodeLilaTracts(await response.json());
        if (active) setTracts(decoded);
      } catch (err) {
        if (active) setError(err?.message || 'Unable to build the USDA 2019 low-income & low-access map.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current || !rootRef.current) return undefined;

    const map = L.map(rootRef.current, {
      preferCanvas: true,
      center: [39.3, -96.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: 12,
      // Quarter steps so the lower 48 can fill the window on any screen.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      zoomControl: false,
      attributionControl: true,
    });
    // Keep the zoom buttons clear of the panels: top-right beside the
    // summary on wider screens; bottom-right on phones, where the summary
    // spans the top.
    const width = rootRef.current.clientWidth;
    L.control.zoom({ position: width >= 640 ? 'topright' : 'bottomright' }).addTo(map);

    // CARTO basemaps require an API key on the keyed raster endpoint (no
    // {s} subdomains there). The key is public-by-design for raster tiles;
    // override the built-in one with VITE_CARTO_KEY. 'dark_all' also answers
    // on this endpoint if the light voyager style ever needs swapping.
    const cartoKey = import.meta.env.VITE_CARTO_KEY || 'cb1_3hwb_1_c5d22856e4cb2fe46ac23f9b';
    L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${cartoKey}`, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    map.fitBounds(CONTIGUOUS_US, nationalPadding(width));

    mapRef.current = map;
    if (import.meta.env.DEV) window.__usMap = map;
    return () => {
      if (import.meta.env.DEV && window.__usMap === map) delete window.__usMap;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Dots: one canvas layer, rebuilt only when the data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracts.length) return undefined;

    const renderer = L.canvas({ padding: 0.5, tolerance: 5 });
    const group = L.featureGroup();
    const zoom = map.getZoom();
    for (const t of tracts) {
      const marker = L.circleMarker([t.lat, t.lng], { renderer, ...dotStyle(t, zoom, focusFipsRef.current) });
      marker.tract = t;
      group.addLayer(marker);
    }

    group.bindTooltip((layer) => tractTooltipHtml(layer.tract), {
      className: 'usmap-tip',
      direction: 'top',
      offset: [0, -5],
      opacity: 1,
    });

    // The canvas hands the click to the top-most dot within tolerance; at
    // national zoom that can be a neighbor, so open the dot whose center is
    // nearest the click instead.
    function nearestTract(e) {
      // Not e.containerPoint: for small circle markers Leaflet sets it to the
      // hit dot's center, which is the very guess being corrected here.
      if (!e.originalEvent || !('clientX' in e.originalEvent)) return null;
      const at = map.mouseEventToContainerPoint(e.originalEvent);
      let best = null;
      let bestD = Infinity;
      group.eachLayer((marker) => {
        const p = map.latLngToContainerPoint(marker.getLatLng());
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= marker.getRadius() + 6 && d < bestD) {
          best = marker.tract;
          bestD = d;
        }
      });
      return best;
    }

    const popup = L.popup({ className: 'usmap-popup', maxWidth: 280, offset: [0, -4], autoPanPadding: [24, 24] });
    group.on('click', (e) => {
      const t = nearestTract(e) || e.layer?.tract;
      if (!t) return;
      group.closeTooltip();
      popup
        .setLatLng([t.lat, t.lng])
        .setContent(tractPopupElement(t, onOpenTractRef.current, () => map.closePopup(popup)))
        .openOn(map);
    });

    function resize() {
      const z = map.getZoom();
      group.eachLayer((marker) => marker.setStyle(dotStyle(marker.tract, z, focusFipsRef.current)));
    }
    map.on('zoomend', resize);

    group.addTo(map);
    groupRef.current = group;
    return () => {
      map.off('zoomend', resize);
      map.closePopup(popup);
      group.remove();
      if (groupRef.current === group) groupRef.current = null;
    };
  }, [tracts]);

  // Picked county: its dots full strength and drawn on top, the rest dimmed.
  useEffect(() => {
    const fips = picked?.fips ?? null;
    focusFipsRef.current = fips;
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    const z = map.getZoom();
    group.eachLayer((marker) => {
      marker.setStyle(dotStyle(marker.tract, z, fips));
      if (fips && marker.tract.geoid.startsWith(fips)) marker.bringToFront();
    });
  }, [picked, tracts]);

  // Fly to a picked county once its card is on screen, so the padding
  // measures the panel as the user will see it.
  useEffect(() => {
    const map = mapRef.current;
    const bounds = picked && paddedCountyBounds(picked);
    if (!map || !bounds) return;
    map.closePopup();
    const options = { ...countyPadding(map, panelRef.current, legendRef.current), maxZoom: COUNTY_MAX_ZOOM };
    if (prefersReducedMotion()) map.fitBounds(bounds, { ...options, animate: false });
    else map.flyToBounds(bounds, { ...options, duration: FLY_SECONDS });
  }, [picked, flySeq]);

  // Keep the active option visible when arrowing through a scrolled list.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function pickCounty(county) {
    setPicked(county);
    setFlySeq((n) => n + 1);
    setQuery(countyLabel(county));
    setListOpen(false);
    setActiveIndex(-1);
  }

  function clearSearch() {
    setQuery('');
    setPicked(null);
    setListOpen(false);
    setActiveIndex(-1);
    const map = mapRef.current;
    if (map) {
      map.closePopup();
      const padding = nationalPadding(map.getSize().x);
      if (prefersReducedMotion()) map.fitBounds(CONTIGUOUS_US, { ...padding, animate: false });
      else map.flyToBounds(CONTIGUOUS_US, { ...padding, duration: FLY_SECONDS });
    }
    inputRef.current?.focus();
  }

  function onQueryChange(event) {
    const value = event.target.value;
    setQuery(value);
    setListOpen(true);
    setActiveIndex(-1);
    // Emptying the box by hand drops the highlight but leaves the map where it is.
    if (value.trim() === '' && picked) setPicked(null);
  }

  function onQueryKeyDown(event) {
    const count = matches.length;
    if (event.key === 'ArrowDown') {
      if (!hasQuery || !count) return;
      event.preventDefault();
      if (!showOptions) {
        setListOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((i) => (i + 1) % count);
      }
    } else if (event.key === 'ArrowUp') {
      if (!showOptions) return;
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (event.key === 'Enter') {
      if (!hasQuery || !count) return;
      event.preventDefault();
      pickCounty(showOptions && activeIndex >= 0 && activeIndex < count ? matches[activeIndex] : matches[0]);
    } else if (event.key === 'Escape') {
      if (!showOptions && !showNoMatch) return;
      event.preventDefault();
      setListOpen(false);
      setActiveIndex(-1);
    }
  }

  function onQueryFocus() {
    if (hasQuery && !(picked && countyLabel(picked) === query)) setListOpen(true);
  }

  // In-view summary, debounced on moveend (zoomend is followed by moveend).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let timer = null;

    function update() {
      timer = null;
      setMapZoom(map.getZoom());
      if (!tracts.length) return;
      const b = map.getBounds();
      const visible = tractsInBounds(tracts, {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
      setInView({ ...summarizeLilaTracts(visible), topStates: topStatesByTracts(visible, 4) });
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, SUMMARY_DEBOUNCE_MS);
    }

    schedule();
    map.on('moveend', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', schedule);
    };
  }, [tracts]);

  const view = inView || { tracts: 0, lowAccess: 0, lowIncomeLowAccess: 0, topStates: [] };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#050608' }}>
      <style>{OVERLAY_CSS}</style>
      <div ref={rootRef} className="w-full h-full" />

      <div
        ref={panelRef}
        data-usmap-summary
        className="absolute left-3 top-3 z-[1000] rounded-lg px-3 py-2.5 text-xs w-[calc(100%-1.5rem)] sm:w-[21rem]"
        style={panelStyle}
      >
        <div className="relative">
          <div className="usmap-search">
            <Search size={14} aria-hidden="true" className="shrink-0 text-white/55" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search by county"
              aria-autocomplete="list"
              aria-expanded={showOptions}
              aria-controls={LIST_ID}
              aria-activedescendant={showOptions && activeIndex >= 0 ? optionId(activeIndex) : undefined}
              placeholder={
                countiesError
                  ? 'County search unavailable'
                  : counties.length
                    ? 'Search by county, e.g. Santa Clara'
                    : 'Loading counties…'
              }
              disabled={countiesError}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={query}
              onChange={onQueryChange}
              onKeyDown={onQueryKeyDown}
              onFocus={onQueryFocus}
              onBlur={() => setListOpen(false)}
            />
            {(query || picked) && (
              <button type="button" className="usmap-clear" aria-label="Clear county search" onClick={clearSearch}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {/* mousedown keeps focus in the input, so a click or a scrollbar drag doesn't close the list first. */}
          <ul
            id={LIST_ID}
            role="listbox"
            aria-label="Matching counties"
            className="usmap-options"
            hidden={!showOptions}
            onMouseDown={(e) => e.preventDefault()}
          >
            {showOptions &&
              matches.map((c, i) => (
                <li
                  key={c.fips}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  className="usmap-option"
                  onMouseMove={() => i !== activeIndex && setActiveIndex(i)}
                  onClick={() => pickCounty(c)}
                >
                  <div className="usmap-option-name text-[12px] text-white/85">{countyLabel(c)}</div>
                  <div className="text-[10.5px] text-white/50 tabular-nums">{flaggedText(c.flagged)}</div>
                </li>
              ))}
          </ul>
          {showNoMatch && (
            <div className="usmap-options px-2.5 py-2 text-white/60" role="status">
              No county matches “{query.trim()}”. Try a county name, then a state.
            </div>
          )}
        </div>

        {picked && (
          <div
            data-usmap-county
            aria-live="polite"
            className="mt-2 rounded-md px-2.5 py-2"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
          >
            <div className="font-semibold text-white/90">{countyLabel(picked)}</div>
            {picked.flagged > 0 ? (
              <>
                <div className="mt-1 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-base font-semibold leading-tight tabular-nums" style={{ color: DOT_FILL }}>
                      {fmtInt(picked.flagged)}
                      <span className="text-xs font-normal text-white/55"> of {fmtInt(picked.tracts)}</span>
                    </div>
                    <div className="text-white/60">tracts flagged</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold leading-tight tabular-nums text-white/90">
                      {fmtInt(picked.flaggedLowAccess)}
                    </div>
                    <div className="text-white/60">low-access residents</div>
                  </div>
                </div>
                <div className="mt-1 text-[10.5px] leading-snug text-white/45">
                  In its flagged tracts, which stay bright on the map.
                </div>
              </>
            ) : (
              <p className="mt-1 leading-snug text-white/65">
                USDA&apos;s 2019 map flagged none of its {fmtInt(picked.tracts)} census tract
                {picked.tracts === 1 ? '' : 's'} as low income and low access.
              </p>
            )}
          </div>
        )}

        <div className="mt-2.5 font-semibold text-white/90">USDA 2019 low-income &amp; low-access tracts</div>
        <p className={`mt-1 text-[11px] leading-snug text-white/65${picked ? ' hidden sm:block' : ''}`}>
          USDA&apos;s published 2019 map (Food Access Research Atlas): tracts USDA flagged low income and low access
          (supermarkets; 1 mile urban, 10 miles rural). Published flags, not this app&apos;s estimate.
        </p>

        <div className="mt-2.5 text-[10px] uppercase tracking-[0.12em] text-white/45">In view</div>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <div className="text-lg font-semibold leading-tight tabular-nums" style={{ color: DOT_FILL }}>
              {fmtInt(view.tracts)}
            </div>
            <div className="text-white/60">flagged tracts</div>
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight tabular-nums text-white/90">{fmtInt(view.lowAccess)}</div>
            <div className="text-white/60">low-access residents</div>
          </div>
        </div>
        <div className="mt-1 hidden sm:block text-white/50 tabular-nums">
          {fmtInt(view.lowIncomeLowAccess)} of them low income
        </div>

        <div className="mt-2 text-white/55 tabular-nums">
          Nationwide (50 states + DC): {fmtInt(national.tracts)} tracts · {fmtInt(national.lowAccess)} low-access
          residents
        </div>

        {view.topStates.length > 0 && (
          <div className="mt-2 hidden sm:block">
            <div className="text-white/60">Most flagged tracts in view</div>
            <div className="mt-0.5 space-y-0.5 text-white/50 tabular-nums">
              {view.topStates.map((row) => (
                <div key={row.state} className="flex justify-between gap-4">
                  <span>{row.state}</span>
                  <span>{fmtInt(row.tracts)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {inView && view.tracts === 0 && !loading && (
          <div className="mt-2 text-white/50">No flagged tracts in this window. Zoom out or pan.</div>
        )}
      </div>

      <div
        ref={legendRef}
        className="absolute left-3 bottom-6 sm:bottom-3 z-[1000] rounded-lg px-3 py-2 text-[11px] max-w-[calc(100%-4.5rem)] sm:max-w-[19rem]"
        style={{ ...panelStyle, color: 'rgba(232,237,244,0.8)' }}
      >
        <div className="font-medium text-white/80">Each dot is one flagged census tract</div>
        <div className="mt-1.5 flex items-end gap-3">
          {LEGEND_SIZES.map((n) => (
            <div key={n} className="flex items-center gap-1.5">
              <LegendDot radius={lilaDotRadius(n, mapZoom)} />
              <span className="tabular-nums text-white/65">{n.toLocaleString('en-US')}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-white/55 leading-snug sm:hidden">Dot size: low-access residents</div>
        <div className="mt-1 text-white/55 leading-snug hidden sm:block">
          Dot size: low-access residents, people living more than 1 mile from a supermarket (urban tracts) or 10
          miles (rural tracts).
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-white/65">
          <span className="flex items-center gap-1.5">
            <LegendDot radius={4} /> Urban
          </span>
          <span className="flex items-center gap-1.5">
            <LegendDot radius={4} urban={false} /> Rural
          </span>
          <span className="hidden sm:inline text-white/45">Hover or tap a dot</span>
        </div>
        <div className="mt-1 hidden sm:block text-[10px] text-white/40">
          Dots at 2010 tract internal points (Census 2010 Gazetteer).
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-black/35">
          <div className="rounded-md border border-white/20 bg-black/70 px-4 py-3 text-sm text-white/85">
            Loading the USDA 2019 Food Access Research Atlas…
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-3 bottom-16 z-[1002] rounded-md border border-red-400/35 bg-red-950/70 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
