import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const FEATURE_NAV_ITEMS = [
  { id: "simulation", label: "City simulation" },
  { id: "analysis", label: "Impact analysis" },
  { id: "interventions", label: "Interventions" },
  { id: "tools", label: "Tools & reports" },
  { id: "agent", label: "AI agent" },
] as const;

export type FeatureNavId = (typeof FEATURE_NAV_ITEMS)[number]["id"];

type FeatureNavProps = {
  className?: string;
  /** Command center: pill banner + active tab ring (reference layout) */
  variant?: "overlay" | "dashboard";
  activeId?: FeatureNavId;
};

export function FeatureNav({
  className,
  variant = "overlay",
  activeId = "simulation",
}: FeatureNavProps) {
  const dashboard = variant === "dashboard";

  return (
    <motion.nav
      role="navigation"
      aria-label="Main"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-auto left-0 right-0 top-0 z-50 px-3 pt-[max(0.65rem,env(safe-area-inset-top))] sm:px-6",
        dashboard ? "fixed" : "absolute",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-[min(1120px,calc(100vw-1.5rem))] flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2",
          dashboard
            ? "rounded-full border border-white/[0.07] bg-[#141923]/90 py-2.5 pl-4 pr-2 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:pl-6 sm:pr-3"
            : "glass-panel py-2 pl-2 pr-2 sm:py-2"
        )}
      >
        <div
          className={cn(
            "shrink-0 px-1 font-semibold uppercase tracking-[0.2em]",
            dashboard ? "text-[11px] text-white" : "text-[11px] text-white/40"
          )}
        >
          NUTRIPLAN.AI
        </div>
        <ul className="flex min-w-0 flex-1 list-none flex-row items-center justify-end gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:gap-1 [&::-webkit-scrollbar]:hidden">
          {FEATURE_NAV_ITEMS.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-2 text-left text-[13px] transition",
                    dashboard && active
                      ? "bg-white/[0.06] text-white ring-1 ring-cyan-400/45"
                      : dashboard
                        ? "text-white/65 hover:bg-white/[0.06] hover:text-white"
                        : "rounded-xl text-white/75 hover:bg-white/[0.07] hover:text-white",
                    !dashboard &&
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/50"
                  )}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.nav>
  );
}
