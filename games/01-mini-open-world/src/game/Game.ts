import * as THREE from 'three';
import { Input } from './Input';
import { Sfx } from './Audio';
import { CameraRig } from './CameraRig';
import {
  World,
  SPAWN,
  MISSION_CAR_SPOT,
  RESTRICTED_ZONE,
  CITY_LIMIT,
} from './World';
import { Player } from './Player';
import { Vehicle, vehicleColor } from './Vehicle';
import { TrafficSystem } from './Traffic';
import { Pedestrian } from './Pedestrian';
import { PoliceSystem } from './Police';
import { Mission, type PlayerContext } from './Mission';
import {
  circleVsAABB,
  circleVsCircle,
  circleVsOBB,
  clamp,
  obbVsAABB,
  obbVsCircle,
  obbVsObb,
} from './physics';
import type { HudBanner, HudNotification, HudState, NotifKind } from './types';

const PED_COUNT = 22;

/** Owns the whole simulation and render loop. React only mounts the canvas
 *  and receives immutable HUD snapshots. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private sun: THREE.DirectionalLight;
  private world = new World();
  private input = new Input();
  private sfx = new Sfx();

  private player: Player;
  private vehicles: Vehicle[] = [];
  private playerCar: Vehicle | null = null;
  private traffic: TrafficSystem;
  private peds: Pedestrian[] = [];
  private police: PoliceSystem;
  private mission: Mission;

  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private disposed = false;

  private notifId = 1;
  private notifications: Array<HudNotification & { until: number }> = [];
  private banner: (HudBanner & { until: number }) | null = null;
  private lastHudPublish = -1;
  private damagedVehicles = new Map<number, number>();
  private restrictedCooldown = 0;

  private onHud: (s: HudState) => void;
  private container: HTMLElement;
  private rng = Math.random;

  constructor(container: HTMLElement, onHud: (s: HudState) => void) {
    this.container = container;
    this.onHud = onHud;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x8fb4dd);
    this.scene.fog = new THREE.Fog(0x8fb4dd, 150, 420);

    const hemi = new THREE.HemisphereLight(0xcfe2f5, 0x8a8068, 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -130;
    this.sun.shadow.camera.right = 130;
    this.sun.shadow.camera.top = 130;
    this.sun.shadow.camera.bottom = -130;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.world.group);

    this.rig = new CameraRig((container.clientWidth || 800) / (container.clientHeight || 600));

    // Player.
    this.player = new Player(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.scene.add(this.player.mesh.group);

    // Mission car + parked cars.
    const missionCar = new Vehicle(
      'mission',
      0xf2c230,
      MISSION_CAR_SPOT.x,
      MISSION_CAR_SPOT.z,
      MISSION_CAR_SPOT.heading,
    );
    this.vehicles.push(missionCar);
    this.scene.add(missionCar.parts.group);
    this.world.parkedCarSpots.forEach((spot, i) => {
      const v = new Vehicle('civil', vehicleColor(i), spot.x, spot.z, spot.heading);
      this.vehicles.push(v);
      this.scene.add(v.parts.group);
    });

    // Systems.
    this.traffic = new TrafficSystem(this.world, this.rng, this.scene);
    this.vehicles.push(...this.traffic.vehicles());

    for (let i = 0; i < PED_COUNT; i++) {
      const ped = new Pedestrian(this.world, this.rng);
      if (Math.hypot(ped.x - SPAWN.x, ped.z - SPAWN.z) < 8) {
        ped.x += 15;
      }
      this.peds.push(ped);
      this.scene.add(ped.mesh.group);
    }

    this.police = new PoliceSystem(this.world, this.rng, this.scene, {
      onWanted: (_level, reason) => {
        this.notify(reason, 'bad');
        this.sfx.wanted();
      },
      onStarLost: () => {
        if (this.police.wanted <= 0) {
          this.notify('You escaped the police', 'good');
        } else {
          this.notify(`Wanted level down — ${this.police.wanted} star(s) left`, 'info');
        }
      },
      onBusted: () => this.handleBusted(),
    });

    this.mission = new Mission(this.world, missionCar, {
      onStart: () => {
        this.notify('JOB: steal the marked car', 'gold');
        this.sfx.missionStart();
      },
      onObjective: () => {
        this.notify('Now deliver it to the green drop zone', 'gold');
        this.sfx.objective();
      },
      onPass: (t) => {
        this.setBanner('passed', 'MISSION PASSED', `Car delivered in ${t.toFixed(1)}s`, 6);
        this.notify(`Job complete — ${t.toFixed(1)}s`, 'good');
        this.sfx.missionPass();
      },
      onFail: (reason) => {
        this.setBanner('failed', 'MISSION FAILED', reason, 5);
        this.sfx.missionFail();
      },
    });

    this.rig.snapBehind(this.activeX(), this.activeZ(), this.activeHeading());
    window.addEventListener('resize', this.onResize);

    // Dev-only smoke-test handle (never used by gameplay code).
    if (import.meta.env.DEV) {
      const g = this;
      (window as unknown as Record<string, unknown>).__mow = {
        get time() {
          return g.time;
        },
        get x() {
          return g.activeX();
        },
        get z() {
          return g.activeZ();
        },
        get mode() {
          return g.playerCar ? 'DRIVING' : 'ON FOOT';
        },
        get wanted() {
          return g.police.wanted;
        },
        get stage() {
          return g.mission.stage;
        },
        get vehicles() {
          return g.vehicles.length;
        },
        get peds() {
          return g.peds.filter((p) => p.state !== 'down').length;
        },
      };
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    this.publishHud(true);
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = clamp((now - this.lastFrame) / 1000, 0.001, 0.05);
    this.lastFrame = now;
    this.update(dt);
    this.renderer.render(this.scene, this.rig.camera);
    this.input.endFrame();
  };

  // ---- Active entity helpers -------------------------------------------

  private activeX(): number {
    return this.playerCar ? this.playerCar.x : this.player.x;
  }
  private activeZ(): number {
    return this.playerCar ? this.playerCar.z : this.player.z;
  }
  private activeHeading(): number {
    return this.playerCar ? this.playerCar.heading : this.player.heading;
  }
  private activeSpeed(): number {
    return this.playerCar ? this.playerCar.speed : 0;
  }

  private playerCtx(): PlayerContext {
    return {
      onFoot: this.playerCar === null,
      x: this.activeX(),
      z: this.activeZ(),
      inCarId: this.playerCar ? this.playerCar.id : null,
      carSpeed: this.activeSpeed(),
    };
  }

  // ---- Main update ------------------------------------------------------

  private update(dt: number): void {
    this.time += dt;
    this.sfx.ensure();

    // 1. Controls and motion.
    if (this.playerCar) {
      this.playerCar.applyPlayerInput(this.input);
      this.playerCar.step(dt);
      this.playerCar.syncMesh();
    } else {
      this.player.update(dt, this.input, this.rig.cameraYaw(), this.world, this.vehicles);
    }

    this.traffic.update(
      dt,
      this.vehicles,
      this.activeX(),
      this.activeZ(),
      this.playerCar === null,
      this.peds,
      this.time,
      this.scene,
    );

    this.police.update(
      dt,
      this.time,
      {
        x: this.activeX(),
        z: this.activeZ(),
        vx: Math.sin(this.activeHeading()) * this.activeSpeed(),
        vz: Math.cos(this.activeHeading()) * this.activeSpeed(),
        onFoot: this.playerCar === null,
      },
      this.vehicles,
    );

    // Idle vehicles still coast to a stop after being shunted.
    for (const v of this.vehicles) {
      if (v.driver === 'none' && Math.abs(v.speed) > 0.01) {
        v.step(dt);
        v.syncMesh();
      }
    }

    // 2. Collisions.
    this.resolveVehicleVsStatic();
    this.resolveVehiclePairs();
    this.resolvePedHits();

    // 3. Interaction.
    this.handleEnterExit();
    if (this.input.pressed('KeyR')) {
      this.mission.restart();
      this.banner = null;
      this.notify('Mission reset — walk into the yellow marker', 'info');
    }

    // 4. Mission and zone logic.
    this.mission.update(dt, this.playerCtx());
    this.checkRestrictedZone();

    // 5. Visuals.
    this.world.pulseMarkers(this.time);

    // 6. Camera and sun.
    this.rig.update(
      dt,
      this.activeX(),
      this.activeZ(),
      this.activeHeading(),
      this.activeSpeed(),
      this.playerCar !== null,
    );
    this.sun.position.set(this.activeX() + 60, 95, this.activeZ() + 35);
    this.sun.target.position.set(this.activeX(), 0, this.activeZ());
    this.sun.target.updateMatrixWorld();

    // 7. Safety: never let NaN positions survive.
    this.sanitize();

    // 8. HUD.
    this.notifications = this.notifications.filter((n) => n.until > this.time);
    if (this.banner && this.banner.until < this.time) this.banner = null;
    this.publishHud(false);
  }

  // ---- Collision passes --------------------------------------------------

  private resolveVehicleVsStatic(): void {
    for (const v of this.vehicles) {
      if (v.driver === 'none' && Math.abs(v.speed) < 0.01) continue;
      const obb = { x: v.x, z: v.z, heading: v.heading, hl: v.hl, hw: v.hw };
      for (const b of this.world.buildingAABBs) {
        if (
          Math.abs(v.x - b.x) > b.hx + v.hl + 1 ||
          Math.abs(v.z - b.z) > b.hz + v.hl + 1
        )
          continue;
        const push = obbVsAABB(obb, b);
        if (push) {
          const impact = v.applyPush(push.x, push.z);
          if (v === this.playerCar && impact > 3) {
            this.sfx.crash(impact);
            v.hp = Math.max(0, v.hp - impact * 1.2);
          }
        }
      }
      for (const c of this.world.obstacles) {
        if (Math.abs(v.x - c.x) > 6 || Math.abs(v.z - c.z) > 6) continue;
        const push = obbVsCircle(obb, c);
        if (push) {
          const impact = v.applyPush(push.x, push.z);
          if (v === this.playerCar && impact > 3) this.sfx.crash(impact);
        }
      }
      v.x = clamp(v.x, -CITY_LIMIT, CITY_LIMIT);
      v.z = clamp(v.z, -CITY_LIMIT, CITY_LIMIT);
      v.syncMesh();
    }
  }

  private resolveVehiclePairs(): void {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const reach = a.hl + b.hl + 1;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        if (dx * dx + dz * dz > reach * reach) continue;

        const hit = obbVsObb(
          { x: a.x, z: a.z, heading: a.heading, hl: a.hl, hw: a.hw },
          { x: b.x, z: b.z, heading: b.heading, hl: b.hl, hw: b.hw },
        );
        if (!hit) continue;

        const aMoving = Math.abs(a.speed) > 0.5;
        const bMoving = Math.abs(b.speed) > 0.5;
        let aShare = 0.5;
        if (aMoving && !bMoving) aShare = 0.85;
        else if (!aMoving && bMoving) aShare = 0.15;
        a.x += hit.push.x * aShare;
        a.z += hit.push.z * aShare;
        b.x -= hit.push.x * (1 - aShare);
        b.z -= hit.push.z * (1 - aShare);

        // Relative approach speed along the collision normal.
        const avx = Math.sin(a.heading) * a.speed;
        const avz = Math.cos(a.heading) * a.speed;
        const bvx = Math.sin(b.heading) * b.speed;
        const bvz = Math.cos(b.heading) * b.speed;
        const rel = (avx - bvx) * hit.nx + (avz - bvz) * hit.nz;
        if (rel < -1) {
          const impact = -rel;
          const damp = impact > 4 ? 0.5 : 0.82;
          a.speed *= damp;
          b.speed *= damp;
          a.hp = Math.max(0, a.hp - impact * 1.1);
          b.hp = Math.max(0, b.hp - impact * 1.1);
          if (a === this.playerCar || b === this.playerCar) {
            const other = a === this.playerCar ? b : a;
            this.handlePlayerCrash(other, impact);
          }
        }
        a.syncMesh();
        b.syncMesh();
      }
    }
  }

  private resolvePedHits(): void {
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 4.5) continue;
      for (const ped of this.peds) {
        if (ped.state === 'down') continue;
        if (Math.abs(ped.x - v.x) > 4 || Math.abs(ped.z - v.z) > 4) continue;
        const push = circleVsOBB(ped.x, ped.z, 0.45, v.x, v.z, v.heading, v.hl, v.hw);
        if (!push) continue;
        const len = Math.max(Math.hypot(push.x, push.z), 0.001);
        ped.knock(push.x / len, push.z / len);
        v.speed *= 0.7;
        v.hp = Math.max(0, v.hp - 3);
        if (v === this.playerCar) {
          this.police.setWanted(2, 'You hit a pedestrian!');
        }
      }
    }
  }

  private handlePlayerCrash(other: Vehicle, impact: number): void {
    if (impact < 2) return;
    this.sfx.crash(impact);
    if (other.kind === 'police') {
      this.police.setWanted(2, 'You rammed a police car!');
      return;
    }
    this.damagedVehicles.set(other.id, this.time);
    for (const [id, t] of this.damagedVehicles) {
      if (this.time - t > 20) this.damagedVehicles.delete(id);
    }
    if (this.damagedVehicles.size >= 3) {
      this.police.setWanted(1, 'Reckless driving — police alerted!');
    }
  }

  // ---- Enter / exit ------------------------------------------------------

  private enterableVehicle(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = 3.4;
    for (const v of this.vehicles) {
      if (v.driver === 'police' || v.kind === 'police') continue;
      if (Math.abs(v.speed) > 3) continue;
      const d = v.distanceTo(this.player.x, this.player.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private spotFree(x: number, z: number, exclude: Vehicle): boolean {
    if (Math.abs(x) > 101 || Math.abs(z) > 101) return false;
    for (const b of this.world.buildingAABBs) {
      if (circleVsAABB(x, z, 0.5, b)) return false;
    }
    for (const c of this.world.obstacles) {
      if (circleVsCircle(x, z, 0.5, c)) return false;
    }
    for (const v of this.vehicles) {
      if (v === exclude) continue;
      if (Math.abs(v.x - x) > 5 || Math.abs(v.z - z) > 5) continue;
      if (circleVsOBB(x, z, 0.5, v.x, v.z, v.heading, v.hl, v.hw)) return false;
    }
    return true;
  }

  private handleEnterExit(): void {
    if (this.playerCar) {
      if (Math.abs(this.playerCar.speed) <= 2.5) {
        if (this.input.pressed('KeyE')) this.exitCar();
      }
      return;
    }
    if (this.input.pressed('KeyE')) {
      const v = this.enterableVehicle();
      if (v) {
        if (v.driver === 'traffic') this.traffic.remove(v);
        v.driver = 'player';
        v.clearControls();
        this.playerCar = v;
        this.player.setVisible(false);
        this.sfx.enterCar();
      }
    }
  }

  private exitCar(): void {
    const v = this.playerCar;
    if (!v) return;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    const rx = -fz;
    const rz = fx;
    const candidates: Array<[number, number]> = [
      [v.hw + 0.85, 0],
      [-(v.hw + 0.85), 0],
      [0, -(v.hl + 1.2)],
      [0, v.hl + 1.2],
    ];
    let placed = false;
    for (const [lx, lz] of candidates) {
      const wx = v.x + rx * lx + fx * lz;
      const wz = v.z + rz * lx + fz * lz;
      if (this.spotFree(wx, wz, v)) {
        this.player.teleport(wx, wz, Math.atan2(wx - v.x, wz - v.z));
        placed = true;
        break;
      }
    }
    if (!placed) {
      const wx = v.x + rx * (v.hw + 0.85);
      const wz = v.z + rz * (v.hw + 0.85);
      this.player.teleport(wx, wz, v.heading - Math.PI / 2);
    }
    this.player.setVisible(true);
    this.player.mesh.group.position.set(this.player.x, 0.14, this.player.z);
    v.driver = 'none';
    v.clearControls();
    this.playerCar = null;
    this.sfx.exitCar();
  }

  // ---- Wanted triggers / busted ------------------------------------------

  private checkRestrictedZone(): void {
    if (this.time < this.restrictedCooldown) return;
    const x = this.activeX();
    const z = this.activeZ();
    if (
      Math.abs(x - RESTRICTED_ZONE.x) < RESTRICTED_ZONE.hx &&
      Math.abs(z - RESTRICTED_ZONE.z) < RESTRICTED_ZONE.hz
    ) {
      this.restrictedCooldown = this.time + 12;
      this.police.setWanted(1, 'Restricted area — police alerted!');
    }
  }

  private handleBusted(): void {
    this.sfx.busted();
    this.setBanner('failed', 'BUSTED', 'The police caught you', 5);
    this.mission.fail('you got busted');
    if (this.playerCar) {
      const v = this.playerCar;
      v.driver = 'none';
      v.clearControls();
      v.speed = 0;
      this.playerCar = null;
    }
    this.player.setVisible(true);
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.player.mesh.group.position.set(SPAWN.x, 0.14, SPAWN.z);
    this.police.clearWanted();
    this.publishHud(true);
  }

  // ---- HUD ---------------------------------------------------------------

  private notify(text: string, kind: NotifKind, dur = 3.5): void {
    this.notifications.push({ id: this.notifId++, text, kind, until: this.time + dur });
    if (this.notifications.length > 4) this.notifications.shift();
    this.publishHud(true);
  }

  private setBanner(
    kind: HudBanner['kind'],
    title: string,
    sub: string,
    dur: number,
  ): void {
    this.banner = { kind, title, sub, until: this.time + dur };
    this.publishHud(true);
  }

  private publishHud(force: boolean): void {
    if (!force && this.time - this.lastHudPublish < 0.12) return;
    this.lastHudPublish = this.time;

    let hint: string | null = null;
    if (this.playerCar) {
      if (Math.abs(this.playerCar.speed) <= 2.5) hint = 'LEAVE CAR';
    } else if (this.enterableVehicle()) {
      hint = 'ENTER VEHICLE';
    }

    this.onHud({
      mode: this.playerCar ? 'DRIVING' : 'ON FOOT',
      speedKmh: Math.round(Math.abs(this.activeSpeed()) * 3.6),
      carHp: this.playerCar ? this.playerCar.hp : null,
      objective: this.mission.objectiveText(),
      missionTimer: this.mission.stage === 'deliver' ? this.mission.time : null,
      wanted: this.police.wanted,
      escapeProgress: this.police.escapeProgress,
      hint,
      banner: this.banner ? { kind: this.banner.kind, title: this.banner.title, sub: this.banner.sub } : null,
      notifications: this.notifications.map((n) => ({
        id: n.id,
        text: n.text,
        kind: n.kind,
      })),
    });
  }

  // ---- Safety / lifecycle --------------------------------------------------

  private sanitize(): void {
    if (!Number.isFinite(this.player.x) || !Number.isFinite(this.player.z)) {
      this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.heading);
    }
    for (const v of this.vehicles) {
      if (
        !Number.isFinite(v.x) ||
        !Number.isFinite(v.z) ||
        !Number.isFinite(v.heading) ||
        !Number.isFinite(v.speed)
      ) {
        const lp = this.world.randomLanePoint(this.rng);
        v.x = lp.x;
        v.z = lp.z;
        v.heading = lp.heading;
        v.speed = 0;
        v.syncMesh();
      }
    }
  }

  private onResize = (): void => {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
