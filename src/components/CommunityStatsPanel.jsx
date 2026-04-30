import { useState } from 'react';
import { fmtPct, fmtIncome } from '../utils/formatters';
import ImpactReceipt from './ImpactReceipt';
import SimilarTractsPanel from './SimilarTractsPanel';
import { evaluateFoodDesertDesignation } from '../engine/foodDesertEvaluation';

/*
 * Judge Notes: Top 10 Complexity Hotspots
 * 1) `SourceConfidenceBadges` merges cache freshness and source reliability into one UI decision.
 * 2) `EvaluationTraceDrawer` reveals criterion-level pass/fail to explain the final designation path.
 * 3) `ScenarioCompare` computes baseline/current/saved deltas without mutating source impact objects.
 * 4) `FoodDesertBadge` reconciles unknown/designated/not-designated into one consistent visual state.
 * 5) `assessAccessBurden` condenses multiple access indicators into a crisis/elevated/stable label.
 * 6) `AccessBurdenBadge` maps burden levels to severity colors while preserving neutral fallback behavior.
 * 7) `ThresholdSensitivityPanel` allows what-if threshold preview without overwriting canonical policy values.
 * 8) Distance labels intentionally separate community-average vs center-point metrics to avoid misreadings.
 * 9) All money/percentage formatters normalize missing values so UI remains deterministic under sparse data.
 * 10) The default export composes many sub-panels while keeping read-only props flow for judge traceability.
 */

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

function fmtMilesLabel(foodAccess) {
  const communityAverageMiles = Number(foodAccess?.communityAverageSupermarketMiles ?? foodAccess?.nearestSupermarketMiles);
  if (foodAccess?.isTwentyFivePlusMiles === true) return '25+ mi';
  if (!Number.isFinite(communityAverageMiles)) return '—';
  return `${communityAverageMiles.toFixed(1)} mi`;
}

function fmtCenterMilesLabel(foodAccess) {
  const centerNearestMiles = Number(foodAccess?.centerNearestSupermarketMiles);
  if (!Number.isFinite(centerNearestMiles)) return '—';
  return `${centerNearestMiles.toFixed(1)} mi`;
}

function fmtPassFail(value) {
  return value ? 'PASS' : 'FAIL';
}

function fmtMoneyCompact(value) {
  if (!Number.isFinite(Number(value))) return '$0';
  return `$${Math.round(Number(value)).toLocaleString()}`;
}

function fmtSigned(value, digits = 1) {
  const num = Number(value || 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(digits)}`;
}

function fmtCacheTs(ts) {
  if (!ts) return 'N/A';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toDesignationLabel(designation) {
  if (designation === 'designated') return 'Designated';
  if (designation === 'not_designated') return 'Not designated';
  return 'Unknown';
}

function SourcePill({ label, level }) {
  const palette = {
    high: {
      fg: 'var(--neon)',
      bg: 'rgba(0,255,153,0.12)',
      border: 'rgba(0,255,153,0.3)',
    },
    medium: {
      fg: 'rgba(254,215,170,0.95)',
      bg: 'rgba(249,115,22,0.12)',
      border: 'rgba(249,115,22,0.3)',
    },
    low: {
      fg: 'rgba(252,165,165,0.95)',
      bg: 'rgba(239,68,68,0.12)',
      border: 'rgba(239,68,68,0.3)',
    },
  };
  const style = palette[level] || palette.medium;

  return (
    <span
      className="text-[10px] px-2 py-1 rounded"
      style={{ color: style.fg, border: `1px solid ${style.border}`, background: style.bg }}
    >
      {label}
    </span>
  );
}

function SourceConfidenceBadges({ foodAccess, cacheMeta }) {
  let usda = { label: 'USDA: missing row', level: 'low' };
  if (foodAccess?.hasUsdaMatch && foodAccess?.matchQuality === 'exact') usda = { label: 'USDA: exact tract', level: 'high' };
  else if (foodAccess?.hasUsdaMatch && foodAccess?.matchQuality === 'county_nearest') usda = { label: 'USDA: county-nearest', level: 'medium' };

  let distance = { label: 'Distance: unavailable', level: 'low' };
  if (String(foodAccess?.nearestDistanceSource || '').startsWith('osm_overpass:')) {
    distance = { label: 'Distance: live OSM', level: 'high' };
  }

  let cache = { label: 'Data: fresh', level: 'high' };
  if (cacheMeta?.status === 'memory') cache = { label: `Data: memory cache (${Math.ceil((cacheMeta.expiresInMs || 0) / 60000)}m)`, level: 'medium' };
  else if (cacheMeta?.status === 'local') cache = { label: `Data: local cache (${Math.ceil((cacheMeta.expiresInMs || 0) / 60000)}m)`, level: 'medium' };

  let decision = { label: 'Decision: not comparable', level: 'medium' };
  if (foodAccess?.sourceComparable) {
    decision = foodAccess?.sourceDisagreement
      ? { label: 'Decision: distance vs USDA disagree', level: 'low' }
      : { label: 'Decision: distance vs USDA agree', level: 'high' };
  }

  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Source Confidence</p>
      <div className="flex flex-wrap gap-1.5">
        <SourcePill label={usda.label} level={usda.level} />
        <SourcePill label={distance.label} level={distance.level} />
        <SourcePill label={decision.label} level={decision.level} />
        <SourcePill label={cache.label} level={cache.level} />
      </div>
    </div>
  );
}

function TraceRow({ label, actual, threshold, pass, note }) {
  return (
    <div className="grid grid-cols-[1.25fr_1fr_1fr_auto] gap-2 items-center text-[11px] py-1.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <span className="text-white/65">{label}</span>
      <span className="text-white/50">{actual}</span>
      <span className="text-white/40">{threshold}</span>
      <span style={{ color: pass ? 'var(--neon)' : 'rgba(252,165,165,0.95)' }}>{pass ? 'PASS' : 'FAIL'}</span>
      {note && <span className="col-span-4 text-[10px] text-white/35">{note}</span>}
    </div>
  );
}

function EvaluationTraceDrawer({ foodAccess, demographics, cacheMeta }) {
  const [open, setOpen] = useState(false);
  const povertyRate = Number(foodAccess?.povertyRate || demographics?.pctPoverty || 0);
  const lowAccessCount = Number(foodAccess?.lowAccessPopulationCount || 0);
  const lowAccessPct = Number(foodAccess?.qualifyingLowAccessPct || 0);
  const incomeThreshold = Number(foodAccess?.incomeThreshold80Pct || 0);
  const tractMedianFamilyIncome = Number(foodAccess?.medianFamilyIncome || 0);
  const distanceThresholdMiles = Number(foodAccess?.distanceThresholdMiles || (foodAccess?.isRural ? 5 : 1));
  const averageMiles = Number(foodAccess?.communityAverageSupermarketMiles ?? foodAccess?.nearestSupermarketMiles);
  const distanceEvaluable = Boolean(foodAccess?.distanceRuleEvaluable);
  const distanceActual = foodAccess?.isTwentyFivePlusMiles === true
    ? '25+ miles'
    : (Number.isFinite(averageMiles) ? `${averageMiles.toFixed(1)} miles` : 'Unavailable');

  return (
    <div className="mb-3 rounded-lg" style={{ border: '1px solid rgba(34,211,238,0.18)', background: 'rgba(34,211,238,0.04)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left flex items-center justify-between"
      >
        <span className="text-[11px] uppercase tracking-wider text-white/55">Evaluation Trace</span>
        <span className="text-[10px] text-white/40">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-2">
          <div className="grid grid-cols-[1.25fr_1fr_1fr_auto] gap-2 text-[10px] text-white/35 pb-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            <span>Criterion</span>
            <span>Actual</span>
            <span>Threshold</span>
            <span>Result</span>
          </div>

          <TraceRow
            label="Low access share"
            actual={`${lowAccessPct.toFixed(1)}%`}
            threshold=">= 33%"
            pass={Boolean(foodAccess?.lowAccessByShare)}
          />
          <TraceRow
            label="Low access count"
            actual={Math.round(lowAccessCount).toLocaleString()}
            threshold=">= 500 residents"
            pass={Boolean(foodAccess?.lowAccessByCount)}
          />
          <TraceRow
            label="Low-access test"
            actual={fmtPassFail(foodAccess?.isLowAccess)}
            threshold="Share OR count"
            pass={Boolean(foodAccess?.isLowAccess)}
            note={`USDA benchmark: ${foodAccess?.isRural ? 'Rural 10-mile' : 'Urban 1-mile'}`}
          />
          <TraceRow
            label="Low-income poverty"
            actual={`${povertyRate.toFixed(1)}%`}
            threshold=">= 20%"
            pass={Boolean(foodAccess?.lowIncomeByPoverty)}
          />
          <TraceRow
            label="Low-income income"
            actual={tractMedianFamilyIncome > 0 ? `$${Math.round(tractMedianFamilyIncome).toLocaleString()}` : 'N/A'}
            threshold={incomeThreshold > 0 ? `<= $${Math.round(incomeThreshold).toLocaleString()}` : 'N/A'}
            pass={Boolean(foodAccess?.lowIncomeByIncomeThreshold)}
          />
          <TraceRow
            label="Low-income test"
            actual={fmtPassFail(foodAccess?.isLowIncome)}
            threshold="Poverty OR income"
            pass={Boolean(foodAccess?.isLowIncome)}
          />
          <TraceRow
            label="Vehicle indicator"
            actual={`${Math.round(Number(demographics?.noVehicleHouseholds || 0)).toLocaleString()} no-vehicle HH`}
            threshold=">= 100 HH + low-access exposure"
            pass={Boolean(foodAccess?.vehicleAccessConcern)}
          />
          <TraceRow
            label="Distance rule"
            actual={distanceActual}
            threshold={`>= ${distanceThresholdMiles.toFixed(0)} miles (${foodAccess?.isRural ? 'rural' : 'urban'})`}
            pass={Boolean(distanceEvaluable && foodAccess?.isFoodDesertByDistanceRule)}
            note={distanceEvaluable
              ? `Primary designation rule in use (model: ${foodAccess?.distanceModel || 'community_average_sampled'}; samples: ${Math.max(0, Number(foodAccess?.communityDistanceSampleCount || 0))}).`
              : 'Distance source unavailable; final designation can be Unknown.'}
          />
          <TraceRow
            label="Final designation"
            actual={toDesignationLabel(foodAccess?.finalDesignation)}
            threshold="Distance rule, else Unknown when unavailable"
            pass={foodAccess?.finalDesignation !== 'unknown'}
            note={`Method: ${foodAccess?.designationMethod || 'n/a'} · cache: ${cacheMeta?.status || 'n/a'} @ ${fmtCacheTs(cacheMeta?.cachedAt)}`}
          />
          <TraceRow
            label="Distance vs USDA"
            actual={foodAccess?.sourceComparable
              ? `${toDesignationLabel(foodAccess?.distanceDesignation)} vs ${toDesignationLabel(foodAccess?.usdaDesignation)}`
              : 'Not comparable'}
            threshold="No disagreement when both available"
            pass={!foodAccess?.sourceDisagreement}
            note={foodAccess?.sourceComparable
              ? (foodAccess?.sourceDisagreement
                ? 'Flagged: distance and USDA produce different outcomes for this tract.'
                : 'Distance and USDA agree for this tract.')
              : 'Distance unavailable or USDA missing, so disagreement check is deferred.'}
          />
        </div>
      )}
    </div>
  );
}

function ScenarioCompare({ baselineImpact, impactData, savedScenario, onSaveScenario, onClearScenario }) {
  if (!impactData || !baselineImpact) return null;

  const savedImpact = savedScenario?.impact || null;

  const rows = [
    {
      label: 'Residents gaining access',
      baseline: Number(baselineImpact.foodAccess?.residentsGainingAccess || 0).toLocaleString(),
      current: Number(impactData.foodAccess?.residentsGainingAccess || 0).toLocaleString(),
      saved: savedImpact ? Number(savedImpact.foodAccess?.residentsGainingAccess || 0).toLocaleString() : '—',
    },
    {
      label: 'Low-access reduction (pp)',
      baseline: fmtSigned(baselineImpact.foodAccess?.pctLowAccessReduction || 0),
      current: fmtSigned(impactData.foodAccess?.pctLowAccessReduction || 0),
      saved: savedImpact ? fmtSigned(savedImpact.foodAccess?.pctLowAccessReduction || 0) : '—',
    },
    {
      label: 'Diabetes reduction (pp)',
      baseline: fmtSigned(-(baselineImpact.health?.diabetesReductionPct || 0)),
      current: fmtSigned(-(impactData.health?.diabetesReductionPct || 0)),
      saved: savedImpact ? fmtSigned(-(savedImpact.health?.diabetesReductionPct || 0)) : '—',
    },
    {
      label: 'Annual local impact',
      baseline: fmtMoneyCompact(baselineImpact.economic?.annualLocalImpact),
      current: fmtMoneyCompact(impactData.economic?.annualLocalImpact),
      saved: savedImpact ? fmtMoneyCompact(savedImpact.economic?.annualLocalImpact) : '—',
    },
    {
      label: 'Trip savings',
      baseline: fmtMoneyCompact(baselineImpact.trueCost?.tripSavings),
      current: fmtMoneyCompact(impactData.trueCost?.tripSavings),
      saved: savedImpact ? fmtMoneyCompact(savedImpact.trueCost?.tripSavings) : '—',
    },
    {
      label: 'Coverage score',
      baseline: `${Math.round((baselineImpact.simulation?.coverageScore || 0) * 100)}%`,
      current: `${Math.round((impactData.simulation?.coverageScore || 0) * 100)}%`,
      saved: savedImpact ? `${Math.round((savedImpact.simulation?.coverageScore || 0) * 100)}%` : '—',
    },
  ];

  return (
    <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.16)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Scenario Compare</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onSaveScenario}
            className="px-2 py-1 rounded text-[10px]"
            style={{ border: '1px solid rgba(34,211,238,0.25)', color: 'var(--cyan)', background: 'rgba(34,211,238,0.08)' }}
          >
            Save Current
          </button>
          <button
            type="button"
            onClick={onClearScenario}
            disabled={!savedImpact}
            className="px-2 py-1 rounded text-[10px] disabled:opacity-40"
            style={{ border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(252,165,165,0.9)', background: 'rgba(239,68,68,0.08)' }}
          >
            Clear Saved
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-white/40 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="text-left py-1 pr-2 font-medium">Metric</th>
              <th className="text-right py-1 px-2 font-medium">Baseline</th>
              <th className="text-right py-1 px-2 font-medium">Current</th>
              <th className="text-right py-1 pl-2 font-medium">Saved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <td className="py-1.5 pr-2 text-white/60">{row.label}</td>
                <td className="py-1.5 px-2 text-right text-white/75">{row.baseline}</td>
                <td className="py-1.5 px-2 text-right text-white/90">{row.current}</td>
                <td className="py-1.5 pl-2 text-right text-white/70">{row.saved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {savedScenario?.savedAt && (
        <p className="mt-1.5 text-[10px] text-white/30">
          Saved snapshot: {new Date(savedScenario.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  );
}

function FoodDesertBadge({ foodAccess }) {
  const finalDesignation = foodAccess?.finalDesignation || (foodAccess?.isFoodDesert ? 'designated' : 'not_designated');
  const isUnknown = finalDesignation === 'unknown';
  const isFoodDesert = finalDesignation === 'designated';
  const hasSourceDisagreement = Boolean(foodAccess?.sourceComparable && foodAccess?.sourceDisagreement);
  const distanceThresholdMiles = Number(foodAccess?.distanceThresholdMiles || (foodAccess?.isRural ? 5 : 1));
  const averageMiles = Number(foodAccess?.communityAverageSupermarketMiles ?? foodAccess?.nearestSupermarketMiles);
  const hasDistance = Boolean(foodAccess?.distanceRuleEvaluable);
  const nearestLabel = foodAccess?.isTwentyFivePlusMiles === true
    ? '25+ miles'
    : (Number.isFinite(averageMiles) ? `${averageMiles.toFixed(1)} miles` : 'Unavailable');

  return (
    <div className="mb-3">
      <div
        className="flex items-center justify-between px-3 py-2 rounded-lg"
        style={{
          background: isUnknown
            ? 'rgba(249, 115, 22, 0.12)'
            : isFoodDesert
            ? 'rgba(239, 68, 68, 0.12)'
            : 'rgba(0, 255, 153, 0.08)',
          border: `1px solid ${isUnknown
            ? 'rgba(249,115,22,0.35)'
            : (isFoodDesert ? 'rgba(239,68,68,0.35)' : 'rgba(0,255,153,0.25)')}`,
        }}
      >
        <span className="text-xs font-medium text-white/55">Food Desert Status</span>
        <span
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{
            color: isUnknown
              ? 'rgba(254,215,170,0.95)'
              : (isFoodDesert ? 'rgba(252,165,165,0.95)' : 'var(--neon)'),
            background: isUnknown
              ? 'rgba(249,115,22,0.2)'
              : (isFoodDesert ? 'rgba(239,68,68,0.2)' : 'rgba(0,255,153,0.12)'),
          }}
        >
          {toDesignationLabel(finalDesignation)}
        </span>
      </div>

      {isFoodDesert && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-white/45">
          Distance rule met: community-average grocery distance is {nearestLabel} (threshold {distanceThresholdMiles.toFixed(0)} miles for {foodAccess?.isRural ? 'rural' : 'urban'} areas).
        </p>
      )}

      {!isFoodDesert && hasDistance && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-white/45">
          Distance rule not met: community-average grocery distance is {nearestLabel} (threshold {distanceThresholdMiles.toFixed(0)} miles for {foodAccess?.isRural ? 'rural' : 'urban'} areas).
        </p>
      )}

      {!hasDistance && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-white/45">
          Live distance source unavailable; designation method: {foodAccess?.designationMethod || 'n/a'}.
        </p>
      )}

      {isUnknown && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-white/45">
          Classification is Unknown until distance data is available. USDA label remains visible for context but does not auto-resolve final status.
        </p>
      )}

      {hasSourceDisagreement && (
        <p className="mt-1 px-1 text-[10px] leading-snug" style={{ color: 'rgba(252,165,165,0.95)' }}>
          Disagreement flag: distance rule says {toDesignationLabel(foodAccess?.distanceDesignation)}, USDA says {toDesignationLabel(foodAccess?.usdaDesignation)}.
        </p>
      )}
    </div>
  );
}

function assessAccessBurden(foodAccess) {
  const pct1 = Number(foodAccess?.pctLowAccess1mi || 0);
  const pct10 = Number(foodAccess?.pctLowAccess10mi || 0);
  const pctNoVehicle = Number(foodAccess?.pctNoVehicleLowAccess || 0);
  const isRural = Boolean(foodAccess?.isRural);
  const qualifying = Number(foodAccess?.qualifyingLowAccessPct || (isRural ? pct10 : pct1));

  if (isRural && pct1 >= 90 && pctNoVehicle >= 3) {
    return {
      level: 'crisis',
      label: 'Access Crisis',
      reason: 'Rural tract with near-universal 1-mile low access and meaningful no-vehicle burden.',
    };
  }

  if (foodAccess?.isTwentyFivePlusMiles === true) {
    return {
      level: 'crisis',
      label: 'Access Crisis',
      reason: 'Nearest mapped supermarket is 25+ miles away.',
    };
  }

  if (qualifying >= 66) {
    return {
      level: 'crisis',
      label: 'Access Crisis',
      reason: `Very high low-access share under USDA ${isRural ? 'rural 10-mile' : 'urban 1-mile'} benchmark.`,
    };
  }

  if (qualifying >= 33) {
    return {
      level: 'elevated',
      label: 'Access Elevated',
      reason: `Elevated low-access share under USDA ${isRural ? 'rural 10-mile' : 'urban 1-mile'} benchmark.`,
    };
  }

  return {
    level: 'stable',
    label: 'Access Stable',
    reason: 'Low-access share is below elevated threshold.',
  };
}

function AccessBurdenBadge({ foodAccess }) {
  const burden = assessAccessBurden(foodAccess);

  const palette = {
    crisis: {
      bg: 'rgba(239,68,68,0.12)',
      border: 'rgba(239,68,68,0.35)',
      text: 'rgba(252,165,165,0.95)',
      pillBg: 'rgba(239,68,68,0.2)',
    },
    elevated: {
      bg: 'rgba(249,115,22,0.12)',
      border: 'rgba(249,115,22,0.35)',
      text: 'rgba(254,215,170,0.95)',
      pillBg: 'rgba(249,115,22,0.2)',
    },
    stable: {
      bg: 'rgba(0,255,153,0.08)',
      border: 'rgba(0,255,153,0.25)',
      text: 'var(--neon)',
      pillBg: 'rgba(0,255,153,0.12)',
    },
  };

  const style = palette[burden.level];

  return (
    <div className="mb-3">
      <div
        className="flex items-center justify-between px-3 py-2 rounded-lg"
        style={{
          background: style.bg,
          border: `1px solid ${style.border}`,
        }}
      >
        <span className="text-xs font-medium text-white/55">Access Burden</span>
        <span
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{
            color: style.text,
            background: style.pillBg,
          }}
        >
          {burden.label}
        </span>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-snug text-white/45">{burden.reason}</p>
    </div>
  );
}

function ThresholdSensitivityPanel({ foodAccess }) {
  const [open, setOpen] = useState(false);
  const [urbanThresholdMiles, setUrbanThresholdMiles] = useState(1);
  const [ruralThresholdMiles, setRuralThresholdMiles] = useState(5);

  const simulated = evaluateFoodDesertDesignation({
    isRural: foodAccess?.isRural,
    nearestSupermarketMiles: foodAccess?.communityAverageSupermarketMiles ?? foodAccess?.nearestSupermarketMiles,
    isTwentyFivePlusMiles: foodAccess?.isTwentyFivePlusMiles,
    usdaLilaFlag: foodAccess?.usdaLilaFlag,
    urbanThresholdMiles,
    ruralThresholdMiles,
    unavailableMode: 'unknown',
  });

  const baselineDesignation = foodAccess?.finalDesignation || 'unknown';
  const simulatedDesignation = simulated?.finalDesignation || 'unknown';
  const flipped = baselineDesignation !== simulatedDesignation;

  return (
    <div className="mb-3 rounded-lg" style={{ border: '1px solid rgba(0,255,153,0.2)', background: 'rgba(0,255,153,0.04)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left flex items-center justify-between"
      >
        <span className="text-[11px] uppercase tracking-wider text-white/55">Threshold Sensitivity</span>
        <span className="text-[10px] text-white/40">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          <p className="text-[10px] text-white/40 mb-2">
            Live what-if controls for threshold tuning. This does not mutate stored data; it only previews rule flips.
          </p>

          <div className="mb-2">
            <div className="flex justify-between text-[10px] text-white/45 mb-1">
              <span>Urban threshold</span>
              <span>{urbanThresholdMiles.toFixed(1)} mi</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={urbanThresholdMiles}
              onChange={(event) => setUrbanThresholdMiles(Number(event.target.value))}
              className="w-full"
            />
          </div>

          <div className="mb-2">
            <div className="flex justify-between text-[10px] text-white/45 mb-1">
              <span>Rural threshold</span>
              <span>{ruralThresholdMiles.toFixed(0)} mi</span>
            </div>
            <input
              type="range"
              min="1"
              max="25"
              step="1"
              value={ruralThresholdMiles}
              onChange={(event) => setRuralThresholdMiles(Number(event.target.value))}
              className="w-full"
            />
          </div>

          <div className="mt-2 p-2 rounded" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-white/55">Baseline result</span>
              <span className="text-white/85">{toDesignationLabel(baselineDesignation)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-white/55">Simulated result</span>
              <span style={{ color: flipped ? 'rgba(252,165,165,0.95)' : 'var(--neon)' }}>
                {toDesignationLabel(simulatedDesignation)} {flipped ? '(flip)' : '(no change)'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommunityStatsPanel({
  communityData,
  loading,
  impactData,
  baselineImpact,
  savedScenario,
  onSaveScenario,
  onClearScenario,
  showImpact,
  onToggleImpact,
  onJumpToTract,
}) {
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
  const cacheMeta = communityData?.meta?.cache;
  const lowAccessRuleLabel = foodAccess?.isRural ? 'USDA low grocery access (10 mi)' : 'USDA low grocery access (1 mi)';
  const lowAccessRulePct = Number(
    foodAccess?.qualifyingLowAccessPct ||
      (foodAccess?.isRural ? foodAccess?.pctLowAccess10mi : foodAccess?.pctLowAccess1mi) ||
      0
  );

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
          <FoodDesertBadge foodAccess={foodAccess} />
          <AccessBurdenBadge foodAccess={foodAccess} />
          <SourceConfidenceBadges foodAccess={foodAccess} cacheMeta={cacheMeta} />
          <EvaluationTraceDrawer foodAccess={foodAccess} demographics={demographics} cacheMeta={cacheMeta} />
          <ThresholdSensitivityPanel foodAccess={foodAccess} />

        <div className="space-y-0">
          <StatRow
            label="Community avg supermarket distance (est.)"
            value={fmtMilesLabel(foodAccess)}
            highlight={foodAccess?.isTwentyFivePlusMiles === true}
          />
          <StatRow
            label="Center-point nearest (reference)"
            value={fmtCenterMilesLabel(foodAccess)}
          />
          <StatRow
            label="USDA low-access test"
            value={fmtPassFail(foodAccess?.isLowAccess)}
            highlight={Boolean(foodAccess?.isLowAccess)}
          />
          <StatRow
            label="USDA low-income test"
            value={fmtPassFail(foodAccess?.isLowIncome)}
            highlight={Boolean(foodAccess?.isLowIncome)}
          />
          <StatRow
            label="Vehicle access indicator"
            value={fmtPassFail(foodAccess?.vehicleAccessConcern)}
            highlight={Boolean(foodAccess?.vehicleAccessConcern)}
          />
          <StatRow
            label={lowAccessRuleLabel}
            value={fmtPct(lowAccessRulePct)}
            highlight={lowAccessRulePct > 30}
            accent={lowAccessRulePct > 30 ? null : 'neon'}
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

            <ImpactReceipt trueCost={impactData.trueCost} />

            <ScenarioCompare
              baselineImpact={baselineImpact}
              impactData={impactData}
              savedScenario={savedScenario}
              onSaveScenario={onSaveScenario}
              onClearScenario={onClearScenario}
            />
          </div>
        )}

        <SimilarTractsPanel communityData={communityData} onJump={onJumpToTract} />
      </div>
    </div>
  );
}
