import type { Input } from './Input';
import { makeCar, type CarParts } from './Entities';
import { clamp } from './physics';

export type VehicleKind = 'civil' | 'police' | 'mission';
export type Driver = 'none' | 'player' | 'traffic' | 'police';

let nextId = 1;

/** Shared car entity: visuals, arcade longitudinal physics, visual wheels.
 *  Steering / throttle decisions come from the controller (player input,
 *  traffic AI, or police AI) via setControls(); step() integrates motion. */
export class Vehicle {
  readonly id = nextId++;
  readonly kind: VehicleKind;
  readonly parts: CarParts;
  x: number;
  z: number;
  heading: number;
  speed = 0;
  hl = 2.2;
  hw = 0.98;
  hp = 100;
  driver: Driver = 'none';
  cruise = 9;

  // Control state, filled by an AI or player input each frame.
  throttle = 0; // 0..1 forward
  braking = 0; // 0..1
  wantReverse = false;
  steer = 0; // -1..1

  private wheelSpin = 0;

  constructor(kind: VehicleKind, color: number, x: number, z: number, heading: number) {
    this.kind = kind;
    this.parts = makeCar(kind, color);
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.syncMesh();
  }

  get maxSpeed(): number {
    return this.kind === 'police' ? 24 : 21;
  }

  /** Player driving: read controls directly from the keyboard. */
  applyPlayerInput(input: Input): void {
    this.throttle = input.isDown('KeyW', 'ArrowUp') ? 1 : 0;
    this.braking = input.isDown('KeyS', 'ArrowDown') ? 1 : 0;
    this.wantReverse = true;
    const handbrake = input.isDown('Space') ? 1 : 0;
    this.braking = Math.max(this.braking, handbrake * 0.9);
    this.steer =
      (input.isDown('KeyD', 'ArrowRight') ? 1 : 0) -
      (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
  }

  clearControls(): void {
    this.throttle = 0;
    this.braking = 0;
    this.steer = 0;
    this.wantReverse = false;
  }

  /** Integrate one physics step. dt already clamped by the game loop. */
  step(dt: number): void {
    const accel = this.kind === 'police' ? 15 : 12.5;
    const brakeForce = 26;

    if (this.throttle > 0 && this.speed < this.maxSpeed) {
      this.speed += accel * this.throttle * dt;
    }
    if (this.braking > 0) {
      if (this.speed > 0.4) {
        this.speed -= brakeForce * this.braking * dt;
      } else if (this.wantReverse) {
        this.speed = Math.max(this.speed - accel * 0.55 * this.braking * dt, -7.5);
      }
    }
    if (this.throttle === 0 && this.braking === 0) {
      // Engine drag + rolling resistance.
      const drag = this.speed * 0.45 + Math.sign(this.speed) * 1.8;
      this.speed -= drag * dt;
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }

    this.speed = clamp(this.speed, -7.5, this.maxSpeed);

    // Steering: effective turn rate scales with speed and flips in reverse.
    const sf = clamp(this.speed / 8, -1, 1);
    const highSpeedFade = 1 - (Math.abs(this.speed) / this.maxSpeed) * 0.35;
    this.heading += this.steer * 1.85 * sf * highSpeedFade * dt;

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;

    this.wheelSpin += (this.speed / 0.36) * dt;
  }

  /** Push out along a collision normal and lose speed according to impact. */
  applyPush(px: number, pz: number): number {
    this.x += px;
    this.z += pz;
    const len = Math.hypot(px, pz);
    if (len < 0.0005) return 0;
    // How much of the velocity points into the obstacle.
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const into = -(fx * px + fz * pz) / len; // 1 = head-on
    const impact = Math.max(0, into) * Math.abs(this.speed);
    this.speed *= 1 - clamp(Math.max(0, into), 0, 1) * 0.75;
    return impact;
  }

  syncMesh(): void {
    const g = this.parts.group;
    g.position.set(this.x, 0, this.z);
    g.rotation.y = this.heading;
    for (const w of this.parts.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.parts.frontPivots) p.rotation.y = this.steer * 0.45;
  }

  /** Spin police beacon lights. */
  updateLights(time: number): void {
    if (!this.parts.lightMatA || !this.parts.lightMatB) return;
    const phase = Math.floor(time * 5) % 2 === 0;
    this.parts.lightMatA.emissiveIntensity = phase ? 2.4 : 0.15;
    this.parts.lightMatB.emissiveIntensity = phase ? 0.15 : 2.4;
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }
}

export function vehicleColor(index: number): number {
  const palette = [
    0xcfd6dd, 0xd94f4f, 0x4f7bd9, 0x4fae62, 0xe0b23c, 0x8a5fc0, 0x3a3f46,
    0xd97fb0,
  ];
  return palette[index % palette.length];
}
