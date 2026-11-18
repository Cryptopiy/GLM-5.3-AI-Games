// Global tunables and unit helpers.

export const GRAVITY = 9.81; // m/s²

export const KMH_PER_MS = 3.6;

/** Fixed physics substep (s). Small enough to avoid tunnelling at 200 km/h. */
export const SUBSTEP = 1 / 240;
/** Max substeps per rendered frame (12 -> 20 s of sim per real second cap). */
export const MAX_SUBSTEPS = 12;

/** Car approach takes ~2.2 s of driving regardless of speed, clamped 20–90 m. */
export const APPROACH_SECONDS = 2.2;
export const APPROACH_MIN_M = 20;
export const APPROACH_MAX_M = 90;

/** Settle timeout after impact (s of simulated time). */
export const SETTLE_TIMEOUT = 14;
/** Hard timeout if no contact happens (s). */
export const NO_IMPACT_TIMEOUT = 40;

export const SPEED_RANGE = { min: 10, max: 200, step: 5, default: 80 } as const;
export const MASS_RANGE = { min: 700, max: 3000, step: 50, default: 1400 } as const;
export const ANGLE_RANGE = { min: -60, max: 60, step: 5, default: 0 } as const;

/** Car body half extents (m): width, height, length. Front of car = +Z. */
export const CAR_HALF = { x: 0.93, y: 0.62, z: 2.2 };
/** Resting height of the car body centre above ground (m). */
export const CAR_REST_Y = 0.66;

export const COLORS = {
  carPaint: 0xd0342c,
  carPaintDark: 0x7a1d18,
  glass: 0x9fd4e8,
  tire: 0x14161a,
  rim: 0xb9c0c9,
  headlight: 0xfff2c8,
  taillight: 0xff3b30,
  asphalt: 0x1b1f26,
  asphaltTrack: 0x262b33,
  line: 0xe8ecf2,
  ground: 0x121620,
  impactZone: 0xf5b31b,
  concrete: 0x9aa0a8,
  heavyBarrier: 0x3f6f8f,
  heavyStripe: 0xf0f4f8,
  lightBarrier: 0xe05a2b,
  marker: 0xf2f5f9
} as const;

/** Damage severity bands (percent). */
export const SEVERITY_BANDS: Array<{ limit: number; label: string }> = [
  { limit: 0.5, label: 'none' },
  { limit: 20, label: 'minor' },
  { limit: 50, label: 'moderate' },
  { limit: 80, label: 'severe' },
  { limit: 100.01, label: 'catastrophic' }
];

export function severityLabel(damagePct: number): string {
  for (const band of SEVERITY_BANDS) {
    if (damagePct < band.limit) return band.label;
  }
  return 'catastrophic';
}
