import { describe, expect, it } from "vitest";
import { GEAR_TOP_KMH, IDLE_RPM, REDLINE_RPM, newDrivetrain, rpmInGear, stepDrivetrain } from "../src/audio/drivetrain";

describe("drivetrain (engine sound model)", () => {
  it("idles when stopped", () => {
    const s = newDrivetrain();
    for (let i = 0; i < 120; i++) stepDrivetrain(s, 0, 0, 1 / 60);
    expect(s.gear).toBe(1);
    expect(s.rpm).toBeGreaterThan(IDLE_RPM * 0.9);
    expect(s.rpm).toBeLessThan(IDLE_RPM * 1.1);
  });

  it("revs up with the throttle at a standstill", () => {
    const s = newDrivetrain();
    for (let i = 0; i < 120; i++) stepDrivetrain(s, 0, 1, 1 / 60);
    expect(s.rpm).toBeGreaterThan(8000);
  });

  it("climbs through all eight gears on a full-throttle run and never exceeds the limiter", () => {
    const s = newDrivetrain();
    let shifts = 0;
    for (let kmh = 0; kmh <= 340; kmh += 0.5) {
      for (let i = 0; i < 6; i++) if (stepDrivetrain(s, kmh, 1, 1 / 360)) shifts++;
      expect(s.rpm).toBeLessThanOrEqual(REDLINE_RPM);
    }
    expect(s.gear).toBe(GEAR_TOP_KMH.length);
    expect(shifts).toBeGreaterThanOrEqual(7);
  });

  it("downshifts under braking", () => {
    const s = newDrivetrain();
    for (let kmh = 0; kmh <= 300; kmh += 1) stepDrivetrain(s, kmh, 1, 1 / 60);
    const top = s.gear;
    for (let kmh = 300; kmh >= 60; kmh -= 1) stepDrivetrain(s, kmh, 0, 1 / 30);
    expect(s.gear).toBeLessThan(top);
    expect(rpmInGear(100, 3)).toBeGreaterThan(rpmInGear(100, 4));
  });
});
