import { motion } from "framer-motion";
import { useSimulation } from "../simulation/SimulationContext";

export function MobileHud() {
  const { metrics, interventions, heroMinimized } = useSimulation();
  if (!heroMinimized) return null;

  return (
    <motion.div
      className="pointer-events-none absolute bottom-24 left-4 right-4 z-30 md:hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="glass-panel flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Equity score
          </div>
          <div className="text-2xl font-extrabold text-neon">
            {interventions.length === 0 ? "—" : metrics.equityScore}
            <span className="text-sm font-medium text-white/35">/100</span>
          </div>
        </div>
        <div className="text-right text-[11px] text-white/55">
          Tap map to place
          <br />
          <span className="text-cyanGlow/90">intervention</span>
        </div>
      </div>
    </motion.div>
  );
}
