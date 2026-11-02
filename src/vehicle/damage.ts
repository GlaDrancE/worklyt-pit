/**
 * Pure damage model for one car. Health runs from 1 (new) to 0 (destroyed) per zone.
 * Hits come in as a closing speed (m/s) plus the direction of the hit in the car's own
 * frame: lx > 0 is the car's left, lz > 0 is its front.
 */
export type Zone =
  | "frontWing"
  | "rearWing"
  | "left"
  | "right"
  | "floor"
  | "engine"
  | "wheelFL"
  | "wheelFR"
  | "wheelRL"
  | "wheelRR";

export const ZONES: readonly Zone[] = ["frontWing", "rearWing", "left", "right", "floor", "engine", "wheelFL", "wheelFR", "wheelRL", "wheelRR"];

export const ZONE_LABEL: Record<Zone, string> = {
  frontWing: "front wing",
  rearWing: "rear wing",
  left: "left sidepod",
  right: "right sidepod",
  floor: "floor",
  engine: "engine",
  wheelFL: "front-left wheel",
  wheelFR: "front-right wheel",
  wheelRL: "rear-left wheel",
  wheelRR: "rear-right wheel",
};

export type DamageMode = "off" | "visual" | "realistic";

/** Seconds of work in the pit for a zone that is completely destroyed. */
const REPAIR_COST: Record<Zone, number> = { frontWing: 5, rearWing: 4, left: 4, right: 4, floor: 4, engine: 8, wheelFL: 3, wheelFR: 3, wheelRL: 3, wheelRR: 3 };

/** Below this closing speed a touch is just a scrape and does nothing. */
export const MIN_HIT_SPEED = 2.5;

export interface HitInfo {
  /** 0..1, how hard the hit was. */
  severity: number;
  zones: Array<{ zone: Zone; amount: number }>;
  /** Zones that went from still attached to destroyed in this hit. */
  lost: Zone[];
}

export interface DamageEffects {
  /** Engine power multiplier. */
  power: number;
  /** Aerodynamic downforce multiplier. */
  downforce: number;
  /** Per-wheel grip multiplier, FL FR RL RR. */
  wheelGrip: [number, number, number, number];
  /** Steering pull in input units (negative = pulls left). */
  steerBias: number;
}

export const NO_EFFECTS: DamageEffects = { power: 1, downforce: 1, wheelGrip: [1, 1, 1, 1], steerBias: 0 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class CarDamage {
  readonly health: Record<Zone, number> = {
    frontWing: 1, rearWing: 1, left: 1, right: 1, floor: 1, engine: 1, wheelFL: 1, wheelFR: 1, wheelRL: 1, wheelRR: 1,
  };

  /** Apply a hit. `kind` "car" does a little less damage than a solid wall. */
  hit(speed: number, lx: number, lz: number, kind: "car" | "wall" = "wall"): HitInfo {
    const energy = Math.min(1.4, Math.max(0, (speed - MIN_HIT_SPEED) / 22));
    const none: HitInfo = { severity: 0, zones: [], lost: [] };
    if (energy <= 0) return none;
    const base = energy * (kind === "car" ? 0.7 : 0.95);
    const len = Math.hypot(lx, lz) || 1;
    const dx = lx / len;
    const dz = lz / len;
    const parts: Array<[Zone, number]> = [];
    const leftSide = dx >= 0;
    if (dz > 0.5) {
      parts.push(["frontWing", base * 1.4], [leftSide ? "wheelFL" : "wheelFR", base * 0.6], ["floor", base * 0.35]);
      if (this.health.frontWing < 0.25) parts.push(["engine", base * 0.2], [leftSide ? "left" : "right", base * 0.3]);
    } else if (dz < -0.5) {
      parts.push(["rearWing", base * 1.3], ["engine", base * 0.5], [leftSide ? "wheelRL" : "wheelRR", base * 0.5]);
    } else {
      parts.push([leftSide ? "left" : "right", base * 1.2], ["floor", base * 0.3]);
      parts.push([dz >= 0 ? (leftSide ? "wheelFL" : "wheelFR") : leftSide ? "wheelRL" : "wheelRR", base * 0.8]);
    }
    const zones: Array<{ zone: Zone; amount: number }> = [];
    const lost: Zone[] = [];
    for (const [zone, amt] of parts) {
      const before = this.health[zone];
      const after = clamp01(before - amt);
      this.health[zone] = after;
      if (before - after > 0.001) zones.push({ zone, amount: before - after });
      if (before > 0.001 && after <= 0.001) lost.push(zone);
    }
    return { severity: Math.min(1, energy), zones, lost };
  }

  /** How much of the car is left, 0..1. */
  integrity(): number {
    const w = this.health;
    return clamp01(
      0.18 * w.frontWing + 0.1 * w.rearWing + 0.1 * w.left + 0.1 * w.right + 0.1 * w.floor + 0.18 * w.engine +
        0.06 * (w.wheelFL + w.wheelFR + w.wheelRL + w.wheelRR),
    );
  }

  lostWheels(): number {
    return (["wheelFL", "wheelFR", "wheelRL", "wheelRR"] as const).filter((z) => this.health[z] <= 0.001).length;
  }

  /** The car cannot continue under its own power. */
  isImmobilised(): boolean {
    return this.integrity() < 0.2 || this.health.engine <= 0.02 || this.lostWheels() >= 2;
  }

  effects(): DamageEffects {
    const h = this.health;
    const pods = (h.left + h.right) / 2;
    const power = this.isImmobilised() ? 0 : (0.4 + 0.6 * h.engine) * (0.85 + 0.15 * pods);
    const downforce = 1 - (0.2 * (1 - h.frontWing) + 0.16 * (1 - h.rearWing) + 0.12 * (1 - h.floor));
    const wg = (z: Zone): number => 0.4 + 0.6 * h[z];
    return {
      power,
      downforce,
      wheelGrip: [wg("wheelFL"), wg("wheelFR"), wg("wheelRL"), wg("wheelRR")],
      steerBias: 0.2 * (h.wheelFL - h.wheelFR),
    };
  }

  damagedZones(threshold = 0.95): Zone[] {
    return ZONES.filter((z) => this.health[z] < threshold);
  }

  /** Pit-lane work needed, in seconds (0 for an undamaged car). */
  repairSeconds(): number {
    let t = 0;
    for (const z of ZONES) t += (1 - this.health[z]) * REPAIR_COST[z];
    return Math.min(25, Math.round(t * 10) / 10);
  }

  /** Fix everything; returns what was damaged. */
  repairAll(): Zone[] {
    const was = this.damagedZones();
    for (const z of ZONES) this.health[z] = 1;
    return was;
  }
}

export function describeZones(zones: readonly Zone[]): string {
  const names = zones.map((z) => ZONE_LABEL[z]);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
