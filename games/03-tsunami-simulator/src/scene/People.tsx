// Pedestrians: instanced capsules. White = walking, green = reached high
// ground, red = caught by the water.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SimulationEngine } from '../sim/engine';

const COLOR_WALK = new THREE.Color(0xf2e9d8);
const COLOR_SAFE = new THREE.Color(0x35c46a);
const COLOR_CAUGHT = new THREE.Color(0xe04040);

export function People({ engine }: { engine: SimulationEngine }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const count = engine.people.length;

  const geometry = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.32, 0.85, 4, 8);
    g.translate(0, 0.75, 0);
    return g;
  }, []);
  const material = useMemo(() => new THREE.MeshLambertMaterial(), []);

  useEffect(() => {
    const mesh = ref.current;
    const c = new THREE.Color();
    engine.people.forEach((_, i) => mesh.setColorAt(i, c.copy(COLOR_WALK)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [engine]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    engine.people.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.heading, p.state === 'caught' ? 1.1 : 0, 'YXZ');
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (p.state === 'safe') c.copy(COLOR_SAFE);
      else if (p.state === 'caught') c.copy(COLOR_CAUGHT);
      else c.copy(COLOR_WALK);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow
      frustumCulled={false}
    />
  );
}
