import * as THREE from 'three';
import {
  ANGLE_RANGE,
  APPROACH_MAX_M,
  APPROACH_MIN_M,
  APPROACH_SECONDS,
  CAR_HALF,
  CAR_REST_Y,
  GRAVITY,
  KMH_PER_MS,
  MAX_SUBSTEPS,
  NO_IMPACT_TIMEOUT,
  SETTLE_TIMEOUT,
  SUBSTEP
} from '../config/constants';
import { OBSTACLES, type ObstacleSpec } from '../config/obstacles';
import { RigidBody } from './body';
import { obbContact, resolveContact } from './collision';
import { clamp, degToRad, hashConfig, mulberry32, radToDeg } from './math';
import {
  crushDepthFor,
  damageSeverity,
  estimateDamagePct,
  estimateForceN,
  kineticEnergyKJ
} from './formulas';
import type {
  DamageZone,
  DetachablePart,
  DeformationSpec,
  EngineEvents,
  ImpactStats,
  ImpactVisuals,
  Phase,
  RunConfig,
  RunResult,
  Telemetry
} from '../types';

export interface DebrisPiece {
  kind: 'metal' | 'glass' | 'bumperF' | 'hood' | 'wheel';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Box half extents for rendering (wheels render as cylinders). */
  half: THREE.Vector3;
  color: string;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  angle: number;
  restY: number;
  resting: boolean;
}

export interface SparkParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface TireMark {
  pos: THREE.Vector3;
  yaw: number;
  len: number;
  width: number;
  alpha: number;
}

const DEFAULT_CONFIG: RunConfig = {
  speedKmh: 80,
  massKg: 1400,
  angleDeg: 0,
  obstacle: 'concrete_wall'
};

/**
 * SimulationEngine owns the whole experiment:
 * phases ready → running → settling → done, rigid bodies, effects and the
 * impact statistics. Rendering components read its state every frame; React
 * only receives throttled telemetry and terminal events.
 */
export class SimulationEngine {
  config: RunConfig = { ...DEFAULT_CONFIG };

  car = new RigidBody(new THREE.Vector3(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z), 1400);
  obstacle: RigidBody = new RigidBody(new THREE.Vector3(9, 1.5, 0.45), 0);
  private obstacleStart = new THREE.Vector3();

  debris: DebrisPiece[] = [];
  sparks: SparkParticle[] = [];
  tireMarks: TireMark[] = [];
  /** Decaying camera-shake amplitude (m). */
  shake = 0;

  phase: Phase = 'ready';
  paused = false;
  timeScale = 1;

  impact: ImpactStats | null = null;
  result: RunResult | null = null;
  live: Telemetry = { speedKmh: 0, x: 0, y: CAR_REST_Y, z: 0, headingDeg: 0 };

  private listeners: EngineEvents[] = [];

  /** Subscribe to engine events; returns an unsubscribe function. */
  addListener(l: EngineEvents): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emitPhase(p: Phase): void {
    for (const l of this.listeners) l.onPhase?.(p);
  }

  private emitTelemetry(t: Telemetry): void {
    for (const l of this.listeners) l.onTelemetry?.(t);
  }

  private emitImpactVisuals(v: ImpactVisuals): void {
    for (const l of this.listeners) l.onImpactVisuals?.(v);
  }

  private emitResetVisuals(): void {
    for (const l of this.listeners) l.onResetVisuals?.();
  }

  private emitResult(r: RunResult): void {
    for (const l of this.listeners) l.onResult?.(r);
  }

  private simTime = 0;
  private settleTimer = 0;
  private rng: () => number = mulberry32(1);
  private keBeforeKJ = 0;
  private lastImpactCarVel = new THREE.Vector3();
  private impactContactDone = false;
  private telemetryAcc = 0;
  private lastMarkPos = new THREE.Vector3(0, 0, -1e9);

  constructor() {
    this.applyConfig(this.config);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Update user parameters. Applied immediately when idle, else on next run. */
  applyConfig(cfg: RunConfig): void {
    this.config = { ...cfg };
    if (this.phase === 'ready' || this.phase === 'done') {
      this.reset();
    }
  }

  reset(): void {
    const cfg = this.config;
    const spec = OBSTACLES[cfg.obstacle];

    // Deterministic RNG per configuration → reproducible crumple patterns.
    this.rng = mulberry32(hashConfig([cfg.speedKmh, cfg.massKg, cfg.angleDeg, cfg.obstacle]));

    // --- obstacle body ---
    this.obstacle = new RigidBody(
      new THREE.Vector3(spec.half.x, spec.half.y, spec.half.z),
      spec.mass
    );
    this.obstacle.restitution = spec.restitution;
    this.obstacle.friction = spec.friction;
    this.obstacle.position.set(0, spec.half.y, 0);
    this.obstacleStart.copy(this.obstacle.position);

    // --- car body, aimed at the obstacle centre from `dist` metres back ---
    const speedMs = cfg.speedKmh / KMH_PER_MS;
    const angle = degToRad(clamp(cfg.angleDeg, ANGLE_RANGE.min, ANGLE_RANGE.max));
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const dist = clamp(speedMs * APPROACH_SECONDS, APPROACH_MIN_M, APPROACH_MAX_M);

    this.car = new RigidBody(
      new THREE.Vector3(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z),
      cfg.massKg
    );
    this.car.restitution = 0.1;
    this.car.friction = spec.friction;
    this.car.position.set(-dir.x * dist, CAR_REST_Y, -dir.z * dist);
    this.car.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

    this.debris.length = 0;
    this.sparks.length = 0;
    this.tireMarks.length = 0;
    this.shake = 0;
    this.impact = null;
    this.result = null;
    this.simTime = 0;
    this.settleTimer = 0;
    this.impactContactDone = false;
    this.keBeforeKJ = kineticEnergyKJ(cfg.massKg, speedMs);
    this.updateLive();
    this.setPhase('ready');
    this.emitResetVisuals();
  }

  run(): void {
    if (this.phase !== 'ready') this.reset();
    const cfg = this.config;
    const speedMs = cfg.speedKmh / KMH_PER_MS;
    const angle = degToRad(cfg.angleDeg);
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    this.car.velocity.copy(dir).multiplyScalar(speedMs);
    this.simTime = 0;
    this.settleTimer = 0;
    this.setPhase('running');
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  // ------------------------------------------------------------------ stepping

  /** Called once per rendered frame with the real frame delta. */
  step(realDt: number): void {
    if (this.paused || this.phase === 'ready' || this.phase === 'done') return;
    const dt = Math.min(realDt, 0.05) * this.timeScale;

    let remaining = dt;
    let steps = 0;
    while (remaining > 1e-6 && steps < MAX_SUBSTEPS) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      steps++;
      this.substep(h);
    }

    this.telemetryAcc += dt;
    if (this.telemetryAcc >= 0.1) {
      this.telemetryAcc = 0;
      this.updateLive();
      this.emitTelemetry(this.live);
    }
  }

  private substep(h: number): void {
    if (this.phase === 'done' || this.phase === 'ready') return;
    this.simTime += h;
    this.car.integrate(h, true);
    this.obstacle.integrate(h, true);

    this.resolveCarObstacle();
    this.groundConstrain(this.car, h, true);
    this.groundConstrain(this.obstacle, h, false);
    this.applyTireModel(h);
    this.updateDebris(h);
    this.updateSparks(h);
    this.updateShake(h);
    this.updateTireMarks();

    this.car.updateSleep(h);
    this.obstacle.updateSleep(h);
    this.checkPhaseProgress(h);
  }

  // ----------------------------------------------------------------- contacts

  private resolveCarObstacle(): void {
    const contact = obbContact(this.car, this.obstacle);
    if (!contact) return;

    const spec = OBSTACLES[this.config.obstacle];
    const carBefore = this.car.velocity.clone();
    const keBefore =
      this.car.kineticEnergy() + this.obstacle.kineticEnergy();

    const jn = resolveContact(this.car, this.obstacle, contact, spec.restitution, spec.friction);

    if (!this.impactContactDone && jn > 0) {
      // Primary impact — capture everything needed for the report.
      this.impactContactDone = true;
      const keAfter = this.car.kineticEnergy() + this.obstacle.kineticEnergy();
      const crushEnergyJ = Math.max(0, keBefore - keAfter);
      const impactSpeed = carBefore.length();
      // Closing speed along the normal (car approaching the obstacle).
      const normalClosing = Math.max(0, carBefore.dot(contact.normal));

      const zone = this.zoneFromLocalNormal(contact.normal);
      const damagePct = estimateDamagePct(crushEnergyJ, this.config.massKg, spec);
      const forceN = estimateForceN(jn, spec);

      this.impact = {
        impactSpeedKmh: impactSpeed * KMH_PER_MS,
        normalSpeedKmh: normalClosing * KMH_PER_MS,
        impulseNs: jn,
        forceKN: forceN / 1000,
        crushEnergyKJ: crushEnergyJ / 1000,
        zone,
        damagePct,
        severity: damageSeverity(damagePct)
      };
      this.lastImpactCarVel.copy(this.car.velocity);

      this.spawnImpactEffects(zone, contact, crushEnergyJ, damagePct, carBefore, spec);
      this.setPhase('settling');
      this.settleTimer = 0;
      this.updateLive();
      this.emitTelemetry(this.live);
    } else if (jn > 0) {
      // Secondary contact — physics only, keeps the report from the primary hit.
      this.car.wake();
      this.obstacle.wake();
    }
  }

  /** Ground plane at y = restY: support, small bounce, tire friction. */
  private groundConstrain(body: RigidBody, h: number, isCar: boolean): void {
    if (body.isStatic || body.sleeping) return;
    const restY = isCar ? CAR_REST_Y : body.halfExtents.y;
    if (body.position.y < restY) {
      body.position.y = restY;
      if (body.velocity.y < 0) {
        body.velocity.y = -body.velocity.y * (isCar ? 0.12 : 0.22);
        if (Math.abs(body.velocity.y) < 0.4) body.velocity.y = 0;
      }
      // Rolling resistance for free bodies (obstacles sliding to a stop).
      if (!isCar) {
        const spec = OBSTACLES[this.config.obstacle];
        const decel = spec.groundFriction * GRAVITY * h;
        const sp = body.velocity.length();
        if (sp > 1e-4) body.velocity.multiplyScalar(Math.max(0, sp - decel) / sp);
        body.angularVelocity.multiplyScalar(Math.exp(-2.5 * h));
      }
    }
  }

  /**
   * Tire model for the car after impact: the (assumed slammed) brakes decelerate
   * the car along its heading, and tire grip kills lateral slip faster — which
   * is what turns post-impact translation into realistic spins and slides.
   * Pitch/roll are held by a damped "suspension" spring so the body cannot
   * flip into numerical madness, but still dives/rears on impact.
   */
  private applyTireModel(h: number): void {
    const car = this.car;
    if (car.isStatic || car.sleeping) return;

    const fwd = car.axisZ(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    const vHoriz = new THREE.Vector3(car.velocity.x, 0, car.velocity.z);
    const vLong = vHoriz.dot(fwd);
    const vLat = vHoriz.dot(right);

    if (this.impactContactDone) {
      // Braking (locked wheels) + lateral tire grip.
      const aLong = 0.62 * GRAVITY;
      const aLat = 0.85 * GRAVITY;
      const dvLong = Math.min(Math.abs(vLong), aLong * h) * Math.sign(vLong);
      const dvLat = Math.min(Math.abs(vLat), aLat * h) * Math.sign(vLat);
      car.velocity.addScaledVector(fwd, -dvLong);
      car.velocity.addScaledVector(right, -dvLat);
    }

    // Yaw damping from tire contact patch; stronger when nearly stopped.
    const speed = vHoriz.length();
    const yawDamp = speed < 2 ? 2.6 : 0.45;
    car.angularVelocity.y *= Math.exp(-yawDamp * h);

    // Suspension spring for pitch (x) and roll (z): restores towards 0 with
    // heavy damping, clamped ±0.5 rad. Wakes no impulses — purely stabilising.
    const euler = new THREE.Euler().setFromQuaternion(car.quaternion, 'YXZ');
    const springK = 60;
    const dampC = 14;
    car.angularVelocity.x += (-springK * euler.x - dampC * car.angularVelocity.x) * h;
    car.angularVelocity.z += (-springK * euler.z - dampC * car.angularVelocity.z) * h;
    const hardLimit = 0.5;
    if (Math.abs(euler.x) > hardLimit) {
      euler.x = clamp(euler.x, -hardLimit, hardLimit);
      car.quaternion.setFromEuler(euler);
    }
    if (Math.abs(euler.z) > hardLimit) {
      euler.z = clamp(euler.z, -hardLimit, hardLimit);
      car.quaternion.setFromEuler(euler);
    }
  }

  // ------------------------------------------------------------------- effects

  private spawnImpactEffects(
    zone: DamageZone,
    contact: { normal: THREE.Vector3; point: THREE.Vector3 },
    crushEnergyJ: number,
    damagePct: number,
    carVelBefore: THREE.Vector3,
    spec: ObstacleSpec
  ): void {
    const rng = this.rng;

    // --- deformation spec for the renderer ---
    const localNormal = contact.normal
      .clone()
      .applyQuaternion(this.car.quaternion.clone().invert());
    const deform: DeformationSpec = {
      zone,
      localDir: [localNormal.x, localNormal.y, localNormal.z],
      crushDepth: crushDepthFor(damagePct),
      seed: Math.floor(rng() * 1e9)
    };

    // --- detachable parts thresholds ---
    const detach: DetachablePart[] = [];
    if (damagePct > 30) detach.push('bumperF');
    if (damagePct > 45) detach.push('hood');
    if (damagePct > 62) detach.push(rng() < 0.5 ? 'wheelFL' : 'wheelFR');

    // --- debris pieces ---
    const spawn = (piece: Partial<DebrisPiece> & { kind: DebrisPiece['kind']; half: THREE.Vector3; color: string; restY: number }) => {
      this.debris.push({
        pos: contact.point.clone().add(new THREE.Vector3((rng() - 0.5) * 0.7, rng() * 0.4, (rng() - 0.5) * 0.7)),
        vel: carVelBefore
          .clone()
          .multiplyScalar(0.25 + rng() * 0.35)
          .add(new THREE.Vector3((rng() - 0.5) * 6, 2 + rng() * 5, (rng() - 0.5) * 6)),
        spinAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        spinSpeed: 3 + rng() * 12,
        angle: rng() * Math.PI * 2,
        resting: false,
        ...piece
      } as DebrisPiece);
    };

    if (detach.includes('bumperF')) {
      spawn({ kind: 'bumperF', half: new THREE.Vector3(0.88, 0.12, 0.07), color: '#2a2d33', restY: 0.12 });
    }
    if (detach.includes('hood')) {
      spawn({ kind: 'hood', half: new THREE.Vector3(0.72, 0.03, 0.5), color: '#d0342c', restY: 0.04 });
    }
    for (const wheel of detach) {
      if (wheel.startsWith('wheel')) {
        spawn({ kind: 'wheel', half: new THREE.Vector3(0.14, 0.36, 0.36), color: '#14161a', restY: 0.36 });
      }
    }
    const chunkCount = Math.min(24, Math.floor(damagePct / 4));
    for (let i = 0; i < chunkCount; i++) {
      spawn({
        kind: 'metal',
        half: new THREE.Vector3(0.05 + rng() * 0.1, 0.02 + rng() * 0.05, 0.05 + rng() * 0.12),
        color: rng() < 0.5 ? '#8f979f' : '#b8443c',
        restY: 0.05
      });
    }
    if (damagePct > 50) {
      const glassCount = Math.min(14, Math.floor((damagePct - 40) / 4));
      for (let i = 0; i < glassCount; i++) {
        spawn({
          kind: 'glass',
          half: new THREE.Vector3(0.03 + rng() * 0.06, 0.01, 0.03 + rng() * 0.06),
          color: '#bfe3ef',
          restY: 0.02
        });
      }
    }

    // --- sparks (metal scrapes on rigid obstacles at real speed) ---
    const sparkEnergy = clamp((this.impact?.normalSpeedKmh ?? 0) / KMH_PER_MS, 0, 60);
    if (spec.rigidity > 0.4 && sparkEnergy > 7) {
      const count = Math.floor(clamp(sparkEnergy * 3, 20, 150));
      for (let i = 0; i < count; i++) {
        const dir = contact.normal
          .clone()
          .multiplyScalar(0.6 + rng() * 0.7)
          .add(new THREE.Vector3((rng() - 0.5) * 1.6, rng() * 1.2, (rng() - 0.5) * 1.6))
          .normalize();
        const speed = 5 + rng() * 14;
        this.sparks.push({
          pos: contact.point.clone(),
          vel: dir.multiplyScalar(speed),
          life: 0.25 + rng() * 0.45,
          maxLife: 0.7
        });
      }
    }

    // --- camera shake scales with crush energy ---
    this.shake = clamp(Math.sqrt(crushEnergyJ / 1000) * 0.12, 0.05, 0.6);

    this.emitImpactVisuals({
      deform,
      detach,
      shake: this.shake
    });
  }

  private updateDebris(h: number): void {
    for (const d of this.debris) {
      if (d.resting) continue;
      d.vel.y -= GRAVITY * h;
      d.pos.addScaledVector(d.vel, h);
      d.angle += d.spinSpeed * h;
      if (d.pos.y < d.restY) {
        d.pos.y = d.restY;
        if (d.vel.y < 0) d.vel.y = -d.vel.y * 0.28;
        d.vel.x *= 0.55;
        d.vel.z *= 0.55;
        d.spinSpeed *= 0.5;
        if (d.vel.lengthSq() < 0.35) {
          d.resting = true;
          d.vel.set(0, 0, 0);
        }
      }
      // Air drag keeps pieces finite.
      d.vel.multiplyScalar(Math.exp(-0.25 * h));
    }
  }

  private updateSparks(h: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= h;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= GRAVITY * 0.55 * h;
      s.pos.addScaledVector(s.vel, h);
    }
  }

  private updateShake(h: number): void {
    this.shake *= Math.exp(-3.2 * h);
    if (this.shake < 0.003) this.shake = 0;
  }

  /** Lay dark skid quads under the wheels while the car slides post-impact. */
  private updateTireMarks(): void {
    if (!this.impactContactDone || this.car.sleeping) return;
    const speed = new THREE.Vector3(this.car.velocity.x, 0, this.car.velocity.z).length();
    if (speed < 3.2) return;
    const wp = this.wheelWorldPositions();
    const moved = this.lastMarkPos.distanceTo(this.car.position);
    if (moved < 0.38) return;
    this.lastMarkPos.copy(this.car.position);

    const yaw = Math.atan2(this.car.velocity.x, this.car.velocity.z);
    const len = clamp(speed * 0.055, 0.4, 1.4);
    for (const w of wp) {
      this.tireMarks.push({
        pos: new THREE.Vector3(w.x, 0.012 + this.tireMarks.length * 1e-5, w.z),
        yaw,
        len,
        width: 0.24,
        alpha: clamp(speed / 18, 0.25, 0.75)
      });
    }
    if (this.tireMarks.length > 560) this.tireMarks.splice(0, this.tireMarks.length - 560);
  }

  private wheelWorldPositions(): THREE.Vector3[] {
    const car = this.car;
    const fx = car.halfExtents.x - 0.08;
    const fz = car.halfExtents.z - 0.72;
    return [
      new THREE.Vector3(fx, 0, fz),
      new THREE.Vector3(-fx, 0, fz),
      new THREE.Vector3(fx, 0, -fz),
      new THREE.Vector3(-fx, 0, -fz)
    ].map((local) => local.applyQuaternion(car.quaternion).add(car.position));
  }

  // -------------------------------------------------------------------- phases

  private zoneFromLocalNormal(worldNormal: THREE.Vector3): DamageZone {
    const local = worldNormal
      .clone()
      .applyQuaternion(this.car.quaternion.clone().invert());
    // The normal points from the car towards the obstacle; the damaged side is
    // the car face the normal exits from.
    const ax = Math.abs(local.x);
    const az = Math.abs(local.z);
    if (az >= ax) return local.z >= 0 ? 'front' : 'rear';
    return local.x >= 0 ? 'right' : 'left';
  }

  private checkPhaseProgress(h: number): void {
    if (this.phase === 'running') {
      if (this.simTime > NO_IMPACT_TIMEOUT) {
        this.finish(true);
      }
      return;
    }
    if (this.phase === 'settling') {
      this.settleTimer += h;
      const allAsleep =
        (this.car.sleeping || this.car.isStatic) &&
        (this.obstacle.sleeping || this.obstacle.isStatic) &&
        this.sparks.length === 0;
      if (allAsleep || this.settleTimer > SETTLE_TIMEOUT) {
        this.finish(false);
      }
    }
  }

  private finish(noImpact: boolean): void {
    const euler = new THREE.Euler().setFromQuaternion(this.car.quaternion, 'YXZ');
    const car = this.car;
    const keAfter = kineticEnergyKJ(car.mass, car.velocity.length());

    const impact: ImpactStats =
      this.impact ??
      {
        impactSpeedKmh: 0,
        normalSpeedKmh: 0,
        impulseNs: 0,
        forceKN: 0,
        crushEnergyKJ: 0,
        zone: 'front',
        damagePct: 0,
        severity: 'none'
      };

    this.result = {
      config: { ...this.config },
      impact,
      keBeforeKJ: this.keBeforeKJ,
      keAfterKJ: noImpact ? this.keBeforeKJ : keAfter + this.obstacle.kineticEnergy() / 1000,
      finalX: car.position.x,
      finalY: car.position.y - CAR_REST_Y,
      finalZ: car.position.z,
      finalYawDeg: radToDeg(euler.y),
      finalPitchDeg: radToDeg(euler.x),
      finalRollDeg: radToDeg(euler.z),
      obstacleDisplacementM: this.obstacle.position.distanceTo(this.obstacleStart),
      simTimeS: this.simTime
    };
    this.updateLive();
    this.setPhase('done');
    this.emitResult(this.result);
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.emitPhase(p);
  }

  private updateLive(): void {
    const euler = new THREE.Euler().setFromQuaternion(this.car.quaternion, 'YXZ');
    this.live = {
      speedKmh: this.car.velocity.length() * KMH_PER_MS,
      x: this.car.position.x,
      y: this.car.position.y,
      z: this.car.position.z,
      headingDeg: radToDeg(euler.y)
    };
  }
}
