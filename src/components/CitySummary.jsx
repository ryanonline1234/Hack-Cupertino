import { useMemo, useState } from 'react';
import { SUMMARY_STEPS } from '../pipeline/placeLoader';

/*
 * CitySummary: docs/07 "City summary". USDA rates census tracts, not cities,
 * so this adds up the tract test (src/pipeline/placeLoader.js) for the
 * residents inside one Census place. No pill: a city has no verdict.
 *
 * Props:
 *   summary: { status: 'loading'|'ok'|'unknown', place: { geoid, name, kind },
 *              progress: { step, done, total } | null,
 *              result: loadPlaceSummary() result | null }
 *   activeGeoid: the tract shown below (its row is highlighted)
 *   onSelectTract(row): open that tract (row carries intptLat/intptLng)
 *   onClose(), onRetry()
 *
 * Numbers follow the tract view: counts to about the nearest 10 (exact
 * below 100) with "≈", shares to whole percent.
 */

const roundCount = (n) => (n < 100 ? Math.round(n) : Math.round(n / 10) * 10);

function fmtCount(n) {
  if (!Number.isFinite(n)) return '—';
  const s = roundCount(n).toLocaleString('en-US');
  return n < 100 ? s : `≈${s}`;
}

function fmtCountBare(n) {
  return Number.isFinite(n) ? roundCount(n).toLocaleString('en-US') : '—';
}

// Whole percent; never shows 33% for a tract share under the 33% limit.
function fmtShare(share, meetsLimit = null) {
  if (!Number.isFinite(share)) return '—';
  if (share > 0 && share < 0.005) return 'under 1%';
  if (share < 1 && share >= 0.995) return 'over 99%';
  const pct = Math.round(share * 100);
  if (meetsLimit === false && pct >= 33) return 'just under 33%';
  return `${pct}%`;
}

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

function stripPlaceSuffix(name) {
  return String(name || '').replace(/\s+(city|town|village|CDP|borough|municipality)$/, '').trim();
}

function isoDate(value) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''));
  return m ? m[0] : null;
}

const REASON_TEXT = {
  no_place: 'No Census place boundary was found for this city.',
  place_unavailable: "The city boundary (Census TIGERweb) didn't load.",
  place_incomplete:
    "The Census blocks found inside the city boundary don't add up to the city's 2020 population, so every total would be partial.",
  no_residents: 'The 2020 Census counted no residents in this place.',
  blocks_unavailable: "The 2020 Census blocks for the city didn't load (Census TIGERweb).",
  blocks_incomplete: "The Census blocks for one of the city's tracts don't add up to that tract's 2020 population.",
  tracts_unavailable: "The census tract details (Census TIGERweb) didn't load.",
  stores_unavailable: "Part of the SNAP store list around the city didn't load, so distances can't be trusted.",
  ers_unavailable: "A USDA ERS county file for the city's tracts didn't load.",
  urban_unavailable:
    "Neither USDA ERS nor the Census blocks say whether one of the city's tracts is urban or rural, so its distance limit isn't known.",
  failed: 'The summary stopped on an unexpected error.',
};

const TRACT_REASON_TEXT = {
  income_unavailable: 'no USDA ERS 2025 income row',
};

function progressText(progress) {
  const { step, done, total } = progress || {};
  const counted = Number.isFinite(done) && Number.isFinite(total) && total > 0;
  switch (step) {
    case 'blocks':
      return `Loading the Census blocks inside the city boundary (TIGERweb)${counted ? `: ${done} of ${total} parts loaded` : ''}…`;
    case 'tracts':
      return `Loading details for ${Number.isFinite(total) ? plural(total, 'census tract') : 'the census tracts'}…`;
    case 'tract_blocks':
      return `Loading every block of the tracts the city touches${counted ? `: ${done} of ${total}` : ''}…`;
    case 'ers':
      return 'Reading the USDA ERS 2025 and 2019 tract rows…';
    case 'stores':
      return 'Loading the SNAP store list around the city…';
    case 'compute':
      return `Computing straight-line distances${Number.isFinite(total) ? ` for ${fmtCount(total)} blocks` : ''}…`;
    default:
      return "Finding the city's 2020 Census blocks…";
  }
}

function progressFraction(progress) {
  const i = Math.max(0, SUMMARY_STEPS.indexOf(progress?.step));
  const { done, total } = progress || {};
  const within = Number.isFinite(done) && Number.isFinite(total) && total > 0 ? Math.min(1, done / total) : 0;
  return (i + within) / SUMMARY_STEPS.length;
}

const STATUS_ORDER = { met: 0, unknown: 1, not_met: 2 };
const STATUS_LABEL = { met: 'Meets', not_met: "Doesn't meet", unknown: 'Unknown' };
const STATUS_COLOR = { met: 'var(--danger)', not_met: 'rgba(255,255,255,0.6)', unknown: 'rgba(255,255,255,0.45)' };

const COLUMNS = [
  { key: 'tract', label: 'Tract', align: 'left', first: 'asc' },
  { key: 'inCity', label: 'In city', align: 'right', first: 'desc' },
  { key: 'share', label: 'Beyond limit', align: 'right', first: 'desc' },
  { key: 'status', label: 'Test', align: 'right', first: 'asc' },
];

function compareRows(key) {
  switch (key) {
    case 'tract':
      return (a, b) => a.geoid.localeCompare(b.geoid);
    case 'inCity':
      return (a, b) => a.inCityPop - b.inCityPop;
    case 'share':
      return (a, b) => (a.share ?? -1) - (b.share ?? -1);
    default:
      return (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
  }
}

function TractTable({ rows, activeGeoid, onSelect }) {
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });
  const sorted = useMemo(() => {
    const cmp = compareRows(sort.key);
    const sign = sort.dir === 'asc' ? 1 : -1;
    // Ties: more in-city residents first, then tract number.
    return [...rows].sort((a, b) => sign * cmp(a, b) || b.inCityPop - a.inCityPop || a.geoid.localeCompare(b.geoid));
  }, [rows, sort]);

  function toggle(col) {
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.first }));
  }

  return (
    <div
      className="max-h-64 overflow-y-auto rounded-md"
      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <table className="w-full text-[11px] tabular-nums">
        <caption className="sr-only">Census tracts the city touches; select a tract to open it</caption>
        <thead className="sticky top-0" style={{ background: 'var(--void)' }}>
          <tr>
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-2 py-1 font-normal ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col)}
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: active ? 'var(--cyan)' : 'rgba(255,255,255,0.4)' }}
                  >
                    {col.label}
                    {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const active = r.geoid === activeGeoid;
            return (
              <tr
                key={r.geoid}
                onClick={() => onSelect(r)}
                className="cursor-pointer border-t hover:bg-white/5"
                style={{
                  borderColor: 'rgba(255,255,255,0.05)',
                  background: active ? 'color-mix(in srgb, var(--cyan) 10%, transparent)' : undefined,
                }}
                aria-current={active ? 'true' : undefined}
              >
                <td className="px-2 py-1 text-left">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(r);
                    }}
                    className="text-white/85 underline decoration-white/20 underline-offset-2"
                    title={`Open census tract ${r.basename}`}
                  >
                    {r.basename}
                  </button>
                  {!r.wholeInCity && (
                    <span className="ml-1 text-[10px] text-white/35" title="Only part of this tract is inside the city">
                      part
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right text-white/75">{fmtCount(r.inCityPop)}</td>
                <td className="px-2 py-1 text-right text-white/75" title={`Share of the whole tract's residents beyond ${r.threshold} mi`}>
                  {fmtShare(r.share, r.byShare)}
                  <span className="text-white/35"> · {r.threshold} mi</span>
                </td>
                <td className="px-2 py-1 text-right whitespace-nowrap" style={{ color: STATUS_COLOR[r.status] }}>
                  {STATUS_LABEL[r.status] ?? 'Unknown'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function flaggedPart(label, f) {
  return `${label} ${fmtCount(f.residents)} (${fmtShare(f.share)})`;
}

function missingNote(label, f, why) {
  if (!(f.missingTracts > 0)) return null;
  return `${label}: ${plural(f.missingTracts, 'tract')} (${fmtCount(f.missingResidents)} residents) ${why}, not counted.`;
}

function Totals({ result }) {
  const { population, beyond, share, meeting, tractCount, unknownTracts, flagged } = result;
  const unknownWhy = (unknownTracts.reasons || []).map((r) => TRACT_REASON_TEXT[r] || 'an input was missing').join('; ');
  const notes = [
    missingNote('2019 map', flagged.lram2019, 'have no 2019 row with the same 2020 tract number (boundaries changed)'),
    missingNote('2025 map', flagged.sram2025, 'have no 2025 row'),
  ].filter(Boolean);
  return (
    <ul className="space-y-1.5 text-xs leading-snug text-white/85">
      <li>
        Residents beyond the distance limit: {fmtCount(beyond)} of {fmtCountBare(population)} ({fmtShare(share)})
        <span className="block text-[10px] text-white/40">
          Each resident is measured against their own tract&apos;s limit: 1 mile urban, 10 miles rural.
        </span>
      </li>
      <li>
        Residents in tracts meeting the test (estimate): {fmtCount(meeting.residents)} ({fmtShare(meeting.share)}) ·{' '}
        {meeting.tracts.toLocaleString('en-US')} of {plural(tractCount, 'tract')}
        {unknownTracts.tracts > 0 && (
          <span className="block text-[10px] text-white/40">
            {plural(unknownTracts.tracts, 'tract')} unknown ({fmtCount(unknownTracts.residents)} residents): {unknownWhy}.
          </span>
        )}
      </li>
      <li>
        Residents in USDA-flagged tracts: {flaggedPart('2019 map', flagged.lram2019)} ·{' '}
        {flaggedPart('2025 map', flagged.sram2025)}
        {notes.map((n) => (
          <span key={n} className="block text-[10px] text-white/40">{n}</span>
        ))}
      </li>
    </ul>
  );
}

function SmallButton({ onClick, children, label, tone = 'neutral' }) {
  const color = tone === 'accent' ? 'var(--orange)' : 'rgba(255,255,255,0.65)';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-md px-2 py-0.5 text-[10px] font-semibold btn-press"
      style={{ color, border: `1px solid ${tone === 'accent' ? 'color-mix(in srgb, var(--orange) 45%, transparent)' : 'rgba(255,255,255,0.18)'}` }}
    >
      {children}
    </button>
  );
}

export default function CitySummary({ summary, activeGeoid, onSelectTract, onClose, onRetry }) {
  const [open, setOpen] = useState(true);
  if (!summary) return null;
  const { status, place, progress, result } = summary;
  const city = stripPlaceSuffix(result?.place?.name || place?.name) || 'this city';

  function select(row) {
    // Fold the table so the tract that opens below is in view.
    setOpen(false);
    onSelectTract?.(row);
  }

  const date = isoDate(result?.storesDataset?.date);
  const blocksFrom = result?.source === 'bundled' ? 'bundled county file from TIGERweb' : 'TIGERweb, live';

  return (
    <section
      className="mb-3 rounded-lg px-3 py-2.5"
      style={{
        border: '1px solid color-mix(in srgb, var(--orange) 30%, transparent)',
        background: 'rgba(255,255,255,0.03)',
      }}
      aria-label={`City summary for ${city}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="[font-family:inherit] text-[13px] font-semibold leading-snug text-white/90">
            City summary: {city} · estimate
          </h3>
          <p className="text-[11px] text-white/45">
            USDA rates census tracts, not cities: these totals add up each tract&apos;s result for the residents inside
            the city boundary.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {status === 'ok' && (
            <SmallButton onClick={() => setOpen((v) => !v)} label={open ? 'Hide the city summary table' : 'Show the city summary table'}>
              {open ? 'Hide' : 'Show'}
            </SmallButton>
          )}
          <SmallButton onClick={() => onClose?.()} label="Close the city summary">Close</SmallButton>
        </div>
      </div>

      {status === 'loading' && (
        <div className="mt-2" role="status" aria-live="polite">
          <p className="text-[11px] text-white/70">{progressText(progress)}</p>
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.round(progressFraction(progress) * 100)}%`, background: 'var(--orange)' }}
            />
          </div>
        </div>
      )}

      {status === 'unknown' && (
        <div className="mt-2 text-xs leading-snug text-white/80" role="alert">
          <p>Unknown: {REASON_TEXT[result?.reason] || REASON_TEXT.failed}</p>
          <p className="mt-1 text-[10px] text-white/40">No partial totals are shown.</p>
          {typeof onRetry === 'function' && (
            <div className="mt-2">
              <SmallButton onClick={() => onRetry()} label="Try the city summary again" tone="accent">Try again</SmallButton>
            </div>
          )}
        </div>
      )}

      {status === 'ok' && result && (
        <div className="mt-2">
          <Totals result={result} />
          {open && (
            <div className="mt-2.5">
              <TractTable rows={result.tracts} activeGeoid={activeGeoid} onSelect={select} />
            </div>
          )}
          <p className="mt-2 text-[10px] leading-snug text-white/40">
            Estimated live with USDA ERS&apos;s rule; not an official USDA designation. A block counts as in the city when
            its Census internal point lies inside the city boundary. Tracts on the city line are tested on all their residents; totals
            count in-city residents only. Block populations include Census privacy noise; counts are rounded. Blocks:
            2020 Census ({blocksFrom}); stores: SNAP supermarkets &amp; super stores{date ? `, list of ${date}` : ''};
            income: USDA ERS 2025.
          </p>
        </div>
      )}
    </section>
  );
}
