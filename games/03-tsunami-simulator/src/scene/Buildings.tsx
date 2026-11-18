// Buildings as one InstancedMesh of boxes. Static obstacles; instance color
// darkens when the flood around them gets deep (damage state).

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TerrainData } from '../sim/terrain';
import { SimulationEngine } from '../sim/engine';

const PALETTE = ['#b8b2a6', '#a8998a', '#93a4ad', '#c4b8a0', '#8f8f97', '#ad9d94', '#7e8a95'];

export function Buildings({ td, engine }: { td: TerrainData; engine: SimulationEngine }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const baseColors = useMemo(
    () => td.buildings.map((_, i) => new THREE.Color(PALETTE[i % PALETTE.length])),
    [td],
  );
  const lastTick = useRef(-1);

  useEffect(() => {
    const mesh = ref.current;
    const m = new THREE.Matrix4();
    td.buildings.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.base + b.h / 2, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, baseColors[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [td, baseColors]);

  useFrame(() => {
    if (lastTick.current === engine.damageTick) return;
    lastTick.current = engine.damageTick;
    const mesh = ref.current;
    if (!mesh || !mesh.instanceColor) return;
    const c = new THREE.Color();
    td.buildings.forEach((b, i) => {
      c.copy(baseColors[i]);
      if (b.flooded) c.multiplyScalar(0.82);
      if (b.damaged) c.lerp(new THREE.Color(0x4a4038), 0.55);
      mesh.setColorAt(i, c);
    });
    mesh.instanceColor.needsUpdate = true;
  });

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial(), []);

  return (
    <instancedMesh
      key={td.buildings.length}
      ref={ref}
      args={[geometry, material, td.buildings.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}
