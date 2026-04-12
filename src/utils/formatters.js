export function fmtPct(value, decimals = 1) {
  if (value == null || isNaN(value)) return '—';
  return `${Number(value).toFixed(decimals)}%`;
}

export function fmtCurrency(value) {
  if (value == null || isNaN(value)) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Number(value).toLocaleString()}`;
}

export function fmtIncome(value) {
  if (!value || value <= 0) return '—';
  return `$${Number(value).toLocaleString()}`;
}

export function fmtDelta(value, unit = 'pp') {
  if (value == null || isNaN(value)) return null;
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(1)} ${unit}`;
}

export function fmtNumber(value) {
  if (value == null || isNaN(value)) return '—';
  return Number(value).toLocaleString();
}
