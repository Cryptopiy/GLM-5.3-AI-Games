import * as THREE from 'three';
import type { World } from './World';
import type { Vehicle } from './Vehicle';
import { makeCharacter, type CharacterParts } from './Entities';
import { angDiff, circleVsAABB, circleVsCircle, clamp } from './physics';

export type PedState = 'walk' | 'wait' | 'flee' | 'down';

const SHIRTS = [0xd95f5f, 0x5f8fd9, 0x63c47a, 0xd9b45f, 0xa06fd0, 0x5fc4c0, 0xe0e0e0];
const PANTS = [0x33414f, 0x4a3b2e, 0x2e3a2e, 0x50505a];

/** A sidewalk NPC with a tiny state machine:
 *  walk → (wait | flee) → walk; knocked down by cars → down → walk. */
export class Pedestrian {
  x: number;
  z: number;
  heading: number;
  state: PedState = 'walk';
  speed: number;
  timer = 0;
  walkPhase = Math.random() * 10;
  target: number;
  private fleeX = 0;
  private fleeZ = 0;
  private stuckFrames = 0;
  readonly mesh: CharacterParts;

  constructor(
    private world: World,
    rng: () => number,
  ) {
    const wps = world.pedWaypoints;
    const idx = Math.floor(rng() * wps.length);
    const wp = wps[idx];
    this.x = wp.x + (rng() - 0.5) * 2;
    this.z = wp.z + (rng() - 0.5) * 2;
    this.heading = rng() * Math.PI * 2;
    this.speed = 1.5 + rng() * 1.0;
    this.target = idx;
    this.mesh = makeCharacter({
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      pants: PANTS[Math.floor(rng() * PANTS.length)],
      skin: 0xe8c39a,
    });
    this.mesh.group.position.set(this.x, 0.14, this.z);
  }

  knock(dirX: number, dirZ: number): void {
    if (this.state === 'down') return;
    this.state = 'down';
    this.timer = 6 + Math.random() * 3;
    this.x += dirX * 1.4;
    this.z += dirZ * 1.4;
    this.mesh.group.rotation.set(Math.PI / 2, this.heading, 0);
    this.mesh.group.position.set(this.x, 0.45, this.z);
  }

  private nearestWaypoint(): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.world.pedWaypoints.length; i++) {
      const wp = this.world.pedWaypoints[i];
      const d = (wp.x - this.x) ** 2 + (wp.z - this.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  update(dt: number, vehicles: Vehicle[]): void {
    const g = this.mesh.group;

    if (this.state === 'down') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'walk';
        this.target = this.nearestWaypoint();
        g.rotation.set(0, this.heading, 0);
      }
      g.position.set(this.x, 0.45, this.z);
      return;
    }

    // Danger sense: any fast vehicle nearby (or a vehicle closing in).
    for (const v of vehicles) {
      if (Math.abs(v.speed) < 4 && v.distanceTo(this.x, this.z) > 3) continue;
      const d = v.distanceTo(this.x, this.z);
      if (d < 8) {
        this.state = 'flee';
        this.timer = 1.6 + Math.random() * 1.4;
        const inv = 1 / Math.max(d, 0.001);
        this.fleeX = (this.x - v.x) * inv;
        this.fleeZ = (this.z - v.z) * inv;
        break;
      }
    }

    let mx = 0;
    let mz = 0;

    if (this.state === 'flee') {
      this.timer -= dt;
      mx = this.fleeX;
      mz = this.fleeZ;
      const sp = this.speed * 2.3;
      if (this.timer <= 0) {
        this.state = 'walk';
        this.target = this.nearestWaypoint();
      }
      this.x += mx * sp * dt;
      this.z += mz * sp * dt;
      this.walkPhase += dt * sp * 1.6;
    } else if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'walk';
    } else {
      // walk
      const wp = this.world.pedWaypoints[this.target];
      const dx = wp.x - this.x;
      const dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) {
        const nbrs = wp.neighbors;
        this.target = nbrs[Math.floor(Math.random() * nbrs.length)];
        if (Math.random() < 0.3) {
          this.state = 'wait';
          this.timer = 1 + Math.random() * 2.5;
        }
      } else {
        mx = dx / d;
        mz = dz / d;
        this.x += mx * this.speed * dt;
        this.z += mz * this.speed * dt;
        this.walkPhase += dt * this.speed * 1.6;
      }
    }

    // Static collisions; if persistently blocked, re-target.
    let pushed = false;
    for (const b of this.world.buildingAABBs) {
      if (Math.abs(this.x - b.x) > b.hx + 2 || Math.abs(this.z - b.z) > b.hz + 2)
        continue;
      const p = circleVsAABB(this.x, this.z, 0.4, b);
      if (p) {
        this.x += p.x;
        this.z += p.z;
        pushed = true;
      }
    }
    for (const c of this.world.obstacles) {
      if (Math.abs(this.x - c.x) > 3 || Math.abs(this.z - c.z) > 3) continue;
      const p = circleVsCircle(this.x, this.z, 0.4, c);
      if (p) {
        this.x += p.x;
        this.z += p.z;
        pushed = true;
      }
    }
    if (pushed && this.state === 'walk') {
      this.stuckFrames++;
      if (this.stuckFrames > 30) {
        this.stuckFrames = 0;
        this.target = this.nearestWaypoint();
      }
    } else {
      this.stuckFrames = 0;
    }

    this.x = clamp(this.x, -102, 102);
    this.z = clamp(this.z, -102, 102);

    // Visuals.
    const moving = this.state !== 'wait';
    if (moving && (mx !== 0 || mz !== 0)) {
      const target = Math.atan2(mx, mz);
      this.heading += angDiff(this.heading, target) * (1 - Math.exp(-10 * dt));
    }
    g.position.set(this.x, 0.14, this.z);
    g.rotation.set(0, this.heading, 0);
    const swing = moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.mesh.legL.rotation.x = swing;
    this.mesh.legR.rotation.x = -swing;
    this.mesh.armL.rotation.x = -swing * 0.7;
    this.mesh.armR.rotation.x = swing * 0.7;
    g.position.y = 0.14 + (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0);
  }
}
