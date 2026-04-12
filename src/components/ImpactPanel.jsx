import { fmtNumber, fmtCurrency } from '../utils/formatters';

function Section({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-3 flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Metric({ label, value, sub, accent, valueClass = 'text-base' }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="text-right">
        <span className={`${valueClass} font-bold ${accent || 'text-gray-900'}`}>{value}</span>
        {sub && <span className="text-xs text-gray-400 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

export default function ImpactPanel({ impactData }) {
  if (!impactData) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center text-gray-400 gap-2">
        <p className="text-sm">Impact projections will appear after community data is loaded.</p>
      </div>
    );
  }

  const { foodAccess, health, economic, sources } = impactData;
  const obesityDelta = -Number(health.obesityReductionPct || 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-400 italic">
        Projections based on research-backed correlations if one grocery store were added to this area.
      </p>

      <Section title="Food Access">
        <Metric
          label="Residents gaining access"
          value={fmtNumber(foodAccess.residentsGainingAccess)}
          sub="people"
          accent="text-teal-700"
          valueClass="text-2xl"
        />
        <Metric
          label="Low-access reduction"
          value={`−${Number(foodAccess.pctLowAccessReduction || 0).toFixed(1)} pp`}
          accent="text-teal-700"
        />
        <Metric
          label="No-vehicle households helped"
          value={fmtNumber(foodAccess.noVehicleHouseholdsHelped)}
          sub="households"
        />
      </Section>

      <Section title="Health">
        <Metric
          label="Diabetes cases avoided (est.)"
          value={fmtNumber(health.estimatedCasesAvoided)}
          sub="people"
          accent="text-teal-700"
        />
        <Metric
          label="Obesity rate change"
          value={`${obesityDelta < 0 ? '−' : '+'}${Math.abs(obesityDelta).toFixed(1)} pp`}
        />
      </Section>

      <Section title="Economic">
        <Metric
          label="Jobs created"
          value={`${economic.jobsMin}–${economic.jobsMax} jobs`}
          accent="text-teal-700"
        />
        <Metric
          label="Annual local economic impact"
          value={fmtCurrency(economic.annualLocalImpact)}
          accent="text-teal-700"
        />
      </Section>

      <details className="rounded-lg border border-gray-200 text-xs">
        <summary className="px-3 py-2 cursor-pointer text-gray-500 font-medium select-none hover:bg-gray-50">
          Sources
        </summary>
        <ul className="px-3 pb-3 pt-1 space-y-1 text-gray-400">
          {sources?.map((s, i) => (
            <li key={i} className="leading-snug">• {s}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
