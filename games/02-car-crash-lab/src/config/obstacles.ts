import type { ObstacleType } from '../types';

/**
 * Obstacle definitions. Each obstacle differs in mass, restitution, friction
 * and "rigidity" (how directly its crush energy translates into car damage).
 */
export interface ObstacleSpec {
  id: ObstacleType;
  label: string;
  shortLabel: string;
  description: string;
  /** kg. 0 = bolted to the ground (infinite mass). */
  mass: number;
  /** Half extents (m): x width, y height, z depth. */
  half: { x: number; y: number; z: number };
  /** Coefficient of restitution for the car-obstacle contact. */
  restitution: number;
  /** Contact friction coefficient (tangential impulse cap). */
  friction: number;
  /** 0..1 — how much of the crush energy damages the car structure. */
  rigidity: number;
  /**
   * Assumed impact duration (s) used for the impact-force ESTIMATE
   * F = J / Δt. Stiffer obstacles stop the car faster.
   */
  impactDurationS: number;
  /** Kinetic friction coefficient against the ground (movable obstacles). */
  groundFriction: number;
  color: number;
  accentColor: number;
}

export const OBSTACLES: Record<ObstacleType, ObstacleSpec> = {
  concrete_wall: {
    id: 'concrete_wall',
    label: 'Concrete Wall',
    shortLabel: 'Wall',
    description: 'Reinforced concrete block anchored to the foundation — effectively immovable.',
    mass: 0,
    half: { x: 9, y: 1.5, z: 0.45 },
    restitution: 0.12,
    friction: 0.45,
    rigidity: 1.0,
    impactDurationS: 0.09,
    groundFriction: 0,
    color: 0x9aa0a8,
    accentColor: 0x6d737b
  },
  heavy_barrier: {
    id: 'heavy_barrier',
    label: 'Heavy Barrier',
    shortLabel: 'Heavy',
    description: '5 000 kg steel-and-concrete jersey barrier. Movable, but barely.',
    mass: 5000,
    half: { x: 2.4, y: 0.8, z: 0.55 },
    restitution: 0.18,
    friction: 0.5,
    rigidity: 0.8,
    impactDurationS: 0.13,
    groundFriction: 0.55,
    color: 0x3f6f8f,
    accentColor: 0xf0f4f8
  },
  light_barrier: {
    id: 'light_barrier',
    label: 'Lightweight Barrier',
    shortLabel: 'Light',
    description: '320 kg plastic water barrier — absorbs little energy and is thrown clear.',
    mass: 320,
    half: { x: 1.6, y: 0.6, z: 0.35 },
    restitution: 0.35,
    friction: 0.3,
    rigidity: 0.5,
    impactDurationS: 0.22,
    groundFriction: 0.35,
    color: 0xe05a2b,
    accentColor: 0xb23d15
  }
};

export const OBSTACLE_ORDER: ObstacleType[] = ['concrete_wall', 'heavy_barrier', 'light_barrier'];
