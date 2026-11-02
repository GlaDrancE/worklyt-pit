import type { Conditions } from "../game/conditions";
import { loadSetting, saveSetting } from "./storage";

/** What happened in a race (or so far in one). Checks only ever read this. */
export interface RaceStats {
  trackId: string;
  completed: boolean;
  versus: boolean;
  collisions: number;
  topSpeedKmh: number;
  driftTotal: number;
  driftBest: number;
  pitStops: number;
  tyreWearOn: boolean;
  finalTyreWear: number;
  validLaps: number;
  /** 1 = winner. Null when there were no rivals. */
  position: number | null;
  fieldSize: number;
  conditions: Conditions;
  /** Races finished before this one (for the long-term badges). */
  racesBefore: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  check(s: RaceStats): boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first-finish", name: "Chequered flag", description: "Finish a race.", check: (s) => s.completed },
  { id: "clean-race", name: "Clean sheet", description: "Finish a race without touching anything.", check: (s) => s.completed && s.collisions === 0 },
  { id: "speed-300", name: "Three hundred", description: "Reach 300 km/h.", check: (s) => s.topSpeedKmh >= 300 },
  { id: "drifter", name: "Tail out", description: "Bank a 500-point drift.", check: (s) => s.driftBest >= 500 },
  { id: "drift-king", name: "Drift king", description: "Bank a 2000-point drift.", check: (s) => s.driftBest >= 2000 },
  { id: "night-owl", name: "Night owl", description: "Finish a race at night.", check: (s) => s.completed && s.conditions.time === "night" },
  { id: "rain-master", name: "Rain master", description: "Finish a race in the rain.", check: (s) => s.completed && s.conditions.weather === "rain" },
  { id: "box-box", name: "Box, box", description: "Complete a pit stop and finish the race.", check: (s) => s.completed && s.pitStops >= 1 },
  {
    id: "tyre-whisperer",
    name: "Tyre whisperer",
    description: "Finish a tyre-wear race without pitting and with tyres still above 40%.",
    check: (s) => s.completed && s.tyreWearOn && s.pitStops === 0 && s.finalTyreWear < 0.6,
  },
  { id: "podium", name: "On the podium", description: "Finish in the top three against rivals.", check: (s) => s.completed && s.position !== null && s.fieldSize >= 4 && s.position <= 3 },
  { id: "winner", name: "Winner", description: "Win a race against rivals.", check: (s) => s.completed && s.position === 1 && s.fieldSize >= 2 && !s.versus },
  { id: "city-slicker", name: "City slicker", description: "Finish Neon Street without a single collision.", check: (s) => s.completed && s.trackId === "neon-street" && s.collisions === 0 },
  { id: "veteran", name: "Veteran", description: "Finish 10 races.", check: (s) => s.completed && s.racesBefore + 1 >= 10 },
];

/** Achievements this race earns that weren't already unlocked. */
export function evaluate(stats: RaceStats, unlocked: ReadonlySet<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.check(stats));
}

const KEY = "achievements";

export function loadUnlocked(): Record<string, string> {
  try {
    const raw = JSON.parse(loadSetting(KEY, "{}")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string> = {};
    for (const a of ACHIEVEMENTS) {
      const v = (raw as Record<string, unknown>)[a.id];
      if (typeof v === "string") out[a.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveUnlocked(map: Record<string, string>): void {
  saveSetting(KEY, JSON.stringify(map));
}
