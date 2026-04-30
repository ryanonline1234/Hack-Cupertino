/*
 * "Cite-the-numbers" annotator: scans AI-generated narrative text for the
 * specific metrics we know about (poverty %, diabetes %, median income,
 * etc.) and wraps each match into a structured chunk so the renderer can
 * draw an inline pill with a hover tooltip showing the data source.
 *
 * Why a regex pass instead of asking the LLM to emit annotations:
 *   • The LLM already paraphrases. Asking it to also emit machine-readable
 *     tags adds prompt complexity and a new failure mode (malformed tags).
 *   • Numbers we feed in are deterministic — finding them in the output is
 *     a string-matching problem, not an NLP problem.
 *   • Falls back gracefully: any unrecognized number stays plain text.
 *
 * The annotator returns a flat array of chunks: { type, text, ...meta }
 * where type is 'text' | 'badge'. Renderer iterates and draws.
 */

function pct(n) {
  return Number(n).toFixed(1);
}

function money(n) {
  return Number(n).toLocaleString();
}

/*
 * Build a list of expected metric values from communityData + impactData.
 * Each entry knows the value's textual form (matching how we'd expect it
 * to appear in AI output) plus a source label and a longer detail string.
 */
function collectMetricNeedles(communityData, impactData) {
  const needles = [];
  if (!communityData) return needles;

  const fa = communityData.foodAccess || {};
  const dem = communityData.demographics || {};
  const health = communityData.health || {};

  const lowAccessRule = fa.isRural ? '10mi' : '1mi';
  const lowAccessPct = Number(
    fa.qualifyingLowAccessPct ||
      (fa.isRural ? fa.pctLowAccess10mi : fa.pctLowAccess1mi) ||
      0,
  );

  if (lowAccessPct > 0) {
    needles.push({
      pattern: `${pct(lowAccessPct)}%`,
      label: `Low-access (${lowAccessRule})`,
      source: 'USDA Food Access Atlas',
      detail: `Share of residents living more than ${lowAccessRule === '10mi' ? '10 miles' : '1 mile'} from a supermarket.`,
    });
  }

  if (Number.isFinite(health.diabetes) && health.diabetes > 0) {
    needles.push({
      pattern: `${pct(health.diabetes)}%`,
      label: 'Diabetes prevalence',
      source: 'CDC PLACES',
      detail: 'Age-adjusted % of adults diagnosed with diabetes.',
    });
  }

  if (Number.isFinite(health.obesity) && health.obesity > 0) {
    needles.push({
      pattern: `${pct(health.obesity)}%`,
      label: 'Obesity prevalence',
      source: 'CDC PLACES',
      detail: 'Age-adjusted % of adults with BMI ≥ 30.',
    });
  }

  if (Number.isFinite(dem.pctPoverty) && dem.pctPoverty > 0) {
    needles.push({
      pattern: `${pct(dem.pctPoverty)}%`,
      label: 'Poverty rate',
      source: 'Census ACS 5-year',
      detail: 'Share of residents below the federal poverty line.',
    });
  }

  if (Number.isFinite(fa.pctNoVehicleLowAccess) && fa.pctNoVehicleLowAccess > 0) {
    needles.push({
      pattern: `${pct(fa.pctNoVehicleLowAccess)}%`,
      label: 'No-vehicle + low-access households',
      source: 'USDA Food Access Atlas',
      detail: 'Share of households without a vehicle who also live in a low-access area.',
    });
  }

  if (Number.isFinite(dem.medianIncome) && dem.medianIncome > 0) {
    needles.push({
      pattern: `$${money(dem.medianIncome)}`,
      label: 'Median household income',
      source: 'Census ACS 5-year',
      detail: 'Median annual household income for this tract.',
    });
  }

  if (impactData?.foodAccess) {
    const r = Number(impactData.foodAccess.residentsGainingAccess);
    if (r > 0) {
      needles.push({
        pattern: money(Math.round(r)),
        label: 'Residents gaining access',
        source: 'Projection model',
        detail: 'Estimated residents brought within range if a new grocery store opened.',
      });
    }
  }

  if (impactData?.economic) {
    const annual = Number(impactData.economic.annualLocalImpact);
    if (annual > 0) {
      needles.push({
        pattern: `$${money(Math.round(annual))}`,
        label: 'Annual local economic impact',
        source: 'Projection model',
        detail: 'Modeled local-spending uplift in the first year of operation.',
      });
    }
  }

  // De-duplicate by pattern: prefer the first-registered source so the
  // most semantically specific metric wins ties (we registered low-access
  // before diabetes, etc.).
  const seen = new Set();
  return needles.filter((n) => {
    if (seen.has(n.pattern)) return false;
    seen.add(n.pattern);
    return true;
  });
}

/*
 * Annotate an AI paragraph by greedy-replacing the longest matches first
 * (so "$76,800" gets a single badge instead of the engine chopping it up
 * into "$76" + "800"). Returns a flat array of chunks.
 */
export function annotateNarrative(text, communityData, impactData) {
  if (!text || typeof text !== 'string') return [];
  const needles = collectMetricNeedles(communityData, impactData);
  if (needles.length === 0) return [{ type: 'text', text }];

  // Sort longest pattern first so "$76,800" is matched before "$76".
  needles.sort((a, b) => b.pattern.length - a.pattern.length);

  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best = null;
    let bestNeedle = null;

    for (const needle of needles) {
      const idx = text.indexOf(needle.pattern, cursor);
      if (idx === -1) continue;
      if (best == null || idx < best || (idx === best && needle.pattern.length > bestNeedle.pattern.length)) {
        best = idx;
        bestNeedle = needle;
      }
    }

    if (best == null || !bestNeedle) {
      chunks.push({ type: 'text', text: text.slice(cursor) });
      break;
    }

    if (best > cursor) {
      chunks.push({ type: 'text', text: text.slice(cursor, best) });
    }
    chunks.push({
      type: 'badge',
      text: bestNeedle.pattern,
      label: bestNeedle.label,
      source: bestNeedle.source,
      detail: bestNeedle.detail,
    });
    cursor = best + bestNeedle.pattern.length;
  }

  return chunks;
}
