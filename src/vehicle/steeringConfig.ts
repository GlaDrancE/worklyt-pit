/**
 * One place for every steering number, plus the small pure functions that use them. The input code, the
 * physics and the wheel animation all read from here, so they always agree and tuning never means
 * rewriting logic. Angles in this file are in degrees unless the name says "Rad".
 */
export interface SteeringConfig {
  /** Real lock of the front wheels at low speed (degrees). At speed it is cut down further, see lockAt(). */
  maxAngleDeg: number;
  /** How fast a held key or button builds steering, in full locks per second. */
  steerSpeed: number;
  /** How fast steering returns to centre after release, in full locks per second. */
  returnSpeed: number;
  /** Extra fraction of lock taken away at top speed (0 = none). */
  highSpeedReduction: number;
  /** The grip-matched lock is never smaller than this fraction of full lock, so the car still answers the wheel at speed. */
  minLockFraction: number;
  /** Rear grip gained at top speed (fraction), like aero balance: keeps the tail planted so the car doesn't swing out. */
  rearStability: number;
  /** >1 gives finer control near the centre (input is raised to this power). */
  linearity: number;
  /** Speed of the steering rack, rad/s at low speed. Stops full lock appearing in a single frame. */
  rackRate: number;
  /** Smoothing of the rack (1/s), applied before the rate limit. */
  rackResponse: number;
  /** Gentle yaw damping when the player is not steering (1/s). The car settles instead of keeping a turn going. */
  yawDamping: number;
  /** Fraction of front grip lost at full lock and top speed: mild understeer. */
  understeer: number;
  /** Wheel angle shown on the model at full lock (degrees). Larger than real so it reads on screen. */
  visualMaxDeg: number;
  /** Fraction of the shown angle that remains at top speed. */
  visualHighSpeedFraction: number;
  /** Speeds (m/s) between which the speed effects fade in. */
  speedLow: number;
  speedHigh: number;
}

export const STEERING: SteeringConfig = {
  maxAngleDeg: 24,
  steerSpeed: 1.5,
  returnSpeed: 4,
  highSpeedReduction: 0.2,
  minLockFraction: 0.11,
  rearStability: 0.12,
  linearity: 1.35,
  rackRate: 1.7,
  rackResponse: 9,
  yawDamping: 0.5,
  understeer: 0.08,
  visualMaxDeg: 28,
  visualHighSpeedFraction: 0.4,
  speedLow: 8,
  speedHigh: 80,
};

export type SteerFeel = "calm" | "standard" | "sharp";

/** The three high-speed steering feels. Only the numbers that matter at speed change; low-speed steering stays the same. */
export const STEER_FEELS: Record<SteerFeel, Pick<SteeringConfig, "minLockFraction" | "rearStability" | "highSpeedReduction">> = {
  calm: { minLockFraction: 0.08, rearStability: 0.2, highSpeedReduction: 0.3 },
  standard: { minLockFraction: 0.11, rearStability: 0.12, highSpeedReduction: 0.2 },
  sharp: { minLockFraction: 0.15, rearStability: 0.08, highSpeedReduction: 0.12 },
};

/** Switch the live steering numbers to one of the feels. Called when a race starts. */
export function applySteerFeel(feel: SteerFeel, cfg: SteeringConfig = STEERING): void {
  Object.assign(cfg, STEER_FEELS[feel]);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;

/** 0 at parking speeds, 1 near top speed, smooth in between. */
export function speedFactor(speedMs: number, cfg: SteeringConfig = STEERING): number {
  const t = clamp((Math.abs(speedMs) - cfg.speedLow) / (cfg.speedHigh - cfg.speedLow), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Largest front-wheel angle (rad) that makes sense at this speed. */
export function lockAt(speedMs: number, wheelBase: number, lateralAccel: number, cfg: SteeringConfig = STEERING): number {
  const byGrip = (wheelBase * lateralAccel) / Math.max(speedMs * speedMs, 1);
  const max = cfg.maxAngleDeg * RAD;
  return Math.min(max, Math.max(byGrip, max * cfg.minLockFraction)) * (1 - cfg.highSpeedReduction * speedFactor(speedMs, cfg));
}

/** Player input (-1..1) after sensitivity and the centre-softening curve. Sign is kept. */
export function shapeSteer(x: number, sensitivity = 1, cfg: SteeringConfig = STEERING): number {
  const a = Math.min(1, Math.abs(x));
  return Math.sign(x) * clamp(Math.pow(a, cfg.linearity) * sensitivity, 0, 1);
}

/**
 * Moves a held-key / held-button steering value towards its target. Builds gently, returns to centre quickly,
 * reverses faster than it builds, and builds a little slower at speed so the car stays settled.
 * `rateScale` is the player's steering-speed setting.
 */
export function rampSteer(current: number, target: number, dt: number, speedMs = 0, rateScale = 1, cfg: SteeringConfig = STEERING): number {
  const sf = speedFactor(speedMs, cfg);
  let rate: number;
  if (target === 0) rate = cfg.returnSpeed * (1 - 0.2 * sf);
  else if (current !== 0 && Math.sign(current) !== Math.sign(target)) rate = cfg.returnSpeed * 1.5;
  else rate = cfg.steerSpeed * rateScale * (1 - 0.25 * sf);
  const step = rate * dt;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

/** The steering rack: smooths towards the target, but never faster than the rate limit. */
export function stepRack(current: number, target: number, dt: number, speedMs: number, cfg: SteeringConfig = STEERING): number {
  // Close enough to a centred target: settle exactly, so the wheels never hang a fraction of a degree off.
  if (target === 0 && Math.abs(current) < 0.012) return 0;
  const smooth = (target - current) * Math.min(1, dt * cfg.rackResponse);
  const limit = cfg.rackRate * (1.25 - 0.55 * speedFactor(speedMs, cfg)) * dt;
  return current + clamp(smooth, -limit, limit);
}

/**
 * Angle drawn on the front wheels (rad, same sign convention as the physics wheel steering).
 * It is the fraction of the available lock actually in use, so it always follows the real steering.
 */
export function visualWheelAngle(steerState: number, lock: number, speedMs: number, cfg: SteeringConfig = STEERING): number {
  const ratio = clamp(steerState / Math.max(lock, 1e-3), -1, 1);
  const frac = 1 - (1 - cfg.visualHighSpeedFraction) * speedFactor(speedMs, cfg);
  return -ratio * cfg.visualMaxDeg * RAD * frac;
}
