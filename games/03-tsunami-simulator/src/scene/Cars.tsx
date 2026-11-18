// Vehicles: two InstancedMeshes (body + cabin) driven by the engine's car
// physics state. Matrices are composed from position/heading/tilt each frame.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SimulationEngine } from '../sim/engine';

const PALETTE = [0xd94f3d, 0x3d7dd9, 0xe8e8e8, 0x2f2f34, 0xd9a13d, 0x48a06b, 0x8a5fd9, 0x9aa3ad];

export function Cars({ engine }: { engine: SimulationEngine }) {
  const bodyRef = useRef<THREE.InstancedMesh>(null!);
  const cabinRef = useRef<THREE.InstancedMesh>(null!);
  const count = engine.cars.length;

  const bodyGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(4.3, 1.25, 2.0);
    g.translate(0, 0.65, 0);
    return g;
  }, []);
  const cabinGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(2.3, 1.0, 1.8);
    g.translate(-0.15, 1.55, 0);
    return g;
  }, []);
  const bodyMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const cabinMat = useMemo(() => new THREE.MeshLambertMaterial({ color: 0x1d2733 }), []);

  useEffect(() => {
    const c = new THREE.Color();
    engine.cars.forEach((car, i) => {
      c.setHex(PALETTE[i % PALETTE.length]);
      bodyRef.current.setColorAt(i, c);
    });
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
  }, [engine]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const body = bodyRef.current;
    const cabin = cabinRef.current;
    if (!body || !cabin) return;
    engine.cars.forEach((car, i) => {
      dummy.position.set(car.x, car.y, car.z);
      dummy.rotation.set(car.pitch, car.heading, car.roll, 'YXZ');
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
      cabin.setMatrixAt(i, dummy.matrix);
    });
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        key={`b${count}`}
        ref={bodyRef}
        args={[bodyGeo, bodyMat, count]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        key={`c${count}`}
        ref={cabinRef}
        args={[cabinGeo, cabinMat, count]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
