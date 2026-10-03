/*
 * ScenarioResultCard: what USDA ERS's tract test would say if the visitor's
 * stores opened (docs/07 "Impact" and "Store customization"). Every number
 * is computed by evaluatePlacedStoreScenario on this tract's Census blocks;
 * nothing is projected. Map overlay on desktop, stacked on mobile.
 *
 * Props:
 *   scenario        evaluatePlacedStoreScenario(communityData, pins) or null
 *   communityData   the docs/07 payload ({ meta, access, ... })
 *   pins            [{ id, lat, lng, format, createdAt }]; renders nothing
 *                   when empty
 *   onSetPinFormat(id, format), onRemovePin(id),
 *   onClearPins({ fromCard: true }) (TrackerApp moves focus to the verdict
 *                   heading, since this card unmounts with no pins)
 *
 * Focus: removing a store focuses the next store's select, or the "Your
 * stores" heading when no store follows it. Removing the only store
 * unmounts the card; TrackerApp moves focus then.
 */
import { useEffect, useId, useRef } from 'react';
import { STORE_FORMATS, storeFormatInfo } from '../lib/storeFormats';
import { approxCount, fmtBeyond, fmtShare } from '../lib/format';

const VERDICT = {
  met: {
    text: 'MEETS TEST',
    color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 45%, transparent)',
    background: 'color-mix(in srgb, var(--danger) 13%, transparent)',
  },
  not_met: {
    text: 'DOES NOT MEET',
    color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.24)',
    background: 'rgba(255,255,255,0.06)',
  },
  unknown: {
    text: 'UNKNOWN',
    color: 'var(--orange)',
    border: '1px solid color-mix(in srgb, var(--orange) 45%, transparent)',
    background: 'color-mix(in srgb, var(--orange) 12%, transparent)',
  },
};

// Why the baseline (and so the recompute) is unknown, in plain words.
const BASELINE_REASON = {
  tract_unavailable: 'the census tract lookup failed (network)',
  no_tract: 'this point is outside any US census tract',
  no_residents: 'USDA does not rate tracts without residents',
  blocks_unavailable: "this tract's Census block data didn't load",
  blocks_incomplete: "this tract's Census block populations don't add up to its total",
  stores_unavailable: "the supermarket data for this area didn't load",
  urban_unavailable: "this tract's urban/rural status isn't available",
  income_unavailable: 'there is no ERS 2025 income flag for this tract',
};

// Reasons whose full sentence (shared wording with the tract view) is shown
// instead of a "because …" clause.
const BASELINE_SENTENCE = {
  ers_unavailable: "The USDA ERS file for this county didn't load, so the urban/rural limit and the income flag are unknown. Try again.",
  stores_not_covered: "SNAP doesn't operate here (this territory uses a nutrition block grant instead), so the SNAP store list has no stores to measure from. The test can't be estimated.",
};

const LINK_CLASS = 'underline decoration-white/30 underline-offset-2 hover:text-white';
const CITATIONS = {
  qcew: 'https://data.bls.gov/cew/apps/table_maker/v4/table_maker.htm#type=2&st=US&year=2025&qtr=A&own=5&ind=445110&supp=0',
  neumark: 'https://econpapers.repec.org/paper/irvwpaper/060711.htm',
  cummins: 'https://pubmed.ncbi.nlm.nih.gov/24493772/',
  dubowitz: 'https://pubmed.ncbi.nlm.nih.gov/26526243/',
  elbel: 'https://pubmed.ncbi.nlm.nih.gov/25714993/',
  richardson: 'https://pubmed.ncbi.nlm.nih.gov/29198367/',
};

// Counts: exact below 100, else about the nearest 10 with "≈"
// (src/lib/format.js).
const fmtCount = (n) => approxCount(Math.max(0, n)) ?? 'not available';

// One side of the before/after: residents beyond T and their share, each
// guarded against reading as at/over a limit that side is under.
function fmtBeyondShare(side) {
  const beyond = fmtBeyond(Math.max(0, side.beyond), side.byCount) ?? 'not available';
  const share = fmtShare(side.share, side.byShare) ?? 'not available';
  return `${beyond} (${share})`;
}

// ERS TractHUNV apportioned by housing units: an estimate (the label carries
// the "≈"), too rough to show under 20.
function fmtNoVehicle(n) {
  if (!Number.isFinite(n)) return 'not available';
  if (n < 20) return 'under 20';
  if (n < 100) return String(Math.round(n));
  return (Math.round(n / 10) * 10).toLocaleString('en-US');
}

function fmtMi(miles) {
  return miles === 0.5 ? '½ mi' : `${miles} mi`;
}

function trail(beforeStatus, afterStatus, reason) {
  const ersFailed = reason === 'ers_unavailable';
  if (beforeStatus === 'met' && afterStatus === 'not_met') return 'Flipped from MEETS TEST';
  if (beforeStatus === 'met' && afterStatus === 'met') return 'Still meets the test';
  if (beforeStatus === 'not_met' && afterStatus === 'not_met') return "Didn't meet the test before either";
  if (beforeStatus === 'unknown' && afterStatus === 'not_met') {
    return `Was UNKNOWN (${ersFailed ? "the USDA ERS file didn't load" : 'no ERS 2025 income flag'}); now not low access, so it doesn't meet the test either way`;
  }
  return ersFailed
    ? "Still UNKNOWN: the USDA ERS file for this county didn't load, so the income flag is unknown"
    : 'Still UNKNOWN: there is no ERS 2025 income flag for this tract';
}

function noun(n, word) {
  return `${word}${n === 1 ? '' : 's'}`;
}

function Pill({ status, size = 'big' }) {
  const v = VERDICT[status] ?? VERDICT.unknown;
  const sizing = size === 'big'
    ? 'block rounded-lg px-3 py-2 text-center text-base font-bold tracking-wider'
    : 'inline-block rounded-full px-1.5 py-px text-[10px] font-bold tracking-wider';
  return (
    <span className={sizing} style={{ color: v.color, border: v.border, background: v.background }}>
      {v.text}
    </span>
  );
}

function Row({ label, before, after, children }) {
  return (
    <div className="py-1.5 border-t border-white/5">
      <p className="text-[11px] leading-snug text-white/60">{label}</p>
      {children ?? (
        <p className="text-[13px] font-semibold tabular-nums leading-snug">
          <span className="text-white/60">{before}</span>
          <span className="text-white/60" aria-hidden="true"> → </span>
          <span className="sr-only"> becomes </span>
          <span style={{ color: 'var(--cyan)' }}>{after}</span>
        </p>
      )}
    </div>
  );
}

// How far over each limit the tract still is. The count limit is reached at
// 500, so the most residents a tract can have beyond T and not be low access
// by count is 499: residentsOver is beyond − 499.
function sharePoints(over) {
  if (over < 0.005) return 'at the 33% limit';
  if (over < 1) return 'under 1 point above the 33% limit';
  const pts = Math.round(over);
  return `${pts} ${noun(pts, 'point')} above the 33% limit`;
}

function GapRow({ after, gap, threshold }) {
  const parts = [];
  if (Number.isFinite(gap?.residentsOver)) {
    parts.push(`${fmtCount(gap.residentsOver)} ${noun(gap.residentsOver, 'resident')} above the 499 maximum`);
  }
  if (Number.isFinite(gap?.shareOverPct)) parts.push(sharePoints(gap.shareOverPct));
  return (
    <Row label="Still low access">
      <p className="text-[12px] leading-snug text-white/80">
        {fmtBeyond(after.beyond, after.byCount) ?? 'not available'} residents still beyond {fmtMi(threshold)}; needs
        under 500 and under 33%.
      </p>
      {parts.length > 0 && <p className="text-[11px] leading-snug text-white/60">{parts.join(' · ')}</p>}
      {Number.isFinite(gap?.residentsToClear) && (
        <p className="text-[11px] leading-snug text-white/60">
          Bringing {fmtCount(gap.residentsToClear)} more residents within {fmtMi(threshold)} would end low access.
        </p>
      )}
    </Row>
  );
}

function Impact({ scenario, threshold, reason }) {
  const { before, after } = scenario;
  const T = fmtMi(threshold);
  return (
    <>
      <Pill status={after.verdict.status} />
      <p className="mt-1 mb-2 text-center text-[11px] leading-snug text-white/60">
        {trail(before.verdict.status, after.verdict.status, reason)}
      </p>

      <p className="text-[10px] uppercase tracking-wider text-white/60">Before → after (computed)</p>
      <Row
        label={`Residents beyond ${T}`}
        before={fmtBeyondShare(before)}
        after={fmtBeyondShare(after)}
      />
      <Row label={`Residents brought within ${T}`}>
        <p className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--cyan)' }}>
          {fmtCount(scenario.broughtWithin)}
        </p>
      </Row>
      <Row label="Test result">
        <p className="flex flex-wrap items-center gap-1.5">
          <Pill status={before.verdict.status} size="small" />
          <span className="text-white/60" aria-hidden="true">→</span>
          <span className="sr-only">becomes</span>
          <Pill status={after.verdict.status} size="small" />
        </p>
      </Row>
      {after.lowAccess === true && <GapRow after={after} gap={scenario.gap} threshold={threshold} />}
      {scenario.halfMile && (
        <Row
          label="Residents within ½ mi"
          before={fmtCount(scenario.halfMile.before)}
          after={fmtCount(scenario.halfMile.after)}
        />
      )}
      {scenario.noVehicleEstimate && (
        <Row
          label="≈ no-vehicle households beyond ½ mi"
          before={fmtNoVehicle(scenario.noVehicleEstimate.before)}
          after={fmtNoVehicle(scenario.noVehicleEstimate.after)}
        />
      )}
      {scenario.nonCounting > 0 && (
        <p className="mt-1.5 text-[11px] leading-snug text-white/60">
          {scenario.nonCounting === 1 ? '1 of your stores doesn’t' : `${scenario.nonCounting} of your stores don’t`} count
          toward the measure, so {scenario.nonCounting === 1 ? 'it is' : 'they are'} left out of these numbers.
        </p>
      )}
      <p className="mt-2 text-[10px] leading-snug text-white/60">
        This tract&apos;s residents only; straight-line distance from 2020 Census block centers.
      </p>
    </>
  );
}

function Unavailable({ communityData }) {
  if (!communityData) {
    return (
      <p className="text-[12px] leading-snug text-white/65">
        Waiting for this tract&apos;s analysis; your stores are tested when it loads.
      </p>
    );
  }
  const access = communityData.access;
  const code = access?.reason ?? access?.verdict?.reason;
  // A known baseline with no scenario means the pins themselves were unusable.
  const known = typeof access?.lowAccess === 'boolean';
  const sentence = known ? null : BASELINE_SENTENCE[code];
  const why = known
    ? 'none of your stores has a valid map position'
    : BASELINE_REASON[code] ?? "this tract's baseline test result is unknown";
  return (
    <>
      <Pill status={access?.verdict?.status ?? 'unknown'} />
      <p className="mt-2 text-[12px] leading-snug text-white/65">
        {sentence
          ? <>The before/after recompute isn&apos;t available. {sentence}</>
          : <>The before/after recompute isn&apos;t available because {why}.</>}
      </p>
    </>
  );
}

function NothingCounts({ scenario }) {
  return (
    <>
      <Pill status={scenario.before.verdict.status} />
      <p className="mt-2 text-[12px] leading-snug text-white/65">
        None of your stores count toward USDA&apos;s supermarket-based measure, so the test result can&apos;t change.
        Set a store to &ldquo;Supermarket or supercenter&rdquo; to test it.
      </p>
    </>
  );
}

function PinList({ pins, onSetPinFormat, onRemovePin, onClearPins }) {
  const baseId = useId();
  const headingRef = useRef(null);
  // Where focus goes once the removal re-renders: a pin index or 'heading'.
  const pendingFocusRef = useRef(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const el = target === 'heading' ? headingRef.current : document.getElementById(`${baseId}-pin-${target}`);
    el?.focus();
  }, [pins, baseId]);

  function remove(pin, i) {
    // The list re-indexes after a removal, so the next store takes index i.
    // Removing the only store unmounts the card (TrackerApp handles focus).
    if (pins.length > 1) pendingFocusRef.current = i < pins.length - 1 ? i : 'heading';
    onRemovePin?.(pin.id);
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h4
          ref={headingRef}
          tabIndex={-1}
          className="[font-family:inherit] text-[10px] font-semibold uppercase tracking-wider text-white/60"
        >
          Your stores ({pins.length})
        </h4>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onClearPins?.({ fromCard: true })}
          className="min-h-[40px] rounded-full px-3 text-[11px] font-semibold btn-press"
          style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.75)' }}
        >
          Clear all
        </button>
      </div>
      <ul className="mt-1">
        {pins.map((pin, i) => {
          const info = storeFormatInfo(pin.format);
          const selectId = `${baseId}-pin-${i}`;
          return (
            <li key={pin.id ?? `${pin.lat},${pin.lng},${i}`} className="py-1.5 border-t border-white/5">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="block shrink-0 rounded-full"
                  style={info.counts
                    ? { width: 12, height: 12, background: 'var(--cyan)', border: '2px solid var(--void)' }
                    : { width: 12, height: 12, background: 'transparent', border: '2px solid #9ca3af' }}
                />
                <label htmlFor={selectId} className="shrink-0 text-[11px] text-white/65">
                  Store {i + 1}
                </label>
                <select
                  id={selectId}
                  value={info.code}
                  onChange={(e) => onSetPinFormat?.(pin.id, e.target.value)}
                  className="flex-1 min-w-0 min-h-[40px] rounded-lg px-2 text-[12px] text-white/90"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}
                >
                  {STORE_FORMATS.map((f) => (
                    <option key={f.code} value={f.code}>{f.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(pin, i)}
                  aria-label={`Remove store ${i + 1}`}
                  title={`Remove store ${i + 1}`}
                  className="shrink-0 w-10 h-10 rounded-full text-lg leading-none btn-press"
                  style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.75)' }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              {!info.counts && (
                <p className="mt-1 pl-5 text-[11px] leading-snug text-white/60">{info.note}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Wording checked against the PubMed abstracts on 2026-10-03 (docs/07).
function Cite({ href, children }) {
  return (
    <a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Context() {
  return (
    <details className="mt-2 rounded-lg px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <summary className="cursor-pointer min-h-[36px] flex items-center text-[11px] font-semibold text-white/65">
        Context: jobs and health research (not projections)
      </summary>
      <div className="pb-2 flex flex-col gap-2 text-[11px] leading-snug text-white/60">
        <p>
          <span className="font-semibold text-white/75">Jobs. </span>
          Grocery retailers (NAICS 445110: supermarkets and other grocers) average about 45 employees per
          establishment (<Cite href={CITATIONS.qcew}>BLS QCEW 2025</Cite>). New stores don&apos;t add those jobs one for
          one: a study of Walmart openings found county retail employment fell on net, with each Walmart worker
          replacing about 1.4 others (<Cite href={CITATIONS.neumark}>Neumark, Zhang &amp; Ciccarella 2008</Cite>).
        </p>
        <p>
          <span className="font-semibold text-white/75">Health. </span>
          Philadelphia (<Cite href={CITATIONS.cummins}>Cummins et al. 2014</Cite>): residents saw better food access,
          but fruit-and-vegetable intake and BMI didn&apos;t change. Pittsburgh
          (<Cite href={CITATIONS.dubowitz}>Dubowitz et al. 2015</Cite>): overall diet quality improved and calories and
          added sugars fell compared with a similar neighborhood, though not because people used the new store; BMI
          and fruit-and-vegetable intake didn&apos;t change. Same Pittsburgh study
          (<Cite href={CITATIONS.richardson}>Richardson et al. 2017</Cite>): food insecurity fell (−11.8% relative to
          the comparison neighborhood), with fewer new high-cholesterol and arthritis diagnoses. Bronx
          (<Cite href={CITATIONS.elbel}>Elbel et al. 2015</Cite>): no appreciable change in household food
          availability or children&apos;s diets. This app does not project health outcomes.
        </p>
      </div>
    </details>
  );
}

export default function ScenarioResultCard({
  scenario,
  communityData,
  pins,
  onSetPinFormat,
  onRemovePin,
  onClearPins,
}) {
  if (!Array.isArray(pins) || pins.length === 0) return null;

  const threshold = communityData?.access?.threshold;
  let body;
  if (!scenario) body = <Unavailable communityData={communityData} />;
  else if (scenario.counting === 0) body = <NothingCounts scenario={scenario} />;
  else body = <Impact scenario={scenario} threshold={threshold} reason={communityData?.access?.reason} />;

  return (
    <section
      aria-label="If your stores opened"
      className="rounded-xl p-3"
      style={{
        background: 'color-mix(in srgb, var(--void) 94%, transparent)',
        border: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <h3 className="[font-family:inherit] mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
        If your stores opened · computed
      </h3>
      {body}
      <PinList pins={pins} onSetPinFormat={onSetPinFormat} onRemovePin={onRemovePin} onClearPins={onClearPins} />
      <Context />
    </section>
  );
}
