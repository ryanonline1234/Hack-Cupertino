import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { InterventionType } from "@/types";
import { useSimulation } from "@/simulation/SimulationContext";

const TOOLS: { type: InterventionType; label: string; emoji: string }[] = [
  { type: "grocery", label: "Grocery Store", emoji: "🏪" },
  { type: "garden", label: "Community Garden", emoji: "🌱" },
  { type: "mobile", label: "Mobile Market", emoji: "🚚" },
];

export function SimulationControlPanel({ className }: { className?: string }) {
  const { setSelectedType, selectedType } = useSimulation();
  const [hovered, setHovered] = useState<InterventionType | null>(null);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-auto fixed left-4 top-[7.25rem] z-40 w-[min(100vw-2rem,280px)] sm:left-6 sm:top-[7.75rem]",
        className
      )}
    >
      <div
        className="rounded-2xl border border-fuchsia-500/25 p-3 shadow-[0_0_36px_rgba(192,38,211,0.22)] backdrop-blur-xl"
        style={{
          background:
            "linear-gradient(155deg, rgba(24, 10, 32, 0.88) 0%, rgba(12, 8, 20, 0.82) 100%)",
        }}
      >
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-200/55">
          Simulation Control Panel
        </div>
        <div className="flex flex-col gap-2">
          {TOOLS.map((t) => {
            const active = selectedType === t.type;
            const pulse = hovered === t.type && t.type === "grocery";
            return (
              <motion.button
                key={t.type}
                type="button"
                onMouseEnter={() => setHovered(t.type)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelectedType(t.type)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                  active
                    ? "border-fuchsia-400/55 bg-fuchsia-500/15 text-white shadow-[0_0_20px_rgba(217,70,239,0.25)]"
                    : "border-white/[0.06] bg-white/[0.04] text-white/75 hover:border-fuchsia-400/25 hover:bg-white/[0.07]"
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl",
                    pulse && "animate-pulse-soft ring-2 ring-fuchsia-400/60"
                  )}
                >
                  {t.emoji}
                </span>
                <span className="font-medium">{t.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.aside>
  );
}
