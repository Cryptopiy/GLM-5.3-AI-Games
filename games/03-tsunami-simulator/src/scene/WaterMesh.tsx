// Dynamic water surface: one quad per grid cell, re-positioned every frame
// from the simulation state (surface height, depth, flow velocity).
// A custom shader colors shallow vs deep water, adds moving ripples and foam
// along the wave front and fast currents.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID, CELL, WORLD, TerrainData, cornerAvg } from '../sim/terrain';
import { SimulationEngine } from '../sim/engine';

const VERT = /* glsl */ `
uniform float uTime;
attribute float aDepth;
attribute vec2 aFlow;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorld;
void main() {
  vDepth = aDepth;
  vFlow = aFlow;
  vec3 p = position;
  float k = clamp(aDepth / 1.2, 0.0, 1.0);
  p.y += ( sin(p.x * 0.42 + uTime * 1.9) * 0.5
         + sin(p.z * 0.35 - uTime * 1.4) * 0.5
         + sin((p.x + p.z) * 0.21 + uTime * 0.8) * 0.6 ) * 0.09 * k;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  if (vDepth < 0.015) discard;
  float df = clamp(vDepth / 3.5, 0.0, 1.0);
  vec3 shallow = vec3(0.22, 0.62, 0.66);
  vec3 deep = vec3(0.03, 0.17, 0.42);
  vec3 col = mix(shallow, deep, pow(df, 0.65));

  float speed = length(vFlow);
  float edge = 1.0 - smoothstep(0.05, 0.65, vDepth); // near-shore / wave front
  vec2 flowN = speed > 0.01 ? vFlow / speed : vec2(1.0, 0.0);
  float n = vnoise(vWorld.xz * 0.55 + flowN * uTime * 0.7);
  float streak = vnoise(vWorld.xz * vec2(0.22, 1.4) + vec2(uTime * 0.5, 0.0));
  float foamAmt = clamp(speed * 0.16 + edge * 0.75, 0.0, 1.0);
  float foam = smoothstep(0.55, 0.8, n * 0.6 + streak * 0.4 + foamAmt * 0.55);
  col = mix(col, vec3(0.93, 0.96, 0.98), foam);

  float alpha = mix(0.5, 0.88, df) + foam * 0.1;
  float spec = pow(vnoise(vWorld.xz * 1.7 + uTime * 0.9), 8.0) * 0.25 * (1.0 - df * 0.5);
  col += spec;

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
}
`;

export function WaterMesh({ td, engine }: { td: TerrainData; engine: SimulationEngine }) {
  const clockRef = useRef(0);

  const { geometry, positions, depthAttr, flowAttr, levelScratch } = useMemo(() => {
    const quads = GRID * GRID;
    const positions = new Float32Array(quads * 4 * 3);
    const depths = new Float32Array(quads * 4);
    const flows = new Float32Array(quads * 4 * 2);
    const indices: number[] = [];
    for (let q = 0; q < quads; q++) {
      const b = q * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const depthAttr = new THREE.BufferAttribute(depths, 1);
    const flowAttr = new THREE.BufferAttribute(flows, 2);
    geo.setAttribute('aDepth', depthAttr);
    geo.setAttribute('aFlow', flowAttr);
    geo.setIndex(indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), WORLD);
    return {
      geometry: geo,
      positions,
      depthAttr,
      flowAttr,
      levelScratch: new Float32Array(GRID * GRID),
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    [],
  );

  useFrame((_, delta) => {
    if (engine.phase !== 'paused') clockRef.current += delta;
    material.uniforms.uTime.value = clockRef.current;

    const h = td.heights;
    const depth = engine.depth;
    const vx = engine.vx;
    const vz = engine.vz;
    const lvl = levelScratch;
    for (let i = 0; i < lvl.length; i++) lvl[i] = h[i] + depth[i];

    const x0 = -WORLD / 2;
    let p = 0;
    let a = 0;
    let f = 0;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        const y00 = cornerAvg(lvl, c, r) + 0.05;
        const y10 = cornerAvg(lvl, c + 1, r) + 0.05;
        const y11 = cornerAvg(lvl, c + 1, r + 1) + 0.05;
        const y01 = cornerAvg(lvl, c, r + 1) + 0.05;
        const d00 = cornerAvg(depth, c, r);
        const d10 = cornerAvg(depth, c + 1, r);
        const d11 = cornerAvg(depth, c + 1, r + 1);
        const d01 = cornerAvg(depth, c, r + 1);
        const fvx = vx[i];
        const fvz = vz[i];
        const xa = x0 + c * CELL;
        const xb = xa + CELL;
        const za = x0 + r * CELL;
        const zb = za + CELL;
        // quad corners (order matches TerrainMesh winding)
        const corners: Array<[number, number, number, number]> = [
          [xa, y00, za, d00],
          [xa, y01, zb, d01],
          [xb, y11, zb, d11],
          [xb, y10, za, d10],
        ];
        for (const [cx, cy, cz, cd] of corners) {
          positions[p++] = cx;
          positions[p++] = cy;
          positions[p++] = cz;
          depthAttr.array[a++] = cd;
          flowAttr.array[f++] = fvx;
          flowAttr.array[f++] = fvz;
        }
      }
    }
    geometry.attributes.position.needsUpdate = true;
    depthAttr.needsUpdate = true;
    flowAttr.needsUpdate = true;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}
