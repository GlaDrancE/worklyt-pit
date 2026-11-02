import { describe, expect, it } from "vitest";
import { MAX_PER_TRACK, MAX_TRACKS, MemoryBoard } from "../server/lobby";
import { MAX_PLAYERS, PlayerStore } from "../server/players";
import { RateLimiter } from "../server/rateLimit";

describe("relay limits", () => {
  it("stops the board growing without end from made-up tracks or drivers", () => {
    const b = new MemoryBoard();
    for (let i = 0; i < MAX_TRACKS + 50; i++) b.submit(`t${i}`, "aaaa1111", "A", 60000);
    expect(b.top(`t${MAX_TRACKS + 10}`, 5)).toHaveLength(0);
    expect(b.top("t0", 5)).toHaveLength(1);
    for (let i = 0; i < MAX_PER_TRACK + 50; i++) b.submit("t0", `id${i}xxxx`, "A", 60000 + i);
    expect(Object.values(b.toJSON()["t0"]!).length).toBeLessThanOrEqual(MAX_PER_TRACK);
  });
  it("refuses new players once the store is full but still serves existing ones", () => {
    const s = new PlayerStore();
    const T = "0123456789abcdef0123";
    s.load(Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: `p${String(i).padStart(7, "0")}`, name: "x", tokenHash: "h", updatedAt: 0, records: [] })));
    expect(s.save("newone01", T, "N", [])).toBe("invalid");
    expect(s.get("p0000000", T)).toBe("forbidden");
  });
  it("rate limiter allows a burst, blocks the excess and recovers next window", () => {
    const r = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => r.allow("ip", 0))).toEqual([true, true, true, false]);
    expect(r.allow("other", 0)).toBe(true);
    expect(r.allow("ip", 1500)).toBe(true);
  });
});
