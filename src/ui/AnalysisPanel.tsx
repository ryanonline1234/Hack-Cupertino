import { motion } from "framer-motion";
import { useSimulation } from "../simulation/SimulationContext";

function formatUsd(n: number) {
  if (n <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function AnalysisPanel() {
  const { metrics, interventions, heroMinimized } = useSimulation();
  const active = heroMinimized;

  if (!active) return null;

  return (
    <motion.aside
      className="pointer-events-auto absolute bottom-8 right-6 top-28 z-30 hidden w-[min(100%,380px)] flex-col md:flex"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="glass-panel flex h-full flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
              AI simulation output
            </div>
            <h2 className="mt-1 text-lg font-bold text-white">Impact model</h2>
          </div>
          <div className="rounded-lg border border-neon/25 bg-neon/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neon">
            Live
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-black/30 p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">
            Equity impact score
          </div>
          <div className="mt-2 flex items-end gap-2">
            <motion.span
              key={metrics.equityScore}
              className="text-5xl font-extrabold tabular-nums text-neon"
              initial={{ scale: 1.08, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 18 }}
            >
              {metrics.equityScore}
            </motion.span>
            <span className="pb-2 text-lg font-medium text-white/35">/ 100</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-cyanGlow to-neon"
              initial={false}
              animate={{ width: `${metrics.equityScore}%` }}
              transition={{ type: "spring", stiffness: 80, damping: 20 }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <dt className="text-[10px] uppercase tracking-wider text-white/40">
              Population impacted
            </dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {interventions.length === 0
                ? "—"
                : metrics.populationImpacted.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <dt className="text-[10px] uppercase tracking-wider text-white/40">
              Travel time −%
            </dt>
            <dd className="mt-1 font-semibold tabular-nums text-cyanGlow">
              {interventions.length === 0
                ? "—"
                : `${metrics.travelTimeReductionPct.toFixed(1)}%`}
            </dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <dt className="text-[10px] uppercase tracking-wider text-white/40">
              Est. healthcare savings
            </dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {formatUsd(metrics.healthcareSavingsUsd)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <dt className="text-[10px] uppercase tracking-wider text-white/40">
              Risk ↓ diabetes / obesity
            </dt>
            <dd className="mt-1 text-sm font-semibold text-white">
              {interventions.length === 0 ? (
                "—"
              ) : (
                <>
                  {metrics.diabetesRiskReductionPct.toFixed(1)}% /{" "}
                  {metrics.obesityRiskReductionPct.toFixed(1)}%
                </>
              )}
            </dd>
          </div>
        </dl>

        <div className="rounded-xl border border-cyanGlow/15 bg-cyanGlow/[0.06] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyanGlow/80">
            Insight summary
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            {metrics.insight}
          </p>
        </div>
      </div>
    </motion.aside>
  );
}
