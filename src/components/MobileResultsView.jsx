import { useState } from 'react';
import LocationGate from './LocationGate';

/*
 * MobileResultsView: the phone-sized tracker experience. A designated-area
 * lookup only needs the answer — designation, key stats, narrative, impact
 * — so phones get an info-only page with no map surface at all: no Streets
 * GL iframe, no 2D canvas, no WebGL. The heavy renderers stay desktop-only.
 *
 * Pre-search reuses LocationGate (same fuzzy search + examples). Post-search
 * stacks the existing desktop panels (CommunityStatsPanel, AICard, pipeline
 * log) in a natural page scroll. Place-a-store needs a map to point at, so
 * it stays desktop-only; Share still works — the copied link replays the
 * full simulation on a bigger screen.
 *
 * Props:
 *   locationPicked, communityData, loading, dataError,
 *   onGateSelect(lat, lng), onShareScenario(), panels (React node)
 */
export default function MobileResultsView({
  locationPicked,
  communityData,
  loading,
  dataError,
  onGateSelect,
  onShareScenario,
  panels,
  scenario,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const showGate = searchOpen || (!locationPicked && !communityData && !loading);

  function handleGateSelect(lat, lng) {
    setSearchOpen(false);
    onGateSelect(lat, lng);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Slim sticky header: brand + search + share. All actions ≥44px. */}
      <header
        className="shrink-0 flex items-center gap-2 px-3"
        style={{
          minHeight: '56px',
          background: 'rgba(5,6,8,0.92)',
          borderBottom: '1px solid rgba(34,211,238,0.18)',
        }}
      >
        <span className="text-sm font-bold tracking-wide whitespace-nowrap">
          <span style={{ color: 'var(--cyan)' }}>FOOD DESERT</span>
          <span className="text-white/85"> AI</span>
        </span>
        <span className="flex-1" />
        {!showGate && (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="rounded-full px-4 text-xs font-semibold"
            style={{
              minHeight: '44px',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            New search
          </button>
        )}
        {communityData && !showGate && (
          <button
            type="button"
            onClick={() => onShareScenario?.()}
            title="Copy a link that replays this location"
            className="rounded-full px-4 text-xs font-semibold"
            style={{
              minHeight: '44px',
              background: 'rgba(52,211,153,0.15)',
              border: '1px solid rgba(52,211,153,0.4)',
              color: 'var(--neon)',
            }}
          >
            Share
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {showGate ? (
          <LocationGate onSelect={handleGateSelect} />
        ) : (
          <div className="flex flex-col gap-3 p-3 pb-8">
            {loading && !communityData && (
              <div
                className="rounded-xl p-4 flex items-center gap-3 text-sm"
                style={{
                  background: 'rgba(5,6,8,0.6)',
                  border: '1px solid rgba(34,211,238,0.22)',
                  color: 'rgba(255,255,255,0.85)',
                }}
                role="status"
                aria-live="polite"
              >
                <span
                  className="shrink-0 rounded-full animate-pulse"
                  style={{ width: '10px', height: '10px', background: 'var(--cyan)' }}
                />
                Analyzing location — census, health, and food-access sources…
              </div>
            )}
            {dataError && !loading && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{
                  background: 'rgba(5,6,8,0.6)',
                  border: '1px solid rgba(252,165,165,0.4)',
                  color: 'rgba(252,165,165,0.9)',
                }}
                role="alert"
              >
                {dataError}
              </div>
            )}
            {scenario}
            {panels}
            {communityData && (
              <p className="text-center text-[11px] leading-relaxed px-6 text-white/40">
                3D map, US atlas, and place-a-store experiments are
                desktop-only. Use Share above to open this location as a
                full simulation on a bigger screen.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
