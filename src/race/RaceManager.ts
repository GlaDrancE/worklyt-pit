import type { Gate } from "../track/TrackModel";

export type RaceState = "idle" | "countdown" | "running" | "finished";

export interface LapResult {
  lap: number;
  ms: number;
  valid: boolean;
  /** Sector durations in ms; null when a checkpoint was missed. */
  sectors: [number | null, number | null, number | null];
}

export type RaceEvent =
  | { type: "countdown"; value: number }
  | { type: "go" }
  | { type: "sector"; sector: 1 | 2; splitMs: number }
  | { type: "lap"; result: LapResult; isBest: boolean }
  | { type: "invalid"; reason: string }
  | { type: "finished"; laps: LapResult[] };

export interface RaceOptions {
  gates: readonly Gate[];
  /** Gate indices where sector 1 and sector 2 end. */
  sectorGates: readonly [number, number];
  totalLaps: number;
  bestMs: number | null;
  countdownSeconds?: number;
}

/** A gate crossing only counts within this many metres of the gate plane. */
const MAX_STEP = 12;
/** Extra lateral tolerance (kerbs) on top of the road half-width. */
const LATERAL_MARGIN = 3;

/**
 * Lap timing and checkpoint validation. Pure logic driven by simulation time,
 * so it can be unit-tested without a browser, renderer or physics engine.
 *
 * Gate 0 is the start/finish line. Gates must be crossed in order; crossing a
 * later gate first (a shortcut) or resetting the car marks the lap invalid.
 */
export class RaceManager {
  state: RaceState = "idle";
  lapNumber = 1;
  bestMs: number | null;
  readonly laps: LapResult[] = [];
  readonly bestSectors: [number | null, number | null, number | null] = [null, null, null];

  private readonly gates: readonly Gate[];
  private readonly opts: RaceOptions;
  private readonly listener: (e: RaceEvent) => void;
  private prev: number[] = [];
  private prevInit = false;
  private expected = 1;
  private lapStartMs: number | null = null;
  private lapValid = true;
  private splits: [number | null, number | null] = [null, null];
  private countdownStartMs = 0;
  private lastCountdownValue = 0;

  constructor(opts: RaceOptions, listener: (e: RaceEvent) => void = () => {}) {
    this.opts = opts;
    this.gates = opts.gates;
    this.bestMs = opts.bestMs;
    this.listener = listener;
  }

  /** The car may only be driven once the lights go out. */
  get canDrive(): boolean {
    return this.state === "running";
  }

  get lapInProgress(): boolean {
    return this.lapStartMs !== null;
  }

  get currentLapValid(): boolean {
    return this.lapValid;
  }

  currentLapMs(nowMs: number): number {
    return this.lapStartMs === null ? 0 : Math.max(0, nowMs - this.lapStartMs);
  }

  /** Which sector the car is currently in (1-3). */
  currentSector(): 1 | 2 | 3 {
    const [s1, s2] = this.opts.sectorGates;
    if (this.expected === 0) return 3;
    if (this.expected <= s1) return 1;
    if (this.expected <= s2) return 2;
    return 3;
  }

  begin(nowMs: number): void {
    this.state = "countdown";
    this.countdownStartMs = nowMs;
    this.lastCountdownValue = 0;
    this.lapNumber = 1;
    this.laps.length = 0;
    this.lapStartMs = null;
    this.lapValid = true;
    this.expected = 1;
    this.splits = [null, null];
    this.prevInit = false;
  }

  /** Re-anchor gate tracking after the car is teleported (reset / respawn). */
  resync(x: number, z: number): void {
    this.prev = this.gates.map((g) => this.signed(g, x, z));
    this.prevInit = true;
  }

  invalidate(reason: string): void {
    if (this.lapStartMs === null || !this.lapValid) return;
    this.lapValid = false;
    this.listener({ type: "invalid", reason });
  }

  update(nowMs: number, x: number, z: number): void {
    if (this.state === "idle" || this.state === "finished") return;
    if (!this.prevInit) this.resync(x, z);

    if (this.state === "countdown") {
      const elapsed = nowMs - this.countdownStartMs;
      const total = (this.opts.countdownSeconds ?? 3) * 1000;
      if (elapsed >= total) {
        this.state = "running";
        this.listener({ type: "go" });
      } else {
        const value = Math.ceil((total - elapsed) / 1000);
        if (value !== this.lastCountdownValue) {
          this.lastCountdownValue = value;
          this.listener({ type: "countdown", value });
        }
        return;
      }
    }

    for (const g of this.gates) {
      const signed = this.signed(g, x, z);
      const was = this.prev[g.index]!;
      this.prev[g.index] = signed;
      if (was >= 0 || signed < 0 || was < -MAX_STEP) continue;
      const lateral = (x - g.x) * -g.tz + (z - g.z) * g.tx;
      if (Math.abs(lateral) > g.halfWidth + LATERAL_MARGIN) continue;
      this.crossed(g.index, nowMs);
      // crossed() can finish the race; stop checking the remaining gates.
      if ((this.state as RaceState) === "finished") return;
    }
  }

  private signed(g: Gate, x: number, z: number): number {
    return (x - g.x) * g.tx + (z - g.z) * g.tz;
  }

  private crossed(k: number, nowMs: number): void {
    const n = this.gates.length;

    if (k === 0) {
      if (this.lapStartMs === null) {
        // First time over the line after the lights: the lap clock starts.
        this.lapStartMs = nowMs;
        this.expected = 1;
        this.lapValid = true;
        this.splits = [null, null];
        return;
      }
      // Ignore jitter over the line early in a lap.
      const farEnough = this.expected === 0 || this.expected > n / 2;
      if (!farEnough) return;
      this.finishLap(nowMs);
      return;
    }

    if (this.lapStartMs === null) return;

    if (k === this.expected) {
      this.expected = (this.expected + 1) % n;
      this.recordSplit(k, nowMs);
    } else if (this.expected !== 0 && k > this.expected) {
      this.lapValid = false;
      this.listener({ type: "invalid", reason: "Missed a checkpoint" });
      this.expected = (k + 1) % n;
      this.recordSplit(k, nowMs);
    }
    // k < expected: re-crossing an earlier gate, ignore.
  }

  private recordSplit(gate: number, nowMs: number): void {
    if (this.lapStartMs === null) return;
    const [g1, g2] = this.opts.sectorGates;
    const t = nowMs - this.lapStartMs;
    if (gate === g1) {
      this.splits[0] = t;
      this.listener({ type: "sector", sector: 1, splitMs: t });
    } else if (gate === g2) {
      this.splits[1] = t;
      this.listener({ type: "sector", sector: 2, splitMs: t });
    }
  }

  private finishLap(nowMs: number): void {
    if (this.lapStartMs === null) return;
    const ms = nowMs - this.lapStartMs;
    const valid = this.lapValid && this.expected === 0;
    const [a, b] = this.splits;
    const sectors: LapResult["sectors"] = [
      a,
      a !== null && b !== null ? b - a : null,
      b !== null ? ms - b : null,
    ];
    const result: LapResult = { lap: this.lapNumber, ms, valid, sectors };
    this.laps.push(result);

    let isBest = false;
    if (valid) {
      isBest = this.bestMs === null || ms < this.bestMs;
      if (isBest) this.bestMs = ms;
      sectors.forEach((v, i) => {
        const cur = this.bestSectors[i];
        if (v !== null && (cur === null || v < cur)) this.bestSectors[i] = v;
      });
    }
    this.listener({ type: "lap", result, isBest });

    if (this.lapNumber >= this.opts.totalLaps) {
      this.state = "finished";
      this.listener({ type: "finished", laps: [...this.laps] });
      return;
    }
    this.lapNumber += 1;
    this.lapStartMs = nowMs;
    this.expected = 1;
    this.lapValid = true;
    this.splits = [null, null];
  }
}
