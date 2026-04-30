import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

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
    if (group.current) {
      group.current.rotation.y += delta * 0.08;
    }
  });

  return (
    <group ref={group} rotation={[0.12, 0, 0]}>
      <Sphere args={[1, 96, 96]}>
        <meshStandardMaterial
          map={colorMap}
          color="#9fc5ff"
          roughness={0.28}
          metalness={0.28}
          emissive="#4f9dff"
          emissiveIntensity={0.1}
        />
      </Sphere>
      <Sphere args={[1.04, 48, 48]}>
        <meshBasicMaterial
          color="#89b7ff"
          transparent
          opacity={0.18}
          side={THREE.BackSide}
        />
      </Sphere>
    </group>
  );
}

function EarthFallback() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.1;
  });
  return (
    <Sphere ref={ref} args={[1, 48, 48]}>
      <meshStandardMaterial
        color="#7aaeff"
        roughness={0.3}
        metalness={0.4}
        emissive="#3b82f6"
        emissiveIntensity={0.28}
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
          gl.toneMappingExposure = 1.42;
        }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={["transparent"]} />
        <hemisphereLight args={["#dbeafe", "#1e293b", 0.72]} />
        <ambientLight intensity={0.56} color="#bfdbfe" />
        <directionalLight position={[5, 3, 5]} intensity={2.2} color="#e0f2fe" />
        <directionalLight position={[-4, -1, -2]} intensity={0.74} color="#93c5fd" />
        <pointLight position={[0, 0, 3]} intensity={0.64} color="#dbeafe" />
        <Suspense fallback={<EarthFallback />}>
          <TexturedEarth />
        </Suspense>
      </Canvas>
    </div>
  );
}
