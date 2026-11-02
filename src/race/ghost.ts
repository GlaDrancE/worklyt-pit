/** Best-lap "ghost": a recording of your fastest lap that replays next to you. */

export interface GhostLap {
  /** Lap time in ms. */
  ms: number;
  /** Lap clock (ms), position, heading and fraction of the lap for each sample. */
  t: number[];
  x: number[];
  z: number[];
  yaw: number[];
  f: number[];
}

export interface GhostPose {
  x: number;
  z: number;
  yaw: number;
  speedKmh: number;
}

const SAMPLE_EVERY_MS = 50;

/** Fraction of the lap measured right after the line can read "almost 1"; fold it to just below 0. */
function unwrap(lapMs: number, frac: number): number {
  return lapMs < 2500 && frac > 0.9 ? frac - 1 : frac;
}

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export class GhostRecorder {
  private lap: GhostLap = { ms: 0, t: [], x: [], z: [], yaw: [], f: [] };

  reset(): void {
    this.lap = { ms: 0, t: [], x: [], z: [], yaw: [], f: [] };
  }

  get length(): number {
    return this.lap.t.length;
  }

  sample(lapMs: number, x: number, z: number, yaw: number, frac: number): void {
    const t = this.lap.t;
    if (t.length > 0 && lapMs - t[t.length - 1]! < SAMPLE_EVERY_MS) return;
    t.push(Math.round(lapMs));
    this.lap.x.push(r(x, 2));
    this.lap.z.push(r(z, 2));
    this.lap.yaw.push(r(yaw, 3));
    this.lap.f.push(r(unwrap(lapMs, frac), 4));
  }

  /** Close the lap and hand back the recording. */
  finish(ms: number, x: number, z: number, yaw: number): GhostLap {
    const lap = this.lap;
    lap.ms = Math.round(ms);
    if (lap.t.length === 0 || lap.t[lap.t.length - 1]! < lap.ms) {
      lap.t.push(lap.ms);
      lap.x.push(r(x, 2));
      lap.z.push(r(z, 2));
      lap.yaw.push(r(yaw, 3));
      lap.f.push(1);
    }
    return lap;
  }
}

export class GhostPlayer {
  constructor(readonly lap: GhostLap) {}

  get ms(): number {
    return this.lap.ms;
  }

  private indexAt(lapMs: number): number {
    const t = this.lap.t;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid]! <= lapMs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Where the ghost is at this lap time, or null once its lap is over. */
  at(lapMs: number): GhostPose | null {
    const L = this.lap;
    if (L.t.length < 2 || lapMs < 0 || lapMs > L.ms) return null;
    const i = Math.min(this.indexAt(lapMs), L.t.length - 2);
    const span = Math.max(1, L.t[i + 1]! - L.t[i]!);
    const k = Math.min(1, Math.max(0, (lapMs - L.t[i]!) / span));
    let dyaw = L.yaw[i + 1]! - L.yaw[i]!;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    const dx = L.x[i + 1]! - L.x[i]!;
    const dz = L.z[i + 1]! - L.z[i]!;
    return {
      x: L.x[i]! + dx * k,
      z: L.z[i]! + dz * k,
      yaw: L.yaw[i]! + dyaw * k,
      speedKmh: (Math.hypot(dx, dz) / (span / 1000)) * 3.6,
    };
  }

  /**
   * How far ahead (negative) or behind (positive) of the ghost you are, in ms,
   * judged at the same point on the track. Null before there is enough data.
   */
  deltaMs(lapMs: number, frac: number): number | null {
    const L = this.lap;
    const f = unwrap(lapMs, frac);
    const last = L.f.length - 1;
    if (last < 1 || f < L.f[0]! || f > L.f[last]!) return null;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (L.f[mid]! < f) lo = mid + 1;
      else hi = mid;
    }
    const j = Math.max(1, lo);
    const f0 = L.f[j - 1]!;
    const f1 = L.f[j]!;
    const k = f1 > f0 ? (f - f0) / (f1 - f0) : 0;
    const ghostMs = L.t[j - 1]! + (L.t[j]! - L.t[j - 1]!) * Math.min(1, Math.max(0, k));
    return lapMs - ghostMs;
  }
}

const key = (trackId: string) => `trackrush.ghost.${trackId}`;

function isGhost(v: unknown): v is GhostLap {
  const g = v as GhostLap;
  const arr = (a: unknown) => Array.isArray(a) && a.length === g.t?.length && a.every((n) => typeof n === "number" && Number.isFinite(n));
  return !!g && typeof g.ms === "number" && Array.isArray(g.t) && g.t.length >= 2 && g.t.length < 20000 && arr(g.t) && arr(g.x) && arr(g.z) && arr(g.yaw) && arr(g.f);
}

export function loadGhost(trackId: string, store: Pick<Storage, "getItem"> | null = safeStorage()): GhostLap | null {
  try {
    const raw = store?.getItem(key(trackId));
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return isGhost(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveGhost(trackId: string, lap: GhostLap, store: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    store?.setItem(key(trackId), JSON.stringify(lap));
  } catch {
    /* storage full or blocked: no ghost next time */
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
