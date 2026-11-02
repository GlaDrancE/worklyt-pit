/**
 * Simple 8-speed gearbox model used only to drive the engine sound and the
 * gear read-out. Real F1 cars run an 8-speed seamless-shift box up to about
 * 12,000 rpm; the speeds below are the road speed at the rev limit in each gear.
 */
export const GEAR_TOP_KMH = [85, 118, 152, 187, 222, 258, 296, 345] as const;
export const IDLE_RPM = 4200;
export const REDLINE_RPM = 12000;
const UPSHIFT_FRACTION = 11500 / 12000;
const DOWNSHIFT_FRACTION = 6800 / 12000;

/** Rev range of the engine driving the gearbox. Defaults to the V6 hybrid. */
export interface RevRange {
  idleRpm: number;
  redlineRpm: number;
}
const DEFAULT_RANGE: RevRange = { idleRpm: IDLE_RPM, redlineRpm: REDLINE_RPM };

export interface DrivetrainState {
  gear: number; // 1..8
  rpm: number;
  /** Seconds left in a shift (throttle is cut briefly). */
  shiftTimer: number;
}

export function newDrivetrain(): DrivetrainState {
  return { gear: 1, rpm: IDLE_RPM, shiftTimer: 0 };
}

/** rpm the engine would turn at this road speed in a gear. */
export function rpmInGear(speedKmh: number, gear: number, redline = REDLINE_RPM): number {
  const top = GEAR_TOP_KMH[gear - 1] ?? GEAR_TOP_KMH[GEAR_TOP_KMH.length - 1]!;
  return (speedKmh / top) * redline;
}

/** Advance the gearbox and engine speed by dt seconds. Returns true if a shift happened. */
export function stepDrivetrain(s: DrivetrainState, speedKmh: number, throttle: number, dt: number, range: RevRange = DEFAULT_RANGE): boolean {
  const { idleRpm, redlineRpm } = range;
  let shifted = false;
  s.shiftTimer = Math.max(0, s.shiftTimer - dt);

  const wheelRpm = rpmInGear(speedKmh, s.gear, redlineRpm);
  if (wheelRpm > redlineRpm * UPSHIFT_FRACTION && s.gear < GEAR_TOP_KMH.length && s.shiftTimer === 0) {
    s.gear++;
    s.shiftTimer = 0.08;
    shifted = true;
  } else if (wheelRpm < redlineRpm * DOWNSHIFT_FRACTION && s.gear > 1 && s.shiftTimer === 0) {
    s.gear--;
    s.shiftTimer = 0.06;
    shifted = true;
  }

  // Below the clutch-bite speed the engine free-revs with the throttle.
  const clutch = Math.max(idleRpm, rpmInGear(speedKmh, s.gear, redlineRpm));
  const launch = throttle > 0.05 && s.gear === 1 ? idleRpm + throttle * (redlineRpm * 0.43) : idleRpm;
  const target = Math.min(redlineRpm, Math.max(clutch, speedKmh < 60 ? launch : 0));

  const rate = target > s.rpm ? 9 : 5;
  s.rpm += (target - s.rpm) * Math.min(1, dt * rate);
  s.rpm = Math.min(redlineRpm, Math.max(idleRpm * 0.9, s.rpm));
  return shifted;
}
