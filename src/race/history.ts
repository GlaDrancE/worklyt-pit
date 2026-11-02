import { cleanName } from "../net/protocol";
import { LAYOUT_EPOCH } from "../track/tracks";
import type { LapResult } from "./RaceManager";

/** One race (or abandoned race) saved on this device. */
export interface RaceRecord {
  id: string;
  driverId: string;
  driver: string;
  trackId: string;
  trackName: string;
  /** ISO timestamp of when the session started. */
  startedAt: string;
  /** False when the player left before finishing all laps. */
  completed: boolean;
  totalLaps: number;
  laps: LapResult[];
  totalMs: number;
  /** Best valid lap in this race, if any. */
  bestMs: number | null;
  collisions: number;
  topSpeedKmh: number;
  /** Championship-style points earned in this race. */
  points?: number;
  /** Finishing position against computer-driven rivals, and how many cars started. */
  position?: number;
  fieldSize?: number;
  /** Present for 1v1 online races. */
  versus?: { opponentId: string; opponentName: string; place: number | null; forfeit?: boolean };
}

export interface DriverProfile {
  id: string;
  name: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PROFILE_KEY = "trackrush.profile";
const HISTORY_KEY = "trackrush.history";
export const MAX_RECORDS = 100;

const ADJECTIVES = ["Swift", "Rapid", "Silent", "Blazing", "Iron", "Neon", "Turbo", "Crimson", "Lunar", "Storm", "Vivid", "Apex"];
const NOUNS = ["Falcon", "Viper", "Comet", "Panther", "Raven", "Cobra", "Phoenix", "Jaguar", "Orca", "Lynx", "Mustang", "Hornet"];

function browserStorage(): StorageLike | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** A readable, specific driver name such as "Swift Falcon 42". */
export function generateDriverName(rand: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)]!;
  const n = NOUNS[Math.floor(rand() * NOUNS.length)]!;
  const num = 10 + Math.floor(rand() * 90);
  return `${a} ${n} ${num}`;
}

export function newId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

export { cleanName };

/** Loads the saved driver, or creates one with a generated name on first visit. */
export function loadProfile(store: StorageLike | null = browserStorage(), rand: () => number = Math.random): DriverProfile {
  try {
    const raw = store?.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<DriverProfile>;
      if (typeof p.id === "string" && typeof p.name === "string" && cleanName(p.name)) {
        return { id: p.id, name: cleanName(p.name) };
      }
    }
  } catch {
    /* fall through and create a new profile */
  }
  const profile = { id: newId(rand), name: generateDriverName(rand) };
  saveProfile(profile, store);
  return profile;
}

export function saveProfile(p: DriverProfile, store: StorageLike | null = browserStorage()): void {
  try {
    store?.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function isLap(v: unknown): v is LapResult {
  const l = v as LapResult;
  return !!l && typeof l.lap === "number" && typeof l.ms === "number" && typeof l.valid === "boolean" && Array.isArray(l.sectors);
}

function isRecord(v: unknown): v is RaceRecord {
  const r = v as RaceRecord;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.driverId === "string" &&
    typeof r.driver === "string" &&
    typeof r.trackId === "string" &&
    typeof r.startedAt === "string" &&
    typeof r.totalMs === "number" &&
    Array.isArray(r.laps) &&
    r.laps.every(isLap)
  );
}

/** Newest first. Anything unreadable is dropped rather than crashing the menu. */
export function loadHistory(store: StorageLike | null = browserStorage()): RaceRecord[] {
  try {
    const raw = store?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isRecord);
  } catch {
    return [];
  }
}

/** Called after the saved history changes, so the game can back it up to the relay. */
export const historyEvents: { onChange: (() => void) | null } = { onChange: null };

export function addRecord(rec: RaceRecord, store: StorageLike | null = browserStorage()): void {
  const list = [rec, ...loadHistory(store)].slice(0, MAX_RECORDS);
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the race just isn't saved */
  }
  historyEvents.onChange?.();
}

/** Replace the whole saved history (used when races from the relay are merged in). */
export function replaceHistory(list: RaceRecord[], store: StorageLike | null = browserStorage()): void {
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    /* ignore */
  }
}

/** Update a saved race (used when a 1v1 result arrives after the race was stored). */
export function updateRecord(id: string, patch: Partial<RaceRecord>, store: StorageLike | null = browserStorage()): void {
  const list = loadHistory(store);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return;
  list[i] = { ...list[i]!, ...patch, id };
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  historyEvents.onChange?.();
}

export function clearHistory(store: StorageLike | null = browserStorage()): void {
  try {
    store?.setItem(HISTORY_KEY, "[]");
  } catch {
    /* ignore */
  }
}

export interface Summary {
  races: number;
  completed: number;
  laps: number;
  validLaps: number;
  collisions: number;
  topSpeedKmh: number;
  points: number;
  wins: number;
}

export function summarize(records: readonly RaceRecord[]): Summary {
  const s: Summary = { races: records.length, completed: 0, laps: 0, validLaps: 0, collisions: 0, topSpeedKmh: 0, points: 0, wins: 0 };
  for (const r of records) {
    if (r.completed) s.completed++;
    s.laps += r.laps.length;
    s.validLaps += r.laps.filter((l) => l.valid).length;
    s.collisions += r.collisions;
    s.topSpeedKmh = Math.max(s.topSpeedKmh, r.topSpeedKmh);
    s.points += r.points ?? 0;
    if (r.versus?.place === 1) s.wins++;
  }
  return s;
}

export interface BoardEntry {
  driverId: string;
  driver: string;
  bestMs: number;
  recordId: string;
}

/** Best valid lap per driver on a track, fastest first. */
export function leaderboard(records: readonly RaceRecord[], trackId: string, limit = 5): BoardEntry[] {
  const best = new Map<string, BoardEntry>();
  for (const r of records) {
    if (r.trackId !== trackId || r.startedAt < LAYOUT_EPOCH) continue;
    for (const l of r.laps) {
      if (!l.valid) continue;
      const cur = best.get(r.driverId);
      if (!cur || l.ms < cur.bestMs) best.set(r.driverId, { driverId: r.driverId, driver: r.driver, bestMs: l.ms, recordId: r.id });
    }
  }
  return [...best.values()].sort((a, b) => a.bestMs - b.bestMs).slice(0, limit);
}

export function buildRecord(input: {
  driver: DriverProfile;
  trackId: string;
  trackName: string;
  startedAt: string;
  completed: boolean;
  totalLaps: number;
  laps: readonly LapResult[];
  collisions: number;
  topSpeedKmh: number;
  points?: number;
  position?: number;
  fieldSize?: number;
  versus?: RaceRecord["versus"];
}): RaceRecord {
  const valid = input.laps.filter((l) => l.valid).map((l) => l.ms);
  return {
    id: newId(),
    driverId: input.driver.id,
    driver: input.driver.name,
    trackId: input.trackId,
    trackName: input.trackName,
    startedAt: input.startedAt,
    completed: input.completed,
    totalLaps: input.totalLaps,
    laps: input.laps.map((l) => ({ ...l, sectors: [...l.sectors] as LapResult["sectors"] })),
    totalMs: input.laps.reduce((a, l) => a + l.ms, 0),
    bestMs: valid.length ? Math.min(...valid) : null,
    collisions: input.collisions,
    topSpeedKmh: Math.round(input.topSpeedKmh),
    ...(input.points !== undefined ? { points: input.points } : {}),
    ...(input.position !== undefined ? { position: input.position, fieldSize: input.fieldSize ?? 0 } : {}),
    ...(input.versus ? { versus: input.versus } : {}),
  };
}

/** Union of two histories by race id (the local copy wins), newest first, trimmed to the limit. */
export function mergeHistories(local: readonly RaceRecord[], remote: readonly unknown[], max = MAX_RECORDS): RaceRecord[] {
  const byId = new Map<string, RaceRecord>();
  for (const r of remote) if (isRecord(r)) byId.set(r.id, r);
  for (const r of local) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)).slice(0, max);
}
