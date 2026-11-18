// Simulation engine: cell-based water propagation with momentum, a simple
// force model for floating/parked vehicles, pedestrian evacuation logic and
// statistics. Runs fully imperative (outside React) at a fixed timestep.

import {
  GRID,
  CELL,
  WORLD,
  OCEAN_COLS,
  TerrainData,
  cellIndexAt,
  gridBilerp,
  heightAt,
} from './terrain';

const DT = 1 / 30;          // fixed simulation timestep (s)
const FLOW_K = 0.32;        // fraction of level difference exchanged per step
const MAX_OUT = 0.85;       // max fraction of a cell's depth leaving per step
const FLOOD_THRESHOLD = 0.08; // m of water needed for a land cell to count as flooded
const VMAX = 9;             // clamp for cell flow velocity (m/s)

export type Phase = 'idle' | 'running' | 'paused';

export interface Car {
  x: number; z: number; y: number;
  vx: number; vz: number;
  heading: number; roll: number; pitch: number;
  sx: number; sz: number;
  phase: number;
  displaced: boolean;
}

export interface Person {
  x: number; z: number; y: number;
  vx: number; vz: number;
  sx: number; sz: number;
  heading: number; speed: number; turnDir: number;
  state: 'walking' | 'safe' | 'caught';
  phase: number;
}

export interface Stats {
  phase: Phase;
  floodedPct: number;
  maxDepth: number;
  floodedBuildings: number;
  buildingsTotal: number;
  displacedCars: number;
  carsTotal: number;
  peopleSafe: number;
  peopleCaught: number;
  peopleTotal: number;
  elapsed: number;
  waveHeight: number;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function smoothstep01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export class SimulationEngine {
  readonly td: TerrainData;

  depth!: Float32Array;
  private depth2!: Float32Array;
  private fW!: Float32Array; // outflow toward west neighbor (depth-meters)
  private fE!: Float32Array;
  private fN!: Float32Array;
  private fS!: Float32Array;
  vx!: Float32Array; // estimated flow velocity (m/s)
  vz!: Float32Array;

  cars: Car[] = [];
  people: Person[] = [];

  phase: Phase = 'idle';
  waveHeight = 8;
  speed = 1;
  simTime = 0;
  private acc = 0;
  private statTimer = 0;
  damageTick = 0; // bumped when building visual states change

  stats: Stats;

  constructor(td: TerrainData) {
    this.td = td;
    const n = GRID * GRID;
    this.depth = new Float32Array(n);
    this.depth2 = new Float32Array(n);
    this.fW = new Float32Array(n);
    this.fE = new Float32Array(n);
    this.fN = new Float32Array(n);
    this.fS = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.stats = {
      phase: 'idle',
      floodedPct: 0,
      maxDepth: 0,
      floodedBuildings: 0,
      buildingsTotal: td.buildings.length,
      displacedCars: 0,
      carsTotal: td.carSpawns.length,
      peopleSafe: 0,
      peopleCaught: 0,
      peopleTotal: td.peopleSpawns.length,
      elapsed: 0,
      waveHeight: this.waveHeight,
    };
    this.reset();
  }

  // ---------------------------------------------------------------- control

  setWaveHeight(h: number): void {
    this.waveHeight = clamp(h, 1, 20);
    this.stats.waveHeight = this.waveHeight;
  }

  setSpeed(s: number): void {
    this.speed = clamp(s, 0.25, 4);
  }

  start(): void {
    if (this.phase === 'idle') {
      this.phase = 'running';
      this.stats.phase = 'running';
    }
  }

  togglePause(): void {
    if (this.phase === 'running') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'running';
    this.stats.phase = this.phase;
  }

  reset(): void {
    this.depth.fill(0);
    this.depth2.fill(0);
    this.vx.fill(0);
    this.vz.fill(0);
    this.fW.fill(0);
    this.fE.fill(0);
    this.fN.fill(0);
    this.fS.fill(0);
    // calm ocean at sea level
    const h = this.td.heights;
    for (let i = 0; i < GRID * GRID; i++) {
      if (this.td.ocean[i]) this.depth[i] = Math.max(0, -h[i]);
    }
    this.cars = this.td.carSpawns.map((s, k) => ({
      x: s.x, z: s.z, y: 0,
      vx: 0, vz: 0,
      heading: s.heading, roll: 0, pitch: 0,
      sx: s.x, sz: s.z,
      phase: (k * 2.399) % (Math.PI * 2),
      displaced: false,
    }));
    for (const c of this.cars) c.y = heightAt(this.td, c.x, c.z);
    this.people = this.td.peopleSpawns.map((s, k) => ({
      x: s.x, z: s.z, y: heightAt(this.td, s.x, s.z),
      vx: 0, vz: 0,
      sx: s.x, sz: s.z,
      heading: 0,
      speed: 1.5 + ((k * 37) % 10) / 10,
      turnDir: k % 2 === 0 ? 1 : -1,
      state: 'walking',
      phase: (k * 1.7) % (Math.PI * 2),
    }));
    this.phase = 'idle';
    this.simTime = 0;
    this.acc = 0;
    for (const b of this.td.buildings) {
      b.flooded = false;
      b.damaged = false;
    }
    this.damageTick++;
    this.updateStats();
    this.stats.phase = 'idle';
    this.stats.elapsed = 0;
  }

  // ------------------------------------------------------------ main update

  update(dtReal: number): void {
    if (this.phase === 'running') {
      this.acc = Math.min(this.acc + dtReal * this.speed, 0.3);
      while (this.acc >= DT) {
        this.stepWater(DT);
        this.stepObjects(DT);
        this.simTime += DT;
        this.acc -= DT;
      }
    }
    this.statTimer += dtReal;
    if (this.statTimer > 0.2) {
      this.statTimer = 0;
      this.updateStats();
    }
  }

  /** Sea-surface elevation enforced at the ocean boundary (m). */
  oceanLevel(): number {
    if (this.phase !== 'running') return 0;
    const t = this.simTime;
    const env = smoothstep01(t / 9); // the surge arrives over ~9 s
    const surge = 1 + 0.07 * Math.sin(t * 0.8);
    return Math.max(0, this.waveHeight * env * surge);
  }

  // ----------------------------------------------------------- water solver

  private stepWater(dt: number): void {
    const N = GRID;
    const h = this.td.heights;
    const blocked = this.td.blocked;
    const depth = this.depth;
    const depth2 = this.depth2;
    const fW = this.fW;
    const fE = this.fE;
    const fN = this.fN;
    const fS = this.fS;
    const vx = this.vx;
    const vz = this.vz;
    const advK = (0.9 * dt) / CELL;

    // 1) compute outflow fluxes (double-buffered: read old depths only)
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const d = depth[i];
        if (d <= 1e-4 || blocked[i]) {
          fW[i] = 0; fE[i] = 0; fN[i] = 0; fS[i] = 0;
          continue;
        }
        const Li = h[i] + d;
        let oW = 0, oE = 0, oN = 0, oS = 0;
        if (c > 0) {
          const j = i - 1;
          if (!blocked[j]) {
            const dh = Li - (h[j] + depth[j]);
            if (dh > 0) oW = FLOW_K * dh;
            const a = vx[i];
            if (a < 0) oW += -a * d * advK;
          }
        }
        if (c < N - 1) {
          const j = i + 1;
          if (!blocked[j]) {
            const dh = Li - (h[j] + depth[j]);
            if (dh > 0) oE = FLOW_K * dh;
            const a = vx[i];
            if (a > 0) oE += a * d * advK;
          }
        }
        if (r > 0) {
          const j = i - N;
          if (!blocked[j]) {
            const dh = Li - (h[j] + depth[j]);
            if (dh > 0) oN = FLOW_K * dh;
            const a = vz[i];
            if (a < 0) oN += -a * d * advK;
          }
        }
        if (r < N - 1) {
          const j = i + N;
          if (!blocked[j]) {
            const dh = Li - (h[j] + depth[j]);
            if (dh > 0) oS = FLOW_K * dh;
            const a = vz[i];
            if (a > 0) oS += a * d * advK;
          }
        }
        const tot = oW + oE + oN + oS;
        if (tot > d * MAX_OUT) {
          const s = (d * MAX_OUT) / tot;
          oW *= s; oE *= s; oN *= s; oS *= s;
        }
        fW[i] = oW; fE[i] = oE; fN[i] = oN; fS[i] = oS;
      }
    }

    // 2) apply fluxes, update velocity estimate
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (blocked[i]) {
          depth2[i] = 0;
          vx[i] = 0;
          vz[i] = 0;
          continue;
        }
        let d = depth[i];
        let inFlow = 0;
        if (c > 0) inFlow += fE[i - 1];
        if (c < N - 1) inFlow += fW[i + 1];
        if (r > 0) inFlow += fS[i - N];
        if (r < N - 1) inFlow += fN[i + N];
        const out = fW[i] + fE[i] + fN[i] + fS[i];
        d = d - out + inFlow;
        if (d <= 1e-4 || !isFinite(d)) {
          depth2[i] = 0;
          vx[i] = 0;
          vz[i] = 0;
          continue;
        }
        if (d > 60) d = 60;
        // net +x/-x directed volume through this cell -> velocity estimate
        let netX = fE[i] - fW[i];
        if (c > 0) netX += fE[i - 1];
        if (c < N - 1) netX -= fW[i + 1];
        let netZ = fS[i] - fN[i];
        if (r > 0) netZ += fS[i - N];
        if (r < N - 1) netZ -= fN[i + N];
        const dd = Math.max(d, 0.12);
        const gain = (CELL / dt) * 0.32 / dd;
        vx[i] = clamp(vx[i] * 0.86 + netX * gain, -VMAX, VMAX);
        vz[i] = clamp(vz[i] * 0.86 + netZ * gain, -VMAX, VMAX);
        depth2[i] = d;
      }
    }

    // swap buffers
    const tmp = this.depth;
    this.depth = depth2;
    this.depth2 = tmp;

    // 3) ocean boundary: infinite reservoir at the current tsunami level
    const lvl = this.oceanLevel();
    const hd = this.td.heights;
    const dep = this.depth;
    const ocean = this.td.ocean;
    for (let i = 0; i < N * N; i++) {
      if (ocean[i]) {
        dep[i] = Math.max(0, lvl - hd[i]);
        const c = i % N;
        if (c < OCEAN_COLS - 2 && lvl > 0.2) {
          // gentle eastward bias so the surge keeps pushing toward land
          this.vx[i] = Math.max(this.vx[i], Math.min(2.5, lvl * 0.25));
        }
      } else if (dep[i] < 1e-4) {
        dep[i] = 0;
      }
      if (!isFinite(dep[i])) dep[i] = 0;
      if (!isFinite(this.vx[i])) this.vx[i] = 0;
      if (!isFinite(this.vz[i])) this.vz[i] = 0;
    }
  }

  // -------------------------------------------------------------- helpers

  private levelLin(x: number, z: number): number {
    // water surface elevation, sampled from the combined field
    const N = GRID;
    const fx = clamp((x + WORLD / 2) / CELL - 0.5, 0, N - 1.0001);
    const fz = clamp((z + WORLD / 2) / CELL - 0.5, 0, N - 1.0001);
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const i = r * N + c;
    const h = this.td.heights;
    const d = this.depth;
    const lv = (j: number) => h[j] + d[j];
    const a = lv(i);
    const b = lv(i + 1);
    const cc = lv(i + N);
    const dd = lv(i + N + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + dd * tx) * tz;
  }

  private depthLin(x: number, z: number): number {
    return gridBilerp(this.depth, x, z);
  }

  private blockedForCar(x: number, z: number, fromX: number, fromZ: number): boolean {
    if (Math.abs(x) > WORLD / 2 - 3.5 || Math.abs(z) > WORLD / 2 - 3.5) return true;
    const i = cellIndexAt(x, z);
    if (this.td.blocked[i]) return true;
    const dHere = this.depth[cellIndexAt(fromX, fromZ)];
    if (dHere < 0.5) {
      // grounded cars cannot climb steep steps or enter the sea
      const step = heightAt(this.td, x, z) - heightAt(this.td, fromX, fromZ);
      if (step > 1.1 || this.td.heights[i] < -0.2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- objects

  private stepObjects(dt: number): void {
    const t = this.simTime;
    const N = GRID;

    // --- cars ---------------------------------------------------------------
    for (const car of this.cars) {
      const i = cellIndexAt(car.x, car.z);
      const d = this.depth[i];
      const wx = this.vx[i];
      const wz = this.vz[i];
      const ground = heightAt(this.td, car.x, car.z);
      const sub = clamp(d / 1.3, 0, 1);
      const floating = d > 0.85;

      let ax = 0;
      let az = 0;
      if (floating) {
        // buoyant: dragged toward the local water velocity
        ax += (wx - car.vx) * 1.7;
        az += (wz - car.vz) * 1.7;
      } else if (d > 0.12) {
        // shallow water pushes weakly
        ax += (wx - car.vx) * 0.5 * sub;
        az += (wz - car.vz) * 0.5 * sub;
      }
      if (d > 0.1) {
        // water flowing downhill drags the car along the slope
        const c = i % N;
        const r = Math.floor(i / N);
        const h = this.td.heights;
        const iL = c > 0 ? i - 1 : i;
        const iR = c < N - 1 ? i + 1 : i;
        const iU = r > 0 ? i - N : i;
        const iD = r < N - 1 ? i + N : i;
        const gx = (h[iR] - h[iL]) / (2 * CELL);
        const gz = (h[iD] - h[iU]) / (2 * CELL);
        const k = 3.0 * Math.min(d, 1);
        ax -= gx * k;
        az -= gz * k;
      }
      car.vx += ax * dt;
      car.vz += az * dt;
      const fr = floating ? 0.5 : d > 0.12 ? 1.2 : 3.5;
      const damp = Math.exp(-fr * dt);
      car.vx *= damp;
      car.vz *= damp;
      const sp = Math.hypot(car.vx, car.vz);
      if (sp > 11) {
        car.vx *= 11 / sp;
        car.vz *= 11 / sp;
      }

      // axis-separated movement with building collision
      const nx = car.x + car.vx * dt;
      const nz = car.z + car.vz * dt;
      if (!this.blockedForCar(nx, car.z, car.x, car.z)) {
        car.x = nx;
      } else {
        car.vx *= -0.25;
        car.heading += Math.sin(t * 7 + car.phase) * 0.5 * dt;
      }
      if (!this.blockedForCar(car.x, nz, car.x, car.z)) {
        car.z = nz;
      } else {
        car.vz *= -0.25;
        car.heading += Math.sin(t * 6 + car.phase) * 0.5 * dt;
      }

      // orientation: turn with the flow, bob and tilt when floating
      const spd = Math.hypot(car.vx, car.vz);
      if (d > 0.35 && spd > 0.25) {
        car.heading = angleLerp(car.heading, Math.atan2(car.vz, car.vx), Math.min(1, 3.2 * dt));
      }
      const bob = Math.sin(t * 2.1 + car.phase) * 0.5 + Math.sin(t * 3.3 + car.phase * 1.7) * 0.5;
      if (floating) {
        car.y = ground + d - 0.55 + 0.08 * bob;
        const k = Math.min(1, d);
        car.roll = 0.3 * Math.sin(t * 1.9 + car.phase) * k;
        car.pitch = -0.25 * Math.sin(t * 1.4 + car.phase * 1.3) * k;
      } else {
        car.y = ground;
        const k = Math.min(1, d * 2);
        car.roll = 0.12 * bob * k;
        car.pitch = 0;
      }
      if (!car.displaced && Math.hypot(car.x - car.sx, car.z - car.sz) > 4) {
        car.displaced = true;
      }
    }

    // --- pedestrians ----------------------------------------------------------
    const hx = this.td.hillTopX;
    const hz = this.td.hillTopZ;
    for (const p of this.people) {
      const i = cellIndexAt(p.x, p.z);
      const d = this.depth[i];

      if (p.state === 'safe') {
        p.y = heightAt(this.td, p.x, p.z);
        continue;
      }

      if (p.state === 'walking') {
        if (d > 0.55) {
          p.state = 'caught';
        } else {
          // steer toward the hill, step around obstacles; wading slows them down
          const wade = d > 0.15 ? 0.45 : 1;
          const step = p.speed * wade * dt;
          const dx = hx - p.x;
          const dz = hz - p.z;
          const target = Math.atan2(dz, dx);
          p.heading = angleLerp(p.heading, target, Math.min(1, 2.2 * dt));
          for (let a = 0; a < 4; a++) {
            const ang = p.heading + (a === 0 ? 0 : p.turnDir * 0.8 * a);
            const mx = p.x + Math.cos(ang) * step;
            const mz = p.z + Math.sin(ang) * step;
            const inBounds = Math.abs(mx) < WORLD / 2 - 4 && Math.abs(mz) < WORLD / 2 - 4;
            const j = inBounds ? cellIndexAt(mx, mz) : -1;
            const okWalk =
              j >= 0 &&
              !this.td.blocked[j] &&
              !this.td.ocean[j] &&
              heightAt(this.td, mx, mz) - heightAt(this.td, p.x, p.z) <= 1.3;
            if (okWalk) {
              p.x = mx;
              p.z = mz;
              if (a > 0) p.heading = ang;
              break;
            }
          }
          p.y = heightAt(this.td, p.x, p.z);
          if (p.y > 9 || Math.hypot(hx - p.x, hz - p.z) < 12) {
            p.state = 'safe';
          }
          continue;
        }
      }

      // caught: carried by the flow like a light floating object
      const wx = this.vx[i];
      const wz = this.vz[i];
      p.vx += (wx - p.vx) * 2.4 * dt;
      p.vz += (wz - p.vz) * 2.4 * dt;
      const damp = Math.exp(-0.4 * dt);
      p.vx *= damp;
      p.vz *= damp;
      const nx = p.x + p.vx * dt;
      const nz = p.z + p.vz * dt;
      if (!this.blockedForCar(nx, p.z, p.x, p.z)) p.x = nx;
      else p.vx *= -0.3;
      if (!this.blockedForCar(p.x, nz, p.x, p.z)) p.z = nz;
      else p.vz *= -0.3;
      const ground = heightAt(this.td, p.x, p.z);
      const lvl = this.levelLin(p.x, p.z);
      p.y = Math.max(ground + 0.15, lvl - 0.15) + Math.sin(t * 3 + p.phase) * 0.1;
      p.heading += dt * 1.6 * p.turnDir;
    }
  }

  // ------------------------------------------------------------ statistics

  updateStats(): void {
    const depth = this.depth;
    const land = this.td.landCells;
    let flooded = 0;
    let maxD = 0;
    for (let k = 0; k < land.length; k++) {
      const d = depth[land[k]];
      if (d > FLOOD_THRESHOLD) flooded++;
      if (d > maxD) maxD = d;
    }
    let floodedB = 0;
    let changed = false;
    for (const b of this.td.buildings) {
      let maxRing = 0;
      for (const j of b.ring) {
        if (depth[j] > maxRing) maxRing = depth[j];
      }
      const fl = maxRing > 0.5;
      const dm = maxRing > 2.2;
      if (fl !== b.flooded || dm !== b.damaged) changed = true;
      b.flooded = fl;
      b.damaged = dm;
      if (fl) floodedB++;
    }
    if (changed) this.damageTick++;
    let safe = 0;
    let caught = 0;
    for (const p of this.people) {
      if (p.state === 'safe') safe++;
      else if (p.state === 'caught') caught++;
    }
    let displaced = 0;
    for (const c of this.cars) {
      if (c.displaced) displaced++;
    }
    const s = this.stats;
    s.phase = this.phase;
    s.floodedPct = land.length > 0 ? (flooded / land.length) * 100 : 0;
    s.maxDepth = isFinite(maxD) ? maxD : 0;
    s.floodedBuildings = floodedB;
    s.displacedCars = displaced;
    s.peopleSafe = safe;
    s.peopleCaught = caught;
    s.elapsed = this.simTime;
    s.waveHeight = this.waveHeight;
  }

  /** Water depth at a world position (for debug / external queries). */
  depthAt(x: number, z: number): number {
    return this.depthLin(x, z);
  }
}
