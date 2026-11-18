import { useEffect, useState } from 'react';
import { Scene } from './components/Scene';
import { useSimulation } from './hooks/useSimulation';
import { ControlPanel } from './ui/ControlPanel';
import { ResultPanel } from './ui/ResultPanel';
import { HistoryTable } from './ui/HistoryTable';
import { ModelInfo } from './ui/ModelInfo';
import { Hud } from './ui/Hud';

export default function App(): JSX.Element {
  const sim = useSimulation();
  const canRun = sim.phase === 'ready' || sim.phase === 'done';
  const [reportDismissed, setReportDismissed] = useState(false);

  // Every new report re-opens the panel.
  useEffect(() => {
    if (sim.result) setReportDismissed(false);
  }, [sim.result]);

  return (
    <div className="app">
      <aside className="side-panel">
        <header className="brand">
          <div className="brand__logo">bang</div>
          <div>
            <h1>CAR CRASH LAB</h1>
            <p>3D crash-test laboratory</p>
          </div>
        </header>

        <div className="actions">
          <button
            type="button"
            className="btn btn--run"
            onClick={sim.run}
            disabled={!canRun || sim.paused}
          >
            ▶ RUN CRASH
          </button>
          <button type="button" className="btn btn--reset" onClick={sim.reset}>
            ⟲ RESET
          </button>
        </div>

        <ControlPanel config={sim.config} phase={sim.phase} onChange={sim.updateConfig} />

        <ModelInfo />

        <HistoryTable history={sim.history} />

        <footer className="foot">
          Same configuration → same result · impulse-based 3D rigid-body physics
        </footer>
      </aside>

      <main className="stage">
        <Hud
          phase={sim.phase}
          config={sim.config}
          telemetry={sim.telemetry}
          paused={sim.paused}
          slowMo={sim.slowMo}
          cameraMode={sim.cameraMode}
          onTogglePause={sim.togglePause}
          onToggleSlowMo={sim.toggleSlowMo}
          onSetCamera={sim.setCameraMode}
        />
        <Scene engine={sim.engine} obstacleType={sim.config.obstacle} cameraMode={sim.cameraMode} />
        {sim.result && !reportDismissed && (
          <ResultPanel result={sim.result} onClose={() => setReportDismissed(true)} />
        )}
      </main>
    </div>
  );
}
