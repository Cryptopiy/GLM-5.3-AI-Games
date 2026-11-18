import { ANGLE_RANGE, MASS_RANGE, SPEED_RANGE } from '../config/constants';
import { OBSTACLES, OBSTACLE_ORDER } from '../config/obstacles';
import type { ObstacleType, Phase, RunConfig } from '../types';

interface Props {
  config: RunConfig;
  phase: Phase;
  onChange: (patch: Partial<RunConfig>) => void;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (v: number) => void;
  hint?: string;
}): JSX.Element {
  return (
    <div className={`control ${props.disabled ? 'control--disabled' : ''}`}>
      <div className="control__head">
        <span className="control__label">{props.label}</span>
        <span className="control__value">
          {props.value}
          <small> {props.unit}</small>
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <div className="control__range">
        <span>{props.min}</span>
        {props.hint && <span className="control__hint">{props.hint}</span>}
        <span>{props.max}</span>
      </div>
    </div>
  );
}

export function ControlPanel({ config, phase, onChange }: Props): JSX.Element {
  const locked = phase === 'running' || phase === 'settling';

  return (
    <div className="controls">
      <Slider
        label="Initial speed"
        value={config.speedKmh}
        min={SPEED_RANGE.min}
        max={SPEED_RANGE.max}
        step={SPEED_RANGE.step}
        unit="km/h"
        disabled={locked}
        onChange={(v) => onChange({ speedKmh: v })}
      />
      <Slider
        label="Vehicle mass"
        value={config.massKg}
        min={MASS_RANGE.min}
        max={MASS_RANGE.max}
        step={MASS_RANGE.step}
        unit="kg"
        disabled={locked}
        onChange={(v) => onChange({ massKg: v })}
      />
      <Slider
        label="Collision angle"
        value={config.angleDeg}
        min={ANGLE_RANGE.min}
        max={ANGLE_RANGE.max}
        step={ANGLE_RANGE.step}
        unit="°"
        disabled={locked}
        hint="0° = head-on"
        onChange={(v) => onChange({ angleDeg: v })}
      />

      <div className={`control ${locked ? 'control--disabled' : ''}`}>
        <div className="control__head">
          <span className="control__label">Obstacle</span>
        </div>
        <div className="obstacles">
          {OBSTACLE_ORDER.map((id: ObstacleType) => {
            const spec = OBSTACLES[id];
            const active = config.obstacle === id;
            return (
              <button
                key={id}
                type="button"
                className={`obstacle ${active ? 'obstacle--active' : ''}`}
                disabled={locked}
                onClick={() => onChange({ obstacle: id })}
              >
                <span className="obstacle__swatch" style={{ background: `#${spec.color.toString(16).padStart(6, '0')}` }} />
                <span className="obstacle__name">{spec.label}</span>
                <span className="obstacle__meta">
                  {spec.mass === 0 ? 'immovable' : `${spec.mass.toLocaleString('en-US')} kg`}
                </span>
              </button>
            );
          })}
        </div>
        <p className="control__hint obstacle-desc">{OBSTACLES[config.obstacle].description}</p>
      </div>
    </div>
  );
}
