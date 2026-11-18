// Static terrain mesh built from the height field: one flat quad per cell
// with baked per-cell colors (elevation ramp + hillshade), plus cliff walls
// around the map border so the diorama reads as a solid block.

import { useMemo } from 'react';
import * as THREE from 'three';
import {
  GRID,
  CELL,
  WORLD,
  TerrainData,
  cornerAvg,
} from '../sim/terrain';

const WALL_BOTTOM = -12;

export function TerrainMesh({ td }: { td: TerrainData }) {
  const geometry = useMemo(() => {
    const quads = GRID * GRID;
    const borderQuads = GRID * 4;
    const vertCount = (quads + borderQuads) * 4;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    let v = 0;

    const push = (
      x: number, y: number, z: number,
      r: number, g: number, b: number,
    ) => {
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      colors[v * 3] = r;
      colors[v * 3 + 1] = g;
      colors[v * 3 + 2] = b;
      v++;
    };

    const x0 = -WORLD / 2;

    // --- surface quads ---
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        const cr = td.colors[i * 3];
        const cg = td.colors[i * 3 + 1];
        const cb = td.colors[i * 3 + 2];
        const h00 = cornerAvg(td.heights, c, r);
        const h10 = cornerAvg(td.heights, c + 1, r);
        const h11 = cornerAvg(td.heights, c + 1, r + 1);
        const h01 = cornerAvg(td.heights, c, r + 1);
        const xa = x0 + c * CELL;
        const xb = xa + CELL;
        const za = x0 + r * CELL;
        const zb = za + CELL;
        // two CCW triangles (viewed from +Y)
        push(xa, h00, za, cr, cg, cb);
        push(xa, h01, zb, cr, cg, cb);
        push(xb, h11, zb, cr, cg, cb);
        push(xa, h00, za, cr, cg, cb);
        push(xb, h11, zb, cr, cg, cb);
        push(xb, h10, za, cr, cg, cb);
      }
    }

    // --- border cliff walls ---
    const rockTop: [number, number, number] = [0.115, 0.105, 0.1];
    const rockBot: [number, number, number] = [0.05, 0.048, 0.046];
    const wall = (
      x0w: number, z0w: number, h0w: number,
      x1w: number, z1w: number, h1w: number,
    ) => {
      push(x0w, h0w, z0w, ...rockTop);
      push(x1w, h1w, z1w, ...rockTop);
      push(x1w, WALL_BOTTOM, z1w, ...rockBot);
      push(x0w, h0w, z0w, ...rockTop);
      push(x1w, WALL_BOTTOM, z1w, ...rockBot);
      push(x0w, WALL_BOTTOM, z0w, ...rockBot);
    };
    const hAt = (C: number, R: number) => cornerAvg(td.heights, C, R);
    for (let c = 0; c < GRID; c++) {
      wall(x0 + c * CELL, -WORLD / 2, hAt(c, 0), x0 + (c + 1) * CELL, -WORLD / 2, hAt(c + 1, 0)); // north
      wall(x0 + (c + 1) * CELL, WORLD / 2, hAt(c + 1, GRID), x0 + c * CELL, WORLD / 2, hAt(c, GRID)); // south
    }
    for (let r = 0; r < GRID; r++) {
      wall(WORLD / 2, x0 + r * CELL, hAt(GRID, r), WORLD / 2, x0 + (r + 1) * CELL, hAt(GRID, r + 1)); // east
      wall(-WORLD / 2, x0 + (r + 1) * CELL, hAt(0, r + 1), -WORLD / 2, x0 + r * CELL, hAt(0, r)); // west
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, [td]);

  const base = useMemo(() => new THREE.BoxGeometry(WORLD, 6, WORLD), []);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh position={[0, WALL_BOTTOM - 3, 0]} geometry={base}>
        <meshLambertMaterial color={'#181512'} />
      </mesh>
    </group>
  );
}
