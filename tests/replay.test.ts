import { describe, expect, it } from "vitest";
import { REPLAY_CAMERAS, nextReplayCamera, replayCameraPose, type ReplayCamera } from "../src/game/replayCamera";
import { speedColour } from "../src/ui/ShareCard";

const car = { x: 10, z: 20, yaw: 0 };
const anchor = { x: 10, z: 60, yaw: 0 };

describe("replay cameras", () => {
  it("cycles through every angle and wraps", () => {
    let c: ReplayCamera = 0;
    const seen = new Set<number>();
    for (let i = 0; i < REPLAY_CAMERAS.length; i++) {
      seen.add(c);
      c = nextReplayCamera(c);
    }
    expect(seen.size).toBe(REPLAY_CAMERAS.length);
    expect(c).toBe(0);
  });
  it("chase sits behind the car and looks ahead", () => {
    const p = replayCameraPose(0, car, anchor, 0);
    expect(p.pos.z).toBeLessThan(car.z);
    expect(p.look.z).toBeGreaterThan(car.z);
  });
  it("TV camera stands off to the side of the anchor, not on the car", () => {
    const p = replayCameraPose(1, car, anchor, 0);
    expect(Math.hypot(p.pos.x - anchor.x, p.pos.z - anchor.z)).toBeCloseTo(16, 5);
    const q = replayCameraPose(1, { ...car, z: 25 }, anchor, 3);
    expect(q.pos).toEqual(p.pos); // fixed during a cut
  });
  it("top view is high and never exactly vertical", () => {
    const p = replayCameraPose(2, car, anchor, 0);
    expect(p.pos.y).toBeGreaterThan(40);
    expect(p.pos.z).not.toBe(p.look.z);
  });
  it("helicopter orbits the car over time", () => {
    const a = replayCameraPose(3, car, anchor, 0);
    const b = replayCameraPose(3, car, anchor, 2);
    expect(a.pos.x).not.toBeCloseTo(b.pos.x, 1);
    expect(Math.hypot(a.pos.x - car.x, a.pos.z - car.z)).toBeCloseTo(34, 5);
  });
});

describe("lap card speed colours", () => {
  it("runs blue to red and clamps", () => {
    expect(speedColour(0, 300)).toContain("220");
    expect(speedColour(300, 300)).toContain("hsl(0");
    expect(speedColour(900, 300)).toBe(speedColour(300, 300));
    expect(speedColour(10, 0)).toContain("220");
  });
});
