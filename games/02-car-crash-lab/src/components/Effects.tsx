import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from '../physics/engine';

/**
 * GPU-friendly rendering of engine particle/effect state:
 * - debris: instanced boxes (panels, chunks, glass) + instanced cylinders (wheels)
 * - sparks: additive THREE.Points, colour fades with remaining life
 * - tire marks: instanced flat quads laid under sliding wheels
 */

const MAX_BOXES = 160;
const MAX_WHEELS = 6;
const MAX_SPARKS = 400;
const MAX_MARKS = 560;

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const zeroScale = new THREE.Vector3(0, 0, 0);

export function Effects({ engine }: { engine: SimulationEngine }): JSX.Element {
  const boxRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.InstancedMesh>(null);
  const marksRef = useRef<THREE.InstancedMesh>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const sparkGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  /** Flat quad lying in the XZ plane: scale.x = width, scale.z = length. */
  const markGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  useFrame(() => {
    // ---- debris boxes ----
    const boxes = boxRef.current;
    if (boxes) {
      let n = 0;
      for (const d of engine.debris) {
        if (d.kind === 'wheel') continue;
        if (n >= MAX_BOXES) break;
        tmpPos.copy(d.pos);
        tmpQuat.setFromAxisAngle(d.spinAxis, d.angle);
        tmpScale.set(d.half.x * 2, d.half.y * 2, d.half.z * 2);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        boxes.setMatrixAt(n, tmpMatrix);
        boxes.setColorAt(n, tmpColor.set(d.color));
        n++;
      }
      for (let i = n; i < MAX_BOXES; i++) {
        tmpMatrix.compose(tmpPos.set(0, -10, 0), tmpQuat.identity(), zeroScale);
        boxes.setMatrixAt(i, tmpMatrix);
      }
      boxes.instanceMatrix.needsUpdate = true;
      if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    }

    // ---- debris wheels (cylinders) ----
    const wheels = wheelRef.current;
    if (wheels) {
      let n = 0;
      for (const d of engine.debris) {
        if (d.kind !== 'wheel') continue;
        if (n >= MAX_WHEELS) break;
        tmpPos.copy(d.pos);
        tmpQuat.setFromAxisAngle(d.spinAxis, d.angle);
        tmpScale.set(1, 1, 1);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        wheels.setMatrixAt(n, tmpMatrix);
        wheels.setColorAt(n, tmpColor.set(d.color));
        n++;
      }
      for (let i = n; i < MAX_WHEELS; i++) {
        tmpMatrix.compose(tmpPos.set(0, -10, 0), tmpQuat.identity(), zeroScale);
        wheels.setMatrixAt(i, tmpMatrix);
      }
      wheels.instanceMatrix.needsUpdate = true;
      if (wheels.instanceColor) wheels.instanceColor.needsUpdate = true;
    }

    // ---- sparks ----
    const points = pointsRef.current;
    if (points) {
      const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = points.geometry.attributes.color as THREE.BufferAttribute;
      const n = Math.min(engine.sparks.length, MAX_SPARKS);
      for (let i = 0; i < n; i++) {
        const s = engine.sparks[i];
        posAttr.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
        const k = Math.max(0, s.life / s.maxLife);
        colAttr.setXYZ(i, 1.0 * k + 0.2, 0.55 * k + 0.1, 0.12 * k);
      }
      points.geometry.setDrawRange(0, n);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    // ---- tire marks ----
    const marks = marksRef.current;
    if (marks) {
      const total = engine.tireMarks.length;
      const start = Math.max(0, total - MAX_MARKS);
      let n = 0;
      for (let i = start; i < total; i++) {
        const m = engine.tireMarks[i];
        tmpPos.copy(m.pos);
        tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw);
        tmpScale.set(m.width, 1, m.len);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        marks.setMatrixAt(n, tmpMatrix);
        n++;
      }
      for (let i = n; i < MAX_MARKS; i++) {
        tmpMatrix.compose(tmpPos.set(0, -10, 0), tmpQuat.identity(), zeroScale);
        marks.setMatrixAt(i, tmpMatrix);
      }
      marks.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={boxRef} args={[undefined, undefined, MAX_BOXES]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.55} metalness={0.35} />
      </instancedMesh>

      <instancedMesh ref={wheelRef} args={[undefined, undefined, MAX_WHEELS]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.36, 0.36, 0.26, 16]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>

      <points ref={pointsRef} geometry={sparkGeometry} frustumCulled={false}>
        <pointsMaterial
          size={0.12}
          vertexColors
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          transparent
          sizeAttenuation
        />
      </points>

      <instancedMesh ref={marksRef} args={[markGeometry, undefined, MAX_MARKS]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={0x07080a}
          transparent
          opacity={0.5}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </instancedMesh>
    </group>
  );
}
