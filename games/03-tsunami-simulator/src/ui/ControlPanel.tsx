// Control panel: wave height slider, START TSUNAMI, pause, reset, speed.

import { Phase } from '../sim/engine';

interface Props {
  phase: Phase;
  waveH: number;
  speed: number;
  onWave: (v: number) => void;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
}

const SPEEDS = [0.5, 1, 2];

export function ControlPanel({ phase, waveH, speed, onWave, onStart, onPause, onReset, onSpeed }: Props) {
  return (
    <div className="panel control-panel">
      <div className="wave-row">
        <label>WAVE HEIGHT</label>
        <div className="wave-value">
          {waveH.toFixed(1)}
          <span> m</span>
        </div>
      </div>
      <input
        className="wave-slider"
        type="range"
        min={1}
        max={20}
        step={0.5}
        value={waveH}
        onChange={(e) => onWave(parseFloat(e.target.value))}
      />
      <div className="scale-marks">
        <span>1 m</span>
        <span>20 m</span>
      </div>
      <button
        className={`btn-start ${phase === 'running' ? 'pulse' : ''}`}
        onClick={onStart}
        disabled={phase !== 'idle'}
      >
        START TSUNAMI
      </button>
      <div className="btn-row">
        <button className="btn-pause" onClick={onPause} disabled={phase === 'idle'}>
          {phase === 'paused' ? '▶ RESUME' : '❚❚ PAUSE'}
        </button>
        <button className="btn-reset" onClick={onReset}>
          ⟲ RESET
        </button>
      </div>
      <div className="speed-row">
        <span className="speed-label">SPEED</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`speed-btn ${speed === s ? 'active' : ''}`}
            onClick={() => onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="hint">drag — rotate · scroll — zoom</div>
    </div>
  );
}
