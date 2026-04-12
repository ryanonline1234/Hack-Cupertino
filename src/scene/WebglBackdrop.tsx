import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Semi-transparent WebGL clear so a DOM/canvas layer (e.g. particle field) reads through.
 */
export function WebglBackdrop({
  color = "#050608",
  alpha = 0.52,
}: {
  color?: string;
  alpha?: number;
}) {
  const { gl, scene } = useThree();

  useLayoutEffect(() => {
    scene.background = null;
    const c = new THREE.Color(color);
    gl.setClearColor(c, alpha);
  }, [gl, scene, color, alpha]);

  return null;
}
