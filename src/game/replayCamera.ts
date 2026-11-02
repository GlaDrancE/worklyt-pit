/** Camera angles for watching a recorded lap. Pure maths so it can be tested without a renderer. */

export const REPLAY_CAMERAS = ["Chase", "TV", "Top", "Helicopter"] as const;
export type ReplayCamera = 0 | 1 | 2 | 3;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CarPoint {
  x: number;
  z: number;
  yaw: number;
}

export interface CamPose {
  pos: Vec3;
  look: Vec3;
  fov: number;
}

export function nextReplayCamera(c: ReplayCamera): ReplayCamera {
  return ((c + 1) % REPLAY_CAMERAS.length) as ReplayCamera;
}

/** How long (ms of lap time) a TV camera stays on one spot before cutting to the next. */
export const TV_CUT_MS = 4500;

/**
 * @param car      where the car is now
 * @param anchor   where the car will be a moment ahead of the current TV cut (fixed for the whole cut)
 * @param t        seconds since the replay started, drives the helicopter's orbit
 */
export function replayCameraPose(mode: ReplayCamera, car: CarPoint, anchor: CarPoint, t: number): CamPose {
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const look: Vec3 = { x: car.x, y: 0.6, z: car.z };
  switch (mode) {
    case 0:
      return { pos: { x: car.x - fx * 9, y: 2.8, z: car.z - fz * 9 }, look: { x: car.x + fx * 6, y: 0.6, z: car.z + fz * 6 }, fov: 68 };
    case 1: {
      // Trackside: stand beside the spot the car is about to pass, 16 m off the racing line.
      const ax = Math.sin(anchor.yaw);
      const az = Math.cos(anchor.yaw);
      return { pos: { x: anchor.x + az * 16, y: 3.2, z: anchor.z - ax * 16 }, look, fov: 48 };
    }
    case 2:
      // A touch behind so the view never points exactly straight down.
      return { pos: { x: car.x - fx * 3, y: 70, z: car.z - fz * 3 }, look: { x: car.x, y: 0, z: car.z }, fov: 50 };
    default: {
      const a = t * 0.45;
      return { pos: { x: car.x + Math.cos(a) * 34, y: 24, z: car.z + Math.sin(a) * 34 }, look, fov: 55 };
    }
  }
}
