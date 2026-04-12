import { useState, useRef } from 'react';
import RippleField from './RippleField';
import ParticleDrift from './ParticleDrift';

const STREETS_GL_BASE = 'https://streets-gl.pages.dev';

const EXAMPLE_LOCATIONS = [
  { label: 'San Jose, CA',        lat: 37.339,  lng: -121.894 },
  { label: 'Chicago South Side',  lat: 41.773,  lng: -87.632  },
  { label: 'Detroit, MI',         lat: 42.331,  lng: -83.046  },
  { label: 'Compton, CA',         lat: 33.894,  lng: -118.220 },
];

function buildSrc(lat, lng) {
  return `${STREETS_GL_BASE}/?mapStyle=streets&pitch=50&yaw=-30&distance=1800&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
}

async function geocodeAddress(query) {
  const url = `/api/nominatim/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en' } });
  if (!res.ok) throw new Error('Geocoding service error');
  const data = await res.json();
  if (!data?.length) throw new Error('Location not found — try a city name or ZIP code');
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

export default function StreetsGlView({ lat, lng, isLoading, hasData, onSearch }) {
  const [query, setQuery] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [searchError, setSearchError] = useState('');
  const inputRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setGeocoding(true);
    setSearchError('');
    try {
      const { lat: rlat, lng: rlng } = await geocodeAddress(q);
      onSearch(rlat, rlng);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setGeocoding(false);
    }
  }

  function handleExample(loc) {
    setQuery(loc.label);
    setSearchError('');
    onSearch(loc.lat, loc.lng);
  }

  const busy = isLoading || geocoding;

  return (
    <div className="relative w-full h-full overflow-hidden map-scanlines" style={{ background: '#050608' }}>
      {/* Streets GL 3D iframe */}
      <iframe
        key={`${lat.toFixed(4)},${lng.toFixed(4)}`}
        src={buildSrc(lat, lng)}
        className="absolute inset-0 w-full h-full border-0"
        title="3D Street Map"
        loading="lazy"
        allow="fullscreen"
        style={{ zIndex: 1 }}
      />

      {/* Decorative overlays (above iframe) */}
      <ParticleDrift />
      <RippleField visible={hasData} />

      {/* Corner arc decoration */}
      <svg
        className="absolute top-0 right-0 pointer-events-none"
        style={{ zIndex: 4, opacity: 0.25 }}
        width="200"
        height="200"
        viewBox="0 0 200 200"
      >
        <path d="M200 0 Q200 200 0 200" fill="none" stroke="var(--cyan)" strokeWidth="0.5" />
        <path d="M200 20 Q180 200 0 180" fill="none" stroke="var(--neon)" strokeWidth="0.5" />
        <path d="M200 50 Q150 200 0 150" fill="none" stroke="var(--cyan)" strokeWidth="0.3" />
      </svg>

      {/* Search bar */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
        style={{ width: 'min(500px, calc(100% - 2.5rem))' }}
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-full"
            style={{
              background: 'rgba(5, 6, 8, 0.82)',
              border: '1px solid rgba(34, 211, 238, 0.25)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <svg className="w-4 h-4 shrink-0 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchError(''); }}
              placeholder="Search any US city, address, or ZIP…"
              disabled={busy}
              className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/25 outline-none disabled:opacity-60"
            />
            {(geocoding) && (
              <svg className="w-4 h-4 shrink-0 animate-spin" style={{ color: 'var(--cyan)' }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>

          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold transition-all disabled:opacity-40"
            style={{
              background: busy ? 'rgba(34,211,238,0.1)' : 'linear-gradient(135deg, rgba(0,255,153,0.2), rgba(34,211,238,0.2))',
              border: '1px solid rgba(34, 211, 238, 0.35)',
              color: 'var(--cyan)',
              backdropFilter: 'blur(20px)',
            }}
          >
            Analyze
          </button>
        </form>

        {/* Error tooltip */}
        {searchError && (
          <div
            className="mt-2 px-4 py-2 rounded-xl text-sm animate-fade-slide-up"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'rgba(252, 165, 165, 0.9)',
            }}
          >
            {searchError}
          </div>
        )}
      </div>

      {/* Example location pills */}
      {!hasData && !busy && (
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-2 flex-wrap justify-center animate-fade-slide-up"
          style={{ width: 'min(600px, calc(100% - 2rem))' }}
        >
          <span className="text-xs text-white/30 self-center mr-1">Try:</span>
          {EXAMPLE_LOCATIONS.map((loc) => (
            <button
              key={loc.label}
              onClick={() => handleExample(loc)}
              className="px-3 py-1.5 rounded-full text-xs transition-all hover:scale-105"
              style={{
                background: 'rgba(5, 6, 8, 0.75)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {loc.label}
            </button>
          ))}
        </div>
      )}

      {/* Pipeline loading overlay */}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 10 }}
        >
          <div
            className="flex items-center gap-3 px-6 py-3 rounded-2xl animate-fade-slide-up"
            style={{
              background: 'rgba(5,6,8,0.85)',
              border: '1px solid rgba(34,211,238,0.25)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: 'var(--cyan)',
                boxShadow: '0 0 8px var(--cyan)',
                animation: 'pulseNeon 1s ease-in-out infinite',
              }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--cyan)' }}>
              Analyzing community data…
            </span>
          </div>
        </div>
      )}

      {/* Centered pin when location is set */}
      {hasData && !isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 5 }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            style={{
              color: 'var(--neon)',
              filter: 'drop-shadow(0 0 8px var(--neon))',
            }}
          >
            <circle cx="18" cy="18" r="4" fill="currentColor" />
            <line x1="18" y1="2"  x2="18" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="18" y1="24" x2="18" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="2"  y1="18" x2="12" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="18" x2="34" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
