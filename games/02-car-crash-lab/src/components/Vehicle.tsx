import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from '../physics/engine';
import type { DeformationSpec, DetachablePart } from '../types';
import { mulberry32 } from '../physics/math';
import { COLORS } from '../config/constants';

/**
 * Deformable test vehicle.
 *
 * The body and cabin are segmented boxes with per-vertex colors. On impact the
 * engine emits a DeformationSpec; vertices near the damaged zone are pushed
 * inwards (against the contact normal) with deterministic noise and tinted
 * dark — producing a crumpled, scraped look on the correct side of the car.
 */

const BODY_SIZE = { w: 1.86, h: 0.64, l: 4.4 };
const CABIN_SIZE = { w: 1.62, h: 0.52, l: 2.05 };

interface Deformable {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  baseColors: Float32Array;
  /** Half extents along x/z used for the crush falloff. */
  halfX: number;
  halfZ: number;
  /** Multiplier vs the nominal crush depth (cabin crushes less). */
  crushScale: number;
}

function paintVertices(geometry: THREE.BufferGeometry, color: THREE.Color): Float32Array {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Slight per-vertex paint variation so crumple tinting blends in.
    const v = 0.92 + 0.08 * ((i * 7919) % 13) / 12;
    colors[i * 3] = color.r * v;
    colors[i * 3 + 1] = color.g * v;
    colors[i * 3 + 2] = color.b * v;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return colors;
}

export function Vehicle({ engine }: { engine: SimulationEngine }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const cabinRef = useRef<THREE.Mesh>(null);
  const glassRef = useRef<THREE.Mesh>(null);
  const headlightMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const spinRefs = useRef<Array<THREE.Group | null>>([]);
  const detachRefs = useRef<Record<string, THREE.Object3D | null>>({});

  const deformablesRef = useRef<Deformable[]>([]);

  // Capture original geometry once mounted, then subscribe to engine events.
  useEffect(() => {
    const list: Deformable[] = [];
    if (bodyRef.current) {
      const geometry = bodyRef.current.geometry;
      list.push({
        mesh: bodyRef.current,
        geometry,
        basePositions: Float32Array.from(geometry.attributes.position.array as Float32Array),
        baseColors: paintVertices(geometry, new THREE.Color(COLORS.carPaint)),
        halfX: BODY_SIZE.w / 2,
        halfZ: BODY_SIZE.l / 2,
        crushScale: 1
      });
    }
    if (cabinRef.current) {
      const geometry = cabinRef.current.geometry;
      list.push({
        mesh: cabinRef.current,
        geometry,
        basePositions: Float32Array.from(geometry.attributes.position.array as Float32Array),
        baseColors: paintVertices(geometry, new THREE.Color(COLORS.carPaintDark)),
        halfX: CABIN_SIZE.w / 2,
        halfZ: CABIN_SIZE.l / 2,
        crushScale: 0.55
      });
    }
    deformablesRef.current = list;

    const resetVisuals = (): void => {
      for (const d of list) {
        (d.geometry.attributes.position as THREE.BufferAttribute).copyArray(d.basePositions);
        (d.geometry.attributes.color as THREE.BufferAttribute).copyArray(d.baseColors);
        d.geometry.attributes.position.needsUpdate = true;
        d.geometry.attributes.color.needsUpdate = true;
        d.geometry.computeVertexNormals();
      }
      for (const key of Object.keys(detachRefs.current)) {
        const obj = detachRefs.current[key];
        if (obj) obj.visible = true;
      }
      if (glassRef.current) {
        const mat = glassRef.current.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.62;
        mat.color.set(COLORS.glass);
      }
      if (headlightMatRef.current) headlightMatRef.current.emissiveIntensity = 1.4;
    };

    const applyDeformation = (spec: DeformationSpec): void => {
      const rng = mulberry32(spec.seed);
      const axis = spec.zone === 'front' || spec.zone === 'rear' ? 'z' : 'x';
      const sign = spec.zone === 'front' || spec.zone === 'right' ? 1 : -1;

      const push = new THREE.Vector3(spec.localDir[0], spec.localDir[1], spec.localDir[2]);
      if (push.lengthSq() < 1e-6) push.set(0, 0, -sign);
      push.normalize().multiplyScalar(-1); // crumple inwards, against the contact normal

      for (const d of list) {
        const pos = d.geometry.attributes.position as THREE.BufferAttribute;
        const col = d.geometry.attributes.color as THREE.BufferAttribute;
        const half = axis === 'z' ? d.halfZ : d.halfX;
        const depth = spec.crushDepth * d.crushScale;

        for (let i = 0; i < pos.count; i++) {
          const bx = d.basePositions[i * 3];
          const by = d.basePositions[i * 3 + 1];
          const bz = d.basePositions[i * 3 + 2];
          const coord = axis === 'z' ? bz : bx;

          // t: 0 at the far face → 1 at the impacted face.
          const t = THREE.MathUtils.clamp((coord * sign + half) / (2 * half), 0, 1);
          const w = Math.pow(t, 3.0) * (d.crushScale === 1 ? 1 : 0.8);
          if (w < 0.04) continue;

          const jitter = 0.6 + 0.8 * rng();
          const off = push.clone().multiplyScalar(depth * w * jitter);
          // Random crumple within the panel plane.
          off.x += (rng() - 0.5) * 0.1 * w;
          off.y += (rng() - 0.5) * 0.1 * w + 0.02 * w;
          off.z += (rng() - 0.5) * 0.1 * w;

          pos.setXYZ(i, bx + off.x, by + off.y, bz + off.z);

          // Scrape tint: dark desaturated patches where the panel crushed hard.
          const scrape = THREE.MathUtils.clamp(w * 1.5, 0, 1);
          col.setXYZ(
            i,
            THREE.MathUtils.lerp(d.baseColors[i * 3], 0.15, scrape),
            THREE.MathUtils.lerp(d.baseColors[i * 3 + 1], 0.15, scrape),
            THREE.MathUtils.lerp(d.baseColors[i * 3 + 2], 0.17, scrape)
          );
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        d.geometry.computeVertexNormals();
      }

      if (spec.zone === 'front') {
        if (headlightMatRef.current) headlightMatRef.current.emissiveIntensity = 0.05;
        if (glassRef.current && spec.crushDepth > 0.24) {
          const mat = glassRef.current.material as THREE.MeshStandardMaterial;
          mat.color.set(0xd8ecf2);
          mat.opacity = 0.85;
        }
      }
    };

    return engine.addListener({
      onImpactVisuals: (v) => {
        applyDeformation(v.deform);
        for (const part of v.detach as DetachablePart[]) {
          const obj = detachRefs.current[part];
          if (obj) obj.visible = false;
        }
      },
      onResetVisuals: resetVisuals
    });
  }, [engine]);

  // Sync group transform + wheel spin every frame.
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const car = engine.car;
    g.position.copy(car.position);
    g.quaternion.copy(car.quaternion);

    const localV = car.velocity.clone().applyQuaternion(car.quaternion.clone().invert());
    const spin = (localV.z / 0.36) * dt;
    for (const s of spinRefs.current) if (s) s.rotation.x += spin;
  });

  const wheelGeometry = useMemo(() => {
    const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 12);
    rim.rotateZ(Math.PI / 2);
    return { tire, rim };
  }, []);

  const wheelPositions: Array<{ pos: [number, number, number]; key: DetachablePart | string }> = [
    { pos: [0.82, -0.3, 1.42], key: 'wheelFL' },
    { pos: [-0.82, -0.3, 1.42], key: 'wheelFR' },
    { pos: [0.82, -0.3, -1.42], key: 'wheelRL' },
    { pos: [-0.82, -0.3, -1.42], key: 'wheelRR' }
  ];

  return (
    <group ref={groupRef}>
      {/* Deformable body */}
      <mesh ref={bodyRef} castShadow receiveShadow>
        <boxGeometry args={[BODY_SIZE.w, BODY_SIZE.h, BODY_SIZE.l, 7, 3, 14]} />
        <meshStandardMaterial vertexColors metalness={0.45} roughness={0.38} />
      </mesh>

      {/* Deformable cabin */}
      <mesh ref={cabinRef} position={[0, 0.52, -0.32]} castShadow>
        <boxGeometry args={[CABIN_SIZE.w, CABIN_SIZE.h, CABIN_SIZE.l, 5, 2, 8]} />
        <meshStandardMaterial vertexColors metalness={0.4} roughness={0.5} />
      </mesh>

      {/* Windshield */}
      <mesh ref={glassRef} position={[0, 0.5, 0.72]}>
        <boxGeometry args={[1.5, 0.42, 0.06]} />
        <meshStandardMaterial
          color={COLORS.glass}
          transparent
          opacity={0.62}
          metalness={0.1}
          roughness={0.08}
        />
      </mesh>

      {/* Detachable hood */}
      <mesh
        ref={(el) => {
          if (el) detachRefs.current['hood'] = el;
        }}
        position={[0, 0.365, 1.28]}
        castShadow
      >
        <boxGeometry args={[1.5, 0.07, 1.15]} />
        <meshStandardMaterial color={COLORS.carPaint} metalness={0.45} roughness={0.38} />
      </mesh>

      {/* Detachable front bumper + fixed rear bumper */}
      <mesh
        ref={(el) => {
          if (el) detachRefs.current['bumperF'] = el;
        }}
        position={[0, -0.14, 2.26]}
        castShadow
      >
        <boxGeometry args={[1.9, 0.28, 0.16]} />
        <meshStandardMaterial color={0x2a2d33} metalness={0.1} roughness={0.7} />
      </mesh>
      <mesh position={[0, -0.14, -2.26]} castShadow>
        <boxGeometry args={[1.9, 0.28, 0.16]} />
        <meshStandardMaterial color={0x2a2d33} metalness={0.1} roughness={0.7} />
      </mesh>

      {/* Headlights (break on front hits) */}
      {[0.58, -0.58].map((x) => (
        <mesh key={`hl${x}`} position={[x, 0.1, 2.42]}>
          <boxGeometry args={[0.36, 0.12, 0.08]} />
          <meshStandardMaterial
            ref={x > 0 ? headlightMatRef : undefined}
            color={COLORS.headlight}
            emissive={COLORS.headlight}
            emissiveIntensity={1.4}
          />
        </mesh>
      ))}
      {[0.58, -0.58].map((x) => (
        <mesh key={`tl${x}`} position={[x, 0.1, -2.42]}>
          <boxGeometry args={[0.34, 0.1, 0.08]} />
          <meshStandardMaterial color={COLORS.taillight} emissive={COLORS.taillight} emissiveIntensity={1.1} />
        </mesh>
      ))}

      {/* Wheels (front pair can detach) */}
      {wheelPositions.map((w, i) => (
        <group
          key={w.key}
          position={w.pos}
          ref={(el) => {
            spinRefs.current[i] = el;
            if (el && (w.key === 'wheelFL' || w.key === 'wheelFR')) {
              detachRefs.current[w.key] = el;
            }
          }}
        >
          <mesh geometry={wheelGeometry.tire} castShadow>
            <meshStandardMaterial color={COLORS.tire} roughness={0.92} />
          </mesh>
          <mesh geometry={wheelGeometry.rim}>
            <meshStandardMaterial color={COLORS.rim} metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
