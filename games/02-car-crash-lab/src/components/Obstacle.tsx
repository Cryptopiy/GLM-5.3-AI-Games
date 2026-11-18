import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from '../physics/engine';
import { OBSTACLES } from '../config/obstacles';
import type { ObstacleType } from '../types';

/**
 * Renders the active obstacle. The mesh transform is driven by the physics
 * body every frame, so movable barriers visibly slide, spin and topple.
 */
export function Obstacle({ engine, type }: { engine: SimulationEngine; type: ObstacleType }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const spec = OBSTACLES[type];

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.copy(engine.obstacle.position);
    g.quaternion.copy(engine.obstacle.quaternion);
  });

  const dims: [number, number, number] = [spec.half.x * 2, spec.half.y * 2, spec.half.z * 2];

  return (
    <group ref={groupRef}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={dims} />
        <meshStandardMaterial color={spec.color} roughness={0.85} metalness={0.05} />
      </mesh>

      {type === 'concrete_wall' && (
        <>
          {/* Yellow warning band along the top */}
          <mesh position={[0, spec.half.y - 0.22, spec.half.z + 0.01]}>
            <boxGeometry args={[spec.half.x * 2, 0.4, 0.02]} />
            <meshStandardMaterial color={0xf5b31b} roughness={0.6} />
          </mesh>
          {/* Foundation feet */}
          {[-6.5, 0, 6.5].map((x) => (
            <mesh key={x} position={[x, -spec.half.y + 0.15, 0]} castShadow>
              <boxGeometry args={[1.4, 0.3, 1.6]} />
              <meshStandardMaterial color={0x565c63} roughness={0.9} />
            </mesh>
          ))}
        </>
      )}

      {type === 'heavy_barrier' && (
        <>
          {/* White reflective stripes */}
          {[-1.5, 0, 1.5].map((z) => (
            <mesh key={z} position={[0, 0, z]} castShadow>
              <boxGeometry args={[spec.half.x * 2 + 0.02, 0.5, 0.3]} />
              <meshStandardMaterial color={spec.accentColor} roughness={0.5} />
            </mesh>
          ))}
        </>
      )}

      {type === 'light_barrier' && (
        <>
          {/* Hollow-core ribs + white band */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[spec.half.x * 2 - 0.3, spec.half.y * 2 + 0.02, spec.half.z * 2 - 0.18]} />
            <meshStandardMaterial color={spec.accentColor} roughness={0.7} />
          </mesh>
          <mesh position={[0, spec.half.y - 0.12, 0]}>
            <boxGeometry args={[spec.half.x * 2 + 0.02, 0.2, spec.half.z * 2 + 0.02]} />
            <meshStandardMaterial color={0xf2f5f9} roughness={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
}
