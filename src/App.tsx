import { Suspense, useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import {
  ParticleTextEffect,
  HERO_PARTICLE_WORDS,
} from "@/components/ui/particle-text-effect";
import { SimulationProvider, useSimulation } from "./simulation/SimulationContext";
import { CityScene } from "./scene/CityScene";
import { CommandCenter } from "./ui/command/CommandCenter";
import { LandingPage } from "./ui/landing/LandingPage";

const CITY_DELAY_MS = 900;

function AppShell() {
  const {
    interventions,
    placeIntervention,
    businessMode,
    cameraPulse,
  } = useSimulation();

  const [showCity, setShowCity] = useState(false);
  const [phase, setPhase] = useState<"intro" | "landing" | "command">("intro");

  useEffect(() => {
    const id = window.setTimeout(() => setShowCity(true), CITY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  const handleTitlePhase = useCallback(() => {
    setPhase("landing");
  }, []);

  return (
    <div className="relative min-h-screen bg-[#050816] text-white">
      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div
            key="intro"
            className="relative min-h-[100dvh] w-full overflow-hidden bg-black"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatePresence>
              {showCity && (
                <motion.div
                  key="city-hero"
                  className="pointer-events-none absolute inset-0 z-0 min-h-[100dvh] w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Canvas
                    className="block h-full min-h-[100dvh] w-full"
                    shadows
                    dpr={[1, 2]}
                    gl={{
                      antialias: true,
                      alpha: false,
                      powerPreference: "high-performance",
                    }}
                    camera={{ position: [13, 11, 13], fov: 46, near: 0.1, far: 200 }}
                  >
                    <Suspense fallback={null}>
                      <CityScene
                        interventions={interventions}
                        onPlace={placeIntervention}
                        mapInteractive={false}
                        businessMode={businessMode}
                        cameraPulse={cameraPulse}
                        transparentBackdrop={false}
                      />
                    </Suspense>
                  </Canvas>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute inset-0 z-10 min-h-[100dvh] w-full">
              <ParticleTextEffect
                words={HERO_PARTICLE_WORDS}
                variant="background"
                showHint={false}
                className="h-full min-h-[100dvh] w-full"
                onTitlePhase={handleTitlePhase}
              />
            </div>

            <button
              type="button"
              onClick={() => setPhase("landing")}
              className="pointer-events-auto fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[60] rounded-full border border-white/[0.12] bg-[#141923]/88 px-4 py-2.5 text-[13px] font-medium text-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl transition hover:border-white/[0.18] hover:bg-[#1a2230]/95 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/55"
              aria-label="Skip intro animation"
            >
              Skip intro
            </button>
          </motion.div>
        )}

        {phase === "landing" && (
          <motion.div
            key="landing"
            className="relative w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          >
            <LandingPage onLaunchSimulation={() => setPhase("command")} />
          </motion.div>
        )}

        {phase === "command" && (
          <motion.div
            key="command"
            className="relative min-h-[100dvh] w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          >
            <CommandCenter />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <SimulationProvider>
      <AppShell />
    </SimulationProvider>
  );
}
