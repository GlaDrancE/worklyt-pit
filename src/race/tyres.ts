import type { CompoundId } from "../game/settings";

export interface Compound {
  id: CompoundId;
  name: string;
  /** Peak grip multiplier on fresh tyres. */
  grip: number;
  /** How fast it wears relative to the medium. */
  wearRate: number;
  color: string;
}

export const COMPOUNDS: Record<CompoundId, Compound> = {
  soft: { id: "soft", name: "Soft", grip: 1.06, wearRate: 1.6, color: "#ff4d4d" },
  medium: { id: "medium", name: "Medium", grip: 1.0, wearRate: 1.0, color: "#ffd21f" },
  hard: { id: "hard", name: "Hard", grip: 0.95, wearRate: 0.6, color: "#f2f2f2" },
};

/** Seconds a medium tyre lasts under steady "load 1" driving. */
const LIFE_SECONDS = 100;
/** Share of grip lost when the tyre is completely worn. */
const MAX_GRIP_LOSS = 0.32;

export interface TyreLoad {
  speedKmh: number;
  /** Absolute slip angle in radians. */
  slip: number;
  /** 0..1 */
  brake: number;
  /** 0..1 */
  throttle: number;
  /** Rain cools the tyres: they wear a little slower. */
  wet: boolean;
}

/** Tyre wear: builds with speed, sliding, braking and power, and takes grip with it. */
export class TyreModel {
  wear = 0;
  compound: Compound;

  constructor(compound: CompoundId = "medium") {
    this.compound = COMPOUNDS[compound];
  }

  update(dt: number, l: TyreLoad): void {
    const speed = Math.min(1, l.speedKmh / 200);
    if (speed <= 0.02) return;
    const load = speed * (0.15 + 0.8 * Math.min(1.2, l.slip * 2) + 0.4 * l.brake + 0.15 * l.throttle);
    const rate = (load * this.compound.wearRate * (l.wet ? 0.85 : 1)) / LIFE_SECONDS;
    this.wear = Math.min(1, this.wear + rate * dt);
  }

  /** Multiplier applied to tyre friction. */
  grip(): number {
    return this.compound.grip * (1 - MAX_GRIP_LOSS * Math.pow(this.wear, 1.4));
  }

  fit(compound: CompoundId): void {
    this.compound = COMPOUNDS[compound];
    this.wear = 0;
  }

  /** Remaining life as a percentage for the HUD. */
  get lifePercent(): number {
    return Math.round((1 - this.wear) * 100);
  }
}
