import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { escapeHtml, storeTooltipLabel } from '../lib/storeTooltip';
import { haversineMiles } from '../lib/geo';
import { placedPinLabel, storeFormatInfo } from '../lib/storeFormats';
import { siteLabel } from '../lib/siteLabels';
// Import Leaflet's CSS here too — DesignationAtlasView.jsx imports it, but
// when StreetsGlView falls back to MapView (2D mode) the atlas may not have
// been loaded yet, so the map would render with broken tiles/zoom controls.
import 'leaflet/dist/leaflet.css';

// Fix default marker icons — Leaflet's icon paths break under bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Leaflet paints SVG/canvas, which can't read CSS variables, so the tokens
// are resolved once per draw. Fallbacks are the index.css values.
function tokenColor(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

const NON_COUNTING_GRAY = '#9ca3af';
// Dark halo under the hollow gray ring: gray alone is ~2.5:1 on light OSM
// tiles; the halo puts a >= 3:1 edge between the ring and any tile.
const NON_COUNTING_HALO = '#050608';
const NON_COUNTING_RADIUS = 8;
const NON_COUNTING_RING_WEIGHT = 2.5;
const NON_COUNTING_HALO_WIDTH = 1.5; // px of halo on each side of the ring
const PINS_PANE = 'placedPins';
// Above markerPane (600), so a pin dropped at the analyzed spot isn't hidden
// under the location marker, and below tooltipPane (650), so tooltips stay
// readable over the pins.
const PINS_PANE_Z = 640;
// Suggested sites (docs/08): numbered dashed circles, a different shape from
// the solid/ring pins, in their own pane just under the placed pins (so a
// store added at a suggested spot covers its marker) and over the location
// marker.
const SUGGEST_PANE = 'suggestedSites';
const SUGGEST_PANE_Z = 630;
const SUGGEST_SIZE = 26;

// The marker's HTML is fixed markup plus the pick's number (an integer), so
// nothing third-party reaches innerHTML here. Tokens resolve in the DOM, and
// the dark outer ring keeps the dashed edge visible on light tiles.
function suggestMarkerHtml(n) {
  const num = Number.isInteger(n) && n > 0 ? String(n) : '';
  return (
    `<span style="display:flex;align-items:center;justify-content:center;box-sizing:border-box;` +
    `width:${SUGGEST_SIZE}px;height:${SUGGEST_SIZE}px;border-radius:9999px;` +
    `border:2px dashed var(--orange);background:var(--void);color:var(--orange);` +
    `box-shadow:0 0 0 2px var(--void);font:700 12px/1 Inter,sans-serif;">${num}</span>`
  );
}

// Tooltip HTML: siteLabel escapes the OpenStreetMap name; everything else is
// a fixed string or a computed number, escaped anyway.
function suggestTooltip(site) {
  const n = Number.isInteger(site.n) && site.n > 0 ? ` ${site.n}` : '';
  const label = siteLabel(site) ?? 'Candidate site';
  const gain = typeof site.gainText === 'string' && site.gainText ? ` · ${escapeHtml(site.gainText)}` : '';
  return `Suggested site${n} · ${label}${gain}`;
}

// The payload's map stores are the tract area + 5 mi, so this cap only
// matters in the densest cities; nearest stores are kept first.
const MAX_STORE_MARKERS = 2000;

/*
 * Props:
 *   stores       counted SNAP stores (communityData.access.stores:
 *                [{ lat, lng, type, name }]), drawn when showStores is on
 *   placedPins   the visitor's stores [{ id, lat, lng, format }], always
 *                drawn: counting formats filled cyan, the others a hollow
 *                gray ring with a dark halo
 *   placeArmed / onPlaceAt(lat, lng)   armed clicks place a store instead of
 *                analyzing the clicked spot
 *   suggestedSites  suggestion picks [{ id, n, lat, lng, kind, sqft, name,
 *                gainText }], drawn as numbered dashed markers (not pins)
 */
export default function MapView({
  center = { lat: 39.5, lng: -98.35 },
  pinPosition = null,
  onPinDrop,
  isLoading,
  showInstruction = true,
  stores = [],
  showStores = false,
  placedPins = [],
  placeArmed = false,
  onPlaceAt,
  suggestedSites = [],
  // True when the map is actually shown. The parent keeps both renderers
  // mounted and hides the inactive one, so a Leaflet map initialized while
  // hidden measures 0×0 — this effect re-syncs size the moment it appears.
  visible = true,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const storesLayerRef = useRef(null);
  const pinsLayerRef = useRef(null);
  const suggestLayerRef = useRef(null);
  const rendererRef = useRef(null);
  // Refs mirror the latest props for the once-bound map click handler.
  const placeArmedRef = useRef(placeArmed);
  const onPlaceAtRef = useRef(onPlaceAt);
  const [hasDropped, setHasDropped] = useState(false);

  useEffect(() => {
    placeArmedRef.current = placeArmed;
    onPlaceAtRef.current = onPlaceAt;
  }, [placeArmed, onPlaceAt]);

  useEffect(() => {
    if (mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
    });
    // One canvas for the store dots: hundreds of SVG nodes get sluggish.
    rendererRef.current = L.canvas({ padding: 0.5 });
    // Placed stores sit in their own pane above the store canvas and the
    // location marker, whichever layer happened to be added first.
    map.createPane(PINS_PANE).style.zIndex = String(PINS_PANE_Z);
    map.createPane(SUGGEST_PANE).style.zIndex = String(SUGGEST_PANE_Z);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;

      // Armed: clicks place a hypothetical store instead of analyzing.
      if (placeArmedRef.current) {
        onPlaceAtRef.current?.(lat, lng);
        return;
      }

      // Remove existing marker
      if (markerRef.current) {
        markerRef.current.remove();
      }

      // Place new marker
      markerRef.current = L.marker([lat, lng]).addTo(map);

      setHasDropped(true);
      onPinDrop?.(lat, lng);
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
      rendererRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const centerLat = Number(center?.lat);
  const centerLng = Number(center?.lng);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !visible) return;
    map.invalidateSize();
    if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      map.setView([centerLat, centerLng], map.getZoom(), { animate: false });
    }
  }, [visible, centerLat, centerLng]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !center) return;

    const nextLat = Number(center.lat);
    const nextLng = Number(center.lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;

    const current = map.getCenter();
    const changed = Math.abs(current.lat - nextLat) > 0.0001 || Math.abs(current.lng - nextLng) > 0.0001;
    if (!changed) return;

    map.setView([nextLat, nextLng], map.getZoom(), { animate: false });
  }, [center, center?.lat, center?.lng]);

  // Counted supermarkets (USDA SNAP Supermarket / Super Store) as native
  // Leaflet markers, so the highlight is a pure layer toggle. Names come
  // from the SNAP retailer list and go through the escaping helper.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (storesLayerRef.current) {
      storesLayerRef.current.remove();
      storesLayerRef.current = null;
    }
    if (!showStores || !Array.isArray(stores) || stores.length === 0) return;

    const hasCenter = Number.isFinite(centerLat) && Number.isFinite(centerLng);
    const neon = tokenColor('--neon', '#5ef2a0');
    const ink = tokenColor('--void', '#0c1411');
    const nearestFirst = stores
      .filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng))
      .map((s) => ({
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        distanceMiles: hasCenter ? haversineMiles(centerLat, centerLng, s.lat, s.lng) : null,
      }))
      .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0))
      .slice(0, MAX_STORE_MARKERS);

    const layer = L.layerGroup(
      nearestFirst.map((s) => L.circleMarker([s.lat, s.lng], {
        renderer: rendererRef.current ?? undefined,
        radius: 6,
        color: ink,
        fillColor: neon,
        fillOpacity: 0.9,
        weight: 1.5,
      }).bindTooltip(
        storeTooltipLabel(s),
        { direction: 'top', offset: [0, -6] },
      )),
    );
    layer.addTo(map);
    storesLayerRef.current = layer;
  }, [stores, showStores, centerLat, centerLng]);

  // The visitor's placed stores: always visible, since the scenario card
  // describes them. Tooltip text is built from fixed strings only.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (pinsLayerRef.current) {
      pinsLayerRef.current.remove();
      pinsLayerRef.current = null;
    }
    if (!Array.isArray(placedPins) || placedPins.length === 0) return;

    const cyan = tokenColor('--cyan', '#7dd3fc');
    const ink = tokenColor('--void', '#0c1411');
    const layer = L.layerGroup(
      placedPins
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
        .flatMap((p) => {
          const counts = storeFormatInfo(p.format).counts;
          const tooltip = [escapeHtml(placedPinLabel(p.format)), { direction: 'top', offset: [0, -8] }];
          if (counts) {
            return [L.circleMarker([p.lat, p.lng], {
              radius: 9, color: ink, weight: 2, fillColor: cyan, fillOpacity: 0.95, pane: PINS_PANE,
            }).bindTooltip(...tooltip)];
          }
          // Hollow gray ring over a wider dark ring: the dark shows as a thin
          // outline inside and outside the gray. The halo takes no pointer
          // events; the ring carries the tooltip.
          return [
            L.circleMarker([p.lat, p.lng], {
              radius: NON_COUNTING_RADIUS,
              color: NON_COUNTING_HALO,
              weight: NON_COUNTING_RING_WEIGHT + 2 * NON_COUNTING_HALO_WIDTH,
              opacity: 1,
              fill: false,
              interactive: false,
              pane: PINS_PANE,
            }),
            L.circleMarker([p.lat, p.lng], {
              radius: NON_COUNTING_RADIUS,
              color: NON_COUNTING_GRAY,
              weight: NON_COUNTING_RING_WEIGHT,
              opacity: 1,
              fillColor: NON_COUNTING_GRAY,
              fillOpacity: 0,
              pane: PINS_PANE,
            }).bindTooltip(...tooltip),
          ];
        }),
    );
    layer.addTo(map);
    pinsLayerRef.current = layer;
  }, [placedPins]);

  // Suggested sites: visual only (the list in the Tract view is the
  // keyboard and screen-reader surface), so the markers take no tab stops.
  // Marker clicks don't reach the map, so they never re-analyze or place.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (suggestLayerRef.current) {
      suggestLayerRef.current.remove();
      suggestLayerRef.current = null;
    }
    const sites = Array.isArray(suggestedSites)
      ? suggestedSites.filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng))
      : [];
    if (sites.length === 0) return;

    const half = SUGGEST_SIZE / 2;
    const layer = L.layerGroup(
      sites.map((s) => L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: 'fds-suggest-marker',
          html: suggestMarkerHtml(s.n),
          iconSize: [SUGGEST_SIZE, SUGGEST_SIZE],
          iconAnchor: [half, half],
          tooltipAnchor: [0, -half],
        }),
        pane: SUGGEST_PANE,
        keyboard: false,
        riseOnHover: true,
      }).bindTooltip(suggestTooltip(s), { direction: 'top' })),
    );
    layer.addTo(map);
    suggestLayerRef.current = layer;
  }, [suggestedSites]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const nextLat = Number(pinPosition?.lat);
    const nextLng = Number(pinPosition?.lng);

    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      markerRef.current = L.marker([nextLat, nextLng]).addTo(map);
    } else {
      markerRef.current.setLatLng([nextLat, nextLng]);
    }

    map.setView([nextLat, nextLng], Math.max(map.getZoom(), 11), { animate: false });
  }, [pinPosition?.lat, pinPosition?.lng]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full z-0" />

      {/* Instruction overlay — disappears after first pin drop */}
      {showInstruction && !hasDropped && !placeArmed && (
        <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow text-sm text-gray-700 pointer-events-none">
          Click anywhere to test that spot&apos;s census tract
        </div>
      )}

      {/* Armed placement has no overlay here: StreetsGlView's banner carries
          the instruction and the format choice, and a top-left box would
          cover Leaflet's zoom control. */}

      {/* Loading spinner overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-lg px-4 py-3 shadow-lg flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-700">Analyzing area...</span>
          </div>
        </div>
      )}
    </div>
  );
}
