/**
 * Drift scoring. A drift is the car travelling sideways: slip angle above a threshold
 * at real speed. Points build while it lasts (faster and sideways-er is worth more, and
 * a longer drift multiplies), and are banked once the car grips up again. Hitting
 * something or leaving the track while a combo is running loses it.
 */
export interface DriftState {
  /** Currently sliding. */
  active: boolean;
  /** Points in the running combo (not yet banked). */
  combo: number;
  /** Multiplier on the running combo. */
  multiplier: number;
  /** Total banked this race. */
  total: number;
  /** Best single combo banked this race. */
  best: number;
  /** Set for one update when a combo was banked or lost; read with `consumeEvent`. */
  event: { kind: "bank" | "lost"; points: number } | null;
}

export const DRIFT_MIN_SLIP = 0.17;
export const DRIFT_MIN_KMH = 30;
export const DRIFT_GRACE_S = 0.8;
const MIN_BANK = 20;

export class DriftScorer {
  private comboPts = 0;
  private time = 0;
  private gripTime = 0;
  private running = false;
  total = 0;
  best = 0;
  private pending: DriftState["event"] = null;

  reset(): void {
    this.comboPts = 0;
    this.time = 0;
    this.gripTime = 0;
    this.running = false;
    this.total = 0;
    this.best = 0;
    this.pending = null;
  }

  private multiplier(): number {
    return 1 + Math.min(4, Math.floor(this.time / 2));
  }

  private end(kind: "bank" | "lost"): void {
    const pts = Math.round(this.comboPts);
    if (kind === "bank" && pts >= MIN_BANK) {
      this.total += pts;
      this.best = Math.max(this.best, pts);
      this.pending = { kind, points: pts };
    } else if (kind === "lost" && pts >= MIN_BANK) {
      this.pending = { kind, points: pts };
    }
    this.comboPts = 0;
    this.time = 0;
    this.gripTime = 0;
    this.running = false;
  }

  /** Advance by dt seconds. `crashed` is true for a frame where the car hit something or went off track. */
  update(dt: number, slip: number, speedKmh: number, crashed: boolean): DriftState {
    const sliding = Math.abs(slip) >= DRIFT_MIN_SLIP && speedKmh >= DRIFT_MIN_KMH;
    if (crashed && this.running) this.end("lost");
    else if (sliding) {
      this.running = true;
      this.gripTime = 0;
      this.time += dt;
      // Slip is capped so a sideways spin is not worth more than a controlled drift.
      const angle = Math.min(Math.abs(slip), 0.9);
      this.comboPts += dt * (speedKmh / 10) * (angle * 12) * this.multiplier();
    } else if (this.running) {
      this.gripTime += dt;
      this.time += dt * 0.5;
      if (this.gripTime >= DRIFT_GRACE_S) this.end("bank");
    }
    return {
      active: sliding,
      combo: Math.round(this.comboPts),
      multiplier: this.running ? this.multiplier() : 1,
      total: this.total,
      best: this.best,
      event: this.pending,
    };
  }

  /** Read and clear the last bank/lost event. */
  consumeEvent(): DriftState["event"] {
    const e = this.pending;
    this.pending = null;
    return e;
  }

  /** Bank anything still running (end of race). */
  finish(): void {
    if (this.running) this.end("bank");
  }
}
