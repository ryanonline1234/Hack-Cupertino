function LayoutToggle({ layout, onToggle }) {
  const isBottom = layout === 'bottom';
  return (
    <button
      onClick={onToggle}
      title={isBottom ? 'Switch to side-by-side layout' : 'Switch to bottom panel layout'}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/5"
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.45)',
      }}
    >
      {isBottom ? (
        // Icon: map left | panels right
        <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
          <rect x="0.5" y="0.5" width="9" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="rgba(34,211,238,0.15)" />
          <rect x="12.5" y="0.5" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="12.5" y="9" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ) : (
        // Icon: map top | panels bottom
        <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
          <rect x="0.5" y="0.5" width="21" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="rgba(34,211,238,0.15)" />
          <rect x="0.5" y="11.5" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8" y="11.5" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="15.5" y="11.5" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )}
      <span className="hidden sm:inline">{isBottom ? 'Split' : 'Bottom'}</span>
    </button>
  );
}

function ModeToggle({ mode, onModeChange }) {
  const isAtlas = mode === 'atlas';

  return (
    <div
      className="flex items-center rounded-lg p-0.5"
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <button
        onClick={() => onModeChange('atlas')}
        className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
        style={{
          color: isAtlas ? 'var(--cyan)' : 'rgba(255,255,255,0.45)',
          background: isAtlas ? 'rgba(34,211,238,0.12)' : 'transparent',
        }}
        title="Global Atlas"
      >
        Globe
      </button>
      <button
        onClick={() => onModeChange('simlab')}
        className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
        style={{
          color: !isAtlas ? 'var(--neon)' : 'rgba(255,255,255,0.45)',
          background: !isAtlas ? 'rgba(0,255,153,0.12)' : 'transparent',
        }}
        title="Sim Lab"
      >
        Sim Lab
      </button>
    </div>
  );
}

export default function FeatureNav({ communityData, loading, layout, onToggleLayout, mode, onModeChange }) {
  const locationLabel = communityData
    ? `${communityData.meta.stateAbbr} · Tract ${communityData.meta.fips?.slice(-6)}`
    : null;

  return (
    <nav
      className="h-14 shrink-0 flex items-center justify-between px-5 border-b z-50"
      style={{
        background: 'rgba(5, 6, 8, 0.92)',
        borderColor: 'rgba(255,255,255,0.07)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Left: logo + title */}
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--neon), var(--cyan))' }}
        >
          <span style={{ color: '#050608' }}>FD</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-wide text-white/90 hidden sm:inline">
            FOOD DESERT
          </span>
          <span className="text-sm font-light tracking-widest" style={{ color: 'var(--cyan)' }}>
            IMPACT SIMULATOR
          </span>
        </div>
      </div>

      {/* Center: status + layout toggle */}
      <div className="flex items-center gap-2.5">
        <ModeToggle mode={mode} onModeChange={onModeChange} />

        {loading && (
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{
              background: 'rgba(34,211,238,0.1)',
              border: '1px solid rgba(34,211,238,0.25)',
              color: 'var(--cyan)',
            }}
          >
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Analyzing
          </div>
        )}
        {!loading && communityData && (
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1 text-xs animate-fade-slide-up"
            style={{
              background: 'rgba(0,255,153,0.08)',
              border: '1px solid rgba(0,255,153,0.2)',
              color: 'var(--neon)',
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--neon)', boxShadow: '0 0 6px var(--neon)' }}
            />
            {locationLabel}
          </div>
        )}
        {!loading && !communityData && (
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20" />
            Awaiting location
          </div>
        )}

        <LayoutToggle layout={layout} onToggle={onToggleLayout} />
      </div>

      {/* Right: data sources */}
      <div className="hidden md:flex items-center gap-1.5">
        {['USDA', 'CDC', 'Census', 'Claude AI'].map((src) => (
          <span
            key={src}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.35)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {src}
          </span>
        ))}
      </div>
    </nav>
  );
}
