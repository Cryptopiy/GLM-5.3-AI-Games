import * as THREE from 'three';
import { RigidBody } from './body';

export interface Contact {
  /** Unit collision normal pointing from A towards B (world space). */
  normal: THREE.Vector3;
  /** Penetration depth (m). */
  depth: number;
  /** Approximate world-space contact point (centre of the overlap region). */
  point: THREE.Vector3;
}

function projectRadius(
  half: THREE.Vector3,
  x: THREE.Vector3,
  y: THREE.Vector3,
  z: THREE.Vector3,
  axis: THREE.Vector3
): number {
  return (
    half.x * Math.abs(axis.dot(x)) +
    half.y * Math.abs(axis.dot(y)) +
    half.z * Math.abs(axis.dot(z))
  );
}

function closestPointOnAToB(a: RigidBody, b: RigidBody): THREE.Vector3 {
  // Clamp B's centre into A's local box, then convert back to world.
  const inv = a.quaternion.clone().invert();
  const localB = b.position.clone().sub(a.position).applyQuaternion(inv);
  localB.set(
    THREE.MathUtils.clamp(localB.x, -a.halfExtents.x, a.halfExtents.x),
    THREE.MathUtils.clamp(localB.y, -a.halfExtents.y, a.halfExtents.y),
    THREE.MathUtils.clamp(localB.z, -a.halfExtents.z, a.halfExtents.z)
  );
  return localB.applyQuaternion(a.quaternion).add(a.position);
}

/**
 * SAT overlap test between two oriented bounding boxes (3D, 15 axes:
 * 3 face axes of A, 3 of B, 9 edge cross products). Returns the contact with
 * the minimum penetration axis, or null when the boxes are separated.
 */
export function obbContact(a: RigidBody, b: RigidBody): Contact | null {
  const ax = a.axisX(new THREE.Vector3());
  const ay = a.axisY(new THREE.Vector3());
  const az = a.axisZ(new THREE.Vector3());
  const bx = b.axisX(new THREE.Vector3());
  const by = b.axisY(new THREE.Vector3());
  const bz = b.axisZ(new THREE.Vector3());

  const d = b.position.clone().sub(a.position);

  const axes: THREE.Vector3[] = [
    ax, ay, az, bx, by, bz,
    ax.clone().cross(bx), ax.clone().cross(by), ax.clone().cross(bz),
    ay.clone().cross(bx), ay.clone().cross(by), ay.clone().cross(bz),
    az.clone().cross(bx), az.clone().cross(by), az.clone().cross(bz)
  ];

  let bestDepth = Infinity;
  let bestAxis: THREE.Vector3 | null = null;

  for (const axis of axes) {
    const lenSq = axis.lengthSq();
    if (lenSq < 1e-10) continue; // parallel edges — covered by face axes
    axis.multiplyScalar(1 / Math.sqrt(lenSq));
    const dist = Math.abs(d.dot(axis));
    const radius =
      projectRadius(a.halfExtents, ax, ay, az, axis) +
      projectRadius(b.halfExtents, bx, by, bz, axis);
    if (dist >= radius) return null; // separating axis found
    const depth = radius - dist;
    if (depth < bestDepth) {
      bestDepth = depth;
      bestAxis = axis;
    }
  }

  if (!bestAxis) return null;

  // Orient the normal from A towards B.
  if (bestAxis.dot(d) < 0) bestAxis.negate();

  const point = closestPointOnAToB(a, b).add(closestPointOnAToB(b, a)).multiplyScalar(0.5);

  return { normal: bestAxis, depth: bestDepth, point };
}

/**
 * Impulse-based collision response for one contact.
 *
 *   j_n = -(1 + e) · (v_rel · n) / (m₁⁻¹ + m₂⁻¹ + ang₁(n) + ang₂(n))
 *
 * where v_rel = v₂ - v₁ measured at the contact point (including rotation),
 * e = combined restitution, ang(n) are the angular effective-mass terms.
 * A Coulomb friction impulse j_t ≤ μ·j_n is applied along the tangential
 * direction of the relative slip. Returns the applied normal impulse
 * magnitude (0 when bodies are already separating).
 */
export function resolveContact(
  a: RigidBody,
  b: RigidBody,
  contact: Contact,
  restitution: number,
  friction: number
): number {
  const n = contact.normal;
  const rA = contact.point.clone().sub(a.position);
  const rB = contact.point.clone().sub(b.position);

  // Relative velocity of B w.r.t. A at the contact point.
  const velA = a.velocity.clone().add(a.angularVelocity.clone().cross(rA));
  const velB = b.velocity.clone().add(b.angularVelocity.clone().cross(rB));
  const vRel = velB.sub(velA);

  const vn = vRel.dot(n);
  if (vn > 0) return 0; // already separating

  const invMassSum =
    a.invMass + b.invMass + a.angularMassAlong(rA, n) + b.angularMassAlong(rB, n);
  if (invMassSum <= 1e-9) return 0;

  // Restitution is only "active" above a small bounce threshold; slow
  // contacts are treated as plastic to avoid jitter.
  const e = -vn > 1.0 ? restitution : 0;
  const jn = (-(1 + e) * vn) / invMassSum;

  const impulse = n.clone().multiplyScalar(jn);
  a.applyImpulse(impulse.clone().negate(), contact.point);
  b.applyImpulse(impulse, contact.point);

  // --- Coulomb friction along the tangential slip direction ---
  const vt = vRel.clone().addScaledVector(n, -vn); // remove normal part
  const vtLen = vt.length();
  if (vtLen > 1e-4 && friction > 0) {
    const tDir = vt.multiplyScalar(1 / vtLen);
    const invMassTan =
      a.invMass + b.invMass + a.angularMassAlong(rA, tDir) + b.angularMassAlong(rB, tDir);
    const jt = Math.min(vtLen / invMassTan, friction * jn);
    const tImpulse = tDir.multiplyScalar(jt);
    a.applyImpulse(tImpulse.clone().negate(), contact.point);
    b.applyImpulse(tImpulse, contact.point);
  }

  // Positional correction: push the bodies apart along n (dynamic bodies only,
  // split by inverse mass) to absorb the penetration.
  const totalInv = a.invMass + b.invMass;
  if (totalInv > 1e-9 && contact.depth > 0.002) {
    const corr = n.clone().multiplyScalar(Math.min(contact.depth, 0.15) * 0.65);
    if (!a.isStatic && !a.sleeping) a.position.addScaledVector(corr, -a.invMass / totalInv);
    if (!b.isStatic && !b.sleeping) b.position.addScaledVector(corr, b.invMass / totalInv);
  }

  return jn;
}
