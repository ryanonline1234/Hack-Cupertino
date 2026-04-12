import { useFrame, useThree } from "@react-three/fiber";
import {
  Line,
  MapControls,
  Instances,
  Instance,
  Float,
  Sparkles,
} from "@react-three/drei";
import { useMemo, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { heatFragmentShader, heatVertexShader } from "./heatmapShader";
import { WebglBackdrop } from "./WebglBackdrop";
import type { Intervention } from "../types";
import { INTERVENTION_META } from "../types";

const GRID = 18;
const HEAT_PLANE_Y = 0.02;

type Building = {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

function generateBuildings(seed: number): Building[] {
  const out: Building[] = [];
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let gx = -7; gx <= 7; gx++) {
    for (let gz = -7; gz <= 7; gz++) {
      if (Math.abs(gx) + Math.abs(gz) < 2 && rnd() > 0.4) continue;
      const h = 0.8 + rnd() * 4.5;
      const w = 0.35 + rnd() * 0.45;
      const d = 0.35 + rnd() * 0.45;
      const jx = (rnd() - 0.5) * 0.35;
      const jz = (rnd() - 0.5) * 0.35;
      out.push({
        x: gx + jx,
        z: gz + jz,
        w,
        h,
        d,
      });
    }
  }
  return out;
}

function HeatmapPlane({
  interventions,
  businessMode,
}: {
  interventions: Intervention[];
  businessMode: boolean;
}) {
  const mat = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uInterventions: {
        value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)),
      },
      uCount: { value: 0 },
      uBusinessMode: { value: false },
    }),
    []
  );

  useFrame((state) => {
    if (!mat.current) return;
    mat.current.uniforms.uTime.value = state.clock.elapsedTime;
    mat.current.uniforms.uBusinessMode.value = businessMode;
    const arr = mat.current.uniforms.uInterventions.value as THREE.Vector4[];
    let c = 0;
    for (const inv of interventions) {
      if (c >= 16) break;
      const radius =
        inv.type === "grocery"
          ? 5.2
          : inv.type === "garden"
            ? 3.8
            : inv.type === "mobile"
              ? 4.2
              : 4.4;
      const strength =
        inv.type === "grocery"
          ? 0.95
          : inv.type === "garden"
            ? 0.65
            : inv.type === "mobile"
              ? 0.72
              : 0.78;
      arr[c].set(inv.x, inv.z, radius, strength);
      c++;
    }
    mat.current.uniforms.uCount.value = c;
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, HEAT_PLANE_Y, 0]}
      userData={{ ground: true }}
    >
      <planeGeometry args={[GRID, GRID, 1, 1]} />
      <shaderMaterial
        ref={mat}
        vertexShader={heatVertexShader}
        fragmentShader={heatFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

function Ripple({
  x,
  z,
  color,
  delay = 0,
}: {
  x: number;
  z: number;
  color: string;
  delay?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!mesh.current) return;
    const t = Math.max(0, state.clock.elapsedTime - delay);
    const cycle = (t % 2.5) / 2.5;
    const s = 0.5 + cycle * 8;
    mesh.current.scale.setScalar(s);
    const m = mesh.current.material as THREE.MeshBasicMaterial;
    m.opacity = 0.45 * (1 - cycle);
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.08, z]}>
      <ringGeometry args={[0.92, 1, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.4}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function InterventionMarker({
  inv,
}: {
  inv: Intervention;
}) {
  const meta = INTERVENTION_META[inv.type];
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.position.y = 0.35 + Math.sin(t * 2 + inv.x) * 0.06;
  });
  return (
    <group ref={group} position={[inv.x, 0, inv.z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.12, 0.18, 0.5, 16]} />
        <meshStandardMaterial
          color={meta.accent}
          emissive={meta.accent}
          emissiveIntensity={0.6}
          metalness={0.3}
          roughness={0.35}
        />
      </mesh>
      <pointLight color={meta.accent} intensity={1.2} distance={4} decay={2} />
    </group>
  );
}

function TravelLines({ interventions }: { interventions: Intervention[] }) {
  const lines = useMemo(() => {
    return interventions.flatMap((inv) => {
      const meta = INTERVENTION_META[inv.type];
      const segs: [number, number, number][][] = [];
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + inv.x;
        const r = 2.5 + (i % 3) * 0.8;
        const hx = inv.x + Math.cos(ang) * r;
        const hz = inv.z + Math.sin(ang) * r;
        segs.push([
          [hx, 0.25, hz],
          [inv.x, 0.4, inv.z],
        ]);
      }
      return segs.map((pts) => ({ pts, color: meta.accent }));
    });
  }, [interventions]);

  return (
    <>
      {lines.map((ln, i) => (
        <Line
          key={i}
          points={ln.pts as [number, number, number][]}
          color={ln.color}
          lineWidth={1.2}
          transparent
          opacity={0.45}
          dashed
          dashSize={0.35}
          gapSize={0.22}
        />
      ))}
    </>
  );
}

function PeopleDots({ interventions }: { interventions: Intervention[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 120;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 8), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#64748b",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    []
  );

  const paths = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const rx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const rz = (Math.cos(i * 78.233) * 12345.6789) % 1;
      const x0 = (rx - 0.5) * 14;
      const z0 = (rz - 0.5) * 14;
      const t = i * 0.15;
      return { x0, z0, t, speed: 0.15 + (i % 7) * 0.02 };
    });
  }, [count]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    paths.forEach((p, i) => {
      const x = p.x0 + Math.sin(t * p.speed + p.t) * 1.2;
      const z = p.z0 + Math.cos(t * p.speed * 0.9 + p.t) * 1.2;
      let y = 0.55;
      for (const inv of interventions) {
        const d = Math.hypot(x - inv.x, z - inv.z);
        if (d < 4) y = 0.65 + (4 - d) * 0.04;
      }
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />
  );
}

function MapPlacementClick({
  onPlace,
  enabled,
  scene,
}: {
  onPlace: (x: number, z: number) => void;
  enabled: boolean;
  scene: THREE.Scene;
}) {
  const { raycaster, camera, gl } = useThree();

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      if (hits.length === 0) return;
      const top = hits[0];
      if (!top.object.userData.ground) return;
      const px = top.point.x;
      const pz = top.point.z;
      if (Math.abs(px) < GRID / 2 - 0.2 && Math.abs(pz) < GRID / 2 - 0.2) {
        onPlace(px, pz);
      }
    },
    [camera, enabled, gl.domElement, onPlace, raycaster, scene]
  );

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [gl.domElement, onClick]);

  return null;
}

function LaunchLightPulse({ pulse }: { pulse: number }) {
  const light = useRef<THREE.AmbientLight>(null);
  const last = useRef(0);
  const t = useRef(1);

  useEffect(() => {
    if (pulse !== last.current) {
      last.current = pulse;
      t.current = 0;
    }
  }, [pulse]);

  useFrame((_, delta) => {
    if (!light.current) return;
    if (t.current < 1) {
      t.current = Math.min(1, t.current + delta * 1.8);
      const k = Math.sin(t.current * Math.PI);
      light.current.intensity = 0.32 + k * 0.14;
    } else {
      light.current.intensity = 0.32;
    }
  });

  return <ambientLight ref={light} intensity={0.32} color="#6b7686" />;
}

export function CityScene({
  interventions,
  onPlace,
  mapInteractive,
  businessMode,
  cameraPulse,
  transparentBackdrop = false,
}: {
  interventions: Intervention[];
  onPlace: (x: number, z: number) => void;
  mapInteractive: boolean;
  businessMode: boolean;
  cameraPulse: number;
  /** When true, WebGL clear is translucent so a layer behind the canvas can show through */
  transparentBackdrop?: boolean;
}) {
  const buildings = useMemo(() => generateBuildings(42), []);
  const { scene } = useThree();

  return (
    <>
      {transparentBackdrop ? (
        <WebglBackdrop color="#000000" alpha={0.5} />
      ) : (
        <color attach="background" args={["#030508"]} />
      )}
      <fog attach="fog" args={["#030508", 16, 40]} />

      <LaunchLightPulse pulse={cameraPulse} />
      <directionalLight
        position={[8, 18, 6]}
        intensity={0.72}
        castShadow
        shadow-mapSize={[2048, 2048]}
        color="#b8c0ce"
      />
      <directionalLight position={[-6, 12, -4]} intensity={0.2} color="#5a6575" />

      <MapControls
        enableDamping
        dampingFactor={0.05}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={10}
        maxDistance={32}
        maxAzimuthAngle={Infinity}
      />

      <group position={[0, 0, 0]}>
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          userData={{ ground: true }}
        >
          <planeGeometry args={[GRID + 2, GRID + 2]} />
          <meshStandardMaterial color="#0a0d12" roughness={0.94} metalness={0.06} />
        </mesh>

        <HeatmapPlane interventions={interventions} businessMode={businessMode} />

        <Instances limit={buildings.length} range={buildings.length}>
          <boxGeometry />
          <meshStandardMaterial
            color="#3d4858"
            roughness={0.88}
            metalness={0.2}
            emissive="#151a22"
            emissiveIntensity={0.1}
          />
          {buildings.map((b, i) => (
            <Instance
              key={i}
              position={[b.x, b.h / 2, b.z]}
              scale={[b.w, b.h, b.d]}
            />
          ))}
        </Instances>

        {interventions.map((inv) => (
          <group key={inv.id}>
            <InterventionMarker inv={inv} />
            <Ripple x={inv.x} z={inv.z} color={INTERVENTION_META[inv.type].accent} delay={0} />
            <Ripple x={inv.x} z={inv.z} color={INTERVENTION_META[inv.type].accent} delay={0.4} />
          </group>
        ))}

        <TravelLines interventions={interventions} />
        <PeopleDots interventions={interventions} />

        <Float speed={0.6} rotationIntensity={0.15} floatIntensity={0.2}>
          <Sparkles
            count={48}
            scale={12}
            size={1.2}
            speed={0.18}
            color="#475569"
            opacity={0.16}
          />
        </Float>

        <MapPlacementClick
          onPlace={onPlace}
          enabled={mapInteractive}
          scene={scene}
        />
      </group>
    </>
  );
}
