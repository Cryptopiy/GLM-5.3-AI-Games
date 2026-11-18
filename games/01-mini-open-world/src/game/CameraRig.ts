import * as THREE from 'three';
import { angDiff, clamp, damp } from './physics';

/** Smooth third-person chase camera. Always perspective, always behind and
 *  above the target; distance and stiffness react to speed and mode. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = Math.PI;
  private dist = 9;
  private height = 4.4;
  private lookTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 900);
    this.camera.position.set(0, 6, 14);
  }

  /** Current camera yaw, used for camera-relative on-foot movement. */
  cameraYaw(): number {
    return this.yaw;
  }

  snapBehind(x: number, z: number, heading: number): void {
    this.yaw = heading;
    this.updateTransform(x, z, true);
  }

  update(
    dt: number,
    x: number,
    z: number,
    heading: number,
    speed: number,
    driving: boolean,
  ): void {
    // While driving the camera locks behind the car. On foot it follows the
    // character's facing loosely, so the player can look around while walking.
    const follow = driving ? 3.2 : 1.4;
    this.yaw += angDiff(this.yaw, heading) * (1 - Math.exp(-follow * dt));

    const targetDist = driving ? clamp(10.5 + Math.abs(speed) * 0.22, 10.5, 17) : 8.6;
    const targetHeight = driving ? 4.6 + Math.abs(speed) * 0.05 : 4.2;
    this.dist = damp(this.dist, targetDist, 3, dt);
    this.height = damp(this.height, targetHeight, 3, dt);

    // Slight FOV kick with speed for a sense of velocity.
    const targetFov = driving ? clamp(62 + Math.abs(speed) * 0.55, 62, 78) : 62;
    this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
    this.camera.updateProjectionMatrix();

    this.updateTransform(x, z, false);

    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const ahead = driving ? 3.4 : 1.2;
    this.lookTarget.set(x + fx * ahead, 1.7, z + fz * ahead);
    this.camera.lookAt(this.lookTarget);
  }

  private updateTransform(x: number, z: number, hard: boolean): void {
    const cx = x - Math.sin(this.yaw) * this.dist;
    const cz = z - Math.cos(this.yaw) * this.dist;
    if (hard) {
      this.camera.position.set(cx, this.height, cz);
    } else {
      const k = 1 - Math.exp(-8 * 0.016);
      this.camera.position.x += (cx - this.camera.position.x) * k;
      this.camera.position.z += (cz - this.camera.position.z) * k;
      this.camera.position.y += (this.height + 0.9 - this.camera.position.y) * k;
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
