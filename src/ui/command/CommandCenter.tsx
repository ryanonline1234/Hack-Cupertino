import { DecorativeArcs } from "@/map/DecorativeArcs";
import { FeatureNav } from "@/ui/FeatureNav";
import { GlitchTitle } from "./GlitchTitle";
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
          <div className="absolute inset-0 z-0 h-full w-full overflow-hidden bg-[#050816]">
            <DecorativeArcs />
            <div className="pointer-events-none absolute inset-0 z-[6] bg-gradient-to-b from-[#050816]/70 via-transparent to-[#050816]/50" />
          </div>
          <RippleField className="z-[3]" />
          <ParticleDrift />
        </div>

        <SimulationControlPanel />
      </div>
    </div>
  );
}
