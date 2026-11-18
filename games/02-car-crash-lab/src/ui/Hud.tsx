import type { CameraMode } from '../components/Scene';
import type { Phase, RunConfig, Telemetry } from '../types';

const phaseLabel: Record<Phase, string> = {
  ready: 'READY',
  running: 'APPROACH',
  settling: 'IMPACT / SETTLING',
  done: 'SETTLED'
};

interface Props {
  phase: Phase;
  config: RunConfig;
  telemetry: Telemetry;
  paused: boolean;
  slowMo: boolean;
  cameraMode: CameraMode;
  onTogglePause: () => void;
  onToggleSlowMo: () => void;
  onSetCamera: (m: CameraMode) => void;
}

export function Hud({
  phase,
  config,
  telemetry,
  paused,
  slowMo,
  cameraMode,
  onTogglePause,
  onToggleSlowMo,
  onSetCamera
}: Props): JSX.Element {
  const running = phase === 'running' || phase === 'settling';
  return (
    <div className="hud">
      <div className={`hud__phase phase-${phase}`}>{paused ? 'PAUSED' : phaseLabel[phase]}</div>

      <div className="hud__speed">
        <span className="hud__speed-value">{telemetry.speedKmh.toFixed(1)}</span>
        <span className="hud__speed-unit">km/h</span>
        <span className="hud__speed-target">target {config.speedKmh} km/h</span>
      </div>

      <div className="hud__pos">
        X {telemetry.x.toFixed(1)} m · Z {telemetry.z.toFixed(1)} m · HDG{' '}
        {telemetry.headingDeg.toFixed(0)}°
      </div>

      <div className="hud__buttons">
        <button
          type="button"
          className={`btn btn--chip ${slowMo ? 'btn--chip-active' : ''}`}
          onClick={onToggleSlowMo}
          title="Slow motion 0.25×"
        >
          ⏱ 0.25×
        </button>
        <button
          type="button"
          className={`btn btn--chip ${paused ? 'btn--chip-active' : ''}`}
          onClick={onTogglePause}
          disabled={phase === 'ready'}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          type="button"
          className={`btn btn--chip ${cameraMode === 'free' ? 'btn--chip-active' : ''}`}
          onClick={() => onSetCamera(cameraMode === 'follow' ? 'free' : 'follow')}
          title={cameraMode === 'follow' ? 'Switch to free orbit camera' : 'Back to chase camera'}
        >
          {cameraMode === 'follow' ? '🎥 Free cam' : '🎥 Chase cam'}
        </button>
        {running && slowMo && <span className="hud__slowmo-flag">SLOW MOTION</span>}
      </div>
    </div>
  );
}
