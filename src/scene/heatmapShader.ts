export const heatVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const heatFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec4 uInterventions[16];
uniform int uCount;
uniform bool uBusinessMode;

varying vec2 vUv;
varying vec3 vWorldPos;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = vWorldPos.xz;

  float n = hash(floor(p * 2.8 + uTime * 0.04)) * 0.12
    + hash(floor(p * 5.1)) * 0.06;

  float heat = 0.0;
  heat += 1.0 - smoothstep(0.0, 8.2, length(p - vec2(-4.2, 2.1)));
  heat += 0.88 - smoothstep(0.0, 7.4, length(p - vec2(3.6, -3.2)));
  heat += 0.72 - smoothstep(0.0, 6.8, length(p - vec2(0.8, 4.2)));
  heat += 0.55 - smoothstep(0.0, 5.5, length(p - vec2(-2.0, -4.0)));
  heat = heat * (0.42 + n);

  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 iv = uInterventions[i];
    float d = length(p - iv.xy);
    float cool = smoothstep(iv.z, 0.0, d) * iv.w;
    heat -= cool;
  }

  heat = clamp(heat, 0.0, 1.0);

  /* Dark blue–gray stress map */
  vec3 baseDark = vec3(0.04, 0.05, 0.08);
  vec3 hotA = vec3(0.14, 0.17, 0.24);
  vec3 hotB = vec3(0.24, 0.28, 0.38);
  vec3 col = mix(baseDark, mix(hotA, hotB, heat), heat);

  float pulse = 0.5 + 0.5 * sin(uTime * 1.2 + heat * 6.283);
  col += vec3(0.04, 0.05, 0.07) * (1.0 - heat) * pulse;

  if (uBusinessMode) {
    col += vec3(0.12, 0.12, 0.1) * heat * 0.15;
  }

  float a = 0.88 + heat * 0.08;
  gl_FragColor = vec4(col, a);
}
`;
