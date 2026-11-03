import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { TRACKS } from "../src/track/tracks";
import { TrackModel } from "../src/track/TrackModel";
import { buildTrackColliders } from "../src/track/TrackBuilder";
import { RaceManager, type RaceEvent } from "../src/race/RaceManager";
import { NEUTRAL_INPUT, VehiclePhysics, type CarInput } from "../src/vehicle/VehiclePhysics";

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** A simple pure-pursuit driver that follows the centre line and slows for corners. */
function autopilot(model: TrackModel, car: VehiclePhysics, cornerG: number): CarInput {
  const s = car.snapshot();
  const n = model.count;
  const near = model.nearest(s.x, s.z);
  const speed = Math.max(s.forwardSpeed, 0);
  const ahead = Math.round((6 + 0.35 * speed) / 2);
  const t = model.samples[(near.index + ahead) % n]!;
  const err = wrap(Math.atan2(t.x - s.x, t.z - s.z) - s.yaw);
  const steer = Math.max(-1, Math.min(1, -err * 2.2));

  // Allowed speed from the sharpest bend in the next ~60 m.
  let vAllowed = 70;
  for (let k = 4; k <= 30; k += 2) {
    const a = model.samples[(near.index + k) % n]!;
    const b = model.samples[(near.index + k + 6) % n]!;
    const dth = Math.abs(wrap(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
    const kappa = dth / 12 + 1e-6;
    vAllowed = Math.min(vAllowed, Math.sqrt(cornerG / kappa) + 0.35 * k * 0.5);
  }
  const vTarget = Math.max(14, vAllowed);
  const over = speed - vTarget;
  return {
    throttle: over < 0 ? Math.min(1, -over / 4 + 0.3) : 0,
    brake: over > 1 ? Math.min(1, over / 8) : 0,
    steer,
    handbrake: false,
  };
}

function setup(trackIndex: number, laps: number) {
  const def = TRACKS[trackIndex]!;
  const model = new TrackModel(def);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
  const colliders = buildTrackColliders(RAPIER, world, model);
  const car = new VehiclePhysics(world, model.startPose(8));
  const events: RaceEvent[] = [];
  const race = new RaceManager(
    { gates: model.gates, sectorGates: model.sectorGates, totalLaps: laps, bestMs: null },
    (e) => events.push(e),
  );
  return { def, model, world, colliders, car, race, events };
}

describe("full lap with the real track, barriers, physics and race manager", () => {
  for (const idx of [0, 1]) {
    it(`${TRACKS[idx]!.name}: an autopilot completes a valid lap without leaving the barriers`, () => {
      const { model, world, colliders, car, race, events } = setup(idx, 2);
      expect(colliders.length).toBeGreaterThan(100);

      const start = model.startPose(8);
      race.begin(0);
      race.resync(start.x, start.z);

      let simMs = 0;
      let minUp = 1;
      let maxLateral = 0;
      let maxSpeed = 0;
      for (let i = 0; i < 60 * 240 && race.state !== "finished"; i++) {
        const input = race.canDrive ? autopilot(model, car, 17) : { ...NEUTRAL_INPUT, handbrake: true };
        car.step(DT, input);
        world.step();
        simMs += DT * 1000;
        const s = car.snapshot();
        race.update(simMs, s.x, s.z);
        minUp = Math.min(minUp, s.upY);
        maxLateral = Math.max(maxLateral, Math.abs(model.nearest(s.x, s.z).lateral));
        maxSpeed = Math.max(maxSpeed, s.speedKmh);
      }

      const laps = events.filter((e): e is Extract<RaceEvent, { type: "lap" }> => e.type === "lap");
      // eslint-disable-next-line no-console
      console.log(
        `${model.def.name}: ${laps.map((l) => `${(l.result.ms / 1000).toFixed(1)}s${l.result.valid ? "" : "(invalid)"}`).join(", ")} ` +
          `| length ${model.length.toFixed(0)} m | top ${maxSpeed.toFixed(0)} km/h | max offset ${maxLateral.toFixed(1)} m | min up ${minUp.toFixed(2)}`,
      );

      expect(race.state).toBe("finished");
      expect(laps.length).toBe(2);
      expect(laps.every((l) => l.result.valid)).toBe(true);
      expect(laps[0]!.result.ms).toBeGreaterThan(20_000);
      expect(laps[0]!.result.ms).toBeLessThan(150_000);
      expect(minUp).toBeGreaterThan(0.5);
      // Stayed inside the barriers (tarmac + kerb + gap).
      expect(maxLateral).toBeLessThan(model.halfWidth + 1.4 + 3.2);
      // Three sector splits recorded for each lap.
      expect(laps[0]!.result.sectors.every((s) => s !== null)).toBe(true);
    }, 30_000);
  }

  it("cutting across the infield (skipping a stretch of track) gives an invalid lap", () => {
    const { model, world, car, race, events } = setup(0, 1);
    const start = model.startPose(8);
    race.begin(0);
    race.resync(start.x, start.z);

    let simMs = 0;
    let teleported = false;
    for (let i = 0; i < 60 * 240 && race.state !== "finished"; i++) {
      const input = race.canDrive ? autopilot(model, car, 17) : { ...NEUTRAL_INPUT, handbrake: true };
      car.step(DT, input);
      world.step();
      simMs += DT * 1000;
      let s = car.snapshot();
      // Once the lap is under way, jump the car ahead past several gates (a "shortcut").
      if (!teleported && race.lapInProgress && model.nearest(s.x, s.z).index > model.count * 0.12) {
        const idx = Math.round(model.count * 0.5);
        const pose = model.poseAtSample(idx);
        car.reset(pose);
        s = car.snapshot();
        teleported = true;
      }
      race.update(simMs, s.x, s.z);
    }
    const lap = events.find((e): e is Extract<RaceEvent, { type: "lap" }> => e.type === "lap");
    expect(teleported).toBe(true);
    expect(events.some((e) => e.type === "invalid")).toBe(true);
    expect(lap?.result.valid).toBe(false);
  }, 30_000);
});

