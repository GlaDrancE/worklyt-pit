import { describe, expect, it } from "vitest";
import { PlayerStore } from "../server/players";
import { mergeHistories, type RaceRecord } from "../src/race/history";
import { httpBase } from "../src/net/playerSync";

const rec = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, startedAt: at, ...extra });
const TOKEN = "0123456789abcdef0123";

describe("server player store", () => {
  it("saves records, merges by race id and keeps newest first", () => {
    const s = new PlayerStore();
    expect(s.save("aaaa1111", TOKEN, "Ann", [rec("r1", "2026-01-01"), rec("r2", "2026-01-02")])).toBe("saved");
    s.save("aaaa1111", TOKEN, "Ann", [rec("r2", "2026-01-02", { points: 25 }), rec("r3", "2026-01-03")]);
    const got = s.get("aaaa1111", TOKEN);
    expect(got).not.toBe("forbidden");
    const recs = (got as { records: Array<{ id: string; points?: number }> }).records;
    expect(recs.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    expect(recs[1]!.points).toBe(25);
  });
  it("lets only the device that claimed an ID read or write it", () => {
    const s = new PlayerStore();
    s.save("aaaa1111", TOKEN, "Ann", [rec("r1", "2026-01-01")]);
    expect(s.save("aaaa1111", "ffffffffffffffffffff", "Mallory", [rec("x", "2026-02-01")])).toBe("forbidden");
    expect(s.get("aaaa1111", "ffffffffffffffffffff")).toBe("forbidden");
    expect(s.get("zzzz9999", TOKEN)).toBeNull();
  });
  it("rejects bad ids, weak tokens and oversized or malformed records", () => {
    const s = new PlayerStore();
    expect(s.save("no!", TOKEN, "A", [])).toBe("invalid");
    expect(s.save("aaaa1111", "short", "A", [])).toBe("invalid");
    s.save("aaaa1111", TOKEN, "A", [{ nope: 1 }, rec("big", "2026-01-01", { blob: "x".repeat(7000) }), rec("ok", "2026-01-01")]);
    expect((s.get("aaaa1111", TOKEN) as { records: unknown[] }).records).toHaveLength(1);
  });
  it("round-trips through JSON so it survives a restart", () => {
    const s = new PlayerStore();
    s.save("aaaa1111", TOKEN, "Ann", [rec("r1", "2026-01-01")]);
    const t = new PlayerStore();
    t.load(JSON.parse(JSON.stringify(s)));
    expect(t.get("aaaa1111", TOKEN)).toMatchObject({ name: "Ann" });
    expect(t.save("aaaa1111", "ffffffffffffffffffff", "x", [])).toBe("forbidden");
  });
});

describe("client history merge", () => {
  const full = (id: string, at: string): RaceRecord => ({ id, driverId: "aaaa1111", driver: "Ann", trackId: "apex-park", trackName: "Apex Park", startedAt: at, completed: true, totalLaps: 1, laps: [], totalMs: 1000, bestMs: null, collisions: 0, topSpeedKmh: 100 });
  it("combines two devices, prefers the local copy and ignores junk", () => {
    const local = [{ ...full("r2", "2026-01-02"), points: 10 }];
    const merged = mergeHistories(local, [full("r1", "2026-01-01"), full("r2", "2026-01-02"), { junk: true }]);
    expect(merged.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(merged[0]!.points).toBe(10);
  });
  it("turns a ws address into the relay's web address", () => {
    expect(httpBase("ws://10.0.0.5:8787")).toBe("http://10.0.0.5:8787");
    expect(httpBase("wss://relay.example.com/")).toBe("https://relay.example.com");
    expect(httpBase("nonsense")).toBeNull();
  });
});

import { isSafeAddress, syncPlayer } from "../src/net/playerSync";

describe("plaintext addresses", () => {
  it("allows plain ws/http only for this computer and private networks", () => {
    for (const ok of ["ws://localhost:8787", "ws://127.0.0.1:8787", "ws://192.168.1.5:8787", "ws://10.11.53.48:8787", "ws://172.20.0.4:8787", "http://my-pc.local:8787", "wss://relay.example.com", "https://x.workers.dev"]) {
      expect(isSafeAddress(ok), ok).toBe(true);
    }
    for (const bad of ["ws://relay.example.com", "http://8.8.8.8:8787", "ws://172.32.0.1", "ws://192.169.1.1", "ftp://x", "nonsense", ""]) {
      expect(isSafeAddress(bad), bad).toBe(false);
    }
  });
  it("never sends history to a public plaintext address", async () => {
    let called = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    try {
      const r = await syncPlayer("http://relay.example.com", { id: "aaaa1111", name: "Ann" });
      expect(r).toBe("offline");
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = real;
    }
  });
});
