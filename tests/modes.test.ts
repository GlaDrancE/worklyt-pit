import { describe, expect, it } from "vitest";
import { addDailyResult, dailyChallenge, dateKey, sanitizeDaily, stars, streak, type DailyResult } from "../src/race/daily";
import { CAR_COLOURS, newlyUnlocked, nextColour, pickColour, unlockedColours } from "../src/race/unlocks";
import { isFinished, currentTrack, newSeason, pointsForPlace, recordRound, sanitizeSeason, standings } from "../src/race/championship";

const tracks = ["a", "b", "c", "d"];
const res = (key: string, place = 2, totalMs = 100000): DailyResult => ({ key, place, fieldSize: 4, totalMs, bestLapMs: 30000 });

describe("daily challenge", () => {
  it("is the same for the same date and valid", () => {
    const a = dailyChallenge("2026-10-22", tracks);
    expect(dailyChallenge("2026-10-22", tracks)).toEqual(a);
    expect(tracks).toContain(a.trackId);
    expect([3, 5]).toContain(a.rivals);
  });
  it("varies across days", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) seen.add(JSON.stringify(dailyChallenge(`2026-10-${String(d).padStart(2, "0")}`, tracks)));
    expect(seen.size).toBeGreaterThan(10);
  });
  it("formats the local date", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("keeps only the best attempt of a day", () => {
    let r = addDailyResult([], res("2026-10-20", 3));
    r = addDailyResult(r, res("2026-10-20", 1));
    r = addDailyResult(r, res("2026-10-20", 2));
    expect(r).toHaveLength(1);
    expect(r[0]!.place).toBe(1);
  });
  it("counts the streak, and today not done yet keeps yesterday's", () => {
    const r = [res("2026-10-19"), res("2026-10-20"), res("2026-10-21")];
    expect(streak(r, "2026-10-21")).toBe(3);
    expect(streak(r, "2026-10-22")).toBe(3);
    expect(streak(r, "2026-10-23")).toBe(0);
    expect(streak([res("2026-10-01"), res("2026-10-21")], "2026-10-21")).toBe(1);
    expect(streak([res("2026-09-30"), res("2026-10-01")], "2026-10-01")).toBe(2);
  });
  it("awards stars and cleans junk from storage", () => {
    expect([stars(1), stars(3), stars(4)]).toEqual([3, 2, 1]);
    expect(sanitizeDaily([res("2026-10-20"), { key: "bad" }, null, 5])).toHaveLength(1);
    expect(sanitizeDaily("x")).toEqual([]);
  });
});

describe("car colour unlocks", () => {
  it("starts with one colour and unlocks more with points", () => {
    expect(unlockedColours(0)).toHaveLength(1);
    expect(unlockedColours(100).map((c) => c.id)).toContain("papaya");
    expect(unlockedColours(99999)).toHaveLength(CAR_COLOURS.length);
    expect(nextColour(0)?.points).toBe(40);
    expect(nextColour(99999)).toBeNull();
  });
  it("reports what a race just unlocked, and refuses locked saved picks", () => {
    expect(newlyUnlocked(30, 130).map((c) => c.id)).toEqual(["midnight", "papaya"]);
    expect(newlyUnlocked(130, 135)).toEqual([]);
    expect(pickColour("gold", 10).id).toBe("signal-red");
    expect(pickColour("nope", 1000).id).toBe("signal-red");
    expect(pickColour("gold", 600).id).toBe("gold");
  });
  it("has increasing thresholds and unique ids", () => {
    const pts = CAR_COLOURS.map((c) => c.points);
    expect([...pts].sort((a, b) => a - b)).toEqual(pts);
    expect(new Set(CAR_COLOURS.map((c) => c.id)).size).toBe(CAR_COLOURS.length);
  });
});

describe("championship", () => {
  const order = (...ids: string[]) => ids.map((id, i) => ({ id, name: id.toUpperCase(), place: i + 1 }));
  it("uses the F1 points table", () => {
    expect([1, 2, 3, 6, 7].map(pointsForPlace)).toEqual([25, 18, 15, 8, 0]);
  });
  it("adds points over rounds and finishes after the last one", () => {
    let s = newSeason("s1", ["a", "b"], ["x"]);
    expect(currentTrack(s)).toBe("a");
    s = recordRound(s, order("me", "r1", "r2"));
    s = recordRound(s, order("r1", "me", "r2"));
    expect(isFinished(s)).toBe(true);
    expect(currentTrack(s)).toBeNull();
    const t = standings(s);
    expect(t[0]).toMatchObject({ id: "me", points: 43, wins: 1 });
    expect(t[1]).toMatchObject({ id: "r1", points: 43, wins: 1 });
    expect(recordRound(s, order("me"))).toBe(s);
  });
  it("does not change the old season when recording", () => {
    const s0 = newSeason("s1", ["a", "b"], []);
    const s1 = recordRound(s0, order("me"));
    expect(s0.round).toBe(0);
    expect(s0.table).toEqual({});
    expect(s1.table.me!.points).toBe(25);
  });
  it("loads saved seasons safely", () => {
    const good = recordRound(newSeason("s1", ["a", "b"], ["n"]), order("me"));
    expect(sanitizeSeason(JSON.parse(JSON.stringify(good)), ["a", "b"])).toEqual(good);
    expect(sanitizeSeason({ id: "x", rounds: ["zzz"], names: [] }, ["a"])).toBeNull();
    expect(sanitizeSeason(null, ["a"])).toBeNull();
    expect(sanitizeSeason({ id: "x", rounds: ["a"], names: [], round: 99, table: { q: { name: "Q", points: "no", wins: 1 } } }, ["a"])).toMatchObject({ round: 1, table: {} });
  });
});
