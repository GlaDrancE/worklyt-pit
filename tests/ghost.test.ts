import { describe, expect, it } from "vitest";
import { GhostPlayer, GhostRecorder, loadGhost, saveGhost } from "../src/race/ghost";

function record(speed: number): ReturnType<GhostRecorder["finish"]> {
  // A car that drives 1000 m round a line at constant speed, lap fraction = distance / 1000.
  const rec = new GhostRecorder();
  const total = (1000 / speed) * 1000;
  for (let t = 0; t <= total; t += 16) {
    const d = (speed * t) / 1000;
    rec.sample(t, d, 0, 1.5, (d / 1000) % 1);
  }
  return rec.finish(total, 1000, 0, 1.5);
}

describe("ghost lap", () => {
  it("records at a sane rate and replays positions", () => {
    const lap = record(50); // 20 s
    expect(lap.ms).toBe(20000);
    expect(lap.t.length).toBeGreaterThan(300);
    expect(lap.t.length).toBeLessThan(450);
    const p = new GhostPlayer(lap);
    const mid = p.at(10000)!;
    expect(mid.x).toBeCloseTo(500, 0);
    expect(mid.speedKmh).toBeCloseTo(180, 0);
    expect(p.at(20001)).toBeNull();
    expect(p.at(-5)).toBeNull();
  });

  it("measures the gap to the ghost at the same point on track", () => {
    const p = new GhostPlayer(record(50)); // ghost takes 20 s
    // I am at 50% of the lap after 11 s: ghost was there at 10 s, so I'm 1 s behind.
    expect(p.deltaMs(11000, 0.5)!).toBeCloseTo(1000, -1);
    // At 25% after 4 s: ghost needed 5 s, so I'm 1 s ahead.
    expect(p.deltaMs(4000, 0.25)!).toBeCloseTo(-1000, -1);
    expect(p.deltaMs(500, 0.01)!).toBeCloseTo(300, -1);
    expect(p.deltaMs(500, 0.99)).toBeNull(); // folded to just before the line: before the recording starts
  });

  it("round-trips through storage and rejects junk", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const lap = record(60);
    saveGhost("t1", lap, store);
    expect(loadGhost("t1", store)?.ms).toBe(lap.ms);
    mem.set("trackrush.ghost.t2", "{not json");
    expect(loadGhost("t2", store)).toBeNull();
    mem.set("trackrush.ghost.t3", JSON.stringify({ ms: 1, t: [1, 2], x: [1], z: [1, 2], yaw: [1, 2], f: [1, 2] }));
    expect(loadGhost("t3", store)).toBeNull();
    expect(loadGhost("none", store)).toBeNull();
  });
});
