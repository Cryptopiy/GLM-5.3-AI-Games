import type { ObstacleSpec } from '../config/obstacles';
import { severityLabel } from '../config/constants';
import type { Severity } from '../types';

/**
 * ---------------------------------------------------------------------------
 * Simplified crash-math models (documented assumptions).
 * ---------------------------------------------------------------------------
 *
 * IMPACT FORCE — this is an ESTIMATE, not a measurement:
 *     F ≈ J / Δt
 * where J is the normal impulse actually exchanged by the impulse solver
 * during the primary impact and Δt is an assumed crush/impact duration that
 * depends on obstacle stiffness (wall 90 ms, heavy barrier 130 ms,
 * light barrier 220 ms). Real crash pulses depend on the entire crush
 * structure; the estimate is shown as "≈" in the UI.
 *
 * DAMAGE MODEL — percentage of structural damage to the vehicle:
 *     D = 100 · (1 − exp(−k · E_crush / E_ref))
 *     E_ref = ½ · m · v_ref²,  v_ref = 18 m/s (≈ 65 km/h)
 * E_crush is the mechanical energy dissipated by the primary impact
 * (KE_before − KE_after of both bodies). k is the obstacle rigidity
 * (wall 1.0, heavy 0.8, light 0.5). The exponential saturates so that
 * damage approaches but never exceeds 100 %.
 *
 * Severity bands: <0.5 none, <20 minor, <50 moderate, <80 severe, ≥80
 * catastrophic.
 */

/** Reference speed for the damage normalisation (m/s ≈ 65 km/h). */
export const DAMAGE_REF_SPEED_MS = 18;

/** Estimated average impact force in newtons. */
export function estimateForceN(impulseNs: number, obstacle: ObstacleSpec): number {
  return impulseNs / obstacle.impactDurationS;
}

/** Damage percentage 0–100 derived from crush energy and obstacle rigidity. */
export function estimateDamagePct(crushEnergyJ: number, carMassKg: number, obstacle: ObstacleSpec): number {
  const eRef = 0.5 * carMassKg * DAMAGE_REF_SPEED_MS * DAMAGE_REF_SPEED_MS;
  if (eRef <= 0) return 0;
  const ratio = (obstacle.rigidity * Math.max(0, crushEnergyJ)) / eRef;
  const pct = 100 * (1 - Math.exp(-ratio));
  return Math.min(100, Math.max(0, pct));
}

export function damageSeverity(damagePct: number): Severity {
  return severityLabel(damagePct) as Severity;
}

/** Kinetic energy of a point mass (kJ). */
export function kineticEnergyKJ(massKg: number, speedMs: number): number {
  return 0.5 * massKg * speedMs * speedMs / 1000;
}

/** Nominal crush depth of the deformed car zone (m), for visuals. */
export function crushDepthFor(damagePct: number): number {
  const t = damagePct / 100;
  return 0.03 + 0.52 * Math.pow(t, 1.35);
}
