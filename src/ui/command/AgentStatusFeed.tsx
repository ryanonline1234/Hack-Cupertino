import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const FEED = [
  "> [Agent: DataMiner] Analyzing Tract 42.01...",
  "> [Agent: HealthConsultant] Cross-referencing BMI data...",
  "> [Agent: Architect] Optimal site proposal: 14th & Main...",
  "> [Agent: PolicyBot] HFFI grant window: 18 days remaining...",
  "> [Agent: DataMiner] Heatmap convergence 0.84σ above baseline...",
];

export function AgentStatusFeed({ className }: { className?: string }) {
  const doubled = [...FEED, ...FEED];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-none fixed bottom-6 right-4 z-40 w-[min(100vw-2rem,340px)] sm:right-6",
        className
      )}
    >
      <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-black/55 py-2 pl-3 pr-2 shadow-[0_0_24px_rgba(34,211,238,0.08)] backdrop-blur-md">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-400/45">
          Agent Status Feed
        </div>
        <div className="agent-feed-window relative h-[4.5rem] overflow-hidden text-[11px] leading-relaxed">
          <div className="agent-feed-track font-mono text-cyan-300/90">
            {doubled.map((line, i) => (
              <div key={i} className="whitespace-nowrap py-0.5">
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
