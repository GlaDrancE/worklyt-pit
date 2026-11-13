import { describe, expect, it } from "vitest";
import {
  MAX_RECORDS,
  addRecord,
  buildRecord,
  cleanName,
  clearHistory,
  generateDriverName,
  leaderboard,
  loadHistory,
  loadProfile,
  summarize,
  updateRecord,
  type StorageLike,
} from "../src/race/history";
import { COMPANY_NAMES, POPULAR_COMPANIES, WORKLYFT } from "../src/race/companies";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const lap = (n: number, ms: number, valid = true) => ({ lap: n, ms, valid, sectors: [ms / 3, ms / 3, ms / 3] as [number, number, number] });

function rec(driverName: string, driverId: string, trackId: string, laps: ReturnType<typeof lap>[], completed = true) {
  return buildRecord({
    driver: { id: driverId, name: driverName },
    trackId,
    trackName: trackId,
    startedAt: new Date().toISOString(),
    completed,
    totalLaps: 3,
    laps,
    collisions: 1,
    topSpeedKmh: 280.4,
  });
}

describe("driver profile", () => {
  it("assigns and keeps a company name on first visit", () => {
    const store = memory();
    const a = loadProfile(store);
    expect(COMPANY_NAMES).toContain(a.name);
    expect(a.name).not.toBe(WORKLYFT);
    const b = loadProfile(store);
    expect(b).toEqual(a);
  });

  it("keeps a custom driver name and migrates the reserved Worklyft name", () => {
    const store = memory();
    store.setItem("trackrush.profile", JSON.stringify({ id: "player-id", name: "Alex Racer" }));
    expect(loadProfile(store, () => 0.5, 6).name).toBe("Alex Racer");

    store.setItem("trackrush.profile", JSON.stringify({ id: "player-id", name: WORKLYFT }));
    const profile = loadProfile(store, () => 0.5, 6);
    expect(POPULAR_COMPANIES).toContain(profile.name);
    expect(profile.name).not.toBe(WORKLYFT);
    expect(JSON.parse(store.getItem("trackrush.profile")!).name).toBe(profile.name);
  });

  it("generates different names and cleans user input", () => {
    const names = new Set(Array.from({ length: 30 }, () => generateDriverName()));
    expect(names.size).toBeGreaterThan(10);
    expect(cleanName("  <b>Cat</b>   Rider  ")).toBe("bCat/b Rider");
    expect(cleanName("x".repeat(50)).length).toBe(20);
  });

  it("recovers from a corrupted profile", () => {
    const store = memory();
    store.setItem("trackrush.profile", "{not json");
    expect(COMPANY_NAMES).toContain(loadProfile(store).name);
  });
});

describe("race history", () => {
  it("saves newest first, survives corrupt data and caps the list", () => {
    const store = memory();
    addRecord(rec("A", "a", "t1", [lap(1, 60000)]), store);
    addRecord(rec("B", "b", "t1", [lap(1, 59000)]), store);
    expect(loadHistory(store)[0]!.driver).toBe("B");
    store.setItem("trackrush.history", "oops");
    expect(loadHistory(store)).toEqual([]);
    for (let i = 0; i < MAX_RECORDS + 10; i++) addRecord(rec("A", "a", "t1", [lap(1, 60000 + i)]), store);
    expect(loadHistory(store).length).toBe(MAX_RECORDS);
    clearHistory(store);
    expect(loadHistory(store)).toEqual([]);
  });

  it("builds records with totals, best valid lap and rounded top speed", () => {
    const r = rec("A", "a", "t1", [lap(1, 61000), lap(2, 58000), lap(3, 50000, false)], false);
    expect(r.totalMs).toBe(169000);
    expect(r.bestMs).toBe(58000);
    expect(r.topSpeedKmh).toBe(280);
    expect(r.completed).toBe(false);
  });

  it("summarises and ranks drivers by best valid lap", () => {
    const list = [
      rec("A", "a", "t1", [lap(1, 61000), lap(2, 60000)]),
      rec("B", "b", "t1", [lap(1, 59000), lap(2, 40000, false)]),
      rec("A", "a", "t2", [lap(1, 30000)]),
    ];
    const s = summarize(list);
    expect(s.races).toBe(3);
    expect(s.laps).toBe(5);
    expect(s.validLaps).toBe(4);
    const board = leaderboard(list, "t1");
    expect(board.map((b) => b.driver)).toEqual(["B", "A"]);
    expect(board[0]!.bestMs).toBe(59000);
  });

  it("updates a saved race with points and 1v1 details, and adds up points and wins", () => {
    const store = memory();
    const r = rec("A", "a", "t1", [lap(1, 60000)]);
    addRecord(r, store);
    updateRecord(r.id, { points: 25, versus: { opponentId: "b", opponentName: "B", place: 1 } }, store);
    const [saved] = loadHistory(store);
    expect(saved).toMatchObject({ points: 25, versus: { place: 1 } });
    expect(summarize(loadHistory(store))).toMatchObject({ points: 25, wins: 1 });
  });
});
