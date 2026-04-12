import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, FileText, Heart, Layers, LayoutGrid, ListOrdered, Satellite, Workflow } from "lucide-react";
import { HorizontalMenuBar } from "@/components/ui/horizontal-menu-bar";
import { RadialOrbitalTimeline, type TimelineItem } from "@/components/ui/radial-orbital-timeline";
import { Globe } from "@/components/ui/globe";
import { RulerCarousel, type CarouselItem } from "@/components/ui/ruler-carousel";
import { cn } from "@/lib/utils";

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

const HERO_POINTS = [
  "Census, mobility, and food environment in one model.",
  "Interventions on the map with before/after access outcomes.",
  "Outputs you can reference in budgets, grants, and briefings.",
] as const;

/** Nav height band (px): when #why-we-care crosses here, hero is done */
const NAV_HIDE_TOP = 80;

export function LandingPage({ onLaunchSimulation, className }: LandingPageProps) {
  const [navVisible, setNavVisible] = useState(true);
  const navRaf = useRef(0);

  useLayoutEffect(() => {
    const updateNav = () => {
      const next = document.getElementById("why-we-care");
      if (!next) return;
      // Hero can be taller than one viewport (min-h + content). Use the next section
      // as the sentinel: hide the bar once "Why we care" reaches the top band.
      setNavVisible(next.getBoundingClientRect().top > NAV_HIDE_TOP);
    };

    const scheduleNav = () => {
      cancelAnimationFrame(navRaf.current);
      navRaf.current = requestAnimationFrame(updateNav);
    };

    updateNav();

    const scrollOpts = { passive: true, capture: true } as const;
    window.addEventListener("scroll", scheduleNav, scrollOpts);
    document.addEventListener("scroll", scheduleNav, scrollOpts);
    const scrollingEl = document.scrollingElement;
    scrollingEl?.addEventListener("scroll", scheduleNav, scrollOpts);
    window.addEventListener("resize", updateNav);

    const vv = window.visualViewport;
    vv?.addEventListener("scroll", scheduleNav);
    vv?.addEventListener("resize", updateNav);

    return () => {
      cancelAnimationFrame(navRaf.current);
      window.removeEventListener("scroll", scheduleNav, true);
      document.removeEventListener("scroll", scheduleNav, true);
      scrollingEl?.removeEventListener("scroll", scheduleNav, true);
      window.removeEventListener("resize", updateNav);
      vv?.removeEventListener("scroll", scheduleNav);
      vv?.removeEventListener("resize", updateNav);
    };
  }, []);

  return (
    <div className={cn("relative bg-neutral-950 text-neutral-100", className)}>
      <AnimatePresence>
        {navVisible && (
          <motion.div
            key="landing-top-nav"
            className="fixed left-0 right-0 top-0 z-50 pt-[max(0.65rem,env(safe-area-inset-top))]"
            initial={false}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ pointerEvents: "auto" }}
          >
            <HorizontalMenuBar
              fixed={false}
              siteName="NutriPlan.AI"
              items={[
                {
                  label: "Why we care",
                  icon: <Heart className="h-4 w-4 shrink-0" aria-hidden />,
                  onSelect: () => scrollToId("why-we-care"),
                },
                {
                  label: "Features",
                  icon: <Layers className="h-4 w-4 shrink-0" aria-hidden />,
                  onSelect: () => scrollToId("features"),
                },
                {
                  label: "How it works",
                  icon: <ListOrdered className="h-4 w-4 shrink-0" aria-hidden />,
                  onSelect: () => scrollToId("how-it-works"),
                },
              ]}
              ctaLabel="Launch simulation"
              onCtaClick={onLaunchSimulation}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero — copy left, globe right */}
      <section
        className="relative flex min-h-[100dvh] flex-col justify-center overflow-hidden px-4 pb-20 pt-[6.25rem] sm:px-8 sm:pb-24 sm:pt-[6.75rem]"
        aria-labelledby="landing-hero-heading"
      >
        <div className="pointer-events-none absolute inset-0 bg-black" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_90%_at_15%_45%,rgba(0,0,0,0.88)_0%,transparent_58%)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/25 lg:via-black/55 lg:to-transparent"
          aria-hidden
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[min(38vh,280px)] overflow-hidden lg:inset-y-0 lg:left-auto lg:right-0 lg:top-0 lg:w-[58%] xl:w-[54%]">
          <div className="absolute inset-x-0 bottom-[-10%] top-0 lg:inset-[4%_-8%_4%_0]">
            <Globe />
          </div>
          <div
            className="absolute inset-0 bg-gradient-to-l from-black/25 via-black/45 to-black lg:from-transparent lg:via-black/30 lg:to-black/90"
            aria-hidden
          />
          <div
            className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_72%_48%,transparent_18%,rgba(0,0,0,0.45)_100%)]"
            aria-hidden
          />
        </div>

        <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-10 xl:gap-16">
          <div className="max-w-xl text-left">
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05 }}
              className="text-sm text-neutral-500"
            >
              Food access simulation
            </motion.p>
            <motion.h1
              id="landing-hero-heading"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 }}
              className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-4xl md:text-[2.35rem] lg:text-[2.5rem]"
            >
              Million lives deserve more than a guess—model food access where it matters.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.14 }}
              className="mt-5 max-w-lg text-pretty text-base leading-relaxed text-neutral-400 sm:text-[1.05rem]"
            >
              NutriPlan.AI helps cities and public-health teams turn geography into clarity: simulate
              interventions, surface equity tradeoffs, and walk into the room with evidence—not
              anecdotes.
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.2 }}
              className="mt-8 space-y-2.5 border-l border-neutral-800 pl-4 text-sm leading-relaxed text-neutral-500"
              aria-label="Product summary"
            >
              {HERO_POINTS.map((line) => (
                <li key={line} className="pl-1">
                  {line}
                </li>
              ))}
            </motion.ul>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.26 }}
              className="mt-10 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
            >
              <button
                type="button"
                onClick={() => onLaunchSimulation()}
                className="w-full min-w-[180px] rounded-md bg-white px-6 py-2.5 text-[14px] font-medium text-neutral-950 transition hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 sm:w-auto"
              >
                Launch city simulation
              </button>
              <button
                type="button"
                onClick={() => scrollToId("how-it-works")}
                className="w-full rounded-md border border-neutral-600 bg-transparent px-6 py-2.5 text-[14px] font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-white/[0.04] sm:w-auto"
              >
                How it works
              </button>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.32 }}
              className="mt-8 text-[13px] text-neutral-600"
            >
              Scroll to explore — or go to{" "}
              <button
                type="button"
                onClick={() => scrollToId("features")}
                className="text-neutral-300 underline decoration-neutral-600 underline-offset-[5px] transition hover:text-white hover:decoration-neutral-400"
              >
                Features
              </button>
            </motion.p>
          </div>

          {/* Reserves space on small screens so the absolute globe sits in-frame */}
          <div
            className="min-h-[min(44vh,300px)] max-lg:min-h-[min(48vh,340px)] lg:min-h-[min(64vh,560px)]"
            aria-hidden
          />
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
            <p className="text-sm text-neutral-500">Why we care</p>
            <h2
              id="why-we-care-heading"
              className="mt-2 text-balance text-2xl font-semibold tracking-tight text-white md:text-3xl"
            >
              The distance between a neighborhood and a grocery store is a public-health signal
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-400">
              Drag the ruler, tap a fact, or use the controls—each figure is a reason simulations
              belong in the room when budgets and land use get decided.
            </p>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-8 md:px-6 md:py-10">
            <RulerCarousel originalItems={WHY_WE_CARE_ITEMS} variant="section" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="scroll-mt-28 border-t border-neutral-900 bg-neutral-950 px-4 py-20 sm:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <p className="text-sm text-neutral-500">Features</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Built for public decisions at urban scale
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-400">
              Everything ties back to one question: who gains access, how fast, and at what cost to
              implement?
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5 }}
            className="mt-10 overflow-hidden rounded-lg border border-neutral-800"
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
        className="scroll-mt-28 border-t border-neutral-900 px-4 py-20 sm:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <p className="text-sm text-neutral-500">How it works</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
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
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
              >
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-neutral-700 bg-neutral-800 text-xs font-medium tabular-nums text-neutral-400"
                    aria-hidden
                  >
                    {s.step}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-medium text-neutral-100">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-400">{s.body}</p>
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-neutral-900 px-4 py-20 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mx-auto max-w-2xl rounded-lg border border-neutral-800 bg-neutral-900/50 px-8 py-10 text-center"
        >
          <h2 className="text-lg font-semibold text-white md:text-xl">Ready to run your first scenario?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
            Open the live simulation workspace—place interventions, watch metrics respond, and stress-test
            before you commit real capital.
          </p>
          <button
            type="button"
            onClick={() => onLaunchSimulation()}
            className="mt-7 rounded-md bg-white px-6 py-2.5 text-[14px] font-medium text-neutral-950 transition hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            Launch simulation
          </button>
        </motion.div>
      </section>

      <footer className="border-t border-neutral-900 px-4 py-10 text-center text-[12px] text-neutral-600 sm:px-8">
        <p>NutriPlan.AI — urban food access simulation (demo)</p>
      </footer>
    </div>
  );
}
