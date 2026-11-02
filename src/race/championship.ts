/** F1-style points for the first six places. */
export const POINTS_TABLE = [25, 18, 15, 12, 10, 8] as const;

export function pointsForPlace(place: number): number {
  return POINTS_TABLE[place - 1] ?? 0;
}

export interface SeasonRow {
  id: string;
  name: string;
  points: number;
  wins: number;
}

export interface Season {
  id: string;
  /** Circuit ids in racing order. */
  rounds: string[];
  /** Rounds finished so far. */
  round: number;
  /** Rival names, kept for the whole season so the table makes sense. */
  names: string[];
  table: Record<string, SeasonRow>;
}

export interface Placed {
  id: string;
  name: string;
  place: number;
}

export function newSeason(id: string, rounds: string[], names: string[]): Season {
  return { id, rounds: [...rounds], round: 0, names: [...names], table: {} };
}

export function isFinished(s: Season): boolean {
  return s.round >= s.rounds.length;
}

export function currentTrack(s: Season): string | null {
  return s.rounds[s.round] ?? null;
}

/** Add one race's finishing order. Returns a new season; a finished season is returned as it is. */
export function recordRound(s: Season, finishers: readonly Placed[]): Season {
  if (isFinished(s)) return s;
  const table: Record<string, SeasonRow> = {};
  for (const [k, v] of Object.entries(s.table)) table[k] = { ...v };
  for (const f of finishers) {
    const row = table[f.id] ?? { id: f.id, name: f.name, points: 0, wins: 0 };
    row.name = f.name;
    row.points += pointsForPlace(f.place);
    if (f.place === 1) row.wins += 1;
    table[f.id] = row;
  }
  return { ...s, round: s.round + 1, table };
}

/** Standings: points, then wins, then name. */
export function standings(s: Season): SeasonRow[] {
  return Object.values(s.table).sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

export function sanitizeSeason(raw: unknown, validTracks: readonly string[]): Season | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !Array.isArray(r.rounds) || !Array.isArray(r.names)) return null;
  const rounds = r.rounds.filter((x): x is string => typeof x === "string" && validTracks.includes(x));
  if (rounds.length === 0 || rounds.length !== r.rounds.length) return null;
  const round = typeof r.round === "number" && Number.isInteger(r.round) ? Math.min(Math.max(r.round, 0), rounds.length) : 0;
  const names = r.names.filter((x): x is string => typeof x === "string").slice(0, 8);
  const table: Record<string, SeasonRow> = {};
  if (r.table && typeof r.table === "object") {
    for (const [k, v] of Object.entries(r.table as Record<string, unknown>)) {
      const row = v as Record<string, unknown> | null;
      if (!row || typeof row.name !== "string" || typeof row.points !== "number" || typeof row.wins !== "number") continue;
      table[k] = { id: k, name: row.name.slice(0, 24), points: row.points, wins: row.wins };
    }
  }
  return { id: r.id, rounds, round, names, table };
}
