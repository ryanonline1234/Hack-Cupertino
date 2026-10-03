/*
 * ActionPlan: the rules-based checklist of docs/08 §2, rendered under the
 * References block when the tract's verdict is known. Items come from
 * buildActionPlan (src/engine/actionPlan.js): fixed titles and actions, a
 * `why` that quotes only this tract's computed numbers, and links that were
 * verified against the official pages. No model, no fetch. TrackerApp
 * recomputes the items whenever the placed stores or the suggestions change.
 *
 * Props: items ([{ id, title, why, action, sources: [{ name, url }] }]);
 * renders nothing when empty.
 */
import { PLAN_FOOTER, PLAN_TITLE } from '../engine/actionPlan';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--cyan)]';

const ACTION_PLAN_HEADING_ID = 'fds-action-plan-heading';

export default function ActionPlan({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <section
      aria-labelledby={ACTION_PLAN_HEADING_ID}
      className="mb-3 rounded-lg px-3 py-2.5"
      style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}
    >
      <h3
        id={ACTION_PLAN_HEADING_ID}
        className="[font-family:inherit] text-[11px] font-semibold uppercase tracking-wider text-white/65"
      >
        {PLAN_TITLE}
      </h3>
      <ol className="mt-1">
        {items.map((item, i) => (
          <li key={item.id} className="py-2 border-t border-white/5 first:border-t-0">
            <h4 className="[font-family:inherit] text-[12px] font-semibold leading-snug text-white/90">
              <span className="tabular-nums text-white/60">{i + 1}. </span>
              {item.title}
            </h4>
            <p className="mt-1 text-[11px] leading-snug text-white/70">
              <span className="font-semibold text-white/75">Why: </span>
              {item.why}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-white/85">
              <span className="font-semibold">Action: </span>
              {item.action}
            </p>
            {item.sources.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] leading-snug">
                {item.sources.map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`underline decoration-white/30 underline-offset-2 rounded hover:text-white ${FOCUS_RING}`}
                      style={{ color: 'var(--cyan)' }}
                    >
                      {s.name}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[10px] leading-snug text-white/60">{PLAN_FOOTER}</p>
    </section>
  );
}
