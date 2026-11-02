/** Time of day and weather: what the player can pick, what they mean for the look and for grip. */
export type TimeOfDay = "day" | "dusk" | "night";
export type Weather = "clear" | "rain";

export interface Conditions {
  time: TimeOfDay;
  weather: Weather;
}

export const DEFAULT_CONDITIONS: Conditions = { time: "day", weather: "clear" };

const TIMES: readonly string[] = ["day", "dusk", "night"];
const WEATHERS: readonly string[] = ["clear", "rain"];

/**
 * Turn the two menu selections into real conditions. "track" means whatever the circuit
 * suggests (e.g. the night circuit is wet by default); anything else is taken literally.
 */
export function resolveConditions(timeSel: string, weatherSel: string, trackDefault?: Conditions): Conditions {
  const base = trackDefault ?? DEFAULT_CONDITIONS;
  return {
    time: TIMES.includes(timeSel) ? (timeSel as TimeOfDay) : base.time,
    weather: WEATHERS.includes(weatherSel) ? (weatherSel as Weather) : base.weather,
  };
}

/** Suffix for personal-best and ghost storage so wet-night laps never overwrite dry-day ones. */
export function conditionsKey(c: Conditions): string {
  return c.time === "day" && c.weather === "clear" ? "" : `@${c.time}-${c.weather}`;
}

export function describeConditions(c: Conditions): string {
  const t = c.time === "day" ? "Day" : c.time === "dusk" ? "Dusk" : "Night";
  return `${t}, ${c.weather === "rain" ? "rain" : "dry"}`;
}

/** Tyre grip on tarmac in these conditions (1 = dry). */
export function roadGrip(c: Conditions): number {
  return c.weather === "rain" ? 0.78 : 1;
}

export interface Look {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  envIntensity: number;
  /** Multiplies the ground (grass / pavement) colour. */
  groundTint: number;
  /** 0..1: how bright street lamps glow. */
  lamps: number;
  /** Headlight strength. */
  headlight: number;
}

export const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    skyTop: "#2f6fb5", skyMid: "#8fc3ea", skyHorizon: "#dcebf5",
    fog: 0xcfe3f1, fogNear: 180, fogFar: 900,
    hemiSky: 0xcfe6ff, hemiGround: 0x4a5d3a, hemiIntensity: 0.85,
    sunColor: 0xfff1d6, sunIntensity: 2.1, envIntensity: 0.3,
    groundTint: 0xffffff, lamps: 0.05, headlight: 0,
  },
  dusk: {
    skyTop: "#2a2f66", skyMid: "#c4627a", skyHorizon: "#ffb56b",
    fog: 0xd89a7c, fogNear: 120, fogFar: 700,
    hemiSky: 0xb8a4c8, hemiGround: 0x3a3a46, hemiIntensity: 0.55,
    sunColor: 0xff9a5a, sunIntensity: 1.1, envIntensity: 0.2,
    groundTint: 0xbfb2b8, lamps: 0.7, headlight: 25,
  },
  night: {
    skyTop: "#04060f", skyMid: "#0a1230", skyHorizon: "#1b2547",
    fog: 0x0a0f22, fogNear: 60, fogFar: 520,
    hemiSky: 0x5a6ea8, hemiGround: 0x15181f, hemiIntensity: 0.5,
    sunColor: 0x8fa6ff, sunIntensity: 0.55, envIntensity: 0.12,
    groundTint: 0x5f6678, lamps: 1, headlight: 90,
  },
};

/** Rain pulls the horizon in and greys the light. */
export function lookFor(c: Conditions): Look {
  const base = LOOKS[c.time];
  if (c.weather !== "rain") return base;
  return {
    ...base,
    fogNear: base.fogNear * 0.35,
    fogFar: base.fogFar * 0.55,
    hemiIntensity: base.hemiIntensity * 0.9,
    sunIntensity: base.sunIntensity * 0.45,
    envIntensity: base.envIntensity * 0.8,
  };
}
