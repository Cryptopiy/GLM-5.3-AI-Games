// Scene assembly: lighting, shadowed sun, orbit camera controls and all
// simulation-driven meshes.

import { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as THREE from 'three';
import { WORLD, TerrainData } from '../sim/terrain';
import { SimulationEngine } from '../sim/engine';
import { TerrainMesh } from './TerrainMesh';
import { WaterMesh } from './WaterMesh';
import { Buildings } from './Buildings';
import { Cars } from './Cars';
import { People } from './People';

function Controls() {
  const { camera, gl } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.target.set(20, 0, 0);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.49;
    c.minDistance = 40;
    c.maxDistance = 620;
    return c;
  }, [camera, gl]);
  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => controls.update());
  return null;
}

export function SimulatorScene({ td, engine }: { td: TerrainData; engine: SimulationEngine }) {
  const shadowSpan = WORLD * 0.72;
  return (
    <>
      <ambientLight intensity={0.85} />
      <hemisphereLight args={[0xbfd9ea, 0x6b6455, 0.55]} />
      <directionalLight
        position={[180, 240, 120]}
        intensity={2.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-shadowSpan}
        shadow-camera-right={shadowSpan}
        shadow-camera-top={shadowSpan}
        shadow-camera-bottom={-shadowSpan}
        shadow-camera-near={60}
        shadow-camera-far={700}
        shadow-bias={-0.0006}
      />
      <Controls />
      <TerrainMesh td={td} />
      <WaterMesh td={td} engine={engine} />
      <Buildings td={td} engine={engine} />
      <Cars engine={engine} />
      <People engine={engine} />
      {/* safe-zone marker on the hill */}
      <mesh position={[td.hillTopX, td.hillTopH + 6, td.hillTopZ]}>
        <cylinderGeometry args={[0.4, 0.4, 12, 8]} />
        <meshLambertMaterial color={'#2ecc71'} />
      </mesh>
    </>
  );
}

/** Re-export for App: default camera parameters. */
export const CAMERA = {
  position: new THREE.Vector3(-172, 118, 182),
  fov: 55,
};
