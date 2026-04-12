import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Intervention, InterventionType } from "../types";

export type SimulationMetrics = {
  populationImpacted: number;
  travelTimeReductionPct: number;
  healthcareSavingsUsd: number;
  diabetesRiskReductionPct: number;
  obesityRiskReductionPct: number;
  equityScore: number;
  insight: string;
};

type SimulationState = {
  interventions: Intervention[];
  selectedType: InterventionType;
  hasLaunched: boolean;
  heroMinimized: boolean;
  cameraPulse: number;
  businessMode: boolean;
  setSelectedType: (t: InterventionType) => void;
  placeIntervention: (x: number, z: number) => void;
  launch: () => void;
  loadDemoCity: () => void;
  setBusinessMode: (v: boolean) => void;
  pulseCamera: () => void;
  clearInterventions: () => void;
  metrics: SimulationMetrics;
};

const SimulationContext = createContext<SimulationState | null>(null);

function hashInsight(n: number): string {
  const snippets = [
    "This intervention significantly improves food access within a high-risk zone previously classified as a severe food desert.",
    "Modeled travel times to fresh food drop sharply; equity gains concentrate among households without vehicle access.",
    "Projected chronic disease burden falls as dietary quality improves—largest effect in census tracts with elevated baseline risk.",
    "The placement creates a viable catchment that overlaps multiple underserved block groups while preserving fiscal sustainability.",
  ];
  return snippets[n % snippets.length];
}

function computeMetrics(interventions: Intervention[]): SimulationMetrics {
  const n = interventions.length;
  if (n === 0) {
    return {
      populationImpacted: 0,
      travelTimeReductionPct: 0,
      healthcareSavingsUsd: 0,
      diabetesRiskReductionPct: 0,
      obesityRiskReductionPct: 0,
      equityScore: 0,
      insight:
        "Awaiting intervention placement. Click the map to model grocery, garden, or clinic access.",
    };
  }
  const basePop = 8420;
  const populationImpacted = Math.round(basePop + n * 1180 + n * n * 42);
  const travelTimeReductionPct = Math.min(48, 9 + n * 6.2 + (n > 2 ? 4 : 0));
  const healthcareSavingsUsd = Math.round(1850000 + n * 420000 + n * n * 55000);
  const diabetesRiskReductionPct = Math.min(35, 4 + n * 3.1);
  const obesityRiskReductionPct = Math.min(28, 3 + n * 2.4);
  const equityScore = Math.min(
    100,
    Math.round(28 + n * 14 + (n >= 3 ? 12 : 0) + (n >= 1 ? 6 : 0))
  );

  return {
    populationImpacted,
    travelTimeReductionPct,
    healthcareSavingsUsd,
    diabetesRiskReductionPct,
    obesityRiskReductionPct,
    equityScore,
    insight: hashInsight(n),
  };
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [selectedType, setSelectedType] =
    useState<InterventionType>("grocery");
  const [hasLaunched, setHasLaunched] = useState(true);
  const [heroMinimized, setHeroMinimized] = useState(true);
  const [cameraPulse, setCameraPulse] = useState(0);
  const [businessMode, setBusinessMode] = useState(false);

  const metrics = useMemo(
    () => computeMetrics(interventions),
    [interventions]
  );

  const placeIntervention = useCallback(
    (x: number, z: number) => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      setInterventions((prev) => [
        ...prev,
        {
          id,
          type: selectedType,
          x,
          z,
          placedAt: performance.now(),
        },
      ]);
    },
    [selectedType]
  );

  const launch = useCallback(() => {
    setHasLaunched(true);
    setHeroMinimized(true);
    setCameraPulse((p) => p + 1);
  }, []);

  const loadDemoCity = useCallback(() => {
    setHasLaunched(true);
    setHeroMinimized(true);
    setInterventions([
      {
        id: "demo-1",
        type: "grocery",
        x: -2.5,
        z: 1.2,
        placedAt: performance.now(),
      },
      {
        id: "demo-2",
        type: "garden",
        x: 3.1,
        z: -2.0,
        placedAt: performance.now(),
      },
    ]);
    setCameraPulse((p) => p + 1);
  }, []);

  const pulseCamera = useCallback(() => {
    setCameraPulse((p) => p + 1);
  }, []);

  const clearInterventions = useCallback(() => setInterventions([]), []);

  const value = useMemo(
    () => ({
      interventions,
      selectedType,
      hasLaunched,
      heroMinimized,
      cameraPulse,
      businessMode,
      setSelectedType,
      placeIntervention,
      launch,
      loadDemoCity,
      setBusinessMode,
      pulseCamera,
      clearInterventions,
      metrics,
    }),
    [
      interventions,
      selectedType,
      hasLaunched,
      heroMinimized,
      cameraPulse,
      businessMode,
      placeIntervention,
      launch,
      loadDemoCity,
      pulseCamera,
      clearInterventions,
      metrics,
    ]
  );

  return (
    <SimulationContext.Provider value={value}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
}
