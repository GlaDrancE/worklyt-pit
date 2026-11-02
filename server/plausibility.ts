import { speedProfile } from "../src/race/Rivals";
import { TrackModel } from "../src/track/TrackModel";
import { TRACKS, type TrackDef } from "../src/track/tracks";

/** No car averages more than this around a lap (m/s); top speed is about 92. */
const MAX_AVERAGE_MS = 100;
/** The corner-speed profile is generous (extra grip, no acceleration time); a real lap cannot beat this share of it. */
const GRIP_ALLOWANCE = 1.25;
const SAFETY = 0.75;

const floors = new Map<string, number>();

function defFor(key: string): TrackDef | null {
  const id = key.split("|")[0] ?? "";
  return TRACKS.find((t) => t.id === id) ?? null;
}

function floorOf(def: TrackDef): number {
  let n = floors.get(def.id);
  if (n === undefined) {
    const model = new TrackModel(def);
    const ds = model.length / model.count;
    let ideal = 0;
    for (const v of speedProfile(model, GRIP_ALLOWANCE)) ideal += ds / Math.max(v, 1);
    n = Math.floor(Math.max(ideal * SAFETY, model.length / MAX_AVERAGE_MS) * 1000);
    floors.set(def.id, n);
  }
  return n;
}

/** The fastest lap (ms) that is possible on this circuit, or null if the circuit is unknown. */
export function minLapMs(key: string): number | null {
  const def = defFor(key);
  return def ? floorOf(def) : null;
}

/** A reported lap time must be for a known circuit and not faster than physics allows. */
export function lapPlausible(key: string, ms: number): boolean {
  const min = minLapMs(key);
  return min !== null && ms >= min;
}

/** A reported race time must cover all the laps of that circuit at a possible pace. */
export function raceTimePlausible(key: string, totalMs: number): boolean {
  const def = defFor(key);
  const min = minLapMs(key);
  return !!def && min !== null && totalMs >= min * def.laps;
}
