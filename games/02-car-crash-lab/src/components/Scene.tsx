import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SimulationEngine } from '../physics/engine';
import { Vehicle } from './Vehicle';
import { Obstacle } from './Obstacle';
import { Ground } from './Ground';
import { Effects } from './Effects';
import { smoothFactor } from '../physics/math';
import type { ObstacleType } from '../types';

export type CameraMode = 'follow' | 'free';

/** Advances the physics engine once per frame, before render reads state. */
function SimRunner({ engine }: { engine: SimulationEngine }): null {
  useFrame((_, dt) => engine.step(dt));
  return null;
}

function Lights(): JSX.Element {
  return (
    <>
      <hemisphereLight args={[0xa8c1e8, 0x23262c, 0.55]} />
      <directionalLight
        position={[45, 70, -35]}
        intensity={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-75}
        shadow-camera-right={75}
        shadow-camera-top={75}
        shadow-camera-bottom={-75}
        shadow-camera-near={5}
        shadow-camera-far={220}
        shadow-bias={-0.00035}
      />
      <directionalLight position={[-40, 30, 40]} intensity={0.28} />
    </>
  );
}

/**
 * Chase camera that smoothly follows the car, or a free orbit camera the user
 * can drag. Adds a decaying random shake at high-energy impacts.
 */
function CameraRig({ engine, mode }: { engine: SimulationEngine; mode: CameraMode }): null {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const lookTarget = useRef(new THREE.Vector3());
  const tmpForward = useRef(new THREE.Vector3());
  const tmpRight = useRef(new THREE.Vector3());
  const tmpDesired = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 4;
    controls.maxDistance = 220;
    controls.enabled = false;
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);

  useEffect(() => {
    if (mode === 'free' && controlsRef.current) {
      controlsRef.current.target.copy(engine.car.position);
      controlsRef.current.update();
    }
  }, [mode, engine]);

  useFrame((state, dt) => {
    const car = engine.car;
    const controls = controlsRef.current;

    if (mode === 'follow') {
      if (controls) controls.enabled = false;
      const fwd = car.axisZ(tmpForward.current);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
      fwd.normalize();
      const right = tmpRight.current.set(fwd.z, 0, -fwd.x);

      // Slightly above and behind-right of the car for a good 3D read.
      tmpDesired.current
        .copy(car.position)
        .addScaledVector(fwd, -10.5)
        .addScaledVector(right, 4.6);
      tmpDesired.current.y = car.position.y + 3.8;
      camera.position.lerp(tmpDesired.current, smoothFactor(2.6, dt));

      lookTarget.current.lerp(
        tmpRight.current.copy(car.position).add(new THREE.Vector3(0, 0.7, 0)),
        smoothFactor(6, dt)
      );
      camera.lookAt(lookTarget.current);
    } else if (controls) {
      controls.enabled = true;
      controls.update();
    }

    // Impact shake — applied after positioning so it never integrates into
    // the follow target.
    if (engine.shake > 0.002) {
      const t = state.clock.elapsedTime;
      const s = engine.shake;
      camera.position.x += Math.sin(t * 47.3) * s * 0.7;
      camera.position.y += Math.sin(t * 53.7 + 1.3) * s * 0.5;
      camera.position.z += Math.sin(t * 41.1 + 2.1) * s * 0.7;
    }
  });

  return null;
}

export function Scene({
  engine,
  obstacleType,
  cameraMode
}: {
  engine: SimulationEngine;
  obstacleType: ObstacleType;
  cameraMode: CameraMode;
}): JSX.Element {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 52, near: 0.2, far: 900, position: [7, 4.5, -18] }}
    >
      <color attach="background" args={['#0e1420']} />
      <fog attach="fog" args={['#0e1420', 170, 560]} />

      <SimRunner engine={engine} />
      <Lights />
      <Ground />
      <Vehicle engine={engine} />
      <Obstacle engine={engine} type={obstacleType} />
      <Effects engine={engine} />
      <CameraRig engine={engine} mode={cameraMode} />
    </Canvas>
  );
}
