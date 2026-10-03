/*
 * SuggestedSites: the "Suggested sites" list (docs/08 §3). Each pick comes
 * from suggestSites (src/engine/suggestSites.js), a greedy search over
 * candidate points by distance only; this component only words it. Picks are
 * not pins and never enter the URL until the visitor adds them ("Add as
 * store" adds a supermarket pin, which then joins share links like any pin).
 * Desktop draws the same picks as numbered dashed markers on the map; phones
 * get the list alone.
 *
 * Props:
 *   view         { status: 'loading' } or { status: 'ready', result, fallback,
 *                  mode: 'auto'|'blocks', dataset, canTryBlocks,
 *                  canGoBack } (see TrackerApp)
 *   threshold    access.threshold (T miles)
 *   hasPins      the visitor has counting stores placed (wording only)
 *   slotsLeft    pins that can still be added before the store limit
 *   maxPins      the store limit, for the "limit reached" line
 *   headingId    id of the heading (TrackerApp moves focus here)
 *   onAdd(index), onAddAll(), onDismiss(), onTryBlocks(), onBackToCommercial()
 *
 * Focus: after Add or Add all the list recomputes (the picks now build on
 * the new store), so focus moves to the heading instead of being lost with
 * the button.
 */
import { useEffect, useRef } from 'react';
import { BLOCK_SITE_KIND, SUGGEST_SITES_CAVEAT, siteLabelText } from '../lib/siteLabels';
import { approxCount, fmtBeyond } from '../lib/format';
import { DEFAULT_MAX_SITES } from '../engine/suggestSites';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--cyan)]';

const VERDICT = {
  met: { text: 'MEETS TEST', color: 'var(--danger)', border: 'color-mix(in srgb, var(--danger) 45%, transparent)' },
  not_met: { text: 'DOES NOT MEET', color: 'rgba(255,255,255,0.9)', border: 'rgba(255,255,255,0.24)' },
  unknown: { text: 'UNKNOWN', color: 'var(--orange)', border: 'color-mix(in srgb, var(--orange) 45%, transparent)' },
};

const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

const miWord = (t) => `${t} mi`;
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] ?? null;

// Why the picks are Census block points, when they are.
function fallbackText(code, T) {
  switch (code) {
    case 'not_bundled':
      return 'This county has no OpenStreetMap commercial-site file, so these are points inside populated Census blocks.';
    case 'unavailable':
      return "The commercial-site file didn't load, so these are points inside populated Census blocks instead.";
    case 'none_in_range':
      return `No OpenStreetMap commercial site is within ${miWord(T)} of this tract's residents, so these are points inside populated Census blocks.`;
    case 'no_gain_commercial':
      return `No OpenStreetMap commercial site near this tract brings anyone new within ${miWord(T)}, so these are points inside populated Census blocks.`;
    case 'chosen_blocks':
      return 'Points inside populated Census blocks, as you asked, instead of OpenStreetMap commercial sites.';
    default:
      return null;
  }
}

function emptyText(reason, hasPins, T) {
  if (reason === 'not_low_access') {
    return hasPins
      ? "With your placed stores, this tract is no longer low access, so there's nothing more to suggest. The before and after is in “If your stores opened.”"
      : "This tract isn't low access, so there's nothing to suggest.";
  }
  if (reason === 'unknown_baseline') return "This tract's distances aren't available, so no sites can be suggested.";
  return `No candidate site brings anyone new within ${miWord(T)}.`;
}

function MarkerBadge({ n }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 inline-flex items-center justify-center rounded-full text-[12px] font-bold tabular-nums"
      style={{
        width: 26,
        height: 26,
        color: 'var(--orange)',
        border: '2px dashed var(--orange)',
        background: 'var(--void)',
      }}
    >
      {n}
    </span>
  );
}

function SmallPill({ status }) {
  const v = VERDICT[status] ?? VERDICT.unknown;
  return (
    <span
      className="inline-block rounded-full px-1.5 py-px text-[10px] font-bold tracking-wider"
      style={{ color: v.color, border: `1px solid ${v.border}` }}
    >
      {v.text}
    </span>
  );
}

function Button({ children, onClick, disabled, ariaLabel, tone = 'plain' }) {
  const style = tone === 'add'
    ? {
        color: 'var(--cyan)',
        border: '1px solid color-mix(in srgb, var(--cyan) 45%, transparent)',
        background: 'color-mix(in srgb, var(--cyan) 12%, transparent)',
      }
    : { color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.22)' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`min-h-[40px] rounded-full px-3 text-[11px] font-semibold btn-press disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS_RING}`}
      style={style}
    >
      {children}
    </button>
  );
}

function PickRow({ pick, n, T, flippedAt, canAdd, onAdd }) {
  const label = siteLabelText(pick.candidate) ?? 'Candidate site';
  const notLowAccess = pick.lowAccessAfter === false ? false : undefined;
  const left = pick.beyondAfter === 0
    ? `no resident left beyond ${miWord(T)}`
    : `${fmtBeyond(pick.beyondAfter, notLowAccess) ?? 'not available'} still beyond ${miWord(T)}`;
  return (
    <li className="py-2 border-t border-white/5">
      <div className="flex items-start gap-2">
        <MarkerBadge n={n} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-white/85">{label}</p>
          <p className="text-[12px] font-semibold tabular-nums leading-snug" style={{ color: 'var(--cyan)' }}>
            +{approxCount(pick.gain) ?? 'not available'} residents within {miWord(T)}
            {n > 1 && <span className="font-normal text-white/65"> (with the sites above)</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-white/65">
            <span>Test after:</span>
            <SmallPill status={pick.verdictAfter?.status} />
            {flippedAt === n && <span style={{ color: 'var(--cyan)' }}>no longer meets the test</span>}
            <span>· {left}</span>
          </p>
        </div>
      </div>
      <div className="mt-1.5 pl-[34px]">
        <Button tone="add" onClick={onAdd} disabled={!canAdd} ariaLabel={`Add as store: suggested site ${n}`}>
          Add as store
        </Button>
      </div>
    </li>
  );
}

export default function SuggestedSites({
  view,
  threshold,
  hasPins = false,
  slotsLeft = Infinity,
  maxPins,
  headingId,
  onAdd,
  onAddAll,
  onDismiss,
  onTryBlocks,
  onBackToCommercial,
}) {
  const headingRef = useRef(null);
  const focusHeadingRef = useRef(false);
  const result = view?.status === 'ready' ? view.result : null;

  useEffect(() => {
    if (!focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus();
  }, [result]);

  if (!view) return null;
  const T = threshold;
  const picks = Array.isArray(result?.picks) ? result.picks : [];
  const source = result?.source;
  const fallback = picks.length > 0 && source === 'blocks' ? fallbackText(view.fallback, T) : null;
  const last = picks[picks.length - 1];
  const stillLowAccess = last?.lowAccessAfter === true;
  const osmDate = isoDate(view.dataset?.osmBase ?? view.dataset?.retrievedAt);
  const atLimit = slotsLeft < 1;

  function add(i) {
    focusHeadingRef.current = true;
    onAdd?.(i);
  }
  function addAll() {
    focusHeadingRef.current = true;
    onAddAll?.();
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mb-3 rounded-lg px-3 py-2.5"
      style={{
        border: '1px dashed color-mix(in srgb, var(--orange) 45%, transparent)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div className="flex items-center gap-2">
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="[font-family:inherit] flex-1 text-[11px] font-semibold uppercase tracking-wider text-white/65"
        >
          Suggested sites · computed
        </h3>
        <Button onClick={() => onDismiss?.()} ariaLabel="Dismiss suggested sites">Dismiss</Button>
      </div>

      {view.status === 'loading' ? (
        <p className="mt-1.5 text-[12px] text-white/70" role="status">Finding sites…</p>
      ) : (
        <>
          {fallback && (
            <p
              className="mt-1.5 text-[11px] leading-snug"
              style={{ color: view.fallback === 'unavailable' ? 'var(--orange)' : 'rgba(255,255,255,0.7)' }}
            >
              {fallback}
              {view.canGoBack && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => onBackToCommercial?.()}
                    className={`underline underline-offset-2 rounded ${FOCUS_RING}`}
                    style={{ color: 'var(--cyan)' }}
                  >
                    Back to commercial sites
                  </button>
                </>
              )}
            </p>
          )}

          {picks.length === 0 ? (
            <p className="mt-1.5 text-[12px] leading-snug text-white/75">{emptyText(result?.reason, hasPins, T)}</p>
          ) : (
            <>
              <ol className="mt-1.5" aria-label="Suggested sites, in order">
                {picks.map((pick, i) => (
                  <PickRow
                    key={`${pick.candidate.kind === BLOCK_SITE_KIND ? 'b' : 'c'}-${pick.candidate.id}`}
                    pick={pick}
                    n={i + 1}
                    T={T}
                    flippedAt={result.flippedAt}
                    canAdd={!atLimit}
                    onAdd={() => add(i)}
                  />
                ))}
              </ol>

              {source === 'commercial' && stillLowAccess && (
                <p className="mt-1 text-[11px] leading-snug text-white/70">
                  {picks.length < DEFAULT_MAX_SITES
                    ? `No other OpenStreetMap commercial site near this tract brings more residents within ${miWord(T)}.`
                    : `Still low access after these ${picks.length} sites.`}
                  {view.canTryBlocks && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => onTryBlocks?.()}
                        className={`underline underline-offset-2 rounded ${FOCUS_RING}`}
                        style={{ color: 'var(--cyan)' }}
                      >
                        Try Census block points instead
                      </button>
                    </>
                  )}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {picks.length > 1 && (
                  <Button
                    tone="add"
                    onClick={addAll}
                    disabled={slotsLeft < picks.length}
                    ariaLabel={`Add all ${picks.length} suggested sites as stores`}
                  >
                    Add all {picks.length}
                  </Button>
                )}
                {(atLimit || (picks.length > 1 && slotsLeft < picks.length)) && (
                  <span className="text-[11px] text-white/65">
                    {Number.isFinite(maxPins) ? `${maxPins}-store limit` : 'Store limit'}: remove a store to add more.
                  </span>
                )}
              </div>
            </>
          )}

          {source === 'commercial' && picks.length > 0 && (
            <p className="mt-2 text-[10px] leading-snug text-white/60">
              Sites: existing OpenStreetMap features{osmDate ? ` (data of ${osmDate})` : ''},{' '}
              <a
                href={OSM_COPYRIGHT}
                target="_blank"
                rel="noopener noreferrer"
                className={`underline underline-offset-2 rounded ${FOCUS_RING}`}
              >
                © OpenStreetMap contributors, ODbL
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
          )}
        </>
      )}

      <p className="mt-2 text-[10px] leading-snug text-white/60">{SUGGEST_SITES_CAVEAT}</p>
    </section>
  );
}
