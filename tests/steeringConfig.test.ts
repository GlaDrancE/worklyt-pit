import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, VehiclePhysics, type CarInput } from "../src/vehicle/VehiclePhysics";
import { STEERING, lockAt, rampSteer, shapeSteer, speedFactor, stepRack, visualWheelAngle } from "../src/vehicle/steeringConfig";

const DT = 1 / 60;
const DEG = Math.PI / 180;

describe("steering maths", () => {
  it("speed factor rises smoothly from 0 to 1", () => {
    expect(speedFactor(0)).toBe(0);
    expect(speedFactor(200)).toBe(1);
    let last = -1;
    for (let v = 0; v <= 90; v += 2) {
      const f = speedFactor(v);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
  it("lock shrinks with speed and never exceeds the configured maximum", () => {
    const lock = (v: number) => lockAt(v, 3.4, 55);
    expect(lock(5)).toBeCloseTo(STEERING.maxAngleDeg * DEG, 5);
    expect(lock(30)).toBeLessThan(lock(10));
    expect(lock(80)).toBeLessThan(lock(30));
    expect(lock(80)).toBeGreaterThan(0);
  });
  it("input curve keeps the sign, is softer near the centre and honours sensitivity", () => {
    expect(shapeSteer(0)).toBe(0);
    expect(shapeSteer(1)).toBe(1);
    expect(shapeSteer(-1)).toBe(-1);
    expect(Math.abs(shapeSteer(0.3))).toBeLessThan(0.3);
    expect(shapeSteer(1, 0.6)).toBeCloseTo(0.6, 5);
    expect(shapeSteer(1, 1.6)).toBe(1);
  });
  it("held steering builds gradually and centres without overshooting", () => {
    let s = 0;
    s = rampSteer(s, 1, DT);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) s = rampSteer(s, 1, DT);
    expect(s).toBe(1);
    for (let i = 0; i < 60; i++) s = rampSteer(s, 0, DT);
    expect(s).toBe(0);
  });
  it("builds slower at speed than when parked, and the setting scales it", () => {
    expect(rampSteer(0, 1, 0.1, 70)).toBeLessThan(rampSteer(0, 1, 0.1, 0));
    expect(rampSteer(0, 1, 0.1, 0, 1.5)).toBeGreaterThan(rampSteer(0, 1, 0.1, 0, 0.5));
  });
  it("the rack follows its target without jumping to full lock in one frame", () => {
    const next = stepRack(0, 0.4, DT, 5);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.05);
    let s = 0;
    for (let i = 0; i < 180; i++) s = stepRack(s, 0.4, DT, 5);
    expect(s).toBeCloseTo(0.4, 3);
  });
  it("wheel angle drawn follows the share of lock in use, is capped, and is smaller at speed", () => {
    const lock = 0.3;
    const full = visualWheelAngle(lock, lock, 5);
    expect(Math.abs(full)).toBeCloseTo(STEERING.visualMaxDeg * DEG, 5);
    expect(Math.sign(full)).toBe(-1); // same sign convention as the physics wheel steering (negative of the steer state)
    expect(visualWheelAngle(-lock, lock, 5)).toBeCloseTo(-full, 5);
    expect(Math.abs(visualWheelAngle(lock, lock, 80))).toBeLessThan(Math.abs(full));
    expect(visualWheelAngle(0, lock, 20)).toBeCloseTo(0, 8);
    expect(Math.abs(visualWheelAngle(5, lock, 5))).toBeCloseTo(STEERING.visualMaxDeg * DEG, 5);
  });
});

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000).setTranslation(0, -0.5, 0));
  return { world, car: new VehiclePhysics(world, { x: 0, z: 0, yaw: 0 }) };
}
function drive(world: RAPIER.World, car: VehiclePhysics, secs: number, f: (t: number) => CarInput) {
  for (let i = 0; i < Math.round(secs / DT); i++) {
    car.step(DT, f(i * DT));
    world.step();
  }
}
/** Gets the car to a steady speed in a straight line. */
function atSpeed(kmh: number) {
  const { world, car } = makeWorld();
  drive(world, car, 1, () => NEUTRAL_INPUT);
  const target = kmh / 3.6;
  drive(world, car, 40, () => ({ ...NEUTRAL_INPUT, throttle: car.forwardSpeed < target ? 1 : 0.25, brake: car.forwardSpeed > target + 3 ? 0.3 : 0 }));
  return { world, car };
}

describe("steering in the physics", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it("turns gradually: one frame of full steering moves the wheels only a little", () => {
    const { world, car } = atSpeed(60);
    car.step(DT, { ...NEUTRAL_INPUT, throttle: 0.4, steer: 1 });
    world.step();
    expect(Math.abs(car.snapshot().steering)).toBeLessThan(0.06);
    drive(world, car, 1.5, () => ({ ...NEUTRAL_INPUT, throttle: 0.4, steer: 1 }));
    expect(Math.abs(car.snapshot().steering)).toBeGreaterThan(0.1);
  });

  it("the drawn front wheels agree with the real steering, rear wheels stay straight", () => {
    const { world, car } = atSpeed(60);
    drive(world, car, 1.2, () => ({ ...NEUTRAL_INPUT, throttle: 0.4, steer: 1 }));
    const fl = car.wheel(0).steering;
    const fr = car.wheel(1).steering;
    expect(fl).toBe(fr);
    expect(Math.sign(fl)).toBe(Math.sign(car.vehicle.wheelSteering(0) ?? 0));
    expect(Math.abs(fl)).toBeGreaterThan(5 * DEG);
    expect(Math.abs(fl)).toBeLessThanOrEqual(STEERING.visualMaxDeg * DEG + 1e-9);
    expect(car.wheel(2).steering).toBe(0);
    expect(car.wheel(3).steering).toBe(0);
    // Steering left is the mirror image.
    const left = atSpeed(60);
    drive(left.world, left.car, 1.2, () => ({ ...NEUTRAL_INPUT, throttle: 0.4, steer: -1 }));
    expect(Math.sign(left.car.wheel(0).steering)).toBe(-Math.sign(fl));
  });

  it.each([60, 150, 250])("lets go of the wheel at %i km/h: steering centres and the car stops turning", (kmh) => {
    const { world, car } = atSpeed(kmh);
    drive(world, car, 2, () => ({ ...NEUTRAL_INPUT, throttle: 0.3, steer: 1 }));
    drive(world, car, 2.5, () => ({ ...NEUTRAL_INPUT, throttle: 0.3, steer: 0 }));
    expect(Math.abs(car.snapshot().steering)).toBeLessThan(0.005);
    expect(Math.abs(car.wheel(0).steering)).toBeLessThan(0.3 * DEG);
    expect(Math.abs(car.chassis.angvel().y)).toBeLessThan(0.05);
    expect(car.snapshot().upY).toBeGreaterThan(0.99);
  });

  it("a high-speed turn stays controlled: small slip angle, no spin, car stays upright", () => {
    const { world, car } = atSpeed(280);
    let slip = 0;
    let up = 1;
    drive(world, car, 3, () => ({ ...NEUTRAL_INPUT, throttle: 0.3, steer: 1 }));
    for (let i = 0; i < 180; i++) {
      car.step(DT, { ...NEUTRAL_INPUT, throttle: 0.3, steer: 1 });
      world.step();
      slip = Math.max(slip, Math.abs(car.slipAngle()));
      up = Math.min(up, car.snapshot().upY);
    }
    expect(slip).toBeLessThan(8 * DEG);
    expect(up).toBeGreaterThan(0.95);
  });

  it("small corrections stay small: a light touch gives a small wheel angle", () => {
    const { world, car } = atSpeed(120);
    drive(world, car, 1.5, () => ({ ...NEUTRAL_INPUT, throttle: 0.3, steer: shapeSteer(0.25) }));
    expect(Math.abs(car.snapshot().steering)).toBeLessThan(0.5 * lockAt(33, 3.4, 55));
  });

  it("at low speed the lock is larger than at high speed, so parking-lot turns still work", () => {
    const slow = atSpeed(40);
    drive(slow.world, slow.car, 2, () => ({ ...NEUTRAL_INPUT, throttle: 0.2, steer: 1 }));
    const fast = atSpeed(250);
    drive(fast.world, fast.car, 2, () => ({ ...NEUTRAL_INPUT, throttle: 0.2, steer: 1 }));
    expect(Math.abs(slow.car.snapshot().steering)).toBeGreaterThan(3 * Math.abs(fast.car.snapshot().steering));
  });
});

describe("steering at speed stays usable and planted", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });
  it.each([200, 250])("at %i km/h full steering turns the car properly without sliding it out", (kmh) => {
    const { world, car } = atSpeed(kmh);
    let maxSlip = 0;
    drive(world, car, 3.5, () => ({ ...NEUTRAL_INPUT, throttle: car.forwardSpeed < kmh / 3.6 ? 1 : 0.25, steer: 1 }));
    drive(world, car, 0.5, () => ({ ...NEUTRAL_INPUT, throttle: 0.25, steer: 1 }));
    maxSlip = Math.abs(car.slipAngle());
    const v = car.forwardSpeed;
    const yaw = Math.abs((car as unknown as { chassis: { angvel(): { y: number } } }).chassis.angvel().y);
    expect(v / yaw).toBeLessThan(kmh === 200 ? 90 : 110); // turning radius in metres
    expect(maxSlip).toBeLessThan(4 * (Math.PI / 180));
  });
  it("half a stick at 250 km/h already gives a firm turn", () => {
    const { world, car } = atSpeed(250);
    drive(world, car, 4, () => ({ ...NEUTRAL_INPUT, throttle: car.forwardSpeed < 250 / 3.6 ? 1 : 0.25, steer: 0.6 }));
    const yaw = Math.abs((car as unknown as { chassis: { angvel(): { y: number } } }).chassis.angvel().y);
    expect((car.forwardSpeed * yaw) / 9.81).toBeGreaterThan(3);
  });
});

import { STEER_FEELS, applySteerFeel, type SteeringConfig } from "../src/vehicle/steeringConfig";
import { sanitizeSettings } from "../src/game/settings";
import { STEERING as LIVE } from "../src/vehicle/steeringConfig";

describe("steering feel presets", () => {
  const base = { ...LIVE };
  const cfgFor = (f: keyof typeof STEER_FEELS): SteeringConfig => ({ ...base, ...STEER_FEELS[f] });
  it("sharp turns in more than standard, and calm less, at 300 km/h", () => {
    const at = (f: keyof typeof STEER_FEELS) => lockAt(83, 3.6, 70, cfgFor(f));
    expect(at("sharp")).toBeGreaterThan(at("standard"));
    expect(at("standard")).toBeGreaterThan(at("calm"));
  });
  it("calm keeps more rear grip than sharp", () => {
    expect(STEER_FEELS.calm.rearStability).toBeGreaterThan(STEER_FEELS.sharp.rearStability);
  });
  it("low-speed lock is the same in every feel", () => {
    const lows = (["calm", "standard", "sharp"] as const).map((f) => lockAt(5, 3.6, 70, cfgFor(f)));
    expect(new Set(lows.map((v) => v.toFixed(6))).size).toBe(1);
  });
  it("applySteerFeel writes the preset and standard restores the defaults", () => {
    const c = { ...base };
    applySteerFeel("sharp", c);
    expect(c.minLockFraction).toBe(STEER_FEELS.sharp.minLockFraction);
    applySteerFeel("standard", c);
    expect(c.minLockFraction).toBe(base.minLockFraction);
    expect(c.rearStability).toBe(base.rearStability);
  });
  it("settings accept only known feels", () => {
    expect(sanitizeSettings({ steerFeel: "sharp" }).steerFeel).toBe("sharp");
    expect(sanitizeSettings({ steerFeel: "wild" }).steerFeel).toBe("standard");
    expect(sanitizeSettings({}).steerFeel).toBe("standard");
  });
});
