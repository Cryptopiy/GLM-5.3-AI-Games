import * as THREE from 'three';
import type { World } from './World';
import { LANE } from './World';
import { Vehicle, vehicleColor } from './Vehicle';
import type { Pedestrian } from './Pedestrian';
import { angDiff, clamp } from './physics';

interface TrafficCar {
  vehicle: Vehicle;
  fromNode: number;
  toNode: number;
  blockedTimer: number;
}

const TARGET_COUNT = 10;

/** NPC vehicles driving lane-offset routes over the intersection graph.
 *  Right-hand traffic: driving direction (dx,dz) keeps its lane offset at
 *  right = (-dz, dx) * LANE. */
export class TrafficSystem {
  private cars: TrafficCar[] = [];
  private spawnCooldown = 0;
  private rng: () => number;

  constructor(
    private world: World,
    rng: () => number,
    scene: THREE.Scene,
  ) {
    this.rng = rng;
    for (let n = 0; n < TARGET_COUNT; n++) {
      const c = this.spawnAnywhere();
      if (c) {
        this.cars.push(c);
        scene.add(c.vehicle.parts.group);
      }
    }
  }

  /** Point partway along the lane of edge from→to, heading toward `to`. */
  private edgePoint(
    from: number,
    to: number,
    t: number,
  ): { x: number; z: number; heading: number } {
    const A = this.world.roadNodes[from];
    const B = this.world.roadNodes[to];
    const dx = Math.sign(B.x - A.x);
    const dz = Math.sign(B.z - A.z);
    const ax = A.x - dz * LANE;
    const az = A.z + dx * LANE;
    const bx = B.x - dz * LANE;
    const bz = B.z + dx * LANE;
    return {
      x: ax + (bx - ax) * t,
      z: az + (bz - az) * t,
      heading: Math.atan2(dx, dz),
    };
  }

  private spawnAnywhere(): TrafficCar | null {
    const nodes = this.world.roadNodes;
    const a = Math.floor(this.rng() * nodes.length);
    const nbrs = this.world.nodeNeighbors(a);
    if (nbrs.length === 0) return null;
    const b = nbrs[Math.floor(this.rng() * nbrs.length)];
    const start = this.edgePoint(a, b, 0.15 + this.rng() * 0.7);
    const v = new Vehicle(
      'civil',
      vehicleColor(Math.floor(this.rng() * 8)),
      start.x,
      start.z,
      start.heading,
    );
    v.driver = 'traffic';
    v.cruise = 7.5 + this.rng() * 3;
    v.speed = v.cruise * 0.5;
    return { vehicle: v, fromNode: a, toNode: b, blockedTimer: 0 };
  }

  /** Remove a car from AI control (when the player carjacks it). */
  remove(vehicle: Vehicle): void {
    const i = this.cars.findIndex((c) => c.vehicle === vehicle);
    if (i >= 0) this.cars.splice(i, 1);
  }

  vehicles(): Vehicle[] {
    return this.cars.map((c) => c.vehicle);
  }

  update(
    dt: number,
    allVehicles: Vehicle[],
    playerX: number,
    playerZ: number,
    playerOnFoot: boolean,
    peds: Pedestrian[],
    time: number,
    scene: THREE.Scene,
  ): void {
    this.spawnCooldown -= dt;
    if (this.cars.length < TARGET_COUNT && this.spawnCooldown <= 0) {
      this.spawnCooldown = 1.5;
      const c = this.spawnAnywhere();
      if (c && c.vehicle.distanceTo(playerX, playerZ) > 45) {
        this.cars.push(c);
        scene.add(c.vehicle.parts.group);
        allVehicles.push(c.vehicle);
      }
    }

    for (const c of this.cars) {
      const v = c.vehicle;
      const target = this.edgePoint(c.fromNode, c.toNode, 1);
      const dx = target.x - v.x;
      const dz = target.z - v.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 4.5) {
        // Arrived at the intersection: pick the next edge, prefer straight.
        const nbrs = this.world.nodeNeighbors(c.toNode);
        const options = nbrs.filter((n) => n !== c.fromNode);
        const pool = options.length > 0 ? options : nbrs;
        const fromNode = this.world.roadNodes[c.fromNode];
        const toNode = this.world.roadNodes[c.toNode];
        const inDx = Math.sign(toNode.x - fromNode.x);
        const inDz = Math.sign(toNode.z - fromNode.z);
        const weighted: number[] = [];
        for (const n of pool) {
          const nn = this.world.roadNodes[n];
          const straight =
            Math.sign(nn.x - toNode.x) === inDx &&
            Math.sign(nn.z - toNode.z) === inDz;
          for (let w = 0; w < (straight ? 3 : 1); w++) weighted.push(n);
        }
        c.fromNode = c.toNode;
        c.toNode = weighted[Math.floor(this.rng() * weighted.length)];
      }

      // Steer toward the current lane target.
      const desired = Math.atan2(dx, dz);
      const diff = angDiff(v.heading, desired);
      const maxTurn = (1.5 + Math.abs(v.speed) * 0.06) * dt;
      v.steer = clamp(diff * 2.5, -1, 1);
      v.heading += clamp(diff, -maxTurn, maxTurn);

      // Obstacle probe ahead: vehicles, the walking player, pedestrians.
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      const probeDist = 4.2 + Math.abs(v.speed) * 0.55;
      const px = v.x + fx * probeDist;
      const pz = v.z + fz * probeDist;
      let blocked = false;
      for (const other of allVehicles) {
        if (other === v) continue;
        if (other.distanceTo(px, pz) < 3.5) {
          blocked = true;
          break;
        }
      }
      if (!blocked && playerOnFoot) {
        const dpx = px - playerX;
        const dpz = pz - playerZ;
        if (dpx * dpx + dpz * dpz < 6.8) blocked = true;
      }
      if (!blocked) {
        for (const ped of peds) {
          if (ped.state === 'down') continue;
          const dxp = px - ped.x;
          const dzp = pz - ped.z;
          if (dxp * dxp + dzp * dzp < 5.8) {
            blocked = true;
            break;
          }
        }
      }

      const cruise = dist < 9 ? Math.min(v.cruise, 5.5) : v.cruise;
      if (blocked) {
        v.throttle = 0;
        v.braking = 1;
        v.wantReverse = false;
        c.blockedTimer += dt;
      } else {
        c.blockedTimer = 0;
        v.braking = 0;
        v.wantReverse = false;
        v.throttle = Math.abs(v.speed) < cruise ? 1 : 0;
      }

      v.step(dt);
      v.updateLights(time);
      v.syncMesh();
    }
  }
}
