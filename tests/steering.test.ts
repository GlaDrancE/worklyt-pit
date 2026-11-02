import { describe, expect, it } from "vitest";
import { rampSteer } from "../src/game/InputManager";

describe("keyboard steering ramp", () => {
  it("a quick tap only nudges the wheel", () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s = rampSteer(s, 1, 1 / 60); // ~100 ms tap
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.2);
  });

  it("holding builds to full lock in under a second, then centres quickly", () => {
    let s = 0;
    for (let i = 0; i < 60; i++) s = rampSteer(s, 1, 1 / 60);
    expect(s).toBe(1);
    for (let i = 0; i < 20; i++) s = rampSteer(s, 0, 1 / 60);
    expect(s).toBe(0);
  });

  it("reverses faster than it builds", () => {
    let s = 0.5;
    s = rampSteer(s, -1, 1 / 60);
    expect(s).toBeLessThan(0.45);
  });
});
