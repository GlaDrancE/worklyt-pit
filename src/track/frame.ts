import type { TrackModel } from "./TrackModel";

export interface Frame {
  x: number;
  z: number;
  yaw: number;
}

/** World position and heading at `dist` metres along the lap and `lateral` metres to the driver's right. */
export function frameAt(model: TrackModel, dist: number, lateral: number): Frame {
  const L = model.length;
  const n = model.count;
  const wrapped = ((dist % L) + L) % L;
  const f = (wrapped / L) * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const s0 = model.samples[i]!;
  const s1 = model.samples[(i + 1) % n]!;
  let tx = s0.tx + (s1.tx - s0.tx) * t;
  let tz = s0.tz + (s1.tz - s0.tz) * t;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  return {
    x: s0.x + (s1.x - s0.x) * t - tz * lateral,
    z: s0.z + (s1.z - s0.z) * t + tx * lateral,
    yaw: Math.atan2(tx, tz),
  };
}
