import type { Difficulty } from "./Rivals";

/** A race everyone gets on the same day: the circuit, light, weather and field all come from the date. */
export interface DailyChallenge {
  key: string;
  trackId: string;
  time: "day" | "dusk" | "night";
  weather: "clear" | "rain";
  rivals: 3 | 5;
  difficulty: Difficulty;
}

export interface DailyResult {
  key: string;
  place: number;
  fieldSize: number;
  totalMs: number;
  bestLapMs: number | null;
}

/** Local calendar day as YYYY-MM-DD. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same date in, same challenge out, on every device. */
export function dailyChallenge(key: string, trackIds: readonly string[], difficulties: readonly Difficulty[] = ["easy", "medium", "hard"] as Difficulty[]): DailyChallenge {
  const r = seeded(hash(`trackrush-daily:${key}`));
  const trackId = trackIds[Math.floor(r() * trackIds.length)] ?? trackIds[0] ?? "";
  const t = r();
  const time = t < 0.4 ? "day" : t < 0.7 ? "dusk" : "night";
  const weather = r() < 0.3 ? "rain" : "clear";
  const rivals = r() < 0.5 ? 3 : 5;
  const difficulty = difficulties[Math.floor(r() * difficulties.length)] ?? difficulties[0]!;
  return { key, trackId, time, weather, rivals, difficulty };
}

const DAY_MS = 86_400_000;
function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

/** Keep the best attempt per day (better place first, then faster time), and only the last 90 days. */
export function addDailyResult(results: readonly DailyResult[], r: DailyResult): DailyResult[] {
  const old = results.find((x) => x.key === r.key);
  const better = !old || r.place < old.place || (r.place === old.place && r.totalMs < old.totalMs);
  const rest = results.filter((x) => x.key !== r.key);
  return [...rest, better ? r : old!].sort((a, b) => dayNumber(a.key) - dayNumber(b.key)).slice(-90);
}

/** Days in a row with a finished daily challenge. Today not done yet doesn't break yesterday's streak. */
export function streak(results: readonly DailyResult[], today: string): number {
  const days = new Set(results.map((r) => dayNumber(r.key)));
  let d = dayNumber(today);
  if (!days.has(d)) d -= 1;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

/** 3 stars for a win, 2 for the podium, 1 for finishing. */
export function stars(place: number): number {
  return place === 1 ? 3 : place <= 3 ? 2 : 1;
}

export function sanitizeDaily(raw: unknown): DailyResult[] {
  if (!Array.isArray(raw)) return [];
  const out: DailyResult[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.key)) continue;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const place = n(r.place);
    const field = n(r.fieldSize);
    const total = n(r.totalMs);
    if (place === null || field === null || total === null) continue;
    out.push({ key: r.key, place, fieldSize: field, totalMs: total, bestLapMs: n(r.bestLapMs) });
  }
  return out;
}
