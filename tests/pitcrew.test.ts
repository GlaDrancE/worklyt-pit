import { describe, expect, it } from "vitest";
import { PitCrewClock } from "../src/audio/pitCrew";

describe("pit crew timing", () => {
  it("fires roughly every interval and marks every fourth as long", () => {
    const c = new PitCrewClock(0.4);
    const fires: boolean[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      const r = c.tick(1 / 60);
      if (r.fire) fires.push(r.long);
    }
    expect(fires.length).toBeGreaterThanOrEqual(9);
    expect(fires.length).toBeLessThanOrEqual(10);
    expect(fires.slice(0, 5)).toEqual([true, false, false, false, true]);
  });
  it("reset starts the sequence again", () => {
    const c = new PitCrewClock(0.1);
    c.tick(0.11);
    c.reset();
    expect(c.tick(0.05).fire).toBe(false);
  });
});
