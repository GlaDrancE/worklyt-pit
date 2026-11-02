import { describe, expect, it } from "vitest";
import { CarDamage, MIN_HIT_SPEED } from "../src/vehicle/damage";

describe("CarDamage", () => {
  it("ignores scrapes below the minimum speed", () => {
    const d = new CarDamage();
    expect(d.hit(MIN_HIT_SPEED - 0.1, 0, 1).zones).toHaveLength(0);
    expect(d.integrity()).toBe(1);
    expect(d.repairSeconds()).toBe(0);
  });
  it("front hits wreck the front wing first", () => {
    const d = new CarDamage();
    const r = d.hit(15, 0.2, 1);
    expect(r.zones[0]!.zone).toBe("frontWing");
    expect(d.health.frontWing).toBeLessThan(0.7);
    expect(d.health.rearWing).toBe(1);
  });
  it("a hard wall hit is worse than a car hit at the same speed", () => {
    const a = new CarDamage();
    const b = new CarDamage();
    a.hit(20, 0, 1, "wall");
    b.hit(20, 0, 1, "car");
    expect(a.integrity()).toBeLessThan(b.integrity());
  });
  it("side hits damage the side that was hit", () => {
    const d = new CarDamage();
    d.hit(14, 1, 0);
    expect(d.health.left).toBeLessThan(1);
    expect(d.health.right).toBe(1);
  });
  it("damage costs performance and a bad left wheel pulls left", () => {
    const d = new CarDamage();
    for (let i = 0; i < 3; i++) d.hit(16, 0.9, 0.7);
    const e = d.effects();
    expect(e.power).toBeLessThan(1);
    expect(e.downforce).toBeLessThan(1);
    expect(e.steerBias).toBeLessThan(0);
  });
  it("reports lost parts once and can be immobilised", () => {
    const d = new CarDamage();
    let lostFront = 0;
    for (let i = 0; i < 6; i++) lostFront += d.hit(30, 0, 1).lost.filter((z) => z === "frontWing").length;
    expect(lostFront).toBe(1);
    for (let i = 0; i < 8; i++) d.hit(30, 0, -1);
    expect(d.isImmobilised()).toBe(true);
    expect(d.effects().power).toBe(0);
  });
  it("repair time grows with damage and repair restores everything", () => {
    const d = new CarDamage();
    d.hit(12, 0, 1);
    const small = d.repairSeconds();
    d.hit(25, 0, 1);
    expect(d.repairSeconds()).toBeGreaterThan(small);
    expect(d.repairSeconds()).toBeLessThanOrEqual(25);
    expect(d.repairAll().length).toBeGreaterThan(0);
    expect(d.integrity()).toBe(1);
    expect(d.repairSeconds()).toBe(0);
  });
});

import { PitStop, pitBoxFor } from "../src/race/pit";
import { TrackModel } from "../src/track/TrackModel";
import { getTrack } from "../src/track/tracks";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/game/settings";

describe("pit repairs and settings", () => {
  it("a pit stop takes as long as the repair needs", () => {
    const box = pitBoxFor(new TrackModel(getTrack("apex-park")));
    const stop = new PitStop(box);
    let doneAt = -1;
    for (let t = 0; t < 20; t += 1 / 60) if (stop.update(1 / 60, box.x, box.z, 0, 9).done && doneAt < 0) doneAt = t;
    expect(doneAt).toBeGreaterThan(8.9);
    expect(doneAt).toBeLessThan(9.2);
  });
  it("the damage setting defaults to realistic and rejects junk", () => {
    expect(DEFAULT_SETTINGS.damage).toBe("realistic");
    expect(sanitizeSettings({ damage: "nonsense" }).damage).toBe("realistic");
    expect(sanitizeSettings({ damage: "off" }).damage).toBe("off");
    expect(sanitizeSettings({ damage: "visual" }).damage).toBe("visual");
  });
});
