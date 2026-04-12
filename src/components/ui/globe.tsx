import { Suspense, useLayoutEffect, useRef } from "react";
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
          color="#eef2f7"
          roughness={0.28}
          metalness={0.28}
          emissive="#fff8ed"
          emissiveIntensity={0.06}
        />
      </Sphere>
      <Sphere args={[1.04, 48, 48]}>
        <meshBasicMaterial
          color="#fef3c7"
          transparent
          opacity={0.14}
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
        color="#d4d4d8"
        roughness={0.3}
        metalness={0.4}
        emissive="#fef3c7"
        emissiveIntensity={0.18}
      />
    </Sphere>
  );
}

export type GlobeProps = {
  className?: string;
};

export function Globe({ className }: GlobeProps) {
  return (
    <div className={cn("h-full w-full min-h-[320px]", className)}>
      <Canvas
        camera={{ position: [0, 0.15, 2.85], fov: 42 }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.42;
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["transparent"]} />
        <hemisphereLight args={["#ffffff", "#3f3f46", 0.68]} />
        <ambientLight intensity={0.52} color="#f4f4f5" />
        <directionalLight position={[5, 3, 5]} intensity={2.15} color="#ffffff" />
        <directionalLight position={[-4, -1, -2]} intensity={0.72} color="#fde68a" />
        <pointLight position={[0, 0, 3]} intensity={0.62} color="#fffbeb" />
        <Suspense fallback={<EarthFallback />}>
          <TexturedEarth />
        </Suspense>
      </Canvas>
    </div>
  );
}
