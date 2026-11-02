import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, VehiclePhysics, type CarInput } from "../src/vehicle/VehiclePhysics";

const DT = 1 / 60;

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000).setTranslation(0, -0.5, 0));
  const car = new VehiclePhysics(world, { x: 0, z: 0, yaw: 0 });
  return { world, car };
}

function run(world: RAPIER.World, car: VehiclePhysics, seconds: number, input: CarInput | ((t: number) => CarInput)) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    car.step(DT, typeof input === "function" ? input(i * DT) : input);
    world.step();
  }
}

beforeAll(async () => {
  await RAPIER.init();
});

describe("VehiclePhysics (headless)", () => {
  it("settles on its suspension without bouncing away", () => {
    const { world, car } = makeWorld();
    run(world, car, 3, NEUTRAL_INPUT);
    const s = car.snapshot();
    expect(s.y).toBeGreaterThan(0.5);
    expect(s.y).toBeLessThan(1.0);
    expect(s.speedKmh).toBeLessThan(2);
    expect(s.upY).toBeGreaterThan(0.99);
  });

  it("accelerates along +Z (its own forward) with full throttle", () => {
    const { world, car } = makeWorld();
    run(world, car, 2, NEUTRAL_INPUT);
    run(world, car, 6, { ...NEUTRAL_INPUT, throttle: 1 });
    const s = car.snapshot();
    expect(s.z).toBeGreaterThan(40);
    expect(s.speedKmh).toBeGreaterThan(80);
    expect(Math.abs(s.x)).toBeLessThan(2);
  });

  it("tops out at a believable single-seater speed", () => {
    const { world, car } = makeWorld();
    run(world, car, 1, NEUTRAL_INPUT);
    run(world, car, 40, { ...NEUTRAL_INPUT, throttle: 1 });
    const s = car.snapshot();
    expect(s.speedKmh).toBeLessThan(370);
    expect(s.speedKmh).toBeGreaterThan(280);
  });

  it("steering right turns the car towards -X (the driver's right when facing +Z)", () => {
    const { world, car } = makeWorld();
    run(world, car, 1, NEUTRAL_INPUT);
    run(world, car, 4, { ...NEUTRAL_INPUT, throttle: 0.6 });
    const before = car.snapshot();
    run(world, car, 2, { ...NEUTRAL_INPUT, throttle: 0.4, steer: 1 });
    const after = car.snapshot();
    expect(after.x).toBeLessThan(before.x - 1);
    expect(after.upY).toBeGreaterThan(0.9);
  });

  it("steering left turns the car towards +X", () => {
    const { world, car } = makeWorld();
    run(world, car, 1, NEUTRAL_INPUT);
    run(world, car, 4, { ...NEUTRAL_INPUT, throttle: 0.6 });
    const before = car.snapshot();
    run(world, car, 2, { ...NEUTRAL_INPUT, throttle: 0.4, steer: -1 });
    expect(car.snapshot().x).toBeGreaterThan(before.x + 1);
  });

  it("brakes to a stop and then reverses", () => {
    const { world, car } = makeWorld();
    run(world, car, 1, NEUTRAL_INPUT);
    run(world, car, 5, { ...NEUTRAL_INPUT, throttle: 1 });
    const fast = car.snapshot().speedKmh;
    run(world, car, 4, { ...NEUTRAL_INPUT, brake: 1 });
    const slow = car.snapshot();
    expect(slow.speedKmh).toBeLessThan(fast * 0.5);
    run(world, car, 6, { ...NEUTRAL_INPUT, brake: 1 });
    expect(car.snapshot().forwardSpeed).toBeLessThan(0);
  });

  it("handbrake lets the rear slide (higher yaw rate than normal steering)", () => {
    const a = makeWorld();
    const b = makeWorld();
    for (const w of [a, b]) run(w.world, w.car, 1, NEUTRAL_INPUT);
    for (const w of [a, b]) run(w.world, w.car, 5, { ...NEUTRAL_INPUT, throttle: 1 });
    run(a.world, a.car, 1.5, { ...NEUTRAL_INPUT, steer: 1 });
    run(b.world, b.car, 1.5, { ...NEUTRAL_INPUT, steer: 1, handbrake: true });
    expect(Math.abs(b.car.snapshot().yaw)).toBeGreaterThan(Math.abs(a.car.snapshot().yaw));
  });

  it("reset() clears velocity and moves the car", () => {
    const { world, car } = makeWorld();
    run(world, car, 3, { ...NEUTRAL_INPUT, throttle: 1 });
    car.reset({ x: 100, z: -50, yaw: Math.PI / 2 });
    const s = car.snapshot();
    expect(s.x).toBeCloseTo(100);
    expect(s.z).toBeCloseTo(-50);
    expect(s.speedKmh).toBeLessThan(0.5);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 2);
  });
});
