import type { Pose, TrackModel } from "../track/TrackModel";

/** Where the pit box is painted on the track and how it is entered. */
export interface PitBox {
  x: number;
  z: number;
  /** Direction of travel (rotation about +Y). */
  yaw: number;
  halfLength: number;
  halfWidth: number;
  pose: Pose;
}

/** Seconds the car must stand still in the box for a tyre change. */
export const PIT_SECONDS = 3;
/** Under this speed (km/h) the car counts as stopped. */
export const PIT_MAX_SPEED = 4;

/**
 * The box sits on the right-hand edge of the main straight, about 100 m after the line,
 * so any car can drive in off the racing line, stop, and leave again without a pit lane.
 */
export function pitBoxFor(model: TrackModel, metresAfterLine = 100): PitBox {
  const idx = Math.round(metresAfterLine / 2);
  const s = model.samples[((idx % model.count) + model.count) % model.count]!;
  const halfWidth = Math.min(2.1, model.halfWidth * 0.4);
  const offset = model.halfWidth - halfWidth - 0.6; // towards the driver's right
  const x = s.x + s.nx * offset;
  const z = s.z + s.nz * offset;
  const yaw = Math.atan2(s.tx, s.tz);
  return { x, z, yaw, halfLength: 4.5, halfWidth, pose: { x, z, yaw } };
}

export function insideBox(box: PitBox, x: number, z: number): boolean {
  const dx = x - box.x;
  const dz = z - box.z;
  const fx = Math.sin(box.yaw);
  const fz = Math.cos(box.yaw);
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  return Math.abs(along) <= box.halfLength && Math.abs(across) <= box.halfWidth;
}

export interface PitState {
  /** The car is inside the box. */
  inBox: boolean;
  /** 0..1 progress of the stop in progress. */
  progress: number;
  /** True for exactly one update: the tyres should be changed now. */
  done: boolean;
}

/** Tracks a pit stop: stop in the box and hold still until the timer fills. */
export class PitStop {
  private held = 0;
  /** After a stop the car must leave the box (or move off) before another one counts. */
  private spent = false;

  constructor(readonly box: PitBox) {}

  reset(): void {
    this.held = 0;
    this.spent = false;
  }

  update(dt: number, x: number, z: number, speedKmh: number, holdSeconds = PIT_SECONDS): PitState {
    const inBox = insideBox(this.box, x, z);
    if (!inBox || speedKmh > PIT_MAX_SPEED) {
      this.held = 0;
      if (!inBox) this.spent = false;
      return { inBox, progress: 0, done: false };
    }
    if (this.spent) return { inBox, progress: 0, done: false };
    this.held += dt;
    if (this.held >= holdSeconds) {
      this.held = 0;
      this.spent = true;
      return { inBox, progress: 1, done: true };
    }
    return { inBox, progress: this.held / holdSeconds, done: false };
  }
}

/** Computer-driven cars service in their own box, this many metres before yours, so they never park on top of you. */
export const RIVAL_BOX_OFFSET_M = 14;

export function rivalPitBoxFor(model: TrackModel): PitBox {
  return pitBoxFor(model, 100 - RIVAL_BOX_OFFSET_M);
}
