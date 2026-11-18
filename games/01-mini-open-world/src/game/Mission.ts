import type { Vehicle } from './Vehicle';
import type { World } from './World';
import { DROP_ZONE, MISSION_MARKER } from './World';

export type MissionStage = 'idle' | 'getCar' | 'deliver' | 'passed' | 'failed';

export interface PlayerContext {
  onFoot: boolean;
  x: number;
  z: number;
  inCarId: number | null;
  carSpeed: number;
}

export interface MissionHooks {
  onStart: () => void;
  onObjective: () => void;
  onPass: (time: number, best: number | null) => void;
  onFail: (reason: string) => void;
}

/** One compact mission: start marker → steal the marked car → drive it to
 *  the drop zone. Restartable at any time with R. */
export class Mission {
  stage: MissionStage = 'idle';
  time = 0;
  finalTime = 0;
  bestTime: number | null = null;
  failReason = '';

  constructor(
    private world: World,
    readonly car: Vehicle,
    private hooks: MissionHooks,
  ) {}

  restart(): void {
    this.stage = 'idle';
    this.time = 0;
    this.failReason = '';
  }

  fail(reason: string): void {
    if (this.stage === 'getCar' || this.stage === 'deliver') {
      this.stage = 'failed';
      this.failReason = reason;
      this.hooks.onFail(reason);
    }
  }

  objectiveText(): string {
    switch (this.stage) {
      case 'idle':
        return 'Walk into the yellow marker to start the job';
      case 'getCar':
        return 'Steal the marked car (yellow arrow)';
      case 'deliver':
        return 'Deliver the car to the drop zone (green beacon)';
      case 'passed': {
        const best =
          this.bestTime !== null && this.bestTime < this.finalTime
            ? ` (best ${this.bestTime.toFixed(1)}s)`
            : '';
        return `MISSION PASSED in ${this.finalTime.toFixed(1)}s${best} — press R to replay`;
      }
      case 'failed':
        return `MISSION FAILED (${this.failReason}) — press R to retry`;
    }
  }

  update(dt: number, p: PlayerContext): void {
    const w = this.world;
    const inMissionCar = !p.onFoot && p.inCarId === this.car.id;

    switch (this.stage) {
      case 'idle':
        w.startBeacon.visible = true;
        w.carBeacon.visible = false;
        w.dropBeacon.visible = false;
        if (
          p.onFoot &&
          Math.hypot(p.x - MISSION_MARKER.x, p.z - MISSION_MARKER.z) < 3.6
        ) {
          this.stage = 'getCar';
          this.time = 0;
          this.hooks.onStart();
        }
        break;

      case 'getCar':
        w.startBeacon.visible = false;
        w.carBeacon.visible = true;
        w.carBeacon.position.set(this.car.x, 0, this.car.z);
        w.dropBeacon.visible = false;
        if (inMissionCar) {
          this.stage = 'deliver';
          this.hooks.onObjective();
        }
        break;

      case 'deliver':
        this.time += dt;
        w.startBeacon.visible = false;
        w.carBeacon.visible = !inMissionCar;
        w.carBeacon.position.set(this.car.x, 0, this.car.z);
        w.dropBeacon.visible = true;
        if (
          inMissionCar &&
          this.car.distanceTo(DROP_ZONE.x, DROP_ZONE.z) < 7 &&
          Math.abs(p.carSpeed) < 9
        ) {
          this.stage = 'passed';
          this.finalTime = this.time;
          const prevBest = this.bestTime;
          if (this.bestTime === null || this.time < this.bestTime) {
            this.bestTime = this.time;
          }
          this.hooks.onPass(this.finalTime, prevBest === null ? this.finalTime : prevBest);
        }
        break;

      case 'passed':
      case 'failed':
        w.startBeacon.visible = false;
        w.carBeacon.visible = false;
        w.dropBeacon.visible = false;
        break;
    }
  }
}
