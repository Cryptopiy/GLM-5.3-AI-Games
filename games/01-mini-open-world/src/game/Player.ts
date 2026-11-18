import * as THREE from 'three';
import type { Input } from './Input';
import type { World } from './World';
import type { Vehicle } from './Vehicle';
import { makeCharacter, type CharacterParts } from './Entities';
import { angDiff, circleVsAABB, circleVsCircle, circleVsOBB, clamp } from './physics';

const WALK_SPEED = 6.4;
const RADIUS = 0.42;

/** Player character controlled on foot. */
export class Player {
  x: number;
  z: number;
  heading = 0;
  moving = false;
  walkPhase = 0;
  readonly mesh: CharacterParts;

  constructor(spawnX: number, spawnZ: number, spawnHeading: number) {
    this.x = spawnX;
    this.z = spawnZ;
    this.heading = spawnHeading;
    this.mesh = makeCharacter({
      shirt: 0xff8c3a,
      pants: 0x2c3e50,
      skin: 0xf0c8a0,
      hat: 0xffffff,
    });
    this.mesh.group.position.set(spawnX, 0.14, spawnZ);
  }

  setVisible(v: boolean): void {
    this.mesh.group.visible = v;
  }

  teleport(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  /** Camera-relative WASD movement with collisions against the static world
   *  and every vehicle body. */
  update(dt: number, input: Input, camYaw: number, world: World, vehicles: Vehicle[]): void {
    const ix =
      (input.isDown('KeyD', 'ArrowRight') ? 1 : 0) -
      (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const iz =
      (input.isDown('KeyW', 'ArrowUp') ? 1 : 0) -
      (input.isDown('KeyS', 'ArrowDown') ? 1 : 0);

    let mx = 0;
    let mz = 0;
    if (ix !== 0 || iz !== 0) {
      const sy = Math.sin(camYaw);
      const cy = Math.cos(camYaw);
      mx = sy * iz - cy * ix;
      mz = cy * iz + sy * ix;
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
    }
    this.moving = mx !== 0 || mz !== 0;

    if (this.moving) {
      const target = Math.atan2(mx, mz);
      this.heading += angDiff(this.heading, target) * (1 - Math.exp(-12 * dt));
      this.x += mx * WALK_SPEED * dt;
      this.z += mz * WALK_SPEED * dt;
      this.walkPhase += dt * WALK_SPEED * 1.6;
    } else {
      this.walkPhase *= 0.8;
    }

    // Collisions: static boxes, props, vehicles.
    for (const b of world.buildingAABBs) {
      if (Math.abs(this.x - b.x) > b.hx + 2 || Math.abs(this.z - b.z) > b.hz + 2) continue;
      const p = circleVsAABB(this.x, this.z, RADIUS, b);
      if (p) {
        this.x += p.x;
        this.z += p.z;
      }
    }
    for (const c of world.obstacles) {
      if (Math.abs(this.x - c.x) > 3 || Math.abs(this.z - c.z) > 3) continue;
      const p = circleVsCircle(this.x, this.z, RADIUS, c);
      if (p) {
        this.x += p.x;
        this.z += p.z;
      }
    }
    for (const v of vehicles) {
      if (Math.abs(this.x - v.x) > 5 || Math.abs(this.z - v.z) > 5) continue;
      const p = circleVsOBB(
        this.x,
        this.z,
        RADIUS + 0.1,
        v.x,
        v.z,
        v.heading,
        v.hl,
        v.hw,
      );
      if (p) {
        this.x += p.x;
        this.z += p.z;
      }
    }

    // Keep inside city bounds.
    this.x = clamp(this.x, -103, 103);
    this.z = clamp(this.z, -103, 103);

    // Animate.
    const g = this.mesh.group;
    g.position.set(this.x, 0.14, this.z);
    g.rotation.y = this.heading;
    const swing = Math.sin(this.walkPhase) * (this.moving ? 0.65 : 0);
    this.mesh.legL.rotation.x = swing;
    this.mesh.legR.rotation.x = -swing;
    this.mesh.armL.rotation.x = -swing * 0.7;
    this.mesh.armR.rotation.x = swing * 0.7;
    g.position.y = 0.14 + (this.moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0);
  }
}
