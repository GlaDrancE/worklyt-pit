import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { CAR_TUNING, NEUTRAL_INPUT, VehiclePhysics, type CarInput } from "../src/vehicle/VehiclePhysics";

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

function make() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setFriction(0.9));
  return { world, car: new VehiclePhysics(world, { x: 0, z: 0, yaw: 0 }) };
}

function run(w: RAPIER.World, c: VehiclePhysics, secs: number, input: CarInput | ((t: number) => CarInput)) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    c.step(DT, typeof input === "function" ? input(i * DT) : input);
    w.step();
  }
}

/** Run until `until` is true or `maxSecs` pass; returns elapsed seconds. */
function runUntil(w: RAPIER.World, c: VehiclePhysics, input: CarInput, until: () => boolean, maxSecs: number) {
  let t = 0;
  while (t < maxSecs && !until()) {
    c.step(DT, input);
    w.step();
    t += DT;
  }
  return t;
}

describe("F1-class performance envelope (headless physics)", () => {
  it("reports and checks the headline numbers", () => {
    const { world, car } = make();
    run(world, car, 2, NEUTRAL_INPUT);
    const rest = car.snapshot();

    const full: CarInput = { ...NEUTRAL_INPUT, throttle: 1 };
    const t100 = runUntil(world, car, full, () => car.forwardSpeed * 3.6 >= 100, 10);
    const t200 = t100 + runUntil(world, car, full, () => car.forwardSpeed * 3.6 >= 200, 15);
    const t300 = t200 + runUntil(world, car, full, () => car.forwardSpeed * 3.6 >= 300, 40);
    run(world, car, 25, full);
    const top = car.snapshot().speedKmh;

    // Braking from 300 km/h.
    const z0 = car.snapshot().z;
    const brk: CarInput = { ...NEUTRAL_INPUT, brake: 1 };
    const tb = runUntil(world, car, brk, () => car.forwardSpeed * 3.6 <= 100, 15);
    const dist300to100 = car.snapshot().z - z0;
    const z1 = car.snapshot().z;
    const tb2 = runUntil(world, car, brk, () => car.forwardSpeed * 3.6 <= 3, 10);
    const dist100to0 = car.snapshot().z - z1;

    // eslint-disable-next-line no-console
    console.log(
      [
        `rest height ${rest.y.toFixed(3)} m (up ${rest.upY.toFixed(3)})`,
        `0-100 ${t100.toFixed(2)} s, 0-200 ${t200.toFixed(2)} s, 0-300 ${t300.toFixed(2)} s, top ${top.toFixed(0)} km/h`,
        `300-100 km/h ${tb.toFixed(2)} s over ${dist300to100.toFixed(0)} m, 100-0 ${tb2.toFixed(2)} s over ${dist100to0.toFixed(0)} m`,
      ].join("\n"),
    );

    expect(rest.y).toBeGreaterThan(0.5);
    expect(rest.y).toBeLessThan(0.75);
    expect(t100).toBeGreaterThan(2.0);
    expect(t100).toBeLessThan(3.8);
    expect(t200).toBeLessThan(8);
    expect(top).toBeGreaterThan(300);
    expect(top).toBeLessThan(370);
    expect(dist100to0).toBeGreaterThan(10);
    expect(dist100to0).toBeLessThan(35);
    expect(dist300to100).toBeLessThan(250);
  });

  it("holds a steady corner at speed without flipping, and downforce raises the limit", () => {
    const results: number[] = [];
    for (const target of [30, 60]) {
      const { world, car } = make();
      run(world, car, 1, NEUTRAL_INPUT);
      // Reach target speed, then hold it while steering hard (full lock is speed-limited).
      let t = 0;
      let peakLat = 0;
      let minUp = 1;
      while (t < 25) {
        const v = car.forwardSpeed;
        const turning = t > 8;
        car.step(DT, { throttle: v < target ? 1 : 0.3, brake: v > target + 4 ? 0.2 : 0, steer: turning ? 1 : 0, handbrake: false });
        world.step();
        t += DT;
        if (turning) {
          const s = car.snapshot();
          const lv = car.chassis.linvel();
          const av = car.chassis.angvel();
          // lateral accel ≈ speed × yaw rate
          peakLat = Math.max(peakLat, Math.hypot(lv.x, lv.z) * Math.abs(av.y));
          minUp = Math.min(minUp, s.upY);
        }
      }
      results.push(peakLat / 9.81);
      // eslint-disable-next-line no-console
      console.log(`steady corner at ${target} m/s: peak lateral ${(peakLat / 9.81).toFixed(2)} g, min up ${minUp.toFixed(2)}`);
      expect(minUp).toBeGreaterThan(0.6);
    }
    expect(results[1]!).toBeGreaterThan(results[0]! * 0.9);
    expect(CAR_TUNING.mass).toBe(768);
  });
});

import { pickDefaultQuality } from "../src/game/QualitySettings";

describe("first-run graphics level", () => {
  it("starts phones and weak machines on Low, others on Medium", () => {
    expect(pickDefaultQuality({ coarse: true, cores: 8, memoryGb: 8 })).toBe("low");
    expect(pickDefaultQuality({ coarse: false, cores: 2 })).toBe("low");
    expect(pickDefaultQuality({ coarse: false, cores: 8, memoryGb: 2 })).toBe("low");
    expect(pickDefaultQuality({ coarse: false, cores: 8, memoryGb: 8 })).toBe("medium");
    expect(pickDefaultQuality({ coarse: false })).toBe("medium");
  });
});
