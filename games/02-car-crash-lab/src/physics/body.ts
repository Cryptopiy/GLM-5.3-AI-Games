import * as THREE from 'three';
import { GRAVITY } from '../config/constants';
import { clamp } from './math';

/**
 * Minimal 3D rigid body with a box inertia tensor.
 *
 * Integration: semi-implicit Euler.
 *   v += g·dt            (then ground/constraint corrections)
 *   x += v·dt
 *   q ← q ⊗ Δq(ω·dt)
 *
 * Inertia: diagonal box tensor I = m/12 · diag(h_y²+h_z², h_x²+h_z², h_x²+h_y²),
 * rotated to world space with the body quaternion when applying impulses:
 *   ω += I_world⁻¹ (r × J)
 */
export class RigidBody {
  readonly isStatic: boolean;
  mass = Infinity;
  invMass = 0;
  /** Half extents in local space (m). */
  halfExtents: THREE.Vector3;

  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  velocity = new THREE.Vector3();
  angularVelocity = new THREE.Vector3();

  /** Restitution and friction of this body's surface. */
  restitution = 0.2;
  friction = 0.4;

  /** Diagonal inertia / inverse inertia in LOCAL space. */
  private inertiaLocal = new THREE.Vector3();
  private invInertiaLocal = new THREE.Vector3();

  sleeping = false;
  private sleepTimer = 0;

  constructor(halfExtents: THREE.Vector3, mass: number) {
    this.halfExtents = halfExtents.clone();
    this.isStatic = mass <= 0;
    this.setMass(mass);
  }

  setMass(mass: number): void {
    if (this.isStatic) {
      this.mass = Infinity;
      this.invMass = 0;
      this.inertiaLocal.set(Infinity, Infinity, Infinity);
      this.invInertiaLocal.set(0, 0, 0);
      return;
    }
    this.mass = mass;
    this.invMass = 1 / mass;
    const m = mass / 12;
    const hx = this.halfExtents.x * 2;
    const hy = this.halfExtents.y * 2;
    const hz = this.halfExtents.z * 2;
    this.inertiaLocal.set(m * (hy * hy + hz * hz), m * (hx * hx + hz * hz), m * (hx * hx + hy * hy));
    this.invInertiaLocal.set(
      1 / this.inertiaLocal.x,
      1 / this.inertiaLocal.y,
      1 / this.inertiaLocal.z
    );
  }

  /** World-space inverse inertia applied to a vector: R · diag(1/I) · Rᵀ · v. */
  worldInvInertiaApply(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    if (this.isStatic) return out.set(0, 0, 0);
    const inv = this.quaternion.clone().invert();
    const local = v.clone().applyQuaternion(inv);
    local.set(
      local.x * this.invInertiaLocal.x,
      local.y * this.invInertiaLocal.y,
      local.z * this.invInertiaLocal.z
    );
    return local.applyQuaternion(this.quaternion);
  }

  /** Effective mass term along a normal at a contact offset r (angular part). */
  angularMassAlong(contactOffset: THREE.Vector3, normal: THREE.Vector3): number {
    if (this.isStatic) return 0;
    const rxn = contactOffset.clone().cross(normal); // r × n
    const iwrxn = this.worldInvInertiaApply(rxn, new THREE.Vector3());
    const arm = iwrxn.cross(contactOffset); // (I⁻¹(r×n)) × r
    return arm.dot(normal);
  }

  applyImpulse(impulse: THREE.Vector3, contactPoint: THREE.Vector3): void {
    if (this.isStatic) return;
    this.wake();
    this.velocity.addScaledVector(impulse, this.invMass);
    const r = contactPoint.clone().sub(this.position);
    const torque = r.cross(impulse);
    const angDelta = this.worldInvInertiaApply(torque, new THREE.Vector3());
    this.angularVelocity.add(angDelta);
  }

  integrate(dt: number, gravity: boolean): void {
    if (this.isStatic || this.sleeping) return;
    if (gravity) this.velocity.y -= GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Clamp to keep the simulation finite and stable under extreme inputs.
    const maxV = 120;
    this.velocity.set(
      clamp(this.velocity.x, -maxV, maxV),
      clamp(this.velocity.y, -maxV, maxV),
      clamp(this.velocity.z, -maxV, maxV)
    );
    const maxW = 9;
    this.angularVelocity.set(
      clamp(this.angularVelocity.x, -maxW, maxW),
      clamp(this.angularVelocity.y, -maxW, maxW),
      clamp(this.angularVelocity.z, -maxW, maxW)
    );

    const w = this.angularVelocity;
    const wl = w.length();
    if (wl > 1e-6) {
      const dq = new THREE.Quaternion().setFromAxisAngle(
        w.clone().multiplyScalar(1 / wl),
        wl * dt
      );
      this.quaternion.premultiply(dq).normalize();
    }
  }

  updateSleep(dt: number, linThreshold = 0.25, angThreshold = 0.3, timeToSleep = 0.6): void {
    if (this.isStatic || this.sleeping) return;
    const still =
      this.velocity.lengthSq() < linThreshold * linThreshold &&
      this.angularVelocity.lengthSq() < angThreshold * angThreshold;
    if (still) {
      this.sleepTimer += dt;
      if (this.sleepTimer >= timeToSleep) {
        this.sleeping = true;
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
      }
    } else {
      this.sleepTimer = 0;
    }
  }

  wake(): void {
    if (this.isStatic) return;
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  kineticEnergy(): number {
    if (this.isStatic) return 0;
    const rot = 0.5 * this.angularVelocity.dot(
      this.worldInvInertiaApply(this.angularVelocity, new THREE.Vector3()) // ω·I⁻¹ω == Iω²... see note
    );
    // NOTE: worldInvInertiaApply returns I⁻¹·ω, so ω·(I⁻¹ω) = ωᵀI⁻¹ω = correct rotational KE.
    return 0.5 * this.mass * this.velocity.lengthSq() + rot;
  }

  /** Local axes of the box in world space. */
  axisX(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  axisY(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  axisZ(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.quaternion);
  }
}
