import { motion } from "framer-motion";
import { useSimulation } from "../simulation/SimulationContext";

const nodes = [
  {
    id: "data",
    title: "Data Agent",
    subtitle: "Census + GIS fusion",
    icon: "🛰️",
  },
  {
    id: "health",
    title: "Health Agent",
    subtitle: "Disease risk modeling",
    icon: "🫀",
  },
  {
    id: "policy",
    title: "Policy Agent",
    subtitle: "Drafts city recommendations",
    icon: "⚖️",
  },
] as const;

export function AgentPipeline() {
  const { heroMinimized } = useSimulation();
  if (!heroMinimized) return null;

  return (
    <section className="relative z-20 border-t border-white/[0.06] bg-gradient-to-b from-void to-slate px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyanGlow/80">
            Multi-agent system
          </div>
          <h2 className="mt-3 text-2xl font-bold text-white md:text-3xl">
            From raw city data to actionable policy
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/55">
            A coordinated pipeline that turns heterogeneous urban signals into
            simulation-ready scenarios—built for the gravity of public-sector
            decisions.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {nodes.map((n, i) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08 }}
              className="glass-panel relative overflow-hidden p-6"
            >
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-neon/10 blur-2xl" />
              <div className="text-3xl">{n.icon}</div>
              <h3 className="mt-4 text-lg font-bold text-white">{n.title}</h3>
              <p className="mt-1 text-sm text-white/50">{n.subtitle}</p>
              {i < nodes.length - 1 && (
                <div
                  className="pointer-events-none absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-gradient-to-r from-neon/40 to-transparent md:block"
                  aria-hidden
                />
              )}
            </motion.div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3 text-[11px] text-white/35">
          <span className="rounded-full border border-white/10 px-3 py-1">
            Ingest
          </span>
          <span aria-hidden className="text-neon/50">
            →
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">
            Model
          </span>
          <span aria-hidden className="text-neon/50">
            →
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">
            Simulate
          </span>
          <span aria-hidden className="text-neon/50">
            →
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">
            Recommend
          </span>
        </div>
      </div>
    </section>
  );
}
