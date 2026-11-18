// Shared domain types for the Car Crash Lab.

export type ObstacleType = 'concrete_wall' | 'heavy_barrier' | 'light_barrier';

export type Phase = 'ready' | 'running' | 'settling' | 'done';

export type DamageZone = 'front' | 'rear' | 'left' | 'right';

export type Severity = 'none' | 'minor' | 'moderate' | 'severe' | 'catastrophic';

/** User-adjustable experiment configuration. */
export interface RunConfig {
  /** Initial vehicle speed in km/h (10–200). */
  speedKmh: number;
  /** Vehicle mass in kg (700–3000). */
  massKg: number;
  /** Impact angle in degrees (-60..+60). 0 = head-on. */
  angleDeg: number;
  /** Selected obstacle. */
  obstacle: ObstacleType;
}

/** Live telemetry streamed from the simulation loop. */
export interface Telemetry {
  /** Current |velocity| of the car in km/h. */
  speedKmh: number;
  /** Current car position in world metres (X lateral, Y up, Z longitudinal). */
  x: number;
  y: number;
  z: number;
  /** Current heading (yaw) in degrees. */
  headingDeg: number;
}

/** Data captured at the moment of the first contact. */
export interface ImpactStats {
  /** Car speed at first contact (km/h). */
  impactSpeedKmh: number;
  /** Component of the closing velocity along the collision normal (km/h). */
  normalSpeedKmh: number;
  /** Total normal impulse exchanged during the primary impact (N·s). */
  impulseNs: number;
  /** Estimated impact force (kN) = impulse / assumed impact duration. */
  forceKN: number;
  /** Mechanical energy dissipated by the primary impact (kJ). */
  crushEnergyKJ: number;
  /** Primary damaged zone of the car. */
  zone: DamageZone;
  /** Damage percentage 0–100 (deterministic, derived from the collision). */
  damagePct: number;
  severity: Severity;
}

/** Full report of a finished run. */
export interface RunResult {
  config: RunConfig;
  impact: ImpactStats;
  /** Kinetic energy of the car before the run and after settling (kJ). */
  keBeforeKJ: number;
  keAfterKJ: number;
  /** Final car transform, metres / degrees, relative to the obstacle centre. */
  finalX: number;
  finalY: number;
  finalZ: number;
  finalYawDeg: number;
  finalPitchDeg: number;
  finalRollDeg: number;
  /** How far the obstacle itself moved (m). */
  obstacleDisplacementM: number;
  /** Total simulated wall-clock time of the experiment (s). */
  simTimeS: number;
}

/** One row of the session experiment history. */
export interface HistoryEntry {
  id: number;
  speedKmh: number;
  massKg: number;
  angleDeg: number;
  obstacle: ObstacleType;
  forceKN: number;
  damagePct: number;
  severity: Severity;
}

/** Instructions for the renderer produced by the physics side at impact. */
export interface DeformationSpec {
  zone: DamageZone;
  /** Average crush direction in car-local coordinates (unit-ish vector). */
  localDir: [number, number, number];
  /** Nominal crush depth in metres (0..~0.55). */
  crushDepth: number;
  /** Deterministic RNG seed for reproducible crumple noise. */
  seed: number;
}

export type DetachablePart = 'bumperF' | 'hood' | 'wheelFL' | 'wheelFR';

export interface ImpactVisuals {
  deform: DeformationSpec;
  detach: DetachablePart[];
  /** Camera shake amplitude (m). */
  shake: number;
}

export interface EngineEvents {
  onPhase?: (phase: Phase) => void;
  onTelemetry?: (t: Telemetry) => void;
  onImpactVisuals?: (v: ImpactVisuals) => void;
  onResetVisuals?: () => void;
  onResult?: (r: RunResult) => void;
}
