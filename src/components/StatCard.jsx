export default function StatCard({ label, value, delta, highlight }) {
  const isImprovement = delta != null && delta < 0;
  const deltaColor = isImprovement ? 'text-green-600' : 'text-red-500';
  const deltaSymbol = delta != null ? (delta < 0 ? '−' : '+') : '';
  const deltaAbs = delta != null ? Math.abs(delta).toFixed(1) : '';

  return (
    <div
      className={`rounded-lg border p-3 flex flex-col gap-1 ${
        highlight
          ? 'bg-orange-50 border-orange-200'
          : 'bg-white border-gray-200'
      }`}
    >
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide leading-none">
        {label}
      </span>
      <span className={`text-xl font-bold leading-tight ${highlight ? 'text-orange-800' : 'text-gray-900'}`}>
        {value}
      </span>
      {delta != null && (
        <span className={`text-xs font-medium ${deltaColor}`}>
          {deltaSymbol}{deltaAbs} pp
        </span>
      )}
    </div>
  );
}
