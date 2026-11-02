import { describe, expect, it } from "vitest";
import { LampLights, nearestSpots } from "../src/game/LampLights";
import { TrackModel } from "../src/track/TrackModel";
import { TRACKS, getTrack } from "../src/track/tracks";
import { lampPositions } from "../src/track/TrackBuilder";

describe("street lamp lights", () => {
  it("picks the lamps closest to the car, nearest first", () => {
    const spots = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 50, z: 0 }, { x: 5, z: 1 }];
    expect(nearestSpots(spots, 4, 0, 2)).toEqual([{ x: 5, z: 1 }, { x: 0, z: 0 }]);
    expect(nearestSpots(spots, 0, 0, 10)).toHaveLength(4);
  });
  it("creates the requested number of lights and moves them with the car", () => {
    const model = new TrackModel(getTrack("midnight-wet"));
    const spots = lampPositions(model);
    expect(spots.length).toBeGreaterThan(50);
    const l = new LampLights(model, 6, 400);
    expect(l.count).toBe(6);
    const far = model.samples[Math.floor(model.count / 2)]!;
    for (let i = 0; i < 6; i++) l.update(far.x, far.z);
    const lights = l.group.children as unknown as Array<{ position: { x: number; z: number } }>;
    for (const p of lights) expect(Math.hypot(p.position.x - far.x, p.position.z - far.z)).toBeLessThan(120);
  });
});

describe("training grounds", () => {
  const training = TRACKS.filter((t) => t.training);
  it("has a straights, a turns and a corners circuit", () => {
    expect(training.map((t) => t.id).sort()).toEqual(["training-corners", "training-straights", "training-turns"]);
  });
  it("keeps every training lap at 2 km or less", () => {
    for (const t of training) expect(new TrackModel(t).length).toBeLessThanOrEqual(2000);
  });
  it("has a long straight on the straights circuit", () => {
    const m = new TrackModel(getTrack("training-straights"));
    let run = 0, best = 0;
    for (let i = 0; i < m.count; i++) {
      const a = m.samples[i]!, b = m.samples[(i + 1) % m.count]!;
      const straight = Math.abs(a.tx * b.tz - a.tz * b.tx) < 0.004;
      run = straight ? run + 1 : 0;
      best = Math.max(best, run);
    }
    expect((best * m.length) / m.count).toBeGreaterThan(400);
  });
});

import { sanitizeSettings } from "../src/game/settings";

describe("street lights setting", () => {
  it("defaults to on and only accepts true or false", () => {
    expect(sanitizeSettings({}).streetLights).toBe(true);
    expect(sanitizeSettings({ streetLights: false }).streetLights).toBe(false);
    expect(sanitizeSettings({ streetLights: "no" }).streetLights).toBe(true);
  });
});
