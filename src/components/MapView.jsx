import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
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

export default function MapView({
  center = { lat: 39.5, lng: -98.35 },
  pinPosition = null,
  onPinDrop,
  isLoading,
  showInstruction = true,
  stores = [],
  showStores = false,
  placeArmed = false,
  onPlaceAt,
  // True when the map is actually shown. The parent keeps both renderers
  // mounted and hides the inactive one, so a Leaflet map initialized while
  // hidden measures 0×0 — this effect re-syncs size the moment it appears.
  visible = true,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const storesLayerRef = useRef(null);
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

  // Supermarket source layer: same data as the 3D highlight overlay, drawn
  // as native Leaflet markers so 2D highlight is a pure layer toggle.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (storesLayerRef.current) {
      storesLayerRef.current.remove();
      storesLayerRef.current = null;
    }
    if (!showStores || !Array.isArray(stores) || stores.length === 0) return;

    const layer = L.layerGroup(
      stores
        .filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng))
        .slice(0, 300)
        .map((s) => L.circleMarker([s.lat, s.lng], {
          radius: s.placed ? 8 : 6,
          color: s.placed ? '#083344' : '#052e22',
          fillColor: s.placed ? '#22d3ee' : '#00ff99',
          fillOpacity: 0.85,
          weight: 1.5,
        }).bindTooltip(
          `${s.name || 'Supermarket'}${Number.isFinite(s.distanceMiles) ? ` · ${s.distanceMiles.toFixed(1)} mi` : ''}`,
          { direction: 'top', offset: [0, -6] },
        )),
    );
    layer.addTo(map);
    storesLayerRef.current = layer;
  }, [stores, showStores]);

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
          Click anywhere to drop a pin and analyze food access
        </div>
      )}
      {placeArmed && (
        <div className="absolute top-3 left-3 z-[1000] px-3 py-2 rounded-lg shadow text-sm pointer-events-none"
          style={{ background: 'rgba(5,6,8,0.9)', border: '1px solid rgba(34,211,238,0.4)', color: 'var(--cyan)' }}
        >
          Click the map to place a hypothetical store
        </div>
      )}

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
