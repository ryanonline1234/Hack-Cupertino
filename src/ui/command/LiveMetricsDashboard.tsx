import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSimulation } from "@/simulation/SimulationContext";

function useDrift(base: number, spread = 0.35) {
  const [v, setV] = useState(base);
  useEffect(() => {
    const id = window.setInterval(() => {
      setV(base + (Math.random() - 0.5) * spread);
    }, 2200);
    return () => window.clearInterval(id);
  }, [base, spread]);
  return v;
}

export function LiveMetricsDashboard({ className }: { className?: string }) {
  const { metrics, interventions } = useSimulation();

  const savingsBase = interventions.length ? metrics.healthcareSavingsUsd / 1e6 : 2.1;
  const accessBase = interventions.length ? metrics.travelTimeReductionPct : 41;
  const grantBase = interventions.length ? Math.min(100, metrics.equityScore + 6) : 92;

  const savingsDrift = useDrift(savingsBase, 0.04);
  const accessDrift = useDrift(accessBase, 0.8);
  const grantDrift = useDrift(grantBase, 0.4);

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-auto fixed right-4 top-[7.25rem] z-40 w-[min(100vw-2rem,300px)] sm:right-6 sm:top-[7.75rem]",
        className
      )}
    >
      <div className="glass-panel border-emerald-500/15 p-4 shadow-[0_0_32px_rgba(16,185,129,0.12)]">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/50">
          Live Metrics Dashboard
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[11px] text-white/45">Projected Healthcare Savings</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-300 text-glow-metric">
              ${savingsDrift.toFixed(1)}M{" "}
              <span className="text-xs font-normal text-white/40">(5-yr)</span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-white/45">Food Access Improvement</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-300 text-glow-metric">
              {accessDrift.toFixed(0)}%
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-white/45">Grant Eligibility</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-300 text-glow-metric">
              {grantDrift.toFixed(0)}% <span className="text-xs font-normal text-white/40">(HFFI)</span>
            </dd>
          </div>
        </dl>
      </div>
    </motion.div>
  );
}
