/** Car-to-car contact for cars that are not simulated by the physics engine. */
export interface Body {
  x: number;
  z: number;
  yaw: number;
  /** World velocity in m/s. */
  vx: number;
  vz: number;
}

export interface Contact {
  /** Unit normal pointing from b to a (the direction a is pushed). */
  nx: number;
  nz: number;
  depth: number;
  /** Closing speed along the normal, m/s (positive when the cars are approaching). */
  closing: number;
}

const OFFSETS = [-1.5, 0, 1.5];
export const CAR_RADIUS = 0.95;

/** Three circles per car are plenty for open-wheel cars seen from above. */
export function carContact(a: Body, b: Body): Contact | null {
  const afx = Math.sin(a.yaw);
  const afz = Math.cos(a.yaw);
  const bfx = Math.sin(b.yaw);
  const bfz = Math.cos(b.yaw);
  let best: Contact | null = null;
  const min = CAR_RADIUS * 2;
  for (const oa of OFFSETS) {
    for (const ob of OFFSETS) {
      const dx = a.x + afx * oa - (b.x + bfx * ob);
      const dz = a.z + afz * oa - (b.z + bfz * ob);
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      const depth = min - d;
      if (best && best.depth >= depth) continue;
      const nx = d > 1e-6 ? dx / d : -afz;
      const nz = d > 1e-6 ? dz / d : afx;
      best = { nx, nz, depth, closing: -((a.vx - b.vx) * nx + (a.vz - b.vz) * nz) };
    }
  }
  return best;
}

/** Convert a world-space hit direction into the car's frame (lx: left, lz: front). */
export function toCarFrame(yaw: number, wx: number, wz: number): { lx: number; lz: number } {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { lx: wx * Math.cos(yaw) - wz * Math.sin(yaw), lz: wx * fx + wz * fz };
}
