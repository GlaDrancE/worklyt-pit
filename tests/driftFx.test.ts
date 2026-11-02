import { describe, expect, it } from "vitest";
import { DriftFx } from "../src/vehicle/DriftFx";
import type { CarSnapshot } from "../src/vehicle/VehiclePhysics";

function snap(z: number): CarSnapshot {
  return { x: 0, y: 0.7, z, qx: 0, qy: 0, qz: 0, qw: 1, yaw: 0, speedKmh: 120, forwardSpeed: 33, steering: 0, upY: 1 } as CarSnapshot;
}

describe("DriftFx skid marks", () => {
  it("lays unbroken marks even when the car covers several metres per frame", () => {
    const fx = new DriftFx();
    fx.update(1 / 60, snap(0), 1, 0);
    fx.update(1 / 60, snap(5), 1, 0); // 5 m in one frame
    expect(fx.markCount).toBeGreaterThanOrEqual(2 * Math.floor(5 / 0.28));
  });

  it("keeps every mark for the whole race and never removes any", () => {
    const fx = new DriftFx();
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      fx.update(1 / 60, snap(i * 0.5), i % 100 < 50 ? 1 : 0, 0);
      expect(fx.markCount).toBeGreaterThanOrEqual(prev);
      prev = fx.markCount;
    }
    expect(prev).toBeGreaterThan(200);
  });

  it("does not mark grass", () => {
    const fx = new DriftFx();
    fx.update(1 / 60, snap(0), 1, 0, false);
    fx.update(1 / 60, snap(5), 1, 0, false);
    expect(fx.markCount).toBe(0);
  });
});
