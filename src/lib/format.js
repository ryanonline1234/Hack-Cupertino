// Shared number formatting for the access-test panels, the scenario card and
// the pipeline log (docs/07). Counts are exact below 100 and about the
// nearest 10 above (with "≈"); shares are whole percent.
//
// The guard: rounding must never show a value that is under one of USDA's
// low-access limits (500 residents, 33%) as at or over it. 497 beyond is not
// "≈500" and 32.9% is not "33%" when the tract is under that limit.
//
// Every formatter returns null for a missing / non-finite input so callers
// pick their own placeholder.

const COUNT_LIMIT = 500;
const SHARE_LIMIT_PCT = 33;

const roundCount = (n) => (n < 100 ? Math.round(n) : Math.round(n / 10) * 10);

// "≈2,060" (rounded) or "84" (exact below 100).
export function approxCount(n) {
  if (!Number.isFinite(n)) return null;
  const s = roundCount(n).toLocaleString('en-US');
  return n < 100 ? s : `≈${s}`;
}

// The same rounding without the sign, for a denominator next to a rounded
// count ("≈1,900 of 2,060").
export function roundedCount(n) {
  return Number.isFinite(n) ? roundCount(n).toLocaleString('en-US') : null;
}

// Residents beyond the distance limit. byCount is the engine's `beyond >=
// 500` flag; when it isn't a boolean the value itself decides (the count
// limit is the same everywhere). Under the limit, a count that would round
// to 500 shows exact.
export function fmtBeyond(beyond, byCount) {
  if (!Number.isFinite(beyond)) return null;
  const underLimit = typeof byCount === 'boolean' ? !byCount : beyond < COUNT_LIMIT;
  if (underLimit && beyond >= 100 && roundCount(beyond) >= COUNT_LIMIT) {
    return Math.round(beyond).toLocaleString('en-US');
  }
  return approxCount(beyond);
}

// Whole percent. byShare is the engine's `share >= 0.33` flag: pass it
// wherever the share is judged against the 33% limit, so a share under the
// limit that rounds to 33% reads "just under 33%". Omit it for shares no
// limit applies to (a city's totals), which stay plain percent.
export function fmtShare(share, byShare) {
  if (!Number.isFinite(share)) return null;
  if (share > 0 && share < 0.005) return 'under 1%';
  if (share < 1 && share >= 0.995) return 'over 99%';
  const pct = Math.round(share * 100);
  if (byShare === false && pct >= SHARE_LIMIT_PCT) return `just under ${SHARE_LIMIT_PCT}%`;
  return `${pct}%`;
}

// Straight-line miles: tenths under 10, whole miles from 10.
export function fmtMiles(miles) {
  if (!Number.isFinite(miles)) return null;
  if (miles < 0.1) return 'under 0.1 mi';
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

// A CDC PLACES figure in the community profile. `status` is
// meta.profileStatus.health ('ok' | 'unavailable' | 'timeout'): when the call
// failed, the fetch hands back an all-zero profile, and those zeros must not
// read as "not published", a claim about the tract nobody checked.
const CDC_NOTE = {
  not_published: 'CDC PLACES returned no figure for this tract.',
  unavailable: "CDC PLACES didn't load for this search.",
  timeout: "CDC PLACES didn't answer in time.",
};

export function cdcFigure(value, status) {
  if (status === 'unavailable' || status === 'timeout') return { value: null, label: 'unavailable', note: CDC_NOTE[status] };
  if (Number.isFinite(value) && value > 0) return { value, label: null, note: null };
  return { value: null, label: 'not published', note: CDC_NOTE.not_published };
}
