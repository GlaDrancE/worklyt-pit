import { CatmullRomCurve3, Vector3 } from "three";
import type { TrackDef } from "./tracks";

export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  tz: number;
  /** Unit normal pointing to the driver's right. */
  nx: number;
  nz: number;
  /** Distance along the centre line in metres. */
  s: number;
}

export interface Gate {
  index: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
}

export interface NearestResult {
  index: number;
  /** Distance to the centre line. */
  distance: number;
  /** Signed offset from the centre line, positive to the right. */
  lateral: number;
  s: number;
}

export interface Pose {
  x: number;
  z: number;
  /** Rotation about +Y so that local +Z points along the track. */
  yaw: number;
}

const SAMPLE_SPACING = 2; // metres

/**
 * Pure geometry for a circuit: centre line samples, checkpoint gates and
 * nearest-point queries. No rendering or physics in here so it is easy to test.
 */
export class TrackModel {
  readonly def: TrackDef;
  readonly samples: TrackSample[];
  readonly length: number;
  readonly halfWidth: number;
  readonly gates: Gate[];
  readonly sectorGates: readonly [number, number];

  constructor(def: TrackDef) {
    this.def = def;
    this.halfWidth = def.width / 2;

    const pts = def.controlPoints.map(([x, z]) => new Vector3(x, 0, z));
    const curve = new CatmullRomCurve3(pts, true, "centripetal");
    this.length = curve.getLength();

    const count = Math.max(16, Math.round(this.length / SAMPLE_SPACING));
    const raw = curve.getSpacedPoints(count);
    raw.pop(); // closed curve: last point equals the first

    const n = raw.length;
    this.samples = raw.map((p, i) => {
      const prev = raw[(i - 1 + n) % n]!;
      const next = raw[(i + 1) % n]!;
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      return { x: p.x, z: p.z, tx, tz, nx: -tz, nz: tx, s: (i * this.length) / n };
    });

    const gateCount = Math.min(16, Math.max(8, Math.round(this.length / 110)));
    this.gates = [];
    for (let i = 0; i < gateCount; i++) {
      const idx = Math.round((i * n) / gateCount) % n;
      const s = this.samples[idx]!;
      this.gates.push({ index: i, x: s.x, z: s.z, tx: s.tx, tz: s.tz, halfWidth: this.halfWidth });
    }
    this.sectorGates = [
      Math.max(1, Math.round(def.sectorFractions[0] * gateCount)),
      Math.max(2, Math.round(def.sectorFractions[1] * gateCount)),
    ];
  }

  get count(): number {
    return this.samples.length;
  }

  /** Brute-force nearest centre-line sample (a few hundred points: cheap enough per frame). */
  nearest(x: number, z: number): NearestResult {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]!;
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    const s = this.samples[best]!;
    return {
      index: best,
      distance: Math.sqrt(bestD2),
      lateral: (x - s.x) * s.nx + (z - s.z) * s.nz,
      s: s.s,
    };
  }

  /** True when the car's centre is outside the tarmac plus an optional margin. */
  isOffTrack(x: number, z: number, margin = 0): boolean {
    return Math.abs(this.nearest(x, z).lateral) > this.halfWidth + margin;
  }

  poseAtSample(index: number): Pose {
    const n = this.samples.length;
    const s = this.samples[((index % n) + n) % n]!;
    return { x: s.x, z: s.z, yaw: Math.atan2(s.tx, s.tz) };
  }

  /** Grid slot a few metres behind the start/finish line. */
  startPose(metresBehind = 8): Pose {
    const back = Math.round(metresBehind / SAMPLE_SPACING);
    return this.poseAtSample(-back);
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
