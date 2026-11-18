import { OBSTACLES } from '../config/obstacles';
import type { RunResult, Severity } from '../types';

const severityClass: Record<Severity, string> = {
  none: 'sev-none',
  minor: 'sev-minor',
  moderate: 'sev-moderate',
  severe: 'sev-severe',
  catastrophic: 'sev-catastrophic'
};

function Row(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="result__row">
      <span>{props.label}</span>
      <strong>{props.children}</strong>
    </div>
  );
}

export function ResultPanel({ result, onClose }: { result: RunResult; onClose: () => void }): JSX.Element {
  const i = result.impact;
  const spec = OBSTACLES[result.config.obstacle];

  return (
    <div className="result-panel">
      <div className="result-panel__head">
        <h2>Crash report</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close report">
          ✕
        </button>
      </div>

      <div className={`result__damage ${severityClass[i.severity]}`}>
        <div className="result__damage-value">{i.damagePct.toFixed(1)}%</div>
        <div className="result__damage-label">
          structural damage · <em>{i.severity}</em> · zone: {i.zone}
        </div>
        <div className="damage-bar">
          <span style={{ width: `${Math.min(100, i.damagePct)}%` }} />
        </div>
      </div>

      <div className="result__grid">
        <Row label="Configured speed">{result.config.speedKmh} km/h</Row>
        <Row label="Impact speed">{i.impactSpeedKmh.toFixed(1)} km/h</Row>
        <Row label="Normal closing speed">{i.normalSpeedKmh.toFixed(1)} km/h</Row>
        <Row label="Mass">{result.config.massKg} kg</Row>
        <Row label="Collision angle">{result.config.angleDeg}°</Row>
        <Row label="Obstacle">{spec.label}</Row>
        <Row label="Impulse J">{(i.impulseNs / 1000).toFixed(1)} kN·s</Row>
        <Row label="Impact force ≈">
          {i.forceKN.toFixed(0)} kN <small>(J / {spec.impactDurationS * 1000} ms)</small>
        </Row>
        <Row label="Crush energy">{i.crushEnergyKJ.toFixed(1)} kJ</Row>
        <Row label="KE before → after">
          {result.keBeforeKJ.toFixed(0)} → {result.keAfterKJ.toFixed(0)} kJ
        </Row>
        <Row label="Final position (X, Y, Z)">
          {result.finalX.toFixed(2)} / {result.finalY.toFixed(2)} / {result.finalZ.toFixed(2)} m
        </Row>
        <Row label="Final rotation (yaw / pitch / roll)">
          {result.finalYawDeg.toFixed(1)}° / {result.finalPitchDeg.toFixed(1)}° / {result.finalRollDeg.toFixed(1)}°
        </Row>
        <Row label="Obstacle displacement">{result.obstacleDisplacementM.toFixed(2)} m</Row>
        <Row label="Sim time">{result.simTimeS.toFixed(1)} s</Row>
      </div>

      <p className="result__note">
        Impact force is an estimate: measured impulse divided by an assumed impact
        duration of {(spec.impactDurationS * 1000).toFixed(0)} ms for this obstacle type.
      </p>
    </div>
  );
}
