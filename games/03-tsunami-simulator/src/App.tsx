import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { SimulatorScene, CAMERA } from './scene/Simulator';
import { ControlPanel } from './ui/ControlPanel';
import { StatsPanel } from './ui/StatsPanel';
import { Legend } from './ui/Legend';
import { generateTerrain } from './sim/terrain';
import { SimulationEngine, Stats } from './sim/engine';

export default function App() {
  const td = useMemo(() => generateTerrain(20260823), []);
  const engine = useMemo(() => new SimulationEngine(td), [td]);

  const [stats, setStats] = useState<Stats>({ ...engine.stats });
  const [phase, setPhase] = useState(engine.phase);
  const [waveH, setWaveH] = useState(engine.waveHeight);
  const [speed, setSpeed] = useState(engine.speed);

  // simulation clock lives outside React rendering
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      engine.update(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(() => setStats({ ...engine.stats }), 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, [engine]);

  return (
    <div className="app">
      <div className="vignette" />
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{
          position: [CAMERA.position.x, CAMERA.position.y, CAMERA.position.z],
          fov: CAMERA.fov,
          near: 0.5,
          far: 3200,
        }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#a8c8de']} />
        <fog attach="fog" args={['#a8c8de', 430, 1650]} />
        <SimulatorScene td={td} engine={engine} />
      </Canvas>
      <StatsPanel stats={stats} />
      <ControlPanel
        phase={phase}
        waveH={waveH}
        speed={speed}
        onWave={(v) => {
          engine.setWaveHeight(v);
          setWaveH(v);
        }}
        onStart={() => {
          engine.start();
          setPhase(engine.phase);
        }}
        onPause={() => {
          engine.togglePause();
          setPhase(engine.phase);
        }}
        onReset={() => {
          engine.reset();
          setPhase(engine.phase);
          setStats({ ...engine.stats });
        }}
        onSpeed={(s) => {
          engine.setSpeed(s);
          setSpeed(s);
        }}
      />
      <Legend />
    </div>
  );
}
