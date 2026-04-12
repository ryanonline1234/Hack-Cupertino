import { motion } from "framer-motion";
import type { InterventionType } from "../types";
import { INTERVENTION_META } from "../types";
import { useSimulation } from "../simulation/SimulationContext";

const ORDER: InterventionType[] = ["grocery", "garden", "clinic", "mobile"];

export function InterventionDock() {
  const { selectedType, setSelectedType, heroMinimized } = useSimulation();

  if (!heroMinimized) return null;

  return (
    <motion.div
      className="pointer-events-auto absolute bottom-8 left-1/2 z-30 -translate-x-1/2"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
    >
      <div className="glass-panel flex items-center gap-2 px-2 py-2">
        <span className="hidden pl-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35 sm:inline">
          Place
        </span>
        {ORDER.map((key) => {
          const m = INTERVENTION_META[key];
          const on = selectedType === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedType(key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                on
                  ? "bg-white/[0.12] text-white shadow-neon ring-1 ring-neon/35"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white"
              }`}
              style={{
                boxShadow: on ? `0 0 20px ${m.accent}33` : undefined,
              }}
            >
              <span className="text-lg leading-none">{m.emoji}</span>
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-white/40">
        Click the map to place the selected intervention
      </p>
    </motion.div>
  );
}
