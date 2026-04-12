import { StreetsGlView } from "@/map/StreetsGlView";
import { FeatureNav } from "@/ui/FeatureNav";
import { AgentStatusFeed } from "./AgentStatusFeed";
import { GlitchTitle } from "./GlitchTitle";
import { LiveMetricsDashboard } from "./LiveMetricsDashboard";
import { ParticleDrift } from "./ParticleDrift";
import { RippleField } from "./RippleField";
import { SimulationControlPanel } from "./SimulationControlPanel";

export function CommandCenter() {
  return (
    <div className="relative min-h-[100dvh] bg-[#050816] text-white">
      <FeatureNav variant="dashboard" activeId="simulation" />

      <div className="flex min-h-[100dvh] flex-col pt-[4.75rem] sm:pt-[5rem]">
        <GlitchTitle className="pb-3" />

        <div className="relative min-h-0 w-full flex-1" style={{ minHeight: "min(72vh, calc(100dvh - 11rem))" }}>
          <StreetsGlView className="absolute inset-0 h-full w-full" />
          <RippleField className="z-[3]" />
          <ParticleDrift />
        </div>

        <SimulationControlPanel />
        <LiveMetricsDashboard />
        <AgentStatusFeed />
      </div>
    </div>
  );
}
