export default function FeatureNav({ communityData, loading }) {
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
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, var(--neon), var(--cyan))' }}
          >
            <span style={{ color: '#050608' }}>FD</span>
          </div>
          <span className="text-sm font-semibold tracking-wide text-white/90">
            FOOD DESERT
          </span>
          <span className="text-sm font-light tracking-widest" style={{ color: 'var(--cyan)' }}>
            IMPACT SIMULATOR
          </span>
        </div>
      </div>

      {/* Center: status badge */}
      <div className="flex items-center gap-3">
        {loading && (
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{
              background: 'rgba(34, 211, 238, 0.1)',
              border: '1px solid rgba(34, 211, 238, 0.25)',
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
              background: 'rgba(0, 255, 153, 0.08)',
              border: '1px solid rgba(0, 255, 153, 0.2)',
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
