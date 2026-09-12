import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Sphere, Stars } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

/* Motion access: still air for users who asked the OS to reduce motion. */
const REDUCE_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Earth texture (three.js examples mirror, CORS-friendly). */
const EARTH_MAP =
  "https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/textures/planets/earth_atmos_2048.jpg";

function TexturedEarth() {
  const group = useRef<THREE.Group>(null);
  const colorMap = useLoader(THREE.TextureLoader, EARTH_MAP);

  useLayoutEffect(() => {
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;
  }, [colorMap]);

  useFrame((_, delta) => {
    if (group.current && !REDUCE_MOTION) {
      group.current.rotation.y += delta * 0.06;
    }
  });

  return (
    <group ref={group} rotation={[0.18, 0, -0.06]}>
      <Sphere args={[1, 96, 96]}>
        {/* No color tint: the blue wash was hiding the actual Earth texture.
            Rough planet, no metal — cities aren't chrome. */}
        <meshStandardMaterial
          map={colorMap}
          roughness={0.95}
          metalness={0}
        />
      </Sphere>
      {/* Thin atmosphere shell, kept subtle so it rims instead of fogs. */}
      <Sphere args={[1.025, 64, 64]}>
        <meshBasicMaterial
          color="#6cb2ff"
          transparent
          opacity={0.1}
          side={THREE.BackSide}
        />
      </Sphere>
    </group>
  );
}

function EarthFallback() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current && !REDUCE_MOTION) ref.current.rotation.y += delta * 0.1;
  });
  return (
    <Sphere ref={ref} args={[1, 48, 48]}>
      <meshStandardMaterial
        color="#16324f"
        roughness={0.9}
        metalness={0}
        emissive="#0e2237"
        emissiveIntensity={0.4}
      />
    </Sphere>
  );
}

export type GlobeProps = {
  className?: string;
};

function isProbablySafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox/i.test(ua);
}

function hasWebGLContext() {
  if (typeof document === "undefined") return true;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
}

function GlobeCompatibilityFallback({ className }: GlobeProps) {
  return (
    <div className={cn("h-full w-full min-h-[320px]", className)}>
      <div className="relative h-full w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_28%,#dbeafe_0%,#7aaeff_38%,#1d4ed8_72%,#0b1020_100%)]" />
        <div className="absolute inset-[6%] rounded-full border border-white/20" />
        <div className="absolute inset-[12%] rounded-full border border-cyan-200/20" />
      </div>
    </div>
  );
}

export function Globe({ className }: GlobeProps) {
  const [renderMode, setRenderMode] = useState<"webgl" | "compat">("webgl");

  useEffect(() => {
    // Conservative safeguard for browsers/GPUs known to produce unstable WebGL framebuffers.
    if (!hasWebGLContext() || isProbablySafari()) {
      setRenderMode("compat");
    }
  }, []);

  if (renderMode === "compat") {
    return <GlobeCompatibilityFallback className={className} />;
  }

  return (
    <div className={cn("h-full w-full min-h-[320px]", className)}>
      <Canvas
        camera={{ position: [0, 0.15, 2.85], fov: 42 }}
        gl={{
          alpha: true,
          antialias: false,
          powerPreference: "default",
          stencil: false,
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.15;
        }}
        dpr={[1, 1.5]}
      >
        {/* Sun key + cool space fill + faint rim: day/night terminator
            instead of flat studio lighting. */}
        <hemisphereLight args={["#cdd8e6", "#0b1020", 0.45]} />
        <directionalLight position={[5, 2.5, 4]} intensity={2.6} color="#fff2df" />
        <directionalLight position={[-5, -1, -3]} intensity={0.5} color="#7aaeff" />
        <Stars radius={70} depth={30} count={2200} factor={3} saturation={0} fade speed={REDUCE_MOTION ? 0 : 0.5} />
        <Suspense fallback={<EarthFallback />}>
          <TexturedEarth />
        </Suspense>
      </Canvas>
    </div>
  );
}
