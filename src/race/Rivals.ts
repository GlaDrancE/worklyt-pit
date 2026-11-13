import type { TrackModel } from "../track/TrackModel";
import { CarDamage, type Zone } from "../vehicle/damage";
import { toCarFrame } from "./contact";
import { COMPANY_NAMES, isCompanyName, rivalCompanyNames, WORKLYFT } from "./companies";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: ReadonlyArray<{ id: Difficulty; name: string; pace: number }> = [
  { id: "easy", name: "Easy", pace: 0.5 },
  { id: "medium", name: "Medium", pace: 0.64 },
  { id: "hard", name: "Hard", pace: 0.78 },
];

export function paceFor(d: Difficulty): number {
  return DIFFICULTIES.find((x) => x.id === d)?.pace ?? 0.8;
}

/** Championship-style points for 1st..6th. */
export const FIELD_POINTS = [25, 18, 15, 12, 10, 8] as const;

// A rough model of the car, matching VehiclePhysics: grip plus downforce, power-limited acceleration.
const BASE_LATERAL = 22; // m/s² of grip at standstill
const AERO_LATERAL = 0.0075; // extra m/s² per (m/s)²
const MAX_SPEED = 92; // m/s (~330 km/h)
const BRAKE = 30; // m/s²
const MASS = 768;
const POWER = 650_000;
const MAX_FORCE = 9500;
const DRAG = 0.76;

const accelAt = (v: number): number => Math.max(1, Math.min(MAX_FORCE, POWER / Math.max(v, 5)) / MASS - (DRAG * v * v) / MASS);

/**
 * Fastest speed at every centre-line sample that corners, braking and power
 * allow, for a car with `grip` (0..1) of the full lateral grip.
 */
export function speedProfile(model: TrackModel, grip: number): Float64Array {
  const n = model.count;
  const ds = model.length / n;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = model.samples[(i - 2 + n) % n]!;
    const b = model.samples[(i + 2) % n]!;
    let dh = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const kappa = Math.abs(dh) / (4 * ds);
    // v²·κ = a0 + k·v²  →  v = sqrt(a0 / (κ − k)) when κ > k, otherwise unlimited.
    const a0 = BASE_LATERAL * grip;
    const k = AERO_LATERAL * grip;
    v[i] = kappa > k ? Math.min(MAX_SPEED, Math.sqrt(a0 / (kappa - k))) : MAX_SPEED;
  }
  const brake = BRAKE * Math.max(0.6, grip);
  // Two sweeps around the lap so the start/finish seam is handled.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n * 2 - 1; i >= 0; i--) {
      const j = i % n;
      const next = v[(j + 1) % n]!;
      v[j] = Math.min(v[j]!, Math.sqrt(next * next + 2 * brake * ds));
    }
    for (let i = 0; i < n * 2; i++) {
      const j = i % n;
      const prev = v[(j - 1 + n) % n]!;
      const cap = Math.sqrt(prev * prev + 2 * accelAt(prev) * grip * ds);
      v[j] = Math.min(v[j]!, cap);
    }
  }
  return v;
}

export type RivalStatus = "racing" | "stopped" | "pitting" | "servicing" | "gone";

export interface RivalState {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  speedKmh: number;
  /** Front-wheel angle for the visuals. */
  steer: number;
  /** Metres travelled relative to the start line (negative while on the grid). */
  dist: number;
  /** Sim time (ms) when this car took the flag, or null. */
  finishedAt: number | null;
  damage: CarDamage;
  status: RivalStatus;
  /** Seconds of pit work left while servicing. */
  serviceLeft: number;
}

/** Something a rival must keep clear of: another car, or the safety car. */
export interface Blocker {
  x: number;
  z: number;
  speed: number;
  /** Never overtaken: stay behind instead of steering round (safety car). */
  solid?: boolean;
}

export interface RivalContext {
  blockers: readonly Blocker[];
  /** Speed limit for everyone (safety car), m/s. */
  cap: number | null;
  /** Multiplies pace (yellow flags). */
  scale: number;
  /** Rivals may spin off now and then. */
  mistakes: boolean;
  wet: boolean;
  /** Rivals pick up damage and pit for repairs. */
  damageOn: boolean;
}

export const NO_CONTEXT: RivalContext = { blockers: [], cap: null, scale: 1, mistakes: false, wet: false, damageOn: false };

/** A hit on a rival, for the visuals (dents, lost parts). Direction is in the rival's own frame. */
export interface RivalHit {
  id: string;
  lx: number;
  lz: number;
  severity: number;
  lost: Zone[];
  /** Closing speed of the hit, m/s. */
  speed: number;
}

export interface RivalIncident {
  id: string;
  /** Metres along the lap, 0..length. */
  dist: number;
  lateral: number;
  severity: number;
}

interface Internal {
  state: RivalState;
  v: number;
  pace: number;
  gridOffset: number;
  phase: number;
  /** Steering round another car, metres. */
  avoid: number;
  /** Knocked sideways by a touch, metres (decays). */
  bump: number;
  /** Pulled towards a fixed lateral position (road edge, pit box). */
  override: number | null;
  overrideW: number;
  reported: boolean;
  lastHitMs: number;
  lateral: number;
}

export function gridSlot(slot: number): { metresBehind: number; lateral: number } {
  return { metresBehind: 8 + slot * 7.5, lateral: slot % 2 === 0 ? -2.5 : 2.5 };
}

export interface PitSpot {
  /** Metres along the lap where the box is. */
  dist: number;
  /** Metres to the driver's right. */
  lateral: number;
}

/** A field of computer-driven cars that follow a speed profile around the circuit. */
export class RivalField {
  readonly rivals: RivalState[] = [];
  readonly incidents: RivalIncident[] = [];
  private hits: RivalHit[] = [];
  private readonly internal: Internal[] = [];
  private readonly profile: Float64Array;
  private readonly total: number;
  private readonly rand: () => number;
  /** Rivals that came through the pit box with damage. */
  pitStops = 0;

  constructor(
    private readonly model: TrackModel,
    count: number,
    difficulty: Difficulty,
    laps: number,
    seed = 1,
    private readonly pit: PitSpot | null = null,
    names: readonly string[] = [],
    playerName = "",
  ) {
    let a = seed >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.rand = rand;
    const grip = paceFor(difficulty);
    this.profile = speedProfile(model, grip);
    this.total = laps * model.length;
    const generatedNames = rivalCompanyNames(count, rand, count + 2, playerName ? [playerName] : []);
    const used = new Set<string>(playerName ? [playerName] : []);
    for (let i = 0; i < count; i++) {
      const requested = names[i];
      let name =
        i === 0
          ? WORKLYFT
          : requested && isCompanyName(requested) && requested !== WORKLYFT && !used.has(requested)
            ? requested
            : generatedNames[i] ?? `${COMPANY_NAMES[i % COMPANY_NAMES.length]} ${i + 1}`;
      if (used.has(name)) {
        name = generatedNames.find((candidate) => !used.has(candidate)) ?? `${COMPANY_NAMES[i % COMPANY_NAMES.length]} ${i + 1}`;
      }
      used.add(name);
      const g = gridSlot(i);
      const state: RivalState = {
        id: `rival${i + 1}`, name, x: 0, z: 0, yaw: 0, speedKmh: 0, steer: 0, dist: -g.metresBehind, finishedAt: null,
        damage: new CarDamage(), status: "racing", serviceLeft: 0,
      };
      this.internal.push({
        state, v: 0, pace: 0.96 + rand() * 0.07, gridOffset: g.lateral, phase: rand() * 6.28,
        avoid: 0, bump: 0, override: null, overrideW: 0, reported: false, lastHitMs: -1000, lateral: 0,
      });
      this.rivals.push(state);
    }
    for (const r of this.internal) this.place(r);
  }

  get totalDistance(): number {
    return this.total;
  }

  private place(r: Internal): void {
    const L = this.model.length;
    const n = this.model.count;
    const wrapped = ((r.state.dist % L) + L) % L;
    const f = (wrapped / L) * n;
    const i = Math.floor(f) % n;
    const t = f - Math.floor(f);
    const s0 = this.model.samples[i]!;
    const s1 = this.model.samples[(i + 1) % n]!;
    const px = s0.x + (s1.x - s0.x) * t;
    const pz = s0.z + (s1.z - s0.z) * t;
    let tx = s0.tx + (s1.tx - s0.tx) * t;
    let tz = s0.tz + (s1.tz - s0.tz) * t;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Start on the grid slot, drift to a racing line with a gentle weave.
    const settle = Math.max(0, 1 - Math.max(0, r.state.dist + 40) / 220);
    let lateral = r.gridOffset * settle + Math.sin(r.state.dist / 85 + r.phase) * 1.1 * (1 - settle);
    lateral += r.avoid + r.bump;
    if (r.override !== null) lateral += (r.override - lateral) * r.overrideW;
    r.lateral = lateral;
    const nx = -tz;
    const nz = tx;
    const prevYaw = r.state.yaw;
    r.state.x = px + nx * lateral;
    r.state.z = pz + nz * lateral;
    r.state.yaw = Math.atan2(tx, tz);
    let dy = r.state.yaw - prevYaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    r.state.steer = Math.max(-0.3, Math.min(0.3, Math.abs(r.v) > 1 ? Math.atan((dy * 60 * 3.4) / r.v) : 0));
    r.state.speedKmh = r.v * 3.6;
  }

  /** The player touched rival `id`: shove it and slow or speed it up. `n` points from the player to the rival. */
  contact(id: string, nx: number, nz: number, closing: number, simMs: number, damaging = true): boolean {
    const r = this.internal.find((x) => x.state.id === id);
    if (!r || r.state.status === "gone" || simMs - r.lastHitMs < 350) return false;
    r.lastHitMs = simMs;
    if (damaging && closing > 0) {
      const dir = toCarFrame(r.state.yaw, -nx, -nz);
      const info = r.state.damage.hit(closing, dir.lx, dir.lz, "car");
      if (info.severity > 0) this.hits.push({ id, lx: dir.lx, lz: dir.lz, severity: info.severity, lost: info.lost, speed: closing });
    }
    const fx = Math.sin(r.state.yaw);
    const fz = Math.cos(r.state.yaw);
    const side = nx * -fz + nz * fx; // + = pushed to its right
    r.bump = Math.max(-2.2, Math.min(2.2, r.bump + side * Math.min(2, closing * 0.12)));
    r.v = Math.max(0, r.v + (nx * fx + nz * fz) * closing * 0.3);
    return true;
  }

  /** Make a rival crash right now (used by mistakes and by tests). */
  crash(id: string, speed: number): void {
    const r = this.internal.find((x) => x.state.id === id);
    if (!r || r.state.status !== "racing") return;
    const lx = (this.rand() - 0.5) * 1.2;
    const info = r.state.damage.hit(speed, lx, 1, "wall");
    this.hits.push({ id, lx, lz: 1, severity: Math.max(0.5, info.severity), lost: info.lost, speed });
    r.state.status = "stopped";
    r.override = (this.rand() < 0.5 ? -1 : 1) * (this.model.halfWidth - 1.1);
    r.reported = false;
  }

  /** Hits since the last call, so the game can crumple the rival's bodywork. */
  drainHits(): RivalHit[] {
    const h = this.hits;
    this.hits = [];
    return h;
  }

  /** Hand a stopped car over to the recovery truck: it disappears from the track. */
  remove(id: string): void {
    const r = this.internal.find((x) => x.state.id === id);
    if (!r) return;
    r.state.status = "gone";
    r.v = 0;
  }

  /** Advance by dt seconds. `simMs` is the session clock, used to stamp finishing times. */
  step(dt: number, driving: boolean, simMs: number, ctx: RivalContext = NO_CONTEXT): void {
    const L = this.model.length;
    const n = this.model.count;
    const half = this.model.halfWidth;
    for (const r of this.internal) {
      const st = r.state;
      if (st.status === "gone") {
        r.v = 0;
        st.speedKmh = 0;
        continue;
      }
      r.bump *= Math.max(0, 1 - 1.6 * dt);
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      const wrapped = ((st.dist % L) + L) % L;

      if (st.status === "stopped") {
        r.v = Math.max(0, r.v - 20 * dt);
        st.dist += r.v * dt;
        r.overrideW = Math.min(1, r.overrideW + dt * 0.9);
        if (r.v < 1 && !r.reported) {
          r.reported = true;
          this.incidents.push({ id: st.id, dist: wrapped, lateral: r.override ?? half - 1.1, severity: Math.min(1, 0.35 + (1 - st.damage.integrity()) * 0.9) });
        }
        this.place(r);
        continue;
      }

      if (st.finishedAt === null && driving) {
        const idx = Math.floor((wrapped / L) * n) % n;
        const fxDmg = ctx.damageOn ? st.damage.effects() : null;
        const dmgScale = fxDmg ? 0.45 + 0.55 * (0.6 * fxDmg.power + 0.4 * fxDmg.downforce) : 1;
        let target = this.profile[idx]! * r.pace * dmgScale * ctx.scale;
        if (ctx.cap !== null) target = Math.min(target, ctx.cap);

        // Keep clear of other cars: steer round them, or hold back if there is no room.
        let want = 0;
        let nearestAhead = Infinity;
        const check = (bx: number, bz: number, bs: number, solid: boolean): void => {
          const dx = bx - st.x;
          const dz = bz - st.z;
          const ahead = dx * fx + dz * fz;
          const side = dx * -fz + dz * fx;
          if (ahead <= 0 || ahead > 26 || Math.abs(side) > 2.7) return;
          if (solid) {
            nearestAhead = Math.min(nearestAhead, ahead);
            target = Math.min(target, bs * (ahead < 18 ? 0.9 : 1.05));
            return;
          }
          want += side > 0 ? -2.6 : 2.6;
          if (ahead < 9 && Math.abs(side) < 2.2) target = Math.min(target, Math.max(bs * 0.95, 4));
        };
        for (const o of this.internal) {
          if (o === r || o.state.status === "gone") continue;
          check(o.state.x, o.state.z, o.v, false);
        }
        for (const b of ctx.blockers) check(b.x, b.z, b.speed, !!b.solid);
        const limit = half - 1.5;
        const cur = r.lateral - r.avoid;
        const wanted = Math.max(-limit - cur, Math.min(limit - cur, want));
        r.avoid += (wanted - r.avoid) * Math.min(1, 2.2 * dt);

        // Damaged cars come into the pit box for repairs.
        if (ctx.damageOn && this.pit && st.status === "racing" && st.damage.integrity() < 0.6 && st.dist > 0) {
          const remaining = (((this.pit.dist - wrapped) % L) + L) % L;
          if (remaining < 160) {
            st.status = "pitting";
          }
        }
        if (st.status === "pitting" && this.pit) {
          const remaining = (((this.pit.dist - wrapped) % L) + L) % L;
          r.override = this.pit.lateral;
          r.overrideW = Math.min(1, r.overrideW + dt * 0.6);
          target = Math.min(target, remaining > L / 2 ? 0 : Math.sqrt(2 * 6 * remaining) + 0.8);
          if (remaining > L / 2 || (remaining < 1.2 && r.v < 1.5)) {
            st.status = "servicing";
            st.serviceLeft = st.damage.repairSeconds() + 3;
            r.v = 0;
          }
        }

        if (target > r.v) r.v = Math.min(target, r.v + accelAt(r.v) * 0.9 * dt);
        else r.v = Math.max(target, r.v - BRAKE * 0.85 * dt);
        if (st.status === "servicing") {
          r.v = 0;
          st.serviceLeft -= dt;
          if (st.serviceLeft <= 0) {
            st.damage.repairAll();
            st.status = "racing";
            r.override = null;
            r.overrideW = 0;
            this.pitStops++;
          }
        }
        st.dist += r.v * dt;
        if (st.dist >= this.total) st.finishedAt = simMs;

        // Mistakes: a rival now and then spins off at speed (more often in the wet).
        if (ctx.mistakes && st.status === "racing" && r.v > 38 && st.dist > 60) {
          const rate = (ctx.wet ? 2.5 : 1) / 900;
          if (this.rand() < rate * dt) this.crash(st.id, r.v * 0.65);
        }
        if (ctx.damageOn && st.status === "racing" && st.damage.isImmobilised()) {
          st.status = "stopped";
          r.override = (r.lateral >= 0 ? 1 : -1) * (half - 1.1);
          r.reported = false;
        }
      } else if (st.finishedAt !== null) {
        // Slow down after the flag.
        r.v = Math.max(0, r.v - 12 * dt);
        st.dist += r.v * dt;
      }
      this.place(r);
    }
  }
}

export interface FieldResult {
  id: string;
  name: string;
  totalMs: number;
  place: number;
  points: number;
}

/**
 * Final order once the player has taken the flag. Cars that already finished use
 * their real time; the rest are timed by how far they still have to go.
 */
export function rankField(
  player: { id: string; name: string; ms: number },
  rivals: ReadonlyArray<Pick<RivalState, "id" | "name" | "dist" | "speedKmh" | "finishedAt">>,
  totalDistance: number,
  goMs: number,
): FieldResult[] {
  const rows = [
    player,
    ...rivals.map((c) => ({
      id: c.id,
      name: c.name,
      ms: c.finishedAt !== null ? c.finishedAt - goMs : player.ms + ((totalDistance - c.dist) / Math.max(c.speedKmh / 3.6, 25)) * 1000,
    })),
  ].sort((a, b) => a.ms - b.ms);
  return rows.map((row, i) => ({ id: row.id, name: row.name, totalMs: Math.round(row.ms), place: i + 1, points: FIELD_POINTS[i] ?? 0 }));
}
