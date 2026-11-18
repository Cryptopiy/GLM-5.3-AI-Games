import * as THREE from 'three';
import type { World } from './World';
import { Vehicle } from './Vehicle';
import { angDiff, clamp } from './physics';

interface PoliceUnit {
  vehicle: Vehicle;
  stuckTimer: number;
  reverseTimer: number;
}

export interface PoliceTarget {
  x: number;
  z: number;
  vx: number;
  vz: number;
  onFoot: boolean;
}

export interface PoliceHooks {
  onWanted: (level: number, reason: string) => void;
  onStarLost: () => void;
  onBusted: () => void;
}

const ESCAPE_TIME = 12;

/** Wanted-level manager + pursuit AI. Police cars seek the player with a
 *  simple pursuit curve, unstick themselves by reversing, and give up after
 *  the player stays out of sight long enough. */
export class PoliceSystem {
  wanted = 0;
  escapeProgress = 0;
  private units: PoliceUnit[] = [];
  private lastSeen = 0;
  private now = 0;
  private bustedTimer = 0;

  constructor(
    private world: World,
    private rng: () => number,
    private scene: THREE.Scene,
    private hooks: PoliceHooks,
  ) {}

  get unitCount(): number {
    return this.units.length;
  }

  policeVehicles(): Vehicle[] {
    return this.units.map((u) => u.vehicle);
  }

  setWanted(level: number, reason: string): void {
    if (level > this.wanted) {
      this.wanted = Math.min(level, 3);
      this.lastSeen = this.now;
      this.hooks.onWanted(this.wanted, reason);
    } else if (level > 0 && this.wanted > 0) {
      this.lastSeen = this.now; // re-seen while already wanted
    }
  }

  clearWanted(): void {
    this.wanted = 0;
    this.bustedTimer = 0;
    this.escapeProgress = 0;
    this.despawnAll();
  }

  private despawnAll(): void {
    for (const u of this.units) this.scene.remove(u.vehicle.parts.group);
    this.units.length = 0;
  }

  private spawnUnit(target: PoliceTarget, allVehicles: Vehicle[]): boolean {
    for (let attempt = 0; attempt < 14; attempt++) {
      const lp = this.world.randomLanePoint(this.rng);
      const d = Math.hypot(lp.x - target.x, lp.z - target.z);
      if (d < 45 || d > 100) continue;
      const v = new Vehicle('police', 0xe9edf2, lp.x, lp.z, lp.heading);
      v.driver = 'police';
      v.speed = 6;
      v.heading = Math.atan2(target.x - lp.x, target.z - lp.z);
      this.units.push({ vehicle: v, stuckTimer: 0, reverseTimer: 0 });
      this.scene.add(v.parts.group);
      allVehicles.push(v);
      return true;
    }
    return false;
  }

  update(
    dt: number,
    time: number,
    target: PoliceTarget,
    allVehicles: Vehicle[],
  ): void {
    this.now = time;

    if (this.wanted <= 0) {
      if (this.units.length > 0) this.despawnAll();
      this.escapeProgress = 0;
      return;
    }

    while (this.units.length < this.wanted) {
      if (!this.spawnUnit(target, allVehicles)) break;
    }

    let minDist = Infinity;
    let nearestSlowAndClose = false;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const v = u.vehicle;

      const dist = Math.hypot(target.x - v.x, target.z - v.z);
      if (dist < minDist) minDist = dist;
      if (dist < 4.8 && Math.abs(v.speed) < 3.5) nearestSlowAndClose = true;

      // Reposition units that fell far behind.
      if (dist > 170) {
        this.scene.remove(v.parts.group);
        const idx = allVehicles.indexOf(v);
        if (idx >= 0) allVehicles.splice(idx, 1);
        this.units.splice(i, 1);
        continue;
      }

      // Pursuit steering with lead prediction.
      const aimX = target.x + target.vx * 0.35;
      const aimZ = target.z + target.vz * 0.35;
      const desired = Math.atan2(aimX - v.x, aimZ - v.z);
      const diff = angDiff(v.heading, desired);

      if (u.reverseTimer > 0) {
        u.reverseTimer -= dt;
        v.throttle = 0;
        v.braking = 1;
        v.wantReverse = true;
        v.steer = clamp(-Math.sign(diff) * 0.8, -1, 1);
      } else if (Math.abs(diff) > 2.2 && dist > 5) {
        // Target is behind: back up and swing around.
        v.throttle = 0;
        v.braking = 1;
        v.wantReverse = true;
        v.steer = clamp(Math.sign(diff) * 0.7, -1, 1);
      } else {
        v.wantReverse = false;
        v.braking = 0;
        v.steer = clamp(diff * 2.2, -1, 1);
        let desiredSpeed: number;
        if (target.onFoot) {
          desiredSpeed = dist < 6 ? 0 : Math.min(13, 5 + dist * 0.25);
        } else {
          desiredSpeed = Math.min(v.maxSpeed, 13 + this.wanted * 3);
        }
        v.throttle = v.speed < desiredSpeed ? 1 : 0;
        if (v.speed > desiredSpeed + 2) {
          v.braking = 0.7;
          v.throttle = 0;
        }
      }

      // Stuck detection → short reversing burst.
      if (v.throttle > 0 && Math.abs(v.speed) < 0.8) {
        u.stuckTimer += dt;
        if (u.stuckTimer > 1.3) {
          u.reverseTimer = 1.1;
          u.stuckTimer = 0;
        }
      } else {
        u.stuckTimer = Math.max(0, u.stuckTimer - dt);
      }

      v.step(dt);
      v.updateLights(time);
      v.syncMesh();
    }

    while (this.units.length < this.wanted) {
      if (!this.spawnUnit(target, allVehicles)) break;
    }

    // Escape logic: unseen for long enough → lose a star.
    if (minDist < 55) this.lastSeen = time;
    this.escapeProgress = clamp((time - this.lastSeen) / ESCAPE_TIME, 0, 1);
    if (time - this.lastSeen > ESCAPE_TIME) {
      this.lastSeen = time;
      this.wanted--;
      if (this.wanted <= 0) {
        this.wanted = 0;
        this.despawnAll();
        this.hooks.onStarLost();
      } else {
        this.hooks.onStarLost();
      }
    }

    // Busted: a stationary police car stays next to the player on foot.
    if (nearestSlowAndClose && target.onFoot) {
      this.bustedTimer += dt;
      if (this.bustedTimer > 2) {
        this.bustedTimer = 0;
        this.hooks.onBusted();
      }
    } else {
      this.bustedTimer = Math.max(0, this.bustedTimer - dt * 0.7);
    }
  }
}
