import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../physics/engine';
import type { CameraMode } from '../components/Scene';
import type { HistoryEntry, Phase, RunConfig, RunResult, Telemetry } from '../types';

/**
 * Binds the (framework-agnostic) SimulationEngine to React state:
 * - config sliders stay in sync with the engine
 * - throttled telemetry feeds the HUD
 * - terminal results land in state and the session history
 */
export function useSimulation() {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SimulationEngine();
  const engine = engineRef.current;

  const [config, setConfig] = useState<RunConfig>({ ...engine.config });
  const [phase, setPhase] = useState<Phase>('ready');
  const [telemetry, setTelemetry] = useState<Telemetry>({ ...engine.live });
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow');

  const nextId = useRef(1);

  useEffect(
    () =>
      engine.addListener({
        onPhase: (p) => setPhase(p),
        onTelemetry: (t) => setTelemetry({ ...t }),
        onResult: (r) => {
          setResult(r);
          const entry: HistoryEntry = {
            id: nextId.current++,
            speedKmh: r.config.speedKmh,
            massKg: r.config.massKg,
            angleDeg: r.config.angleDeg,
            obstacle: r.config.obstacle,
            forceKN: r.impact.forceKN,
            damagePct: r.impact.damagePct,
            severity: r.impact.severity
          };
          setHistory((h) => [entry, ...h].slice(0, 5));
        }
      }),
    [engine]
  );

  const updateConfig = useCallback(
    (patch: Partial<RunConfig>) => {
      setConfig((c) => {
        const next = { ...c, ...patch };
        engine.applyConfig(next);
        return next;
      });
    },
    [engine]
  );

  const run = useCallback(() => {
    setResult(null);
    engine.run();
  }, [engine]);

  const reset = useCallback(() => {
    setResult(null);
    engine.reset();
  }, [engine]);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      engine.setPaused(!p);
      return !p;
    });
  }, [engine]);

  const toggleSlowMo = useCallback(() => {
    setSlowMo((s) => {
      engine.setTimeScale(s ? 1 : 0.25);
      return !s;
    });
  }, [engine]);

  return {
    engine,
    config,
    phase,
    telemetry,
    result,
    history,
    paused,
    slowMo,
    cameraMode,
    setCameraMode,
    updateConfig,
    run,
    reset,
    togglePause,
    toggleSlowMo
  };
}
