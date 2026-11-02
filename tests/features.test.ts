import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings, shapeStick } from "../src/game/settings";
import { DEFAULT_CONDITIONS, conditionsKey, resolveConditions, roadGrip } from "../src/game/conditions";
import { TyreModel } from "../src/race/tyres";
import { PIT_SECONDS, PitStop, insideBox, pitBoxFor } from "../src/race/pit";
import { ACHIEVEMENTS, evaluate, type RaceStats } from "../src/race/achievements";
import { TRACKS } from "../src/track/tracks";
import { TrackModel } from "../src/track/TrackModel";

describe("settings", () => {
  it("falls back to defaults for junk and clamps out-of-range values", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ steerSpeed: 99, volume: -4, assist: "banana", deadzone: 5, compound: "soft" });
    expect(s.steerSpeed).toBe(1.6);
    expect(s.volume).toBe(0);
    expect(s.assist).toBe("off");
    expect(s.deadzone).toBe(0.3);
    expect(s.compound).toBe("soft");
  });
  it("stick: dead zone swallows drift, full deflection stays full, curve softens the middle", () => {
    expect(shapeStick(0.1, 0.12, 1.4)).toBe(0);
    expect(shapeStick(1, 0.12, 1.4)).toBeCloseTo(1);
    expect(shapeStick(-1, 0.12, 1.4)).toBeCloseTo(-1);
    expect(Math.abs(shapeStick(0.5, 0.12, 1.4))).toBeLessThan(0.5);
  });
});

describe("conditions", () => {
  it("'track' picks the circuit's own conditions; explicit choices win", () => {
    const night = { time: "night", weather: "rain" } as const;
    expect(resolveConditions("track", "track", night)).toEqual(night);
    expect(resolveConditions("day", "clear", night)).toEqual(DEFAULT_CONDITIONS);
    expect(resolveConditions("night", "track", undefined)).toEqual({ time: "night", weather: "clear" });
  });
  it("wet laps are stored separately and grip is lower in rain", () => {
    expect(conditionsKey(DEFAULT_CONDITIONS)).toBe("");
    expect(conditionsKey({ time: "night", weather: "rain" })).toBe("@night-rain");
    expect(roadGrip({ time: "day", weather: "rain" })).toBeLessThan(roadGrip(DEFAULT_CONDITIONS));
  });
});

describe("tyres", () => {
  const drive = { speedKmh: 180, slip: 0.03, brake: 0.2, throttle: 0.8, wet: false };
  it("wear builds with driving and takes grip, and never goes past 100%", () => {
    const t = new TyreModel("medium");
    const fresh = t.grip();
    for (let i = 0; i < 60 * 60; i++) t.update(1 / 60, drive);
    expect(t.wear).toBeGreaterThan(0.1);
    expect(t.grip()).toBeLessThan(fresh);
    for (let i = 0; i < 60 * 600; i++) t.update(1 / 60, drive);
    expect(t.wear).toBe(1);
    expect(t.grip()).toBeGreaterThan(0.6);
  });
  it("soft wears faster than hard, sliding wears faster than gripping, standing still doesn't wear", () => {
    const wearAfter = (c: "soft" | "hard", slip: number, speed: number) => {
      const t = new TyreModel(c);
      for (let i = 0; i < 3600; i++) t.update(1 / 60, { ...drive, slip, speedKmh: speed });
      return t.wear;
    };
    expect(wearAfter("soft", 0.03, 180)).toBeGreaterThan(wearAfter("hard", 0.03, 180));
    expect(wearAfter("hard", 0.5, 180)).toBeGreaterThan(wearAfter("hard", 0.03, 180) * 1.5);
    expect(wearAfter("hard", 0.5, 0)).toBe(0);
  });
  it("a medium set lasts roughly a few laps at race pace", () => {
    const t = new TyreModel("medium");
    for (let i = 0; i < 60 * 210; i++) t.update(1 / 60, drive); // ~3 laps
    expect(t.wear).toBeGreaterThan(0.4);
    expect(t.wear).toBeLessThan(0.95);
  });
  it("fitting new tyres resets wear and can change compound", () => {
    const t = new TyreModel("medium");
    t.wear = 0.8;
    t.fit("soft");
    expect(t.wear).toBe(0);
    expect(t.compound.id).toBe("soft");
  });
});

describe.each(TRACKS.map((d) => [d.id, d] as const))("pit box on %s", (_id, def) => {
  const m = new TrackModel(def);
  const box = pitBoxFor(m);
  it("sits on the tarmac, inside the kerbs, on the main straight", () => {
    const n = m.nearest(box.x, box.z);
    expect(Math.abs(n.lateral) + box.halfWidth).toBeLessThanOrEqual(m.halfWidth);
    expect(n.lateral).toBeGreaterThan(0); // driver's right
    expect(insideBox(box, box.x, box.z)).toBe(true);
  });
  it("completes only when the car stands still inside the box for the full time", () => {
    const stop = new PitStop(box);
    let done = false;
    for (let t = 0; t < PIT_SECONDS + 0.5; t += 1 / 60) done = stop.update(1 / 60, box.x, box.z, 0).done || done;
    expect(done).toBe(true);
    const moving = new PitStop(box);
    for (let t = 0; t < PIT_SECONDS * 2; t += 1 / 60) expect(moving.update(1 / 60, box.x, box.z, 30).done).toBe(false);
    const outside = new PitStop(box);
    for (let t = 0; t < PIT_SECONDS * 2; t += 1 / 60) expect(outside.update(1 / 60, box.x + 40, box.z, 0).done).toBe(false);
  });
  it("does not fit tyres again while the car just sits in the box", () => {
    const stop = new PitStop(box);
    let count = 0;
    for (let t = 0; t < PIT_SECONDS * 4; t += 1 / 60) if (stop.update(1 / 60, box.x, box.z, 0).done) count++;
    expect(count).toBe(1);
    stop.update(1 / 60, box.x + 40, box.z, 0); // leave
    for (let t = 0; t < PIT_SECONDS + 0.5; t += 1 / 60) if (stop.update(1 / 60, box.x, box.z, 0).done) count++;
    expect(count).toBe(2);
  });
  it("creeping out part-way resets the timer", () => {
    const stop = new PitStop(box);
    for (let t = 0; t < PIT_SECONDS * 0.8; t += 1 / 60) stop.update(1 / 60, box.x, box.z, 0);
    stop.update(1 / 60, box.x, box.z, 20);
    expect(stop.update(1 / 60, box.x, box.z, 0).progress).toBeLessThan(0.1);
  });
});

describe("achievements", () => {
  const base: RaceStats = {
    trackId: "apex-park", completed: false, versus: false, collisions: 3, topSpeedKmh: 250, driftTotal: 0, driftBest: 0,
    pitStops: 0, tyreWearOn: false, finalTyreWear: 0, validLaps: 0, position: null, fieldSize: 1,
    conditions: DEFAULT_CONDITIONS, racesBefore: 0,
  };
  const ids = (s: RaceStats, have: string[] = []) => evaluate(s, new Set(have)).map((a) => a.id);

  it("ids are unique", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it("only awards what was earned, and never twice", () => {
    expect(ids(base)).toEqual([]);
    expect(ids({ ...base, completed: true })).toEqual(["first-finish"]);
    expect(ids({ ...base, completed: true }, ["first-finish"])).toEqual([]);
  });
  it("live achievements fire mid-race", () => {
    expect(ids({ ...base, topSpeedKmh: 301, driftBest: 650 })).toEqual(expect.arrayContaining(["speed-300", "drifter"]));
  });
  it("conditions, pit and tyre badges", () => {
    const wetNight = { ...base, completed: true, conditions: { time: "night", weather: "rain" } as const };
    expect(ids(wetNight)).toEqual(expect.arrayContaining(["night-owl", "rain-master"]));
    expect(ids({ ...base, completed: true, pitStops: 1 })).toContain("box-box");
    expect(ids({ ...base, completed: true, tyreWearOn: true, finalTyreWear: 0.5 })).toContain("tyre-whisperer");
    expect(ids({ ...base, completed: true, tyreWearOn: true, pitStops: 1, finalTyreWear: 0.2 })).not.toContain("tyre-whisperer");
  });
  it("podium and win need real rivals", () => {
    expect(ids({ ...base, completed: true, position: 1, fieldSize: 1 })).not.toContain("winner");
    expect(ids({ ...base, completed: true, position: 1, fieldSize: 4 })).toEqual(expect.arrayContaining(["winner", "podium"]));
    expect(ids({ ...base, completed: true, versus: true, position: 1, fieldSize: 2 })).not.toContain("winner");
  });
});
