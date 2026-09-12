/*
 * ScenarioResultCard: the "what did my placed stores change?" answer, shown
 * whenever the scenario holds placed pins (map overlay on desktop, stacked
 * above the panels on mobile — including pins replayed from a shared link).
 *
 * - Clear verdict: the AFTER designation rendered big, so a flip to
 *   NOT DESIGNATED is unmistakable, with the before→after trail beneath.
 * - Demand-side numbers come from the projection engine (same objects the
 *   narrative cites): residents gaining access, jobs, local spend.
 * - "What it would take" lists planning factors triggered by the tract's
 *   own numbers (vehicle access, poverty, diet-related health, rurality).
 *   No invented build costs: the footer says plainly that capex needs a
 *   site, and these are the demand-side figures a proposal starts from.
 *
 * Props: scenario, impactData, communityData, onRecompute.
 */
import CountUp from './bits/CountUp';

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : 'n/a';
}

function fmtMi(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} mi` : 'n/a';
}

function verdictStyle(label) {
  if (label === 'designated') {
    return { color: 'rgba(252,165,165,0.95)', border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.12)' };
  }
  if (label === 'not designated') {
    return { color: 'var(--neon)', border: '1px solid rgba(0,255,153,0.4)', background: 'rgba(0,255,153,0.10)' };
  }
  return { color: 'rgba(254,215,170,0.95)', border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.12)' };
}

export default function ScenarioResultCard({ scenario, impactData, communityData, onRecompute }) {
  if (!scenario || scenario.placedCount === 0) return null;

  const food = communityData?.foodAccess || {};
  const demo = communityData?.demographics || {};
  const health = communityData?.health || {};
  const impactFood = impactData?.foodAccess || {};
  const impactHealth = impactData?.health || {};
  const economic = impactData?.economic || {};
  const after = verdictStyle(scenario.afterLabel);

  // Planning factors, each gated by a real tract number cited in the row.
  const factors = [];
  if (food.vehicleAccessConcern || Number(food.pctNoVehicleLowAccess || 0) > 0) {
    factors.push({
      title: 'Car-light access',
      detail: `${Number(food.pctNoVehicleLowAccess || 0).toFixed(1)}% of households lack a vehicle with low access — a transit stop and walkable entry matter more than parking.`,
    });
  }
  if (Number(demo.pctPoverty || 0) >= 20) {
    factors.push({
      title: 'Affordability first',
      detail: `Poverty is ${Number(demo.pctPoverty).toFixed(1)}% — SNAP/WIC authorization and value lines decide whether the store gets used.`,
    });
  }
  if (Number(health.diabetes || 0) >= 10 || Number(health.obesity || 0) >= 30) {
    factors.push({
      title: 'Produce-forward assortment',
      detail: `Diabetes ${Number(health.diabetes || 0).toFixed(1)}% · obesity ${Number(health.obesity || 0).toFixed(1)}% — fresh produce density is the health lever here.`,
    });
  }
  if (food.isRural) {
    factors.push({
      title: 'Wide catchment',
      detail: `Rural tract — the ${fmtMi(scenario.afterAvg)} average hides longer trips at the edges; delivery or shuttle closes the last mile.`,
    });
  }
  factors.push({
    title: 'Typical setup path',
    detail: 'Site acquisition → permits → refrigeration and supply chain → staffing → SNAP retailer authorization. Sequence, not estimates.',
  });

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'rgba(5,6,8,0.92)',
        border: '1px solid rgba(34,211,238,0.3)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Experiment result · {scenario.placedCount} placed
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onRecompute?.()}
          title="Re-run the numbers from the current pins"
          className="rounded-full px-3 text-[11px] font-semibold btn-press"
          style={{
            minHeight: '44px',
            border: '1px solid rgba(34,211,238,0.4)',
            color: 'var(--cyan)',
            background: 'rgba(34,211,238,0.08)',
          }}
        >
          Recompute
        </button>
      </div>

      <div
        className="rounded-lg px-3 py-2 mb-1 text-center text-sm font-bold uppercase tracking-wider"
        style={after}
      >
        {scenario.afterLabel}
      </div>
      <p className="text-center text-[11px] text-white/45 mb-2">
        {scenario.flipped ? `Flipped from ${scenario.beforeLabel}` : `Was already ${scenario.beforeLabel}`} · avg distance {fmtMi(scenario.beforeAvg)} → {fmtMi(scenario.afterAvg)}
      </p>

      <div className="flex flex-col gap-1 mb-2 text-[11px]">
        <div className="flex justify-between"><span className="text-white/45">Residents gaining access</span><span className="font-semibold" style={{ color: 'var(--neon)' }}>{Number.isFinite(Number(impactFood.residentsGainingAccess)) ? <CountUp key={`res:${impactFood.residentsGainingAccess}`} to={Number(impactFood.residentsGainingAccess)} prefix="+" decimals={0} duration={1} /> : `+${fmtInt(impactFood.residentsGainingAccess)}`}</span></div>
        <div className="flex justify-between"><span className="text-white/45">Jobs</span><span className="font-semibold text-white/85">{fmtInt(economic.jobsMin)}–{fmtInt(economic.jobsMax)}</span></div>
        <div className="flex justify-between"><span className="text-white/45">Local spend recaptured</span><span className="font-semibold" style={{ color: 'var(--cyan)' }}>{fmtMoney(economic.annualLocalImpact)}/yr</span></div>
        <div className="flex justify-between"><span className="text-white/45">Diabetes rate change</span><span className="font-semibold text-white/85">{Number.isFinite(Number(impactHealth.diabetesReductionPct)) ? <CountUp key={`dia:${impactHealth.diabetesReductionPct}`} to={Number(impactHealth.diabetesReductionPct)} prefix="−" suffix=" pts" decimals={1} duration={1} /> : `−${Number(impactHealth.diabetesReductionPct || 0).toFixed(1)} pts`}</span></div>
      </div>

      <p className="text-[10px] uppercase tracking-wider text-white/45 mb-1">What it would take</p>
      <ul className="flex flex-col gap-1.5 mb-2">
        {factors.map((f) => (
          <li key={f.title} className="text-[11px] leading-snug">
            <span className="font-semibold text-white/80">{f.title}: </span>
            <span className="text-white/55">{f.detail}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-snug text-white/30">
        Build costs need a site — these are the demand-side numbers a proposal starts from.
      </p>
    </div>
  );
}
