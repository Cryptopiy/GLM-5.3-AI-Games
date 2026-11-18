import type { AABB, ObstacleCircle } from './types';

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Shortest signed angle difference from a to b, in [-PI, PI]. */
export function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Forward vector for a heading (heading 0 faces +Z, PI/2 faces +X). */
export function fwd(h: number): { x: number; z: number } {
  return { x: Math.sin(h), z: Math.cos(h) };
}

/** Right vector relative to forward (right-handed, Y up). */
export function rightOf(fx: number, fz: number): { x: number; z: number } {
  return { x: -fz, z: fx };
}

export interface Push {
  x: number;
  z: number;
}

/** Circle vs axis-aligned box: returns push-out vector or null. */
export function circleVsAABB(
  px: number,
  pz: number,
  r: number,
  b: AABB,
): Push | null {
  const dx = px - b.x;
  const dz = pz - b.z;
  const ox = b.hx + r - Math.abs(dx);
  if (ox <= 0) return null;
  const oz = b.hz + r - Math.abs(dz);
  if (oz <= 0) return null;
  if (ox < oz) return { x: Math.sign(dx || 1) * ox, z: 0 };
  return { x: 0, z: Math.sign(dz || 1) * oz };
}

/** Circle vs static circle: returns push-out vector or null. */
export function circleVsCircle(
  px: number,
  pz: number,
  r: number,
  c: ObstacleCircle,
): Push | null {
  const dx = px - c.x;
  const dz = pz - c.z;
  const d2 = dx * dx + dz * dz;
  const rr = r + c.r;
  if (d2 >= rr * rr || d2 === 0) return null;
  const d = Math.sqrt(d2);
  return { x: (dx / d) * (rr - d), z: (dz / d) * (rr - d) };
}

/** Push a circle out of an oriented rectangle (car body). */
export function circleVsOBB(
  px: number,
  pz: number,
  r: number,
  cx: number,
  cz: number,
  heading: number,
  hl: number,
  hw: number,
): Push | null {
  // To OBB local space (+Z along heading)
  const s = Math.sin(-heading);
  const c = Math.cos(-heading);
  const lx = px * c - pz * s - cx * c + cz * s;
  const lz = px * s + pz * c - cx * s - cz * c;
  const qx = clamp(lx, -hw, hw);
  const qz = clamp(lz, -hl, hl);
  const ddx = lx - qx;
  const ddz = lz - qz;
  const dist2 = ddx * ddx + ddz * ddz;
  let lxPush = 0;
  let lzPush = 0;
  if (dist2 > 0.000001) {
    const dist = Math.sqrt(dist2);
    if (dist >= r) return null;
    const push = r - dist;
    lxPush = (ddx / dist) * push;
    lzPush = (ddz / dist) * push;
  } else {
    // Center inside the box: push out along the shallowest local axis.
    const ox = hw - Math.abs(lx);
    const oz = hl - Math.abs(lz);
    if (ox < oz) lxPush = Math.sign(lx || 1) * (ox + r);
    else lzPush = Math.sign(lz || 1) * (oz + r);
  }
  // Back to world space
  const ws = Math.sin(heading);
  const wc = Math.cos(heading);
  return { x: lxPush * wc + lzPush * ws, z: -lxPush * ws + lzPush * wc };
}

export interface OBB {
  x: number;
  z: number;
  heading: number;
  hl: number; // half-length along heading
  hw: number; // half-width
}

function obbAxes(o: OBB) {
  const fx = Math.sin(o.heading);
  const fz = Math.cos(o.heading);
  return { fx, fz, rx: -fz, rz: fx };
}

function cornersOf(o: OBB): Array<{ x: number; z: number }> {
  const { fx, fz, rx, rz } = obbAxes(o);
  return [
    { x: o.x + fx * o.hl + rx * o.hw, z: o.z + fz * o.hl + rz * o.hw },
    { x: o.x + fx * o.hl - rx * o.hw, z: o.z + fz * o.hl - rz * o.hw },
    { x: o.x - fx * o.hl + rx * o.hw, z: o.z - fz * o.hl + rz * o.hw },
    { x: o.x - fx * o.hl - rx * o.hw, z: o.z - fz * o.hl - rz * o.hw },
  ];
}

function pointInOBB(px: number, pz: number, o: OBB): boolean {
  const { fx, fz, rx, rz } = obbAxes(o);
  const dx = px - o.x;
  const dz = pz - o.z;
  return (
    Math.abs(dx * fx + dz * fz) <= o.hl && Math.abs(dx * rx + dz * rz) <= o.hw
  );
}

/**
 * Oriented box vs axis-aligned box. Returns a world-space push that moves the
 * OBB out of the AABB, or null. Arcade resolution: finds the deepest involved
 * corner and resolves along the shallowest local axis of the OBB.
 */
export function obbVsAABB(o: OBB, b: AABB): Push | null {
  let best: Push | null = null;
  let bestLen = 0;
  const { fx, fz, rx, rz } = obbAxes(o);

  // OBB corners inside the AABB: push out along the min world-axis penetration.
  for (const p of cornersOf(o)) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const ox = b.hx - Math.abs(dx);
    if (ox <= 0) continue;
    const oz = b.hz - Math.abs(dz);
    if (oz <= 0) continue;
    let push: Push;
    if (ox < oz) push = { x: Math.sign(dx || 1) * ox, z: 0 };
    else push = { x: 0, z: Math.sign(dz || 1) * oz };
    const len = Math.abs(push.x) + Math.abs(push.z);
    if (len > bestLen) {
      bestLen = len;
      best = push;
    }
  }

  // AABB corners inside the OBB: push the OBB away along the OBB local axis.
  const abCorners = [
    { x: b.x - b.hx, z: b.z - b.hz },
    { x: b.x + b.hx, z: b.z - b.hz },
    { x: b.x - b.hx, z: b.z + b.hz },
    { x: b.x + b.hx, z: b.z + b.hz },
  ];
  for (const p of abCorners) {
    if (!pointInOBB(p.x, p.z, o)) continue;
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const alongF = dx * fx + dz * fz;
    const alongR = dx * rx + dz * rz;
    const pf = o.hl - Math.abs(alongF);
    const pr = o.hw - Math.abs(alongR);
    let push: Push;
    if (pf * Math.abs(fx) + pf * Math.abs(fz) < pr * Math.abs(rx) + pr * Math.abs(rz)) {
      const s = Math.sign(alongF || 1);
      push = { x: fx * pf * s, z: fz * pf * s };
    } else {
      const s = Math.sign(alongR || 1);
      push = { x: rx * pr * s, z: rz * pr * s };
    }
    const len = Math.abs(push.x) + Math.abs(push.z);
    if (len > bestLen) {
      bestLen = len;
      best = push;
    }
  }
  return best;
}

function projectRect(o: OBB, axX: number, axZ: number): { min: number; max: number } {
  const { fx, fz, rx, rz } = obbAxes(o);
  const c = o.x * axX + o.z * axZ;
  const r =
    Math.abs((fx * axX + fz * axZ) * o.hl) + Math.abs((rx * axX + rz * axZ) * o.hw);
  return { min: c - r, max: c + r };
}

/** Oriented box vs oriented box (SAT on the XZ plane). Returns MTV or null. */
export function obbVsObb(a: OBB, b: OBB): { push: Push; nx: number; nz: number } | null {
  const aF = obbAxes(a);
  const bF = obbAxes(b);
  const axes = [
    { x: aF.fx, z: aF.fz },
    { x: aF.rx, z: aF.rz },
    { x: bF.fx, z: bF.fz },
    { x: bF.rx, z: bF.rz },
  ];
  let minOverlap = Infinity;
  let minAxis = axes[0];
  for (const ax of axes) {
    const pa = projectRect(a, ax.x, ax.z);
    const pb = projectRect(b, ax.x, ax.z);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      minAxis = ax;
    }
  }
  // Push A away from B, in the direction from B to A.
  let nx = minAxis.x;
  let nz = minAxis.z;
  if ((a.x - b.x) * nx + (a.z - b.z) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { push: { x: nx * minOverlap, z: nz * minOverlap }, nx, nz };
}

/** OBB vs static circle, pushing the OBB out. */
export function obbVsCircle(o: OBB, c: ObstacleCircle): Push | null {
  const inv = circleVsOBB(c.x, c.z, c.r, o.x, o.z, o.heading, o.hl, o.hw);
  if (!inv) return null;
  return { x: -inv.x, z: -inv.z };
}
