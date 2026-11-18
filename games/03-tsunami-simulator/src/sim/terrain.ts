// Terrain generation: height field, ocean/land masks, roads, buildings,
// spawn points for vehicles/pedestrians, and baked vertex colors.
// Everything is generated locally from a deterministic seed — no external data.

import { mulberry32, fbm, hash2 } from './rng';

export const GRID = 128;            // simulation cells per side
export const CELL = 2.5;            // meters per cell
export const WORLD = GRID * CELL;   // 320 m
export const OCEAN_COLS = 30;       // columns on the west side that are permanent ocean
export const SEA_LEVEL = 0;         // calm sea surface elevation (m)

export interface BuildingDef {
  x: number; z: number;            // world-space center
  w: number; d: number; h: number; // footprint size and height (m)
  base: number;                    // ground elevation of the base
  cells: number[];                 // blocked cell indices under the footprint
  ring: number[];                  // neighboring cells used for flood checks
  flooded: boolean;
  damaged: boolean;
}

export interface CarSpawn { x: number; z: number; heading: number; }
export interface PersonSpawn { x: number; z: number; }

export interface TerrainData {
  heights: Float32Array;
  ocean: Uint8Array;
  blocked: Uint8Array;   // building footprints — no water storage, car obstacles
  road: Uint8Array;
  buildings: BuildingDef[];
  hillTopX: number; hillTopZ: number; hillTopH: number;
  carSpawns: CarSpawn[];
  peopleSpawns: PersonSpawn[];
  landCells: Int32Array; // cells counted in the "flooded area" statistic
  colors: Float32Array;  // per-cell linear RGB (with hillshade baked in)
}

// ---------------------------------------------------------------------------
// Corner tables: each terrain/water quad corner averages the (up to 4) cells
// touching it. Shared corners therefore sample identical data -> no cracks.
// ---------------------------------------------------------------------------

export const CORNER_COUNT = new Uint8Array((GRID + 1) * (GRID + 1));
export const CORNER_CELLS = new Int32Array((GRID + 1) * (GRID + 1) * 4).fill(-1);

(() => {
  const offs = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
  for (let R = 0; R <= GRID; R++) {
    for (let C = 0; C <= GRID; C++) {
      const k = R * (GRID + 1) + C;
      let n = 0;
      for (const [dc, dr] of offs) {
        const c = C + dc;
        const r = R + dr;
        if (c >= 0 && c < GRID && r >= 0 && r < GRID) {
          CORNER_CELLS[k * 4 + n++] = r * GRID + c;
        }
      }
      CORNER_COUNT[k] = n;
    }
  }
})();

export function cornerAvg(arr: Float32Array, C: number, R: number): number {
  const base = (R * (GRID + 1) + C) * 4;
  const n = CORNER_COUNT[R * (GRID + 1) + C];
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[CORNER_CELLS[base + i]];
  return n > 0 ? s / n : 0;
}

export function cellIndexAt(x: number, z: number): number {
  const c = Math.min(GRID - 1, Math.max(0, Math.floor((x + WORLD / 2) / CELL)));
  const r = Math.min(GRID - 1, Math.max(0, Math.floor((z + WORLD / 2) / CELL)));
  return r * GRID + c;
}

export function cellCenter(i: number): { x: number; z: number } {
  const r = Math.floor(i / GRID);
  const c = i % GRID;
  return { x: (c + 0.5) * CELL - WORLD / 2, z: (r + 0.5) * CELL - WORLD / 2 };
}

/** Bilinear sample of a per-cell field in world coordinates. */
export function gridBilerp(arr: Float32Array, x: number, z: number): number {
  const fx = Math.min(GRID - 1.0001, Math.max(0, (x + WORLD / 2) / CELL - 0.5));
  const fz = Math.min(GRID - 1.0001, Math.max(0, (z + WORLD / 2) / CELL - 0.5));
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const tx = fx - c;
  const tz = fz - r;
  const i = r * GRID + c;
  const a = arr[i];
  const b = arr[i + 1];
  const cc = arr[i + GRID];
  const d = arr[i + GRID + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
}

export function heightAt(td: TerrainData, x: number, z: number): number {
  return gridBilerp(td.heights, x, z);
}

// ---------------------------------------------------------------------------
// Elevation color ramp (sRGB anchors; converted to linear when baked)
// ---------------------------------------------------------------------------

type Anchor = [h: number, r: number, g: number, b: number];

const ANCHORS: Anchor[] = [
  [-9.5, 0.09, 0.16, 0.25],
  [-3.0, 0.15, 0.27, 0.34],
  [-0.6, 0.40, 0.46, 0.42],
  [0.0, 0.60, 0.56, 0.42],
  [0.9, 0.80, 0.74, 0.55],
  [2.5, 0.47, 0.62, 0.36],
  [5.5, 0.30, 0.48, 0.29],
  [8.5, 0.52, 0.54, 0.42],
  [11.5, 0.63, 0.63, 0.60],
  [14.5, 0.93, 0.94, 0.97],
];

function rampColor(h: number): [number, number, number] {
  if (h <= ANCHORS[0][0]) return [ANCHORS[0][1], ANCHORS[0][2], ANCHORS[0][3]];
  const last = ANCHORS[ANCHORS.length - 1];
  if (h >= last[0]) return [last[1], last[2], last[3]];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i];
    const b = ANCHORS[i + 1];
    if (h >= a[0] && h <= b[0]) {
      const t = (h - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [last[1], last[2], last[3]];
}

const toHex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** CSS gradient string for the elevation legend (0–15 m land range). */
export function legendGradientCss(): string {
  const stops: string[] = [];
  for (const [h, r, g, b] of ANCHORS) {
    if (h < 0) continue;
    const pct = Math.round((Math.min(h, 15) / 15) * 100);
    stops.push(`#${toHex(r)}${toHex(g)}${toHex(b)} ${pct}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

const H_ROADS = [28, 64, 100];        // horizontal roads (rows)
const V_ROADS = [40, 64, 88, 112];    // vertical roads (cols), 40 = coastal highway
const ROAD_H_FROM = 34;
const ROAD_H_TO = 124;
const ROAD_V_FROM = 16;
const ROAD_V_TO = 112;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateTerrain(seed = 1337): TerrainData {
  const N = GRID;
  const rng = mulberry32(seed);
  const heights = new Float32Array(N * N);
  const ocean = new Uint8Array(N * N);
  const blocked = new Uint8Array(N * N);
  const road = new Uint8Array(N * N);

  // --- base height field ---------------------------------------------------
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const t = Math.min(1, Math.max(0, (c - OCEAN_COLS) / (N - OCEAN_COLS)));
      const nz = fbm(c / 34, r / 34, seed, 4) * 2 - 1; // roughly ±1 m
      let h: number;
      if (c <= OCEAN_COLS) {
        // sea bed: deep offshore, shallow near the shoreline
        h = -9.2 + 8.3 * Math.pow(c / OCEAN_COLS, 1.35) + nz * 0.5;
      } else {
        // coastal profile: beach, beach ridge, downtown depression, rising plain
        const ridge = 2.9 * Math.exp(-Math.pow((t - 0.075) / 0.055, 2));
        const dip = -2.1 * Math.exp(-Math.pow((t - 0.3) / 0.17, 2));
        const rise = 0.7 + 2.7 * t + 2.1 * t * t;
        h = ridge + dip + rise + nz * 1.5;
        if (h < 0.28) h = 0.28;
      }
      // main safe hill in the east + a small knoll
      const wx = (c + 0.5) * CELL - WORLD / 2;
      const wz = (r + 0.5) * CELL - WORLD / 2;
      h += 10.5 * Math.exp(-(Math.pow((wx - 96) / 64, 2) + Math.pow((wz + 42) / 58, 2)));
      h += 3.6 * Math.exp(-(Math.pow((wx - 58) / 42, 2) + Math.pow((wz - 88) / 40, 2)));
      heights[i] = h;
      ocean[i] = c <= OCEAN_COLS ? 1 : 0;
    }
  }

  // --- smoothing passes ------------------------------------------------------
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(heights);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let s = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < N && cc >= 0 && cc < N) {
              s += tmp[rr * N + cc];
              n++;
            }
          }
        }
        let h = s / n;
        if (!ocean[r * N + c] && h < 0.28) h = 0.28;
        heights[r * N + c] = h;
      }
    }
  }

  // --- roads (carved 0.4 m below terrain so they channel water) --------------
  for (const rr of H_ROADS) {
    for (let c = ROAD_H_FROM; c <= ROAD_H_TO; c++) {
      road[rr * N + c] = 1;
      road[(rr + 1) * N + c] = 1;
    }
  }
  for (const cc of V_ROADS) {
    for (let r = ROAD_V_FROM; r <= ROAD_V_TO; r++) {
      road[r * N + cc] = 1;
      road[r * N + cc + 1] = 1;
    }
  }
  for (let i = 0; i < N * N; i++) {
    if (road[i] && !ocean[i]) heights[i] -= 0.4;
  }

  // --- buildings -------------------------------------------------------------
  const buildings: BuildingDef[] = [];

  const canPlace = (c0: number, r0: number, c1: number, r1: number): boolean => {
    if (c0 < OCEAN_COLS + 3 || c1 >= N - 2 || r0 < 2 || r1 >= N - 2) return false;
    let hMin = Infinity;
    let hMax = -Infinity;
    // footprint + 1-cell margin must be free; footprint itself must be buildable
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      for (let c = c0 - 1; c <= c1 + 1; c++) {
        const i = r * N + c;
        const margin = r < r0 || r > r1 || c < c0 || c > c1;
        if (ocean[i] || road[i]) return false;
        if (!margin && blocked[i]) return false;
        if (!margin) {
          const h = heights[i];
          if (h < 0.45 || h > 8.6) return false;
          if (h < hMin) hMin = h;
          if (h > hMax) hMax = h;
        }
      }
    }
    return hMax - hMin < 2.4;
  };

  const placeBuilding = (c0: number, r0: number, c1: number, r1: number) => {
    // flatten footprint toward its average height (limited to ±1 m)
    let sum = 0;
    let cnt = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        sum += heights[r * N + c];
        cnt++;
      }
    }
    const target = sum / cnt - 0.3;
    const cells: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * N + c;
        heights[i] = Math.min(heights[i] + 1.0, Math.max(heights[i] - 1.0, target));
        blocked[i] = 1;
        cells.push(i);
      }
    }
    // ring cells for flood/damage checks
    const ring: number[] = [];
    const seen = new Set<number>(cells);
    for (const i of cells) {
      const r = Math.floor(i / N);
      const c = i % N;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) {
          const j = rr * N + cc;
          if (!seen.has(j)) {
            seen.add(j);
            ring.push(j);
          }
        }
      }
    }
    const tCenter = ((c0 + c1) / 2 - OCEAN_COLS) / (N - OCEAN_COLS);
    const downtown = Math.exp(-Math.pow((tCenter - 0.32) / 0.13, 2));
    const hB = Math.min(30, 5.5 + rng() * 9 + downtown * (7 + rng() * 10));
    buildings.push({
      x: ((c0 + c1 + 1) / 2) * CELL - WORLD / 2,
      z: ((r0 + r1 + 1) / 2) * CELL - WORLD / 2,
      w: (c1 - c0 + 1) * CELL * 0.92,
      d: (r1 - r0 + 1) * CELL * 0.92,
      h: hB,
      base: target,
      cells,
      ring,
      flooded: false,
      damaged: false,
    });
  };

  // roadside plots along vertical roads
  for (const cc of V_ROADS) {
    for (let r = ROAD_V_FROM + 3; r < ROAD_V_TO - 4; r += 5 + Math.floor(rng() * 4)) {
      if (buildings.length >= 90) break;
      for (const side of [-1, 1]) {
        const hw = 1.2 + rng() * 1.6;
        const hd = 1.2 + rng() * 1.6;
        const cx = cc + side * (1.6 + hw);
        const c0 = Math.round(cx - hw);
        const c1 = Math.round(cx + hw);
        const r0 = Math.round(r - hd);
        const r1 = Math.round(r + hd);
        if (canPlace(c0, r0, c1, r1)) placeBuilding(c0, r0, c1, r1);
      }
    }
  }
  // roadside plots along horizontal roads
  for (const rr of H_ROADS) {
    for (let c = ROAD_H_FROM + 4; c < ROAD_H_TO - 4; c += 5 + Math.floor(rng() * 4)) {
      if (buildings.length >= 90) break;
      for (const side of [-1, 1]) {
        const hw = 1.2 + rng() * 1.6;
        const hd = 1.2 + rng() * 1.6;
        const cz = rr + side * (1.6 + hd);
        const c0 = Math.round(c - hw);
        const c1 = Math.round(c + hw);
        const r0 = Math.round(cz - hd);
        const r1 = Math.round(cz + hd);
        if (canPlace(c0, r0, c1, r1)) placeBuilding(c0, r0, c1, r1);
      }
    }
  }
  // scattered infill in the city area
  for (let a = 0; a < 400 && buildings.length < 90; a++) {
    const hw = 1.2 + rng() * 1.8;
    const hd = 1.2 + rng() * 1.8;
    const cx = 46 + rng() * (N - 56);
    const cz = 22 + rng() * (N - 30);
    const c0 = Math.round(cx - hw);
    const c1 = Math.round(cx + hw);
    const r0 = Math.round(cz - hd);
    const r1 = Math.round(cz + hd);
    if (canPlace(c0, r0, c1, r1)) placeBuilding(c0, r0, c1, r1);
  }

  // --- land cells (for statistics: excludes ocean and building footprints) ---
  const landList: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (!ocean[i] && !blocked[i]) landList.push(i);
  }

  // --- hill top (evacuation target) -----------------------------------------
  let hillTopH = -Infinity;
  let hillIdx = 0;
  for (let r = 0; r < N; r++) {
    for (let c = Math.floor(N * 0.55); c < N; c++) {
      const i = r * N + c;
      if (heights[i] > hillTopH) {
        hillTopH = heights[i];
        hillIdx = i;
      }
    }
  }
  const hill = cellCenter(hillIdx);

  // --- car spawns on roads ----------------------------------------------------
  const roadCells: number[] = [];
  for (let i = 0; i < N * N; i++) {
    const c = i % N;
    if (road[i] && !ocean[i] && c > OCEAN_COLS + 4) roadCells.push(i);
  }
  const carSpawns: CarSpawn[] = [];
  let guard = 0;
  while (carSpawns.length < 26 && guard++ < 4000) {
    const i = roadCells[Math.floor(rng() * roadCells.length)];
    const p = cellCenter(i);
    let ok = true;
    for (const s of carSpawns) {
      if (Math.hypot(s.x - p.x, s.z - p.z) < 8.5) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const r = Math.floor(i / N);
    const c = i % N;
    const horiz = (c > 0 && road[i - 1] === 1) || (c < N - 1 && road[i + 1] === 1);
    let heading: number;
    if (horiz) heading = rng() < 0.5 ? 0 : Math.PI;
    else heading = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    heading += (rng() - 0.5) * 0.08;
    carSpawns.push({ x: p.x, z: p.z, heading });
  }

  // --- people spawns (mostly in low city areas so the drama is visible) -------
  const peopleSpawns: PersonSpawn[] = [];
  guard = 0;
  while (peopleSpawns.length < 45 && guard++ < 8000) {
    const c = OCEAN_COLS + 4 + Math.floor(rng() * Math.floor(N * 0.45));
    const r = 8 + Math.floor(rng() * (N - 16));
    const i = r * N + c;
    const h = heights[i];
    if (blocked[i] || road[i] || h < 0.5 || h > 6.5) continue;
    const p = cellCenter(i);
    let ok = true;
    for (const s of peopleSpawns) {
      if (Math.hypot(s.x - p.x, s.z - p.z) < 4) {
        ok = false;
        break;
      }
    }
    if (ok) peopleSpawns.push({ x: p.x, z: p.z });
  }

  // --- baked per-cell colors with hillshading ---------------------------------
  const colors = new Float32Array(N * N * 3);
  const sun = [0.45, 0.75, 0.35];
  const sunLen = Math.hypot(sun[0], sun[1], sun[2]);
  const s2l = (v: number) => Math.pow(Math.min(1, Math.max(0, v)), 2.2);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let [cr, cg, cb] = rampColor(heights[i]);
      if (road[i] && !ocean[i]) {
        cr = 0.36; cg = 0.37; cb = 0.4;
      }
      if (blocked[i]) {
        cr = 0.3; cg = 0.29; cb = 0.28;
      }
      // slope shading
      const iL = c > 0 ? i - 1 : i;
      const iR = c < N - 1 ? i + 1 : i;
      const iU = r > 0 ? i - N : i;
      const iD = r < N - 1 ? i + N : i;
      const dhdx = (heights[iR] - heights[iL]) / (2 * CELL);
      const dhdz = (heights[iD] - heights[iU]) / (2 * CELL);
      const nl = Math.hypot(dhdx, 1, dhdz);
      const dot = (-dhdx * sun[0] + 1 * sun[1] + -dhdz * sun[2]) / (nl * sunLen);
      const shade = Math.min(1.12, 0.62 + 0.5 * Math.max(0, dot));
      const jitter = (hash2(c, r, 7) - 0.5) * 0.05;
      colors[i * 3] = s2l(cr * shade + jitter);
      colors[i * 3 + 1] = s2l(cg * shade + jitter);
      colors[i * 3 + 2] = s2l(cb * shade + jitter);
    }
  }

  return {
    heights,
    ocean,
    blocked,
    road,
    buildings,
    hillTopX: hill.x,
    hillTopZ: hill.z,
    hillTopH,
    carSpawns,
    peopleSpawns,
    landCells: Int32Array.from(landList),
    colors,
  };
}
