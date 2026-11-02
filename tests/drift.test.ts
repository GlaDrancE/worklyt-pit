import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, VehiclePhysics, type CarInput, type Handling } from "../src/vehicle/VehiclePhysics";

const DT = 1 / 60;

function setup(handling: Handling) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000).setTranslation(0, -0.5, 0));
  const car = new VehiclePhysics(world, { x: 0, z: 0, yaw: 0 });
  car.setHandling(handling);
  return { world, car };
}

function run(world: RAPIER.World, car: VehiclePhysics, seconds: number, input: CarInput | ((t: number) => CarInput), probe?: () => void) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    car.step(DT, typeof input === "function" ? input(i * DT) : input);
    world.step();
    probe?.();
  }
}

/** Cruise at ~90 km/h, then turn left with throttle (optionally flicking the handbrake) and track the slide. */
function corner(handling: Handling, handbrake: boolean) {
  const { world, car } = setup(handling);
  run(world, car, 1, NEUTRAL_INPUT);
  run(world, car, 2.5, { ...NEUTRAL_INPUT, throttle: 0.8 });
  let peak = 0;
  let spun = false;
  run(
    world,
    car,
    4,
    (t) => ({ throttle: 0.9, brake: 0, steer: -0.7 * Math.min(1, t / 0.5), handbrake: handbrake && t < 0.4 }),
    () => {
      peak = Math.max(peak, Math.abs(car.slipAngle()));
      if (car.snapshot().upY < 0.5) spun = true;
    },
  );
  return { peak, spun, speed: car.snapshot().speedKmh };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe("slip angle", () => {
  it("is ~0 when driving straight", () => {
    const { world, car } = setup("grip");
    run(world, car, 1, NEUTRAL_INPUT);
    run(world, car, 4, { ...NEUTRAL_INPUT, throttle: 0.8 });
    expect(Math.abs(car.slipAngle())).toBeLessThan(0.03);
  });
});

describe("drift handling", () => {
  it("slides far more than grip handling in the same corner", () => {
    const grip = corner("grip", false);
    const drift = corner("drift", false);
    expect(drift.peak).toBeGreaterThan(grip.peak + 0.3);
  });

  it("a handbrake flick starts a clear drift in drift handling", () => {
    expect(corner("drift", true).peak).toBeGreaterThan(0.3);
  });

  it("the assist keeps the slide bounded: no spin, no rollover, still moving", () => {
    const r = corner("drift", true);
    expect(r.spun).toBe(false);
    expect(r.peak).toBeLessThan(1.0);
    expect(r.speed).toBeGreaterThan(30);
  });

  it("grip handling is unchanged by the drift tuning", () => {
    expect(corner("grip", false).peak).toBeLessThan(0.25);
  });
});
