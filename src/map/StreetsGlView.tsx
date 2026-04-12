import { cn } from "@/lib/utils";
import { DecorativeArcs } from "./DecorativeArcs";

/**
 * Streets.GL — WebGL2 OSM 3D renderer (https://github.com/StrandedKitty/streets-gl).
 * Embedded via iframe; camera hash format: lat,lon,pitch°,yaw°,distanceMeters
 */
const CHICAGO_SOUTH_SIDE =
  "41.7730,-87.6320,52.0,-32.0,1050";

const DEFAULT_ORIGIN = "https://streets-gl.pages.dev";

type Props = {
  className?: string;
};

export function StreetsGlView({ className }: Props) {
  const origin = import.meta.env.VITE_STREETS_GL_URL ?? DEFAULT_ORIGIN;
  const base = origin.replace(/\/$/, "");
  const src = `${base}/#${CHICAGO_SOUTH_SIDE}`;

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden bg-[#050816]",
        className
      )}
    >
      <iframe
        title="Streets.GL — OpenStreetMap 3D (Chicago)"
        src={src}
        className="absolute inset-0 z-0 h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share; xr-spatial-tracking"
      />
      <div className="pointer-events-none absolute inset-0 z-[6] bg-gradient-to-b from-[#050816]/70 via-transparent to-[#050816]/50" />
      <DecorativeArcs />
    </div>
  );
}
