import { fmtPct, fmtIncome } from '../utils/formatters';

function SkeletonRow() {
  return (
    <div className="flex justify-between items-center py-1.5">
      <div className="skeleton h-3 w-28 rounded" />
      <div className="skeleton h-3 w-16 rounded" />
    </div>
  );
}

function StatRow({ label, value, accent, highlight }) {
  return (
    <div
      className="flex justify-between items-baseline py-1.5 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <span className="text-xs text-white/45">{label}</span>
      <span
        className="text-sm font-semibold"
        style={{
          color: highlight ? 'var(--orange)' : accent === 'neon' ? 'var(--neon)' : accent === 'cyan' ? 'var(--cyan)' : 'rgba(255,255,255,0.85)',
          textShadow: highlight ? '0 0 10px rgba(249,115,22,0.4)' : accent === 'neon' ? '0 0 10px rgba(0,255,153,0.3)' : 'none',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FoodDesertBadge({ isFoodDesert }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded-lg mb-3"
      style={{
        background: isFoodDesert
          ? 'rgba(249, 115, 22, 0.1)'
          : 'rgba(0, 255, 153, 0.08)',
        border: `1px solid ${isFoodDesert ? 'rgba(249,115,22,0.3)' : 'rgba(0,255,153,0.25)'}`,
      }}
    >
      <span className="text-xs font-medium text-white/55">Food Desert Status</span>
      <span
        className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded"
        style={{
          color: isFoodDesert ? 'var(--orange)' : 'var(--neon)',
          background: isFoodDesert ? 'rgba(249,115,22,0.15)' : 'rgba(0,255,153,0.12)',
        }}
      >
        {isFoodDesert ? 'Confirmed' : 'Not Designated'}
      </span>
    </div>
  );
}

export default function CommunityStatsPanel({ communityData, loading, impactData, showImpact, onToggleImpact }) {
  if (!communityData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <p className="text-xs text-white/30">Community data will appear here</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        <div className="skeleton h-8 rounded-lg mb-2" />
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  const { foodAccess, health, demographics } = communityData;

  return (
    <div className="flex flex-col h-full animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--cyan)', boxShadow: '0 0 6px var(--cyan)' }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Community Profile
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <FoodDesertBadge isFoodDesert={foodAccess.isFoodDesert} />

        <div className="space-y-0">
          <StatRow
            label="Low grocery access (1 mi)"
            value={fmtPct(foodAccess.pctLowAccess1mi)}
            highlight={foodAccess.pctLowAccess1mi > 30}
            accent={foodAccess.pctLowAccess1mi > 30 ? null : 'neon'}
          />
          <StatRow
            label="No vehicle · low access"
            value={fmtPct(foodAccess.pctNoVehicleLowAccess)}
          />
          <StatRow
            label="Diabetes prevalence"
            value={fmtPct(health.diabetes)}
            highlight={health.diabetes > 12}
          />
          <StatRow
            label="Obesity prevalence"
            value={fmtPct(health.obesity)}
          />
          <StatRow
            label="Poverty rate"
            value={fmtPct(demographics.pctPoverty)}
            highlight={demographics.pctPoverty > 20}
          />
          <StatRow
            label="Median household income"
            value={fmtIncome(demographics.medianIncome)}
            accent="cyan"
          />
        </div>

        {/* Impact toggle */}
        {impactData && (
          <button
            onClick={onToggleImpact}
            className="w-full mt-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: showImpact
                ? 'rgba(0,255,153,0.12)'
                : 'rgba(34,211,238,0.08)',
              border: `1px solid ${showImpact ? 'rgba(0,255,153,0.3)' : 'rgba(34,211,238,0.2)'}`,
              color: showImpact ? 'var(--neon)' : 'var(--cyan)',
            }}
          >
            {showImpact ? '▲ Hide projection' : '▼ Show impact projection'}
          </button>
        )}

        {/* Impact numbers (inline) */}
        {showImpact && impactData && (
          <div
            className="mt-3 p-3 rounded-lg space-y-1.5 animate-fade-slide-up"
            style={{
              background: 'rgba(0,255,153,0.05)',
              border: '1px solid rgba(0,255,153,0.15)',
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2">
              If 1 grocery store opened
            </p>
            <div className="flex justify-between text-xs">
              <span className="text-white/45">Residents gaining access</span>
              <span className="font-bold" style={{ color: 'var(--neon)' }}>
                +{Number(impactData.foodAccess.residentsGainingAccess).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white/45">Jobs created</span>
              <span className="font-bold" style={{ color: 'var(--neon)' }}>
                {impactData.economic.jobsMin}–{impactData.economic.jobsMax}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white/45">Annual local impact</span>
              <span className="font-bold" style={{ color: 'var(--cyan)' }}>
                ${(impactData.economic.annualLocalImpact / 1e6).toFixed(1)}M
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white/45">Diabetes rate reduction</span>
              <span className="font-bold" style={{ color: 'var(--neon)' }}>
                −{Number(impactData.health.diabetesReductionPct).toFixed(1)} pp
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
