/** Screen layout choice: follow the device, or force one orientation. */
export type LayoutPref = "auto" | "portrait" | "landscape";
export type Layout = "portrait" | "landscape";

export function deviceLayout(w: number, h: number): Layout {
  return w > h ? "landscape" : "portrait";
}

export interface ResolvedLayout {
  layout: Layout;
  /** The game has to be turned 90 degrees on screen because the device is held the other way. */
  rotate: boolean;
}

/**
 * Which layout to show. "auto" follows the device. A forced layout that differs from the device
 * can only be shown by turning the game 90 degrees, which is done on touch devices only
 * (browsers rarely allow a real orientation lock outside full screen).
 */
export function resolveLayout(pref: LayoutPref, w: number, h: number, canRotate: boolean): ResolvedLayout {
  const device = deviceLayout(w, h);
  if (pref === "auto") return { layout: device, rotate: false };
  return { layout: pref, rotate: canRotate && pref !== device };
}

/** Size of the game stage in CSS pixels for a window of w x h. */
export function stageSize(w: number, h: number, rotate: boolean): { w: number; h: number } {
  return rotate ? { w: h, h: w } : { w, h };
}

/** Per-layout control settings. */
export interface ControlPrefs {
  /** Button size multiplier. */
  scale: number;
  opacity: number;
  /** Extra distance from the bottom edge, in pixels. */
  raise: number;
}

export const DEFAULT_CONTROLS: Record<Layout, ControlPrefs> = {
  portrait: { scale: 1.1, opacity: 0.85, raise: 0 },
  landscape: { scale: 1, opacity: 0.85, raise: 0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sanitizeControls(raw: unknown, fallback: ControlPrefs): ControlPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    scale: clamp(num(r.scale, fallback.scale), 0.7, 1.5),
    opacity: clamp(num(r.opacity, fallback.opacity), 0.3, 1),
    raise: clamp(num(r.raise, fallback.raise), 0, 140),
  };
}

const GEAR_TOPS = [70, 115, 155, 195, 235, 275, 310, 345];

/** A gear and engine speed for the HUD, worked out from road speed (the game has no gearbox). */
export function gearFor(kmh: number): { gear: number; rpm: number } {
  if (kmh < 3) return { gear: 0, rpm: 0.12 };
  let gear = GEAR_TOPS.findIndex((top) => kmh < top);
  if (gear < 0) gear = GEAR_TOPS.length - 1;
  const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1]!;
  const hi = GEAR_TOPS[gear]!;
  const t = clamp((kmh - lo) / (hi - lo), 0, 1);
  const rpm = gear === 0 ? 0.2 + 0.8 * t : 0.45 + 0.55 * t;
  return { gear: gear + 1, rpm: clamp(rpm, 0, 1) };
}

/**
 * Steering from tilting the phone like a wheel. (nx, ny) is the gravity reading in the screen plane
 * when the player pressed "calibrate", (vx, vy) the current reading. The signed angle between the two
 * does not depend on the phone's screen orientation or on the sign convention of the platform.
 * Clockwise (as seen by the player) is positive, steering right.
 */
export function tiltToSteer(nx: number, ny: number, vx: number, vy: number, sensitivity: number, invert: boolean): number {
  if (Math.hypot(vx, vy) < 1.5 || Math.hypot(nx, ny) < 1.5) return 0; // lying flat: no tilt to read
  let deg = (Math.atan2(nx * vy - ny * vx, nx * vx + ny * vy) * 180) / Math.PI;
  if (invert) deg = -deg;
  const dead = 3;
  const lock = 30 / clamp(sensitivity, 0.4, 2.5);
  if (Math.abs(deg) <= dead) return 0;
  return clamp(Math.sign(deg) * ((Math.abs(deg) - dead) / (lock - dead)), -1, 1);
}
