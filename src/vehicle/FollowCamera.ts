import * as THREE from "three";
import type { CarSnapshot } from "./VehiclePhysics";

export const CAMERA_MODES = ["Chase", "Far chase", "Bonnet", "Top-down", "Side"] as const;
export type CameraMode = 0 | 1 | 2 | 3 | 4;

const UP = new THREE.Vector3(0, 1, 0);

/** Smoothed chase camera with a few views. Switch with C. */
export class FollowCamera {
  mode: CameraMode = 0;
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialised = false;
  /** 0 = landscape framing, 1 = portrait framing. Eases between the two so a rotation never makes the view jump. */
  private portrait = 0;
  private portraitTarget = 0;

  /** Wide, low view for landscape; tall view with more road ahead for portrait. */
  setLayout(layout: "portrait" | "landscape"): void {
    this.portraitTarget = layout === "portrait" ? 1 : 0;
  }

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  cycle(): string {
    this.mode = ((this.mode + 1) % CAMERA_MODES.length) as CameraMode;
    this.initialised = false;
    return CAMERA_MODES[this.mode];
  }

  /** Snap straight to the car (after a respawn or a mode change). */
  snap(): void {
    this.initialised = false;
  }

  update(dt: number, s: CarSnapshot): void {
    const car = new THREE.Vector3(s.x, s.y, s.z);
    const heading = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));

    if (!this.initialised) {
      this.fwd.copy(heading);
    } else {
      // Heading follows the car smoothly so the view doesn't whip on spins.
      this.fwd.lerp(heading, 1 - Math.exp(-dt * 5)).normalize();
    }
    const f = this.fwd;
    this.portrait += (this.portraitTarget - this.portrait) * (1 - Math.exp(-dt * 3));
    const p = this.portrait;
    const fovBase = this.mode === 2 ? 75 + p * 12 : this.mode === 3 ? 55 : 65 + p * 22;
    const fovTarget = fovBase + Math.min(s.speedKmh / 320, 1) * (this.mode === 3 ? 0 : 9);
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }

    switch (this.mode) {
      case 0:
      case 1: {
        const dist = (this.mode === 0 ? 8.5 : 14) * (1 + 0.1 * p);
        const height = (this.mode === 0 ? 2.5 : 4.8) * (1 + 0.3 * p);
        const speedPull = Math.min(s.speedKmh / 300, 1) * 2.2;
        this.target.copy(car).addScaledVector(f, -(dist + speedPull)).addScaledVector(UP, height);
        this.look.copy(car).addScaledVector(f, 6 + 7 * p).addScaledVector(UP, 0.6);
        break;
      }
      case 2: {
        this.target.copy(car).addScaledVector(heading, -0.5).addScaledVector(UP, 0.64);
        this.look.copy(car).addScaledVector(heading, 30).addScaledVector(UP, 0.2);
        break;
      }
      case 4: {
        // Low three-quarter view from the front-right, good for admiring the car.
        const right = new THREE.Vector3(f.z, 0, -f.x);
        this.target.copy(car).addScaledVector(right, 5.2).addScaledVector(f, 3.6).addScaledVector(UP, 0.9);
        this.look.copy(car).addScaledVector(UP, 0.1);
        break;
      }
      case 3: {
        this.target.copy(car).addScaledVector(UP, 70).addScaledVector(f, -6);
        this.look.copy(car).addScaledVector(f, 2);
        break;
      }
    }

    if (!this.initialised || this.mode === 2) {
      this.camera.position.copy(this.target);
      this.initialised = true;
    } else {
      this.camera.position.lerp(this.target, 1 - Math.exp(-dt * 9));
    }
    this.camera.up.set(0, 1, 0);
    if (this.mode === 3) this.camera.up.copy(f);
    this.camera.lookAt(this.look);
  }
}
