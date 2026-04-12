import { fmtCurrency } from '../utils/formatters';

function Row({ label, value, strong = false, tint = 'rgba(255,255,255,0.72)' }) {
  return (
    <div className="flex items-baseline justify-between text-[11px] leading-5">
      <span className="text-white/55">{label}</span>
      <span className={strong ? 'font-bold' : 'font-medium'} style={{ color: tint }}>
        {value}
      </span>
    </div>
  );
}

export default function ImpactReceipt({ trueCost }) {
  if (!trueCost) return null;

  return (
    <div
      className="mt-3 rounded-lg px-3 py-3"
      style={{
        background: 'rgba(5,6,8,0.55)',
        border: '1px dashed rgba(255,255,255,0.2)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Impact Receipt</p>
        <span className="text-[10px] text-white/30">Basket Model</span>
      </div>

      <Row label="Base grocery basket" value={fmtCurrency(trueCost.baseBasketCost)} />
      <Row label="Time surcharge (before)" value={fmtCurrency(trueCost.timeSurchargeBefore)} />
      <Row label="Convenience premium (before)" value={fmtCurrency(trueCost.conveniencePremiumBefore)} />
      <div className="my-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.12)' }} />
      <Row label="Total access cost (before)" value={fmtCurrency(trueCost.totalAccessCostBefore)} strong />
      <Row label="Total access cost (after)" value={fmtCurrency(trueCost.totalAccessCostAfter)} strong tint="var(--neon)" />
      <Row
        label="Estimated savings / trip"
        value={fmtCurrency(trueCost.totalAccessCostBefore - trueCost.totalAccessCostAfter)}
        strong
        tint="var(--cyan)"
      />
    </div>
  );
}
