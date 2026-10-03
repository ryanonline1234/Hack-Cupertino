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
 *   onSetPinFormat(id, format), onRemovePin(id), onClearPins()
 */
import { useId } from 'react';
import { STORE_FORMATS, storeFormatInfo } from '../lib/storeFormats';

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

const LINK_CLASS = 'underline decoration-white/30 underline-offset-2 hover:text-white';
const CITATIONS = {
  qcew: 'https://data.bls.gov/cew/apps/table_maker/v4/table_maker.htm#type=2&st=US&year=2025&qtr=A&own=5&ind=445110&supp=0',
  neumark: 'https://econpapers.repec.org/paper/irvwpaper/060711.htm',
  cummins: 'https://pubmed.ncbi.nlm.nih.gov/24493772/',
  dubowitz: 'https://pubmed.ncbi.nlm.nih.gov/26526243/',
  elbel: 'https://pubmed.ncbi.nlm.nih.gov/25714993/',
  richardson: 'https://pubmed.ncbi.nlm.nih.gov/29198367/',
};

// Counts: exact below 100, else about the nearest 10 with "≈".
function fmtCount(n) {
  if (!Number.isFinite(n)) return 'not available';
  const v = Math.max(0, n);
  if (v < 100) return Math.round(v).toLocaleString('en-US');
  return `≈${(Math.round(v / 10) * 10).toLocaleString('en-US')}`;
}

function fmtPct(share) {
  return Number.isFinite(share) ? `${Math.round(share * 100)}%` : 'not available';
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

function trail(beforeStatus, afterStatus) {
  if (beforeStatus === 'met' && afterStatus === 'not_met') return 'Flipped from MEETS TEST';
  if (beforeStatus === 'met' && afterStatus === 'met') return 'Still meets the test';
  if (beforeStatus === 'not_met' && afterStatus === 'not_met') return "Didn't meet the test before either";
  if (beforeStatus === 'unknown' && afterStatus === 'not_met') {
    return "Was UNKNOWN (no ERS 2025 income flag); now not low access, so it doesn't meet the test either way";
  }
  return 'Still UNKNOWN: there is no ERS 2025 income flag for this tract';
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
      <p className="text-[11px] leading-snug text-white/50">{label}</p>
      {children ?? (
        <p className="text-[13px] font-semibold tabular-nums leading-snug">
          <span className="text-white/60">{before}</span>
          <span className="text-white/35" aria-hidden="true"> → </span>
          <span className="sr-only"> becomes </span>
          <span style={{ color: 'var(--cyan)' }}>{after}</span>
        </p>
      )}
    </div>
  );
}

function GapRow({ after, gap, threshold }) {
  const parts = [];
  if (Number.isFinite(gap?.residentsOver)) parts.push(`${fmtCount(gap.residentsOver)} over the 500-resident line`);
  if (Number.isFinite(gap?.shareOverPct)) {
    parts.push(gap.shareOverPct < 1 ? 'under 1 point over 33%' : `${Math.round(gap.shareOverPct)} points over 33%`);
  }
  return (
    <Row label="Still low access">
      <p className="text-[12px] leading-snug text-white/80">
        {fmtCount(after.beyond)} residents still beyond {fmtMi(threshold)}; needs under 500 and under 33%.
      </p>
      {parts.length > 0 && <p className="text-[11px] leading-snug text-white/50">{parts.join(' · ')}</p>}
      {Number.isFinite(gap?.residentsToClear) && (
        <p className="text-[11px] leading-snug text-white/50">
          Bringing {fmtCount(gap.residentsToClear)} more residents within {fmtMi(threshold)} would end low access.
        </p>
      )}
    </Row>
  );
}

function Impact({ scenario, threshold }) {
  const { before, after } = scenario;
  const T = fmtMi(threshold);
  return (
    <>
      <Pill status={after.verdict.status} />
      <p className="mt-1 mb-2 text-center text-[11px] leading-snug text-white/55">
        {trail(before.verdict.status, after.verdict.status)}
      </p>

      <p className="text-[10px] uppercase tracking-wider text-white/40">Before → after (computed)</p>
      <Row
        label={`Residents beyond ${T}`}
        before={`${fmtCount(before.beyond)} (${fmtPct(before.share)})`}
        after={`${fmtCount(after.beyond)} (${fmtPct(after.share)})`}
      />
      <Row label={`Residents brought within ${T}`}>
        <p className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--cyan)' }}>
          {fmtCount(scenario.broughtWithin)}
        </p>
      </Row>
      <Row label="Test result">
        <p className="flex flex-wrap items-center gap-1.5">
          <Pill status={before.verdict.status} size="small" />
          <span className="text-white/35" aria-hidden="true">→</span>
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
        <p className="mt-1.5 text-[11px] leading-snug text-white/45">
          {scenario.nonCounting === 1 ? '1 of your stores doesn’t' : `${scenario.nonCounting} of your stores don’t`} count
          toward the measure, so {scenario.nonCounting === 1 ? 'it is' : 'they are'} left out of these numbers.
        </p>
      )}
      <p className="mt-2 text-[10px] leading-snug text-white/40">
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
  const why = typeof access?.lowAccess === 'boolean'
    ? 'none of your stores has a valid map position'
    : BASELINE_REASON[code] ?? "this tract's baseline test result is unknown";
  return (
    <>
      <Pill status={access?.verdict?.status ?? 'unknown'} />
      <p className="mt-2 text-[12px] leading-snug text-white/65">
        The before/after recompute isn&apos;t available because {why}.
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
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h4 className="[font-family:inherit] text-[10px] font-semibold uppercase tracking-wider text-white/45">
          Your stores ({pins.length})
        </h4>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onClearPins?.()}
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
                  onClick={() => onRemovePin?.(pin.id)}
                  aria-label={`Remove store ${i + 1}`}
                  title={`Remove store ${i + 1}`}
                  className="shrink-0 w-10 h-10 rounded-full text-lg leading-none btn-press"
                  style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.75)' }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              {!info.counts && (
                <p className="mt-1 pl-5 text-[11px] leading-snug text-white/45">{info.note}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
          establishment (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.qcew} target="_blank" rel="noopener noreferrer">BLS QCEW 2025</a>);
          new stores partly shift jobs from existing ones (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.neumark} target="_blank" rel="noopener noreferrer">Neumark, Zhang &amp; Ciccarella 2008</a>).
        </p>
        <p>
          <span className="font-semibold text-white/75">Health. </span>
          No measurable BMI change after new supermarkets in Philadelphia
          (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.cummins} target="_blank" rel="noopener noreferrer">Cummins et al. 2014</a>)
          or Pittsburgh (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.dubowitz} target="_blank" rel="noopener noreferrer">Dubowitz et al. 2015</a>);
          no change in children&apos;s diets in the Bronx
          (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.elbel} target="_blank" rel="noopener noreferrer">Elbel et al. 2015</a>);
          food insecurity fell 11.8% relative to a comparison neighborhood in Pittsburgh
          (<a className={LINK_CLASS} style={{ color: 'var(--cyan)' }} href={CITATIONS.richardson} target="_blank" rel="noopener noreferrer">Richardson et al. 2017</a>).
          This app does not project health outcomes.
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
  else body = <Impact scenario={scenario} threshold={threshold} />;

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
      <h3 className="[font-family:inherit] mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
        If your stores opened · computed
      </h3>
      {body}
      <PinList pins={pins} onSetPinFormat={onSetPinFormat} onRemovePin={onRemovePin} onClearPins={onClearPins} />
      <Context />
    </section>
  );
}
