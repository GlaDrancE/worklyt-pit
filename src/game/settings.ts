import type { SteerFeel } from "../vehicle/steeringConfig";
import { loadSetting, saveSetting } from "../race/storage";

export type AssistLevel = "off" | "low" | "high";
import type { DamageMode } from "../vehicle/damage";
import { DEFAULT_CONTROLS, sanitizeControls, type ControlPrefs, type LayoutPref } from "../ui/orientation";

export type CompoundId = "soft" | "medium" | "hard";

/** Everything the player can change in the Settings panel. Stored on this device only. */
export interface Settings {
  /** Multiplies how quickly keyboard/touch steering builds (0.5 gentle .. 1.6 sharp). */
  steerSpeed: number;
  /** Counter-steer / stability help in Race handling. Drift handling always has its own. */
  assist: AssistLevel;
  /** How the car steers at high speed: calm (planted), standard, or sharp (more turn-in, less stability). Online races always use standard. */
  steerFeel: SteerFeel;
  /** Steering sensitivity: how much of the lock a full press or drag uses (0.6 gentle .. 1.6 sharp). */
  steerSens: number;
  /** Master volume 0..1. */
  volume: number;
  /** Gamepad stick dead zone 0.04..0.3. */
  deadzone: number;
  /** Gamepad stick response: 1 = linear, higher = softer around the centre. */
  stickCurve: number;
  /** Controller rumble on collisions and rumble strips. */
  vibration: boolean;
  /** Street lamps glow and light the road at dusk and night. Off makes night races darker and harder. */
  streetLights: boolean;
  tyreWear: boolean;
  /** Crash damage: off, looks only, or it hurts performance and needs pit repairs. */
  damage: DamageMode;
  compound: CompoundId;
  /** "track" = what the circuit suggests, otherwise a fixed choice. */
  time: string;
  weather: string;
  /** Screen layout: follow the device, or stay in portrait / landscape. */
  layout: LayoutPref;
  /** Touch steering: two buttons or a drag wheel. */
  ctrlStyle: "buttons" | "wheel";
  /** Size, opacity and height of the touch controls, kept separately for each layout. */
  controls: { portrait: ControlPrefs; landscape: ControlPrefs };
  /** Pedals on the left and steering on the right. */
  swapSides: boolean;
  /** Steer by tilting the phone. */
  tilt: boolean;
  tiltSens: number;
  tiltInvert: boolean;
  /** Beginner help: the gas is held down for you, steering is gentler and stability control is on. */
  easyDrive: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  steerSpeed: 1,
  steerFeel: "standard",
  steerSens: 1,
  assist: "off",
  volume: 0.6,
  deadzone: 0.12,
  stickCurve: 1.4,
  vibration: true,
  streetLights: true,
  tyreWear: false,
  damage: "realistic",
  compound: "medium",
  time: "track",
  weather: "track",
  layout: "auto",
  ctrlStyle: "buttons",
  controls: { portrait: { ...DEFAULT_CONTROLS.portrait }, landscape: { ...DEFAULT_CONTROLS.landscape } },
  swapSides: false,
  tilt: false,
  tiltSens: 1,
  tiltInvert: false,
  easyDrive: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (raw: unknown, fallback: number) => (typeof raw === "number" && Number.isFinite(raw) ? raw : fallback);

/** Turn anything (including junk from storage) into valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    steerSpeed: clamp(num(r.steerSpeed, d.steerSpeed), 0.5, 1.6),
    steerFeel: r.steerFeel === "calm" || r.steerFeel === "sharp" || r.steerFeel === "standard" ? r.steerFeel : d.steerFeel,
    steerSens: clamp(num(r.steerSens, d.steerSens), 0.6, 1.6),
    assist: r.assist === "low" || r.assist === "high" || r.assist === "off" ? r.assist : d.assist,
    volume: clamp(num(r.volume, d.volume), 0, 1),
    deadzone: clamp(num(r.deadzone, d.deadzone), 0.04, 0.3),
    stickCurve: clamp(num(r.stickCurve, d.stickCurve), 1, 2.5),
    vibration: typeof r.vibration === "boolean" ? r.vibration : d.vibration,
    damage: r.damage === "off" || r.damage === "visual" || r.damage === "realistic" ? r.damage : d.damage,
    streetLights: typeof r.streetLights === "boolean" ? r.streetLights : d.streetLights,
    tyreWear: typeof r.tyreWear === "boolean" ? r.tyreWear : d.tyreWear,
    compound: r.compound === "soft" || r.compound === "hard" || r.compound === "medium" ? r.compound : d.compound,
    time: typeof r.time === "string" ? r.time : d.time,
    weather: typeof r.weather === "string" ? r.weather : d.weather,
    layout: r.layout === "portrait" || r.layout === "landscape" || r.layout === "auto" ? r.layout : d.layout,
    ctrlStyle: r.ctrlStyle === "wheel" || r.ctrlStyle === "buttons" ? r.ctrlStyle : d.ctrlStyle,
    controls: {
      portrait: sanitizeControls((r.controls as Record<string, unknown> | undefined)?.portrait, DEFAULT_CONTROLS.portrait),
      landscape: sanitizeControls((r.controls as Record<string, unknown> | undefined)?.landscape, DEFAULT_CONTROLS.landscape),
    },
    swapSides: typeof r.swapSides === "boolean" ? r.swapSides : d.swapSides,
    tilt: typeof r.tilt === "boolean" ? r.tilt : d.tilt,
    tiltSens: clamp(num(r.tiltSens, d.tiltSens), 0.4, 2.5),
    tiltInvert: typeof r.tiltInvert === "boolean" ? r.tiltInvert : d.tiltInvert,
    easyDrive: typeof r.easyDrive === "boolean" ? r.easyDrive : d.easyDrive,
  };
}

export function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(loadSetting("settings", "{}")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  saveSetting("settings", JSON.stringify(s));
}

/** Stick value after dead zone and response curve, so small movements stay small. */
export function shapeStick(v: number, deadzone: number, curve: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const scaled = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * Math.pow(scaled, curve);
}
