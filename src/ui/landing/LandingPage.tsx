import { motion } from "framer-motion";
import {
  BarChart3,
  FileText,
  LayoutGrid,
  Satellite,
  Workflow,
} from "lucide-react";
import { RadialOrbitalTimeline, type TimelineItem } from "@/components/ui/radial-orbital-timeline";
import { RulerCarousel, type CarouselItem } from "@/components/ui/ruler-carousel";
import { cn } from "@/lib/utils";
import { SkylineBackdrop } from "./SkylineBackdrop";

const WHY_WE_CARE_ITEMS: CarouselItem[] = [
  {
    id: 1,
    title:
      "Residents in food deserts are 2.5 times more likely to suffer a stroke.",
  },
  {
    id: 2,
    title: 'Families in "dead zones" spend 40% of their income on overpriced groceries.',
  },
  {
    id: 3,
    title: "Life expectancy drops by 15 years for those living 2 miles from a grocer.",
  },
  {
    id: 4,
    title:
      "Over 23.5 million Americans currently live in a government-defined food desert.",
  },
  {
    id: 5,
    title: "Transit to a store takes 45 minutes for residents without local access.",
  },
  {
    id: 6,
    title:
      "Local corner stores offer 90% fewer fresh produce options than supermarkets.",
  },
  {
    id: 7,
    title:
      'Food-insecure children are 90% more likely to be in "poor health" by age three.',
  },
  {
    id: 8,
    title:
      "Small urban retailers mark up staple prices by 37% over national averages.",
  },
  {
    id: 9,
    title: "One new grocery store can reduce local obesity rates by 10% in three years.",
  },
];

type LandingPageProps = {
  onLaunchSimulation: () => void;
  className?: string;
};

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function LandingNav({
  onLaunch,
  className,
}: {
  onLaunch: () => void;
  className?: string;
}) {
  return (
    <motion.nav
      role="navigation"
      aria-label="Landing"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed left-0 right-0 top-0 z-50 px-3 pt-[max(0.65rem,env(safe-area-inset-top))] sm:px-6",
        className
      )}
    >
      <div className="mx-auto flex max-w-[min(1120px,calc(100vw-1.5rem))] flex-row items-center gap-2 rounded-full border border-white/[0.07] bg-[#141923]/90 px-3 py-2.5 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:gap-3 sm:px-5 sm:py-2.5">
        <div className="shrink-0 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
          NutriPlan.AI
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <div className="flex items-center gap-x-3 sm:gap-x-5">
            <button
              type="button"
              onClick={() => scrollToId("why-we-care")}
              className="whitespace-nowrap rounded-full px-3 py-2 text-[13px] text-white/65 transition hover:bg-white/[0.06] hover:text-white"
            >
              Why we care
            </button>
            <button
              type="button"
              onClick={() => scrollToId("features")}
              className="whitespace-nowrap rounded-full px-3 py-2 text-[13px] text-white/65 transition hover:bg-white/[0.06] hover:text-white"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollToId("how-it-works")}
              className="whitespace-nowrap rounded-full px-3 py-2 text-[13px] text-white/65 transition hover:bg-white/[0.06] hover:text-white"
            >
              How it works
            </button>
          </div>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => onLaunch()}
            className="whitespace-nowrap rounded-full bg-gradient-to-r from-cyan-500/90 to-fuchsia-500/85 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60"
          >
            Launch simulation
          </button>
        </div>
      </div>
    </motion.nav>
  );
}

/** Orbital “Features” explorer — ids & relatedIds power node links */
const FEATURES_ORBIT_DATA: TimelineItem[] = [
  {
    id: 1,
    title: "Fused city intelligence",
    date: "Foundation",
    content:
      "Census, mobility, and food-environment signals in one model—so equity isn’t a spreadsheet footnote.",
    category: "Data",
    icon: Satellite,
    relatedIds: [2, 5],
    status: "completed",
    energy: 95,
  },
  {
    id: 2,
    title: "Scenario simulation",
    date: "Live model",
    content:
      "Place groceries, gardens, and mobile markets on the map and see travel-time and access shift in real time.",
    category: "Simulation",
    icon: LayoutGrid,
    relatedIds: [1, 3],
    status: "in-progress",
    energy: 88,
  },
  {
    id: 3,
    title: "Equity & impact metrics",
    date: "Analytics",
    content:
      "Population reached, travel-time deltas, and equity scores side by side—before you commit capital.",
    category: "Metrics",
    icon: BarChart3,
    relatedIds: [2, 4],
    status: "in-progress",
    energy: 78,
  },
  {
    id: 4,
    title: "Policy-ready outputs",
    date: "Delivery",
    content:
      "Impact metrics and narrative briefs your team can take into council packets and grant applications.",
    category: "Reporting",
    icon: FileText,
    relatedIds: [3, 5],
    status: "pending",
    energy: 72,
  },
  {
    id: 5,
    title: "Multi-agent AI pipeline",
    date: "Orchestration",
    content:
      "Data, health, and policy agents coordinated into simulation-ready scenarios and talking points.",
    category: "Agents",
    icon: Workflow,
    relatedIds: [1, 4],
    status: "pending",
    energy: 64,
  },
];

const STEPS = [
  {
    step: "01",
    title: "Define the city",
    body: "Load the urban context and baseline food-access metrics for your study area.",
  },
  {
    step: "02",
    title: "Design interventions",
    body: "Model stores, gardens, and mobile programs where communities need them most.",
  },
  {
    step: "03",
    title: "Compare outcomes",
    body: "Read travel-time, population reached, and equity signals side by side before you commit.",
  },
  {
    step: "04",
    title: "Share the story",
    body: "Export summaries and visuals aligned with public-sector decision timelines.",
  },
] as const;

export function LandingPage({ onLaunchSimulation, className }: LandingPageProps) {
  return (
    <div className={cn("relative bg-[#050816] text-white", className)}>
      <LandingNav onLaunch={onLaunchSimulation} />

      {/* Hero */}
      <section
        className="relative flex min-h-[100dvh] flex-col justify-center px-4 pb-16 pt-[6.5rem] sm:px-8"
        aria-labelledby="landing-hero-heading"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-[#050816]" />
          <SkylineBackdrop />
          {/* Darken top (nav + headline) and bottom; keep mid–lower band readable over skyline */}
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,8,22,0.94)_0%,rgba(5,8,22,0.18)_34%,rgba(5,8,22,0.32)_56%,rgba(5,8,22,0.92)_100%)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -left-1/4 top-1/3 h-[min(60vw,420px)] w-[min(60vw,420px)] rounded-full bg-fuchsia-600/10 blur-[100px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -right-1/4 bottom-1/4 h-[min(50vw,360px)] w-[min(50vw,360px)] rounded-full bg-cyan-500/10 blur-[90px]"
            aria-hidden
          />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-300/80"
          >
            Mission
          </motion.p>
          <motion.h1
            id="landing-hero-heading"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="mt-4 text-balance bg-gradient-to-br from-white via-white to-white/75 bg-clip-text text-3xl font-bold leading-tight text-transparent sm:text-4xl md:text-[2.65rem] md:leading-[1.12]"
          >
            Million lives deserve more than a guess—model food access where it matters.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22 }}
            className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-white/60 sm:text-lg"
          >
            NutriPlan.AI helps cities and public-health teams turn geography into clarity: simulate
            interventions, surface equity tradeoffs, and walk into the room with evidence—not
            anecdotes.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
          >
            <button
              type="button"
              onClick={() => onLaunchSimulation()}
              className="w-full min-w-[200px] rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-8 py-3.5 text-[15px] font-semibold text-white shadow-[0_0_32px_rgba(34,211,238,0.3)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60 sm:w-auto"
            >
              Launch city simulation
            </button>
            <button
              type="button"
              onClick={() => scrollToId("how-it-works")}
              className="w-full rounded-full border border-white/[0.12] bg-white/[0.04] px-8 py-3.5 text-[15px] font-medium text-white/85 transition hover:border-cyan-400/35 hover:bg-white/[0.07] sm:w-auto"
            >
              How it works
            </button>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.5 }}
            className="mt-10 text-[13px] text-white/35"
          >
            Scroll to explore the product
          </motion.p>
        </div>
      </section>

      {/* Why we care — ruler carousel */}
      <section
        id="why-we-care"
        className="scroll-mt-28 border-t border-neutral-900 bg-black px-4 py-16 sm:px-8"
        aria-labelledby="why-we-care-heading"
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-400/80">
              Why we care
            </p>
            <h2
              id="why-we-care-heading"
              className="mt-3 text-balance text-2xl font-bold text-white md:text-3xl"
            >
              The distance between a neighborhood and a grocery store is a public-health signal
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-400">
              Drag the ruler, tap a fact, or use the controls—each figure is a reason simulations
              belong in the room when budgets and land use get decided.
            </p>
          </div>
          <div className="rounded-3xl border border-neutral-800 bg-black px-2 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.85)] md:px-6 md:py-10">
            <RulerCarousel originalItems={WHY_WE_CARE_ITEMS} variant="section" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="scroll-mt-28 border-t border-white/[0.06] bg-gradient-to-b from-[#050816] to-[#080c14] px-4 py-20 sm:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-300/75">
              Features
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white md:text-3xl">
              Built for public decisions at urban scale
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-white/55">
              Everything ties back to one question: who gains access, how fast, and at what cost to
              implement?
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5 }}
            className="mt-10 overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
          >
            <RadialOrbitalTimeline
              variant="section"
              orbitRadius={155}
              timelineData={FEATURES_ORBIT_DATA}
            />
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-28 border-t border-white/[0.06] px-4 py-20 sm:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-fuchsia-300/75">
              How it works
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white md:text-3xl">
              From baseline map to council-ready insight
            </h2>
          </motion.div>
          <ol className="mt-14 grid list-none gap-5 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.step}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ duration: 0.45, delay: i * 0.05 }}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5"
              >
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-fuchsia-500/25 text-sm font-bold tabular-nums text-cyan-100 ring-1 ring-white/[0.08]"
                    aria-hidden
                  >
                    {s.step}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/55">{s.body}</p>
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-white/[0.06] px-4 py-20 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-[#0c1420] to-fuchsia-500/10 px-8 py-12 text-center shadow-[0_0_60px_rgba(34,211,238,0.12)]"
        >
          <h2 className="text-xl font-bold text-white md:text-2xl">Ready to run your first scenario?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/55">
            Open the live simulation workspace—place interventions, watch metrics respond, and stress-test
            before you commit real capital.
          </p>
          <button
            type="button"
            onClick={() => onLaunchSimulation()}
            className="mt-8 rounded-full bg-white px-8 py-3.5 text-[15px] font-semibold text-[#050816] transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
          >
            Launch simulation
          </button>
        </motion.div>
      </section>

      <footer className="border-t border-white/[0.06] px-4 py-10 text-center text-[12px] text-white/35 sm:px-8">
        <p>NutriPlan.AI — urban food access simulation (demo)</p>
      </footer>
    </div>
  );
}
