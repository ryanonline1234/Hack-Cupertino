import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

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

export default function MapView({ onPinDrop, isLoading, communityData }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const [hasDropped, setHasDropped] = useState(false);

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

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 2rem)' }}>
      <div ref={mapRef} className="w-full h-full z-0" />

      {/* Instruction overlay — disappears after first pin drop */}
      {!hasDropped && (
        <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow text-sm text-gray-700 pointer-events-none">
          Click anywhere to drop a pin and analyze food access
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
