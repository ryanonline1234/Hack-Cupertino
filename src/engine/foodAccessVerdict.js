// Three-valued AND of the two USDA ERS conditions: a known `false` decides
// NOT MET on its own; otherwise any unknown input makes the verdict Unknown.

// ERS publishes its flags as 1/0, so those read as booleans; anything else
// that isn't a boolean is unknown rather than guessed.
function tri(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

export function evaluateFoodAccess({ lowIncome, lowAccess, unknownReason } = {}) {
  const li = tri(lowIncome);
  const la = tri(lowAccess);

  if (li === true && la === true) return { status: 'met', qualifier: 'li_la', reason: null };
  if (li === false && la === true) return { status: 'not_met', qualifier: 'la_not_li', reason: null };
  if (li === true && la === false) return { status: 'not_met', qualifier: 'li_not_la', reason: null };
  if (li === false && la === false) return { status: 'not_met', qualifier: 'neither', reason: null };
  if (li === null && la === false) {
    return { status: 'not_met', qualifier: 'not_la_income_unknown', reason: null };
  }
  if (li === false && la === null) {
    return { status: 'not_met', qualifier: 'not_li_access_unknown', reason: null };
  }
  if (li === null && la === true) {
    return { status: 'unknown', qualifier: 'la_income_unknown', reason: 'income_unavailable' };
  }
  return { status: 'unknown', qualifier: 'unknown', reason: unknownReason || 'unknown' };
}
