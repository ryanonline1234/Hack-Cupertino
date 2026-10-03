import { useState } from 'react';
import { MapPin } from 'lucide-react';
import PanelHeader from './bits/PanelHeader';
import CitySummary from './CitySummary';
import { approxCount, cdcFigure, fmtBeyond, fmtMiles, fmtShare, roundedCount } from '../lib/format';

/*
 * CommunityStatsPanel: the Tract view of docs/07. USDA ERS's low-income &
 * low-access test computed on the 2020 census tract at the searched point
 * (communityData.access from src/pipeline/normalizer.js), the two published
 * USDA maps as references, the exact-spot distance, then the community
 * profile (Census ACS, CDC PLACES).
 *
 * Numbers: counts to about the nearest 10 (exact below 100) with "≈", shares
 * to whole percent (src/lib/format.js). Every Unknown names its reason in
 * plain words.
 *
 * Props: communityData, loading, lastSearch ({ placeKind, placeName } | null),
 *        onSummarizeCity (optional; the button only renders when provided),
 *        citySummary (TrackerApp's City summary state, see CitySummary.jsx;
 *        null when none is open), onCitySummaryTract(row),
 *        onCloseCitySummary(), onRetryCitySummary(),
 *        onRetry() (re-runs the search without the cache; the verdict card
 *        offers it when a source failed to load).
 */

const ACS_TOP_CODE = 250001;

const PILL = {
  met: {
    label: 'MEETS TEST',
    color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)',
    background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
  },
  not_met: {
    label: 'DOES NOT MEET',
    color: 'var(--cyan)',
    border: '1px solid color-mix(in srgb, var(--cyan) 40%, transparent)',
    background: 'color-mix(in srgb, var(--cyan) 10%, transparent)',
  },
  unknown: {
    label: 'UNKNOWN',
    color: 'rgba(255,255,255,0.62)',
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.06)',
  },
};

// Plain words for every Unknown reason in docs/07.
const REASON_TEXT = {
  tract_unavailable: "The census tract lookup (Census TIGERweb) didn't answer, so this point couldn't be placed in a tract.",
  no_tract: "This point isn't inside any US census tract.",
  no_residents: "USDA does not rate tracts without residents, and this tract had no residents in the 2020 Census.",
  blocks_unavailable: "The 2020 Census block populations for this tract didn't load.",
  blocks_incomplete: "The Census blocks that loaded don't add up to the tract's 2020 population, so a count would be partial.",
  stores_unavailable: "Part of the SNAP store list near this tract didn't load, so distances can't be trusted.",
  income_unavailable: 'USDA ERS has no 2025 income row for this tract.',
  urban_unavailable: "Neither USDA ERS nor the Census blocks say whether this tract is urban or rural, so the distance limit (1 or 10 miles) isn't known.",
  ers_unavailable: "The USDA ERS file for this county didn't load, so the urban/rural limit and the income flag are unknown. Try again.",
  stores_not_covered: "SNAP doesn't operate here (this territory uses a nutrition block grant instead), so the SNAP store list has no stores to measure from. The test can't be estimated.",
};
const GENERIC_REASON = "An input the test needs wasn't available.";

const reasonText = (reason) => REASON_TEXT[reason] || GENERIC_REASON;

// Fetch failures a fresh request can fix: the verdict card offers Try again.
const RETRY_REASONS = new Set(['tract_unavailable', 'blocks_unavailable', 'stores_unavailable', 'ers_unavailable']);

// Why the income flag is missing: no ERS row, or the ERS file didn't load.
const incomeMissingText = (access) =>
  REASON_TEXT[access.reason === 'ers_unavailable' ? 'ers_unavailable' : 'income_unavailable'];

// ------------------------------------------------------------- formatting
// Counts, shares and miles come from src/lib/format.js (shared with the
// scenario card and the log), which never shows a value under a limit as at
// or over it.

function fmtWholePct(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : null;
}

function fmtDollars(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= ACS_TOP_CODE) return '$250,000 or more';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

const milesWord = (t) => (t === 1 ? '1 mile' : `${t} miles`);
const bandMi = (x) => String(Number(x.toFixed(1)));

function isoDate(value) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''));
  return m ? m[0] : null;
}

// "Census Tract 5046.02" -> "5046.02"; falls back to the 6-digit tract code.
function tractBasename(meta) {
  const fromName = String(meta?.tractName || '').replace(/^census tract\s+/i, '').trim();
  if (fromName) return fromName;
  const code = typeof meta?.fips === 'string' ? meta.fips.slice(5) : '';
  if (!/^\d{6}$/.test(code)) return null;
  const whole = String(Number(code.slice(0, 4)));
  return code.slice(4) === '00' ? whole : `${whole}.${code.slice(4)}`;
}

// "San Jose city" -> "San Jose" (Census keeps the legal suffix in NAME).
function stripPlaceSuffix(name) {
  return String(name || '').replace(/\s+(city|town|village|CDP)$/, '').trim();
}

// ------------------------------------------------------------- sentences

function limitsClause(access) {
  if (access.lowAccess !== true) return ', under both limits (33% and 500 residents)';
  if (access.byShare && access.byCount) return ' — over both limits (33% and 500 residents)';
  if (access.byCount) return ' — over the 500-resident limit, though under 33%';
  return ' — over the 33% limit';
}

function beyondClause(access) {
  const { beyond, population, share, threshold, byShare, byCount } = access;
  if (!Number.isFinite(beyond) || !Number.isFinite(population) || population <= 0 || !Number.isFinite(threshold)) {
    return null;
  }
  const noun = population === 1 ? 'resident' : 'residents';
  return `${fmtBeyond(beyond, byCount)} of ${roundedCount(population)} ${noun} (${fmtShare(share, byShare)}) live more than ${milesWord(threshold)} from a counted supermarket`;
}

function qualifierSentence(access) {
  const verdict = access.verdict || {};
  const clause = beyondClause(access);
  const lim = clause ? limitsClause(access) : '';
  switch (verdict.qualifier) {
    case 'li_la':
      return clause ? `Low income and low access: ${clause}${lim}.` : 'Low income and low access.';
    case 'la_not_li':
      return clause
        ? `Low access but not low income: ${clause}${lim}. USDA ERS 2025 does not flag the tract as low income.`
        : 'Low access, but USDA ERS 2025 does not flag the tract as low income.';
    case 'li_not_la':
      return clause
        ? `Low income but not low access: ${clause}${lim}.`
        : 'Low income (USDA ERS 2025) but not low access.';
    case 'neither':
      return clause ? `Neither low income nor low access: ${clause}${lim}.` : 'Neither low income nor low access.';
    case 'not_la_income_unknown':
      return `Not low access${clause ? `: ${clause}${lim}` : ''}. ${incomeMissingText(access)} That can't change the result: both conditions are needed.`;
    case 'not_li_access_unknown':
      return `Not low income (USDA ERS 2025), so the test isn't met whatever access is. Access wasn't computed: ${reasonText(access.reason)}`;
    case 'la_income_unknown':
      return `Low access${clause ? `: ${clause}${lim}` : ''}. ${incomeMissingText(access)} Without it the result is unknown.`;
    default:
      return `Unknown: ${reasonText(verdict.reason || access.reason)}`;
  }
}

// The Point scope: a distance from the searched spot, never a verdict.
const POINT_CAVEAT = " One spot doesn't decide USDA's test; the tract's residents do.";

function pointSentence(point) {
  if (!point) return null;
  if (Number.isFinite(point.miles)) {
    const name = point.store?.name || (point.store?.type === 'S' ? 'an unnamed super store' : 'an unnamed supermarket');
    return `From this exact spot: nearest counted supermarket is ${name}, ${fmtMiles(point.miles)} (straight line).${POINT_CAVEAT}`;
  }
  if (point.reason === 'over_30_mi') {
    return `From this exact spot: no counted supermarket within 30 mi (straight line).${POINT_CAVEAT}`;
  }
  if (point.reason === 'stores_not_covered') {
    return 'From this exact spot: no distance computed; the SNAP store list has no stores in this territory.';
  }
  if (point.reason === 'no_residents') {
    return "From this exact spot: no distance computed; stores aren't loaded for a tract without residents.";
  }
  return `From this exact spot: no distance computed. ${reasonText(point.reason || 'stores_unavailable')}`;
}

// ------------------------------------------------------------- pieces

function SkeletonRow() {
  return (
    <div className="flex justify-between items-center py-1.5">
      <div className="skeleton h-3 w-28 rounded" />
      <div className="skeleton h-3 w-16 rounded" />
    </div>
  );
}

// Static text: a count-up starts at 0 until scrolled into view, and a "$0"
// or "≈0" that reads as data is worse than no animation.
function StatRow({ label, value, note, accent }) {
  return (
    <div
      className="flex justify-between items-baseline gap-3 py-1.5 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <span className="text-xs text-white/60">{label}</span>
      <span className="text-right">
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: accent ? `var(--${accent})` : 'rgba(255,255,255,0.85)' }}
        >
          {value}
        </span>
        {note && <span className="block text-[10px] text-white/60">{note}</span>}
      </span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h3 className="[font-family:inherit] text-[10px] font-semibold uppercase tracking-wider text-white/60 mb-1.5">
      {children}
    </h3>
  );
}

// Comparable place name: "San José city" and "San Jose" both -> "san jose".
function placeKey(name) {
  return stripPlaceSuffix(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// docs/07 city detection: the search was a city/town/village (Nominatim)
// AND the TIGERweb place at the point has a matching name. Without a
// searched name, the TIGERweb place alone confirms it.
function cityConfirmed(lastSearch, place) {
  if (lastSearch?.placeKind !== 'city' || !place?.kind || !place.name) return false;
  const searched = placeKey(lastSearch.placeName);
  if (!searched) return true;
  const found = placeKey(place.name);
  return Boolean(found) && (found === searched || found.startsWith(`${searched} `) || searched.startsWith(`${found} `));
}

// The notice also shows when the place lookup itself failed (meta.placeStatus
// 'unavailable'): the city name can't be confirmed, so there is no Summarize.
function CityNotice({ lastSearch, meta, onSummarizeCity }) {
  const confirmed = cityConfirmed(lastSearch, meta?.place);
  const lookupFailed = lastSearch?.placeKind === 'city' && meta?.placeStatus === 'unavailable';
  if (!confirmed && !lookupFailed) return null;
  const city = (confirmed && stripPlaceSuffix(meta.place.name)) || lastSearch.placeName || 'this place';
  const basename = tractBasename(meta);
  return (
    <div
      className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-snug"
      style={{
        border: '1px solid color-mix(in srgb, var(--orange) 35%, transparent)',
        background: 'color-mix(in srgb, var(--orange) 8%, transparent)',
        color: 'rgba(255,255,255,0.78)',
      }}
    >
      <p>
        USDA rates census tracts, not cities. Showing tract {basename || 'at this point'}, the one at the point you
        searched.
      </p>
      {confirmed && typeof onSummarizeCity === 'function' && (
        <button
          type="button"
          onClick={() => onSummarizeCity()}
          className="mt-2 rounded-md px-2.5 py-1 text-[11px] font-semibold btn-press"
          style={{
            color: 'var(--orange)',
            border: '1px solid color-mix(in srgb, var(--orange) 45%, transparent)',
            background: 'color-mix(in srgb, var(--orange) 10%, transparent)',
          }}
        >
          Summarize {city}
        </button>
      )}
    </div>
  );
}

// TrackerApp moves focus here (Try again, opening a City-summary row,
// clearing the placed stores) by this id.
const VERDICT_HEADING_ID = 'fds-verdict-heading';

function VerdictCard({ meta, access, onRetry }) {
  const status = PILL[access.status] ? access.status : 'unknown';
  const pill = PILL[status];
  const basename = tractBasename(meta);
  const T = access.threshold;
  const canRetry = typeof onRetry === 'function' && RETRY_REASONS.has(access.reason);
  return (
    <section
      className="mb-3 rounded-lg px-3 py-2.5"
      style={{
        border: `1px solid ${status === 'met' ? 'color-mix(in srgb, var(--danger) 30%, transparent)' : 'rgba(255,255,255,0.1)'}`,
        background: 'rgba(255,255,255,0.03)',
      }}
      aria-label="Low-income and low-access test"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={VERDICT_HEADING_ID}
            tabIndex={-1}
            className="[font-family:inherit] text-[13px] font-semibold leading-snug text-white/90"
          >
            Low-income &amp; low-access test (USDA rule, supermarket-based) · estimate
          </h2>
          <p className="text-[11px] text-white/60">the measure often called a food desert</p>
        </div>
        <span
          className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-bold tracking-wider"
          style={{ color: pill.color, border: pill.border, background: pill.background }}
        >
          {pill.label}
        </span>
      </div>

      {basename && (
        <p className="mt-2 text-[11px] text-white/60">
          Census tract {basename}
          {Number.isFinite(access.population) ? ` · ${approxCount(access.population)} ${access.population === 1 ? 'resident' : 'residents'}` : ''}
        </p>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-white/85">{qualifierSentence(access)}</p>

      {access.borderline === true && Number.isFinite(T) && (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--orange)' }}>
          Borderline: moving the distance limit 10% either way ({bandMi(T * 0.9)}–{bandMi(T * 1.1)} mi) changes the
          low-access result.
        </p>
      )}

      {canRetry && (
        <button
          type="button"
          onClick={() => onRetry()}
          className="mt-2 min-h-[40px] rounded-md px-3 text-[11px] font-semibold btn-press"
          style={{
            color: 'var(--orange)',
            border: '1px solid color-mix(in srgb, var(--orange) 45%, transparent)',
            background: 'color-mix(in srgb, var(--orange) 10%, transparent)',
          }}
        >
          Try again
        </button>
      )}
    </section>
  );
}

function DistanceBands({ access }) {
  const { bands, population, threshold, beyond } = access;
  if (!Array.isArray(bands) || !(beyond > 0) || !(population > 0)) return null;
  return (
    <div className="mb-3">
      <SectionLabel>Residents beyond {threshold} mi, by straight-line distance</SectionLabel>
      <div className="space-y-1">
        {bands.map((band) => {
          const label = band.toMi === null
            ? `over ${bandMi(band.fromMi)} mi`
            : `${bandMi(band.fromMi)}–${bandMi(band.toMi)} mi`;
          const width = Math.max(0, Math.min(100, (band.residents / population) * 100));
          return (
            <div key={label} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-[11px]">
              <span className="text-white/60">{label}</span>
              <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${width}%`, background: 'var(--orange)', opacity: 0.75 }}
                />
              </span>
              <span className="text-right text-white/75 tabular-nums">{approxCount(band.residents)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function lramLine(lram2019) {
  if (!lram2019 || lram2019.reason === 'unavailable') return "couldn't be loaded";
  if (lram2019.reason === 'boundary_changed') return 'no 2019 row for this 2020 tract (boundaries changed)';
  if (lram2019.reason) return 'no 2019 row for this tract';
  if (lram2019.lila === null) return 'not published for this tract';
  const flag = lram2019.lila ? 'yes' : 'no';
  // ERS's 2019 low-access rule used the same 33% limit: a share under it
  // never reads as 33%.
  const share = lram2019.share === null
    ? 'share not published'
    : `share beyond: ${fmtShare(lram2019.share, lram2019.share >= 0.33)}`;
  return `low income & low access — ${flag} (${share})`;
}

function sramLine(sram2025) {
  if (!sram2025 || sram2025.reason === 'unavailable') return "couldn't be loaded";
  if (sram2025.reason) return 'no 2025 row for this tract';
  const flag = sram2025.lila === null ? 'not published' : sram2025.lila ? 'yes' : 'no';
  return `${flag} — counts SNAP-authorized stores of every size, including convenience and dollar stores (not farmers markets)`;
}

function References({ references }) {
  if (!references) return null;
  const { lram2019, sram2025, differNote } = references;
  return (
    <div className="mb-3">
      <SectionLabel>Published USDA maps (for reference)</SectionLabel>
      <ul className="space-y-1 text-[11px] leading-snug text-white/65">
        <li>
          <span className="text-white/80">USDA 2019 supermarket map (LRAM, 2010 tract boundaries):</span>{' '}
          {lramLine(lram2019)}
        </li>
        <li>
          <span className="text-white/80">USDA 2025 SNAP-store map (SRAM):</span> {sramLine(sram2025)}
        </li>
        {differNote && (
          <li style={{ color: 'var(--orange)' }}>
            Compared with this estimate: {differNote}.
          </li>
        )}
      </ul>
    </div>
  );
}

function TraceRow({ label, actual, rule, result }) {
  const shown = result === true ? 'yes' : result === false ? 'no' : result === null ? 'unknown' : '—';
  const color = result === true ? 'var(--orange)' : result === null ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.75)';
  return (
    <div
      className="grid grid-cols-[1.1fr_1fr_1.2fr_auto] gap-2 items-start text-[11px] py-1.5 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <span className="text-white/65">{label}</span>
      <span className="text-white/60">{actual}</span>
      <span className="text-white/60">{rule}</span>
      <span style={{ color }}>{shown}</span>
    </div>
  );
}

function EvaluationTrace({ communityData }) {
  const [open, setOpen] = useState(false);
  const { access, ers, meta } = communityData;
  const e2025 = ers?.status === 'ok' ? ers.e2025 : null;
  const blocks = Array.isArray(access.blocks) ? access.blocks : [];
  const T = access.threshold;
  const urbanFrom = access.urbanSource === 'ers_2025'
    ? 'ERS 2025 Urban flag'
    : access.urbanSource === 'block_ur'
      ? 'majority of block residents (no ERS flag)'
      : 'no source';
  const blocksFrom = access.blocksSource === 'bundled'
    ? 'bundled county file (TIGERweb)'
    : access.blocksSource === 'tigerweb'
      ? 'TIGERweb, live'
      : 'not loaded';
  const storesDate = isoDate(access.storesDataset?.date);
  const ersContext = e2025
    ? [
        Number.isFinite(e2025.povertyRate) ? `poverty ${fmtWholePct(e2025.povertyRate)}` : null,
        fmtDollars(e2025.medianFamilyIncome) ? `median family income ${fmtDollars(e2025.medianFamilyIncome)}` : null,
      ].filter(Boolean).join(', ')
    : '';
  const cache = meta?.cache;

  return (
    <div className="mb-3 rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 py-2 text-left flex items-center justify-between"
      >
        <span className="text-[11px] uppercase tracking-wider text-white/60">Evaluation trace</span>
        <span className="text-[10px] text-white/60">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-2">
          <div
            className="grid grid-cols-[1.1fr_1fr_1.2fr_auto] gap-2 text-[10px] text-white/60 pb-1 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <span>Criterion</span>
            <span>Value</span>
            <span>Rule</span>
            <span>Met</span>
          </div>
          <TraceRow
            label="Low income"
            actual={typeof access.lowIncome === 'boolean'
              ? `ERS 2025 flag: ${access.lowIncome ? '1' : '0'}${ersContext ? ` (${ersContext})` : ''}`
              : access.reason === 'ers_unavailable' ? "ERS county file didn't load" : 'no ERS 2025 row'}
            rule="ERS 2025 LowIncomeTracts, as published"
            result={typeof access.lowIncome === 'boolean' ? access.lowIncome : null}
          />
          <TraceRow
            label="Low access: share"
            actual={fmtShare(access.share, access.byShare) ?? 'not computed'}
            rule={`≥ 33% of residents beyond ${Number.isFinite(T) ? `${T} mi` : 'the limit'}`}
            result={typeof access.byShare === 'boolean' ? access.byShare : null}
          />
          <TraceRow
            label="Low access: count"
            actual={fmtBeyond(access.beyond, access.byCount) ?? 'not computed'}
            rule="≥ 500 residents beyond the limit"
            result={typeof access.byCount === 'boolean' ? access.byCount : null}
          />
          <TraceRow
            label="Low access"
            actual={typeof access.lowAccess === 'boolean' ? (access.lowAccess ? 'yes' : 'no') : 'not computed'}
            rule="share OR count"
            result={typeof access.lowAccess === 'boolean' ? access.lowAccess : null}
          />
          <TraceRow
            label="Distance limit"
            actual={Number.isFinite(T) ? `${T} mi (${access.urban ? 'urban' : 'rural'})` : 'unknown'}
            rule={`1 mi urban, 10 mi rural · from ${urbanFrom}`}
            result="info"
          />
          <TraceRow
            label="Census blocks"
            actual={blocks.length ? `${blocks.length.toLocaleString('en-US')} populated` : 'none used'}
            rule={`2020 Census, ${blocksFrom}; must sum to tract population`}
            result="info"
          />
          <TraceRow
            label="Stores"
            actual={storesDate ? `list of ${storesDate}` : 'not loaded'}
            rule="SNAP supermarkets & super stores, straight-line from block centers"
            result="info"
          />
          <TraceRow
            label="Result"
            actual={PILL[access.status]?.label ?? 'UNKNOWN'}
            rule="low income AND low access (a known 'no' decides)"
            result={access.status === 'met' ? true : access.status === 'not_met' ? false : null}
          />
          {cache?.status && (
            <p className="pt-1.5 text-[10px] text-white/60">
              {cache.status === 'fresh' ? 'Fetched just now' : `Served from the ${cache.status} cache`}
              {cache.cachedAt ? ` · computed ${new Date(cache.cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourcesNote({ access }) {
  const date = isoDate(access.storesDataset?.date);
  const blocks = access.blocksSource === 'bundled'
    ? 'bundled county file from TIGERweb'
    : access.blocksSource === 'tigerweb'
      ? 'TIGERweb, live'
      : 'not loaded';
  return (
    <div className="mb-3 space-y-1 text-[10px] leading-snug text-white/60">
      <p>
        Estimated live with USDA ERS&apos;s rule; not an official USDA designation. Block populations include Census
        privacy noise; counts are rounded.
      </p>
      <p>
        Stores: USDA SNAP-authorized supermarkets &amp; super stores, {date ? `list of ${date}` : 'list not loaded for this search'};
        warehouse clubs and commissaries removed; supermarkets that don&apos;t take SNAP are missing. Blocks: 2020
        Census ({blocks}). Income: USDA ERS 2025.
      </p>
    </div>
  );
}

const ACS_MISSING_NOTE = {
  not_configured: 'Census ACS figures are off on this deployment (no Census API key).',
  timeout: "The Census ACS figures for this tract didn't arrive in time.",
  ok: 'Census ACS returned no figures for this tract.',
};

// healthStatus / acsStatus: meta.profileStatus.{health, demographics}; a
// failed CDC call shows as unavailable, not as "not published".
function CommunityProfile({ demographics, health, healthStatus, acsStatus }) {
  const acsMissing = !demographics || !(demographics.population > 0 || demographics.medianIncome > 0 || demographics.pctPoverty > 0);
  const diabetes = cdcFigure(health?.diabetes, healthStatus);
  const obesity = cdcFigure(health?.obesity, healthStatus);
  const pop = demographics?.population;
  const income = demographics?.medianIncome;

  return (
    <div className="mb-1">
      <PanelHeader icon={MapPin}>Community profile</PanelHeader>
      {acsMissing ? (
        <StatRow
          label="Census ACS 5-year"
          value="unavailable"
          note={ACS_MISSING_NOTE[acsStatus] ?? "The Census ACS figures for this tract didn't load."}
        />
      ) : (
        <>
          <StatRow
            label="Population (ACS 5-year)"
            value={pop > 0 ? approxCount(pop) : 'unavailable'}
          />
          <StatRow
            label="Poverty rate (ACS)"
            value={fmtWholePct(demographics.pctPoverty) ?? 'unavailable'}
          />
          <StatRow
            label="Median household income (ACS)"
            value={fmtDollars(income) ?? 'unavailable'}
            note={income >= ACS_TOP_CODE ? 'ACS top-codes incomes at $250,000' : null}
            accent="cyan"
          />
        </>
      )}
      <StatRow
        label="Diabetes (CDC PLACES)"
        value={diabetes.label ?? fmtWholePct(diabetes.value)}
        note={diabetes.note}
      />
      <StatRow
        label="Obesity (CDC PLACES)"
        value={obesity.label ?? fmtWholePct(obesity.value)}
        note={obesity.note}
      />
    </div>
  );
}

// ------------------------------------------------------------- panel

export default function CommunityStatsPanel({
  communityData,
  loading,
  lastSearch,
  onSummarizeCity,
  citySummary = null,
  onCitySummaryTract,
  onCloseCitySummary,
  onRetryCitySummary,
  onRetry,
}) {
  // With a City summary open, everything renders in one stable shell so the
  // summary (and its sort/fold state) survives the tract reloading below it
  // when a row is opened.
  if (citySummary) {
    const ready = Boolean(communityData?.access) && !loading;
    const meta = communityData?.meta;
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={MapPin}>Tract view</PanelHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          {ready ? <CityNotice lastSearch={lastSearch} meta={meta} onSummarizeCity={undefined} /> : null}
          <CitySummary
            summary={citySummary}
            activeGeoid={ready ? meta?.fips : null}
            onSelectTract={onCitySummaryTract}
            onClose={onCloseCitySummary}
            onRetry={onRetryCitySummary}
          />
          {ready ? (
            <TractBody communityData={communityData} onRetry={onRetry} animate />
          ) : loading ? (
            <div className="flex flex-col gap-1 animate-pulse">
              <div className="skeleton h-8 rounded-lg mb-2" />
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!communityData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <p className="text-xs text-white/60">The tract test will appear here</p>
      </div>
    );
  }

  if (loading || !communityData?.access) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        <div className="skeleton h-8 rounded-lg mb-2" />
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-slide-up">
      <PanelHeader icon={MapPin}>Tract view</PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        <CityNotice lastSearch={lastSearch} meta={communityData.meta} onSummarizeCity={onSummarizeCity} />
        <TractBody communityData={communityData} onRetry={onRetry} />
      </div>
    </div>
  );
}

// Verdict, bands, the exact-spot line, references, sources, trace, profile.
function TractBody({ communityData, onRetry, animate = false }) {
  const { meta, access, health, demographics } = communityData;
  const hasTract = Boolean(meta?.fips);
  const point = pointSentence(access.point);
  return (
    <div className={animate ? 'animate-fade-slide-up' : undefined}>
      <VerdictCard meta={meta} access={access} onRetry={onRetry} />
      <DistanceBands access={access} />

      {hasTract && point && (
        <p className="mb-3 text-[11px] leading-snug text-white/65">
          {point}
        </p>
      )}

      {hasTract && <References references={access.references} />}
      <SourcesNote access={access} />
      {hasTract && <EvaluationTrace communityData={communityData} />}
      {hasTract && (
        <CommunityProfile
          demographics={demographics}
          health={health}
          healthStatus={meta?.profileStatus?.health}
          acsStatus={meta?.profileStatus?.demographics}
        />
      )}
    </div>
  );
}
