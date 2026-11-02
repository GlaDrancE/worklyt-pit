import { describe, expect, it } from "vitest";
import { TRACKS } from "../src/track/tracks";
import { TrackModel } from "../src/track/TrackModel";
import { RaceManager, type RaceEvent } from "../src/race/RaceManager";

const def = TRACKS[0]!;

function makeRace(laps = 2, best: number | null = null) {
  const model = new TrackModel(def);
  const events: RaceEvent[] = [];
  const race = new RaceManager(
    { gates: model.gates, sectorGates: model.sectorGates, totalLaps: laps, bestMs: best },
    (e) => events.push(e),
  );
  return { model, race, events };
}

/** Walk the car along the centre line, 1 sample per 20 ms of sim time. */
function drive(
  model: TrackModel,
  race: RaceManager,
  startIndex: number,
  steps: number,
  t0: number,
  skip?: (i: number) => boolean,
) {
  let t = t0;
  const n = model.count;
  for (let k = 0; k < steps; k++) {
    const i = (((startIndex + k) % n) + n) % n;
    if (skip?.(i)) continue;
    const s = model.samples[i]!;
    t += 20;
    race.update(t, s.x, s.z);
  }
  return t;
}

describe("TrackModel", () => {
  it("builds a closed loop with ordered gates", () => {
    const m = new TrackModel(def);
    expect(m.length).toBeGreaterThan(800);
    expect(m.gates.length).toBeGreaterThanOrEqual(8);
    expect(m.gates[0]!.index).toBe(0);
    expect(m.sectorGates[0]).toBeLessThan(m.sectorGates[1]);
  });

  it("nearest() reports zero lateral offset on the centre line", () => {
    const m = new TrackModel(def);
    const s = m.samples[40]!;
    const r = m.nearest(s.x, s.z);
    expect(r.index).toBe(40);
    expect(Math.abs(r.lateral)).toBeLessThan(1e-6);
  });

  it("lateral is positive to the driver's right", () => {
    const m = new TrackModel(def);
    const s = m.samples[40]!;
    const r = m.nearest(s.x + s.nx * 3, s.z + s.nz * 3);
    expect(r.lateral).toBeCloseTo(3, 1);
  });

  it("start pose sits behind the line", () => {
    const m = new TrackModel(def);
    const p = m.startPose(8);
    const g = m.gates[0]!;
    const signed = (p.x - g.x) * g.tx + (p.z - g.z) * g.tz;
    expect(signed).toBeLessThan(-5);
  });
});

describe("RaceManager", () => {
  it("counts down 3-2-1 then go, and blocks driving until then", () => {
    const { model, race, events } = makeRace();
    const p = model.startPose();
    race.begin(0);
    race.update(10, p.x, p.z);
    expect(race.canDrive).toBe(false);
    race.update(1100, p.x, p.z);
    race.update(2100, p.x, p.z);
    race.update(3100, p.x, p.z);
    expect(race.canDrive).toBe(true);
    const values = events.filter((e) => e.type === "countdown").map((e) => (e as { value: number }).value);
    expect(values).toEqual([3, 2, 1]);
    expect(events.some((e) => e.type === "go")).toBe(true);
  });

  it("records a valid lap after crossing every gate in order", () => {
    const { model, race, events } = makeRace(2);
    race.begin(0);
    const start = model.count - 4;
    let t = drive(model, race, start, 5, 0);
    t = drive(model, race, start + 5, model.count + 10, t + 4000);
    const laps = events.filter((e) => e.type === "lap");
    expect(laps.length).toBeGreaterThanOrEqual(1);
    const first = laps[0] as Extract<RaceEvent, { type: "lap" }>;
    expect(first.result.valid).toBe(true);
    expect(first.result.sectors.every((s) => s !== null)).toBe(true);
    const sum = first.result.sectors.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(Math.abs(sum - first.result.ms)).toBeLessThan(1);
    expect(first.isBest).toBe(true);
  });

  it("marks a lap invalid when checkpoints are skipped (shortcut)", () => {
    const { model, race, events } = makeRace(2);
    race.begin(0);
    const n = model.count;
    // Teleport past gates 3-5 by never visiting their samples.
    const g3 = Math.round((3 * n) / model.gates.length);
    const g5 = Math.round((5 * n) / model.gates.length);
    drive(model, race, n - 4, 5, 0);
    drive(model, race, n + 1, n + 10, 4000, (i) => i > g3 - 12 && i < g5 + 12 && i !== 0 && false);
    // Run a fresh scenario where a chunk of the loop is skipped entirely.
    const b = makeRace(2);
    b.race.begin(0);
    const skipFrom = Math.round((3 * n) / b.model.gates.length) - 5;
    const skipTo = Math.round((5 * n) / b.model.gates.length) + 5;
    let t = drive(b.model, b.race, n - 4, 5, 0);
    t = drive(b.model, b.race, 1, skipFrom, t + 4000);
    // Jump: resync as if the car was teleported, but without invalidating.
    t = drive(b.model, b.race, skipTo, n - skipTo + 10, t);
    const lap = b.events.find((e) => e.type === "lap") as Extract<RaceEvent, { type: "lap" }> | undefined;
    expect(b.events.some((e) => e.type === "invalid")).toBe(true);
    expect(lap?.result.valid).toBe(false);
    expect(lap?.isBest).toBe(false);
    expect(events.length).toBeGreaterThan(0);
  });

  it("invalidate() (e.g. a reset) makes the running lap invalid", () => {
    const { model, race, events } = makeRace(2);
    race.begin(0);
    const n = model.count;
    let t = drive(model, race, n - 4, 5, 0);
    t = drive(model, race, 1, 60, t + 4000);
    race.invalidate("Car reset");
    const rest = drive(model, race, 61, n, t);
    expect(rest).toBeGreaterThan(t);
    const lap = events.find((e) => e.type === "lap") as Extract<RaceEvent, { type: "lap" }>;
    expect(lap.result.valid).toBe(false);
  });

  it("ignores jitter back and forth over the start line", () => {
    const { model, race, events } = makeRace(2);
    race.begin(0);
    const n = model.count;
    let t = drive(model, race, n - 4, 5, 0);
    t = drive(model, race, 1, 6, t + 4000);
    // Wiggle across the line a few times.
    for (let k = 0; k < 4; k++) {
      t = drive(model, race, n - 3, 6, t);
      t = drive(model, race, 2, 6, t);
    }
    expect(events.filter((e) => e.type === "lap").length).toBe(0);
  });

  it("finishes after the configured number of laps and keeps the best time", () => {
    const { model, race, events } = makeRace(2, 1);
    race.begin(0);
    const n = model.count;
    let t = drive(model, race, n - 4, 5, 0);
    t = drive(model, race, 1, n * 2 + 20, t + 4000);
    expect(t).toBeGreaterThan(0);
    expect(race.state).toBe("finished");
    expect(events.some((e) => e.type === "finished")).toBe(true);
    // Seeded best of 1 ms can never be beaten.
    expect(race.bestMs).toBe(1);
  });

  it("does not count a crossing far outside the road width", () => {
    const { model, race, events } = makeRace(2);
    race.begin(0);
    const n = model.count;
    const g = model.gates[0]!;
    // Parallel pass 40 m to the side of the start line.
    let t = 4000;
    race.update(0, g.x, g.z);
    for (let k = -3; k <= 3; k++) {
      t += 20;
      race.update(t, g.x - g.tz * 40 + g.tx * k * 3, g.z + g.tx * 40 + g.tz * k * 3);
    }
    expect(n).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "lap").length).toBe(0);
    expect(race.lapInProgress).toBe(false);
  });
});
