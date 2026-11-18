import * as THREE from 'three';
import type { AABB, ObstacleCircle } from './types';

export const ROAD_COORDS = [-96, -48, 0, 48, 96];
export const BLOCK_CENTERS = [-72, -24, 24, 72];
export const BLOCK_HALF = 18;
export const LANE = 3;
export const CITY_LIMIT = 103;

export const SPAWN = { x: -72, z: -60, heading: Math.PI };
export const MISSION_MARKER = { x: -72, z: -68 };
export const MISSION_CAR_SPOT = { x: -52.6, z: -66, heading: 0 };
export const DROP_ZONE = { x: 72, z: -59 };
export const RESTRICTED_ZONE = { x: 72, z: 60, hx: 9, hz: 5 };

export interface RoadNode {
  i: number;
  j: number;
  x: number;
  z: number;
}

export interface PedWaypoint {
  x: number;
  z: number;
  neighbors: number[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type BlockType = 'buildings' | 'plaza' | 'park' | 'police' | 'warehouse';

const BLOCK_TYPES: Record<string, BlockType> = {
  '0,0': 'plaza',
  '1,2': 'park',
  '2,1': 'park',
  '3,3': 'police',
  '3,0': 'warehouse',
};

/** Static city: geometry, colliders and navigation data. */
export class World {
  readonly group = new THREE.Group();
  readonly buildingAABBs: AABB[] = [];
  readonly obstacles: ObstacleCircle[] = [];
  readonly roadNodes: RoadNode[] = [];
  readonly nodeIndex = new Map<string, number>();
  readonly pedWaypoints: PedWaypoint[] = [];
  readonly parkedCarSpots: Array<{ x: number; z: number; heading: number }> = [];

  readonly startBeacon: THREE.Group;
  readonly dropBeacon: THREE.Group;
  readonly carBeacon: THREE.Group;
  readonly restrictedMesh: THREE.Group;

  private beaconPulse: Array<{ disc: THREE.Mesh; beam: THREE.Material }> = [];

  constructor() {
    const rng = mulberry32(20260823);

    this.buildGround();
    this.buildRoads();
    this.buildBlocks(rng);
    this.buildPerimeter();

    // Road graph nodes (intersections).
    for (let i = 0; i < ROAD_COORDS.length; i++) {
      for (let j = 0; j < ROAD_COORDS.length; j++) {
        const idx = this.roadNodes.length;
        this.roadNodes.push({ i, j, x: ROAD_COORDS[i], z: ROAD_COORDS[j] });
        this.nodeIndex.set(`${i},${j}`, idx);
      }
    }

    // Sidewalk waypoints: 4 corners per block.
    const cornerIds = new Map<string, number>();
    const cornerOffsets = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let bi = 0; bi < 4; bi++) {
      for (let bj = 0; bj < 4; bj++) {
        for (let k = 0; k < 4; k++) {
          const cx = BLOCK_CENTERS[bi] + cornerOffsets[k][0] * 16.5;
          const cz = BLOCK_CENTERS[bj] + cornerOffsets[k][1] * 16.5;
          cornerIds.set(`${bi},${bj},${k}`, this.pedWaypoints.length);
          this.pedWaypoints.push({ x: cx, z: cz, neighbors: [] });
        }
      }
    }
    for (let bi = 0; bi < 4; bi++) {
      for (let bj = 0; bj < 4; bj++) {
        for (let k = 0; k < 4; k++) {
          const id = cornerIds.get(`${bi},${bj},${k}`)!;
          const wp = this.pedWaypoints[id];
          // Same-block perimeter links.
          wp.neighbors.push(cornerIds.get(`${bi},${bj},${(k + 1) % 4}`)!);
          wp.neighbors.push(cornerIds.get(`${bi},${bj},${(k + 3) % 4}`)!);
          // Links across roads to the facing corner of the adjacent block.
          const [dx, dz] = cornerOffsets[k];
          if (dx === -1 && bi > 0)
            wp.neighbors.push(cornerIds.get(`${bi - 1},${bj},${1}`)!);
          if (dx === 1 && bi < 3)
            wp.neighbors.push(cornerIds.get(`${bi + 1},${bj},${0}`)!);
          if (dz === -1 && bj > 0)
            wp.neighbors.push(cornerIds.get(`${bi},${bj - 1},${2}`)!);
          if (dz === 1 && bj < 3)
            wp.neighbors.push(cornerIds.get(`${bi},${bj + 1},${3}`)!);
        }
      }
    }

    // Roadside parking spots.
    for (let bi = 0; bi < 4; bi++) {
      for (let bj = 0; bj < 4; bj++) {
        const type = BLOCK_TYPES[`${bi},${bj}`] ?? 'buildings';
        if (type === 'plaza') continue;
        const cx = BLOCK_CENTERS[bi];
        const cz = BLOCK_CENTERS[bj];
        if (rng() < 0.75) {
          this.parkedCarSpots.push({ x: cx - 9, z: cz - 19.4, heading: 0 });
        }
        if (rng() < 0.6) {
          this.parkedCarSpots.push({ x: cx + 10, z: cz + 19.4, heading: Math.PI });
        }
      }
    }

    this.startBeacon = this.makeBeacon(0xffd23c);
    this.startBeacon.position.set(MISSION_MARKER.x, 0, MISSION_MARKER.z);
    this.group.add(this.startBeacon);

    this.dropBeacon = this.makeBeacon(0x54e06a);
    this.dropBeacon.position.set(DROP_ZONE.x, 0, DROP_ZONE.z);
    this.dropBeacon.visible = false;
    this.group.add(this.dropBeacon);

    this.carBeacon = new THREE.Group();
    const arrow = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75),
      new THREE.MeshStandardMaterial({
        color: 0xffd23c,
        emissive: 0xffb700,
        emissiveIntensity: 1.4,
      }),
    );
    arrow.position.y = 3.4;
    this.carBeacon.add(arrow);
    this.carBeacon.visible = false;
    this.group.add(this.carBeacon);

    this.restrictedMesh = this.buildRestrictedZone();
    this.group.add(this.restrictedMesh);
  }

  private buildGround(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.04;
    grass.receiveShadow = true;
    this.group.add(grass);

    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(212, 212),
      new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.95 }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = 0;
    asphalt.receiveShadow = true;
    this.group.add(asphalt);
  }

  private buildRoads(): void {
    // Center-line dashes.
    const dashGeo = new THREE.BoxGeometry(0.24, 0.02, 3);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xd8d9d2,
      roughness: 0.8,
    });
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    for (const c of ROAD_COORDS) {
      for (let t = -96; t <= 96; t += 8) {
        if (ROAD_COORDS.some((r) => Math.abs(t - r) < 11)) continue;
        // Horizontal road (along X) at z = c
        pos.set(t, 0.015, c);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        mats.push(m.clone().compose(pos, q, s));
        // Vertical road (along Z) at x = c
        pos.set(c, 0.015, t);
        q.identity();
        mats.push(m.clone().compose(pos, q, s));
      }
    }
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, mats.length);
    mats.forEach((mm, i) => dashes.setMatrixAt(i, mm));
    this.group.add(dashes);

    // Crosswalk stripes near every intersection.
    const stripeGeo = new THREE.BoxGeometry(0.8, 0.02, 2.2);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e0,
      roughness: 0.85,
    });
    const stripes: THREE.Matrix4[] = [];
    for (const X0 of ROAD_COORDS) {
      for (const Z0 of ROAD_COORDS) {
        for (const side of [-1, 1]) {
          // On the X-running road: band at x = X0 ± 7.6, stripes along z.
          for (let z = Z0 - 4.2; z <= Z0 + 4.2; z += 1.4) {
            pos.set(X0 + side * 7.6, 0.015, z);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
            stripes.push(m.clone().compose(pos, q, s));
          }
          // On the Z-running road: band at z = Z0 ± 7.6, stripes along x.
          for (let x = X0 - 4.2; x <= X0 + 4.2; x += 1.4) {
            pos.set(x, 0.015, Z0 + side * 7.6);
            q.identity();
            stripes.push(m.clone().compose(pos, q, s));
          }
        }
      }
    }
    const crosswalks = new THREE.InstancedMesh(stripeGeo, stripeMat, stripes.length);
    stripes.forEach((mm, i) => crosswalks.setMatrixAt(i, mm));
    this.group.add(crosswalks);
  }

  private makeWindowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#d9dbdd';
    ctx.fillRect(0, 0, 64, 128);
    // Ground floor.
    ctx.fillStyle = '#8f9296';
    ctx.fillRect(0, 108, 64, 20);
    ctx.fillStyle = '#5a6470';
    ctx.fillRect(8, 110, 12, 18);
    ctx.fillRect(44, 110, 12, 18);
    // Windows.
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        const lit = Math.random() < 0.22;
        ctx.fillStyle = lit ? '#ffe6a0' : `hsl(215, 25%, ${18 + Math.random() * 14}%)`;
        ctx.fillRect(6 + col * 14, 8 + row * 16, 9, 11);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  private addBuilding(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    baseTex: THREE.CanvasTexture,
    tint: number,
    slabY: number,
  ): void {
    const tex = baseTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(h / 14)));
    const side = new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ color: 0x565b63, roughness: 1 });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [side, side, top, top, side, side],
    );
    mesh.position.set(x, slabY + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Roof cap for silhouette variety.
    if (h > 20) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.4, 2.2, d * 0.4),
        new THREE.MeshStandardMaterial({ color: 0x3d4249, roughness: 1 }),
      );
      cap.position.set(x, slabY + h + 1.1, z);
      cap.castShadow = true;
      this.group.add(cap);
    }
    this.buildingAABBs.push({ x, z, hx: w / 2 + 0.15, hz: d / 2 + 0.15 });
  }

  private addTree(x: number, z: number, y: number, rng: () => number): void {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.7, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    );
    trunk.position.y = 0.85;
    trunk.castShadow = true;
    g.add(trunk);
    const r = 1.1 + rng() * 0.7;
    const foliage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.3 + rng() * 0.06, 0.5, 0.3 + rng() * 0.1),
        roughness: 1,
        flatShading: true,
      }),
    );
    foliage.position.y = 1.7 + r * 0.7;
    foliage.castShadow = true;
    g.add(foliage);
    g.position.set(x, y, z);
    this.group.add(g);
    this.obstacles.push({ x, z, r: 0.45 });
  }

  private addHydrant(x: number, z: number): void {
    const h = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0xc23434, roughness: 0.6 }),
    );
    h.position.set(x, 0.42, z);
    h.castShadow = true;
    this.group.add(h);
    this.obstacles.push({ x, z, r: 0.3 });
  }

  private buildBlocks(rng: () => number): void {
    const textures = [this.makeWindowTexture(), this.makeWindowTexture()];
    const tints = [0xffffff, 0xe6d7c3, 0xc9d4dd, 0xd8c9bd, 0xbfc8cc, 0xdfe3e6];

    for (let bi = 0; bi < 4; bi++) {
      for (let bj = 0; bj < 4; bj++) {
        const cx = BLOCK_CENTERS[bi];
        const cz = BLOCK_CENTERS[bj];
        const type = BLOCK_TYPES[`${bi},${bj}`] ?? 'buildings';

        // Sidewalk slab.
        const slabColor =
          type === 'park'
            ? 0x4f8f4b
            : type === 'plaza'
              ? 0xb3a894
              : type === 'police'
                ? 0x8f959c
                : 0x9aa0a6;
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(36.3, 0.14, 36.3),
          new THREE.MeshStandardMaterial({ color: slabColor, roughness: 1 }),
        );
        slab.position.set(cx, 0.07, cz);
        slab.receiveShadow = true;
        this.group.add(slab);

        // Curb trim (slightly darker ring).
        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(37.1, 0.1, 37.1),
          new THREE.MeshStandardMaterial({ color: 0x7c8288, roughness: 1 }),
        );
        curb.position.set(cx, 0.05, cz);
        curb.receiveShadow = true;
        this.group.add(curb);

        if (type === 'plaza') {
          // Fountain in the middle.
          const basin = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5, 2.7, 0.7, 18),
            new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.7 }),
          );
          basin.position.set(cx, 0.49, cz);
          basin.castShadow = true;
          basin.receiveShadow = true;
          this.group.add(basin);
          const water = new THREE.Mesh(
            new THREE.CylinderGeometry(2.2, 2.2, 0.1, 18),
            new THREE.MeshStandardMaterial({
              color: 0x3f9fd8,
              roughness: 0.15,
              metalness: 0.3,
            }),
          );
          water.position.set(cx, 0.86, cz);
          this.group.add(water);
          const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.5, 1.6, 10),
            new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.7 }),
          );
          pillar.position.set(cx, 1.6, cz);
          pillar.castShadow = true;
          this.group.add(pillar);
          this.obstacles.push({ x: cx, z: cz, r: 2.8 });
          for (const [ox, oz] of [
            [-13, -13],
            [13, -13],
            [13, 13],
            [-13, 13],
          ]) {
            this.addTree(cx + ox, cz + oz, 0.14, rng);
          }
          this.addHydrant(cx + 16.5, cz + 16.5);
          continue;
        }

        if (type === 'park') {
          const count = 6 + Math.floor(rng() * 3);
          for (let n = 0; n < count; n++) {
            const ox = (rng() - 0.5) * 26;
            const oz = (rng() - 0.5) * 26;
            this.addTree(cx + ox, cz + oz, 0.14, rng);
          }
          continue;
        }

        if (type === 'police') {
          this.addBuilding(cx, cz + 4, 26, 16, 12, textures[0], 0xdfe3e6, 0.14);
          // Blue "POLICE" trim band.
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(26.2, 1.1, 0.3),
            new THREE.MeshStandardMaterial({
              color: 0x2456c4,
              emissive: 0x123a9e,
              emissiveIntensity: 0.4,
            }),
          );
          band.position.set(cx, 5.2, cz - 4.2);
          this.group.add(band);
          continue;
        }

        if (type === 'warehouse') {
          this.addBuilding(cx, cz - 5, 26, 18, 9, textures[1], 0xc9b9a4, 0.14);
          continue;
        }

        // Regular block: either one tower or a 2x2 cluster.
        if (rng() < 0.3) {
          const h = 24 + rng() * 14;
          this.addBuilding(
            cx,
            cz,
            20 + rng() * 5,
            20 + rng() * 5,
            h,
            textures[rng() < 0.5 ? 0 : 1],
            tints[Math.floor(rng() * tints.length)],
            0.14,
          );
        } else {
          for (const [ox, oz] of [
            [-7.5, -7.5],
            [7.5, -7.5],
            [7.5, 7.5],
            [-7.5, 7.5],
          ]) {
            if (rng() < 0.12) {
              this.addTree(cx + ox, cz + oz, 0.14, rng);
              continue;
            }
            const w = 10 + rng() * 3.5;
            const d = 10 + rng() * 3.5;
            const h = 8 + rng() * 16;
            this.addBuilding(
              cx + ox + (rng() - 0.5),
              cz + oz + (rng() - 0.5),
              w,
              d,
              h,
              textures[rng() < 0.5 ? 0 : 1],
              tints[Math.floor(rng() * tints.length)],
              0.14,
            );
          }
        }

        // Street props at some corners.
        if (rng() < 0.5) this.addHydrant(cx + 16.5, cz + 16.5);
        if (rng() < 0.5) this.addTree(cx - 16, cz - 16, 0.14, rng);
      }
    }
  }

  private buildPerimeter(): void {
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1 });
    for (const [x, z, hx, hz] of [
      [0, -105.5, 107, 1],
      [0, 105.5, 107, 1],
      [-105.5, 0, 1, 107],
      [105.5, 0, 1, 107],
    ] as const) {
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 2.2, hz * 2), hedgeMat);
      hedge.position.set(x, 1.1, z);
      hedge.castShadow = true;
      hedge.receiveShadow = true;
      this.group.add(hedge);
      this.buildingAABBs.push({ x, z, hx, hz });
    }
  }

  private buildRestrictedZone(): THREE.Group {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(RESTRICTED_ZONE.hx * 2, 0.06, RESTRICTED_ZONE.hz * 2),
      new THREE.MeshStandardMaterial({
        color: 0xd03030,
        transparent: true,
        opacity: 0.32,
        emissive: 0x901010,
        emissiveIntensity: 0.5,
      }),
    );
    slab.position.y = 0.2;
    g.add(slab);
    // Striped poles at the corners.
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xdd3030,
      roughness: 0.7,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
    for (const [px, pz] of [
      [-RESTRICTED_ZONE.hx, -RESTRICTED_ZONE.hz],
      [RESTRICTED_ZONE.hx, -RESTRICTED_ZONE.hz],
      [RESTRICTED_ZONE.hx, RESTRICTED_ZONE.hz],
      [-RESTRICTED_ZONE.hx, RESTRICTED_ZONE.hz],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8), poleMat);
      pole.position.set(px, 0.9, pz);
      g.add(pole);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), whiteMat);
      tip.position.set(px, 1.75, pz);
      g.add(tip);
    }
    g.position.set(RESTRICTED_ZONE.x, 0, RESTRICTED_ZONE.z);
    return g;
  }

  private makeBeacon(color: number): THREE.Group {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 0.5, 24),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        emissive: color,
        emissiveIntensity: 0.6,
        depthWrite: false,
      }),
    );
    disc.position.y = 0.35;
    g.add(disc);
    const beam = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.15,
      emissive: color,
      emissiveIntensity: 0.8,
      depthWrite: false,
    });
    const beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.85, 30, 12, 1, true),
      beam,
    );
    beamMesh.position.y = 15;
    g.add(beamMesh);
    this.beaconPulse.push({ disc, beam });
    return g;
  }

  pulseMarkers(t: number): void {
    for (const { disc, beam } of this.beaconPulse) {
      const k = 1 + Math.sin(t * 3.2) * 0.09;
      disc.scale.set(k, 1, k);
      beam.opacity = 0.1 + 0.08 * (1 + Math.sin(t * 3.2));
    }
    this.carBeacon.rotation.y += 0.03;
    this.carBeacon.position.y = Math.sin(t * 2.4) * 0.25;
  }

  nodeNeighbors(idx: number): number[] {
    const n = this.roadNodes[idx];
    const out: number[] = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [di, dj] of dirs) {
      const ni = n.i + di;
      const nj = n.j + dj;
      if (ni < 0 || ni >= ROAD_COORDS.length || nj < 0 || nj >= ROAD_COORDS.length)
        continue;
      out.push(this.nodeIndex.get(`${ni},${nj}`)!);
    }
    return out;
  }

  /** A random lane point (used to spawn traffic and police). Right-hand
   *  traffic: driving +X keeps lane at roadZ+LANE, driving +Z keeps lane at
   *  roadX-LANE, and mirrored for the opposite directions. */
  randomLanePoint(rng: () => number): { x: number; z: number; heading: number } {
    if (rng() < 0.5) {
      const j = Math.floor(rng() * ROAD_COORDS.length);
      const dir = rng() < 0.5 ? 1 : -1;
      const x =
        ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)] + (rng() - 0.5) * 24;
      return {
        x,
        z: ROAD_COORDS[j] + dir * LANE,
        heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      };
    }
    const i = Math.floor(rng() * ROAD_COORDS.length);
    const dir = rng() < 0.5 ? 1 : -1;
    const z =
      ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)] + (rng() - 0.5) * 24;
    return {
      x: ROAD_COORDS[i] - dir * LANE,
      z,
      heading: dir > 0 ? 0 : Math.PI,
    };
  }
}
