import { describe, expect, it } from "vitest";
import { TrackModel } from "../src/track/TrackModel";
import { TRACKS, getTrack } from "../src/track/tracks";
import { NO_CONTEXT, RivalField, speedProfile, paceFor, rankField } from "../src/race/Rivals";
import { WORKLYFT } from "../src/race/companies";

function lapTime(trackIdx: number, difficulty: "easy" | "medium" | "hard"): number {
  const model = new TrackModel(TRACKS[trackIdx]!);
  const field = new RivalField(model, 1, difficulty, 1, 5);
  let ms = 0;
  while (field.rivals[0]!.finishedAt === null && ms < 600_000) {
    field.step(1 / 60, true, ms);
    ms += 1000 / 60;
  }
  return field.rivals[0]!.finishedAt ?? Infinity;
}

describe("rival cars", () => {
  it("speed profile stays within physical limits and is smooth", () => {
    for (const def of TRACKS) {
      const model = new TrackModel(def);
      const v = speedProfile(model, 0.9);
      for (let i = 0; i < v.length; i++) {
        expect(Number.isFinite(v[i]!)).toBe(true);
        expect(v[i]!).toBeGreaterThan(8);
        expect(v[i]!).toBeLessThanOrEqual(92);
        const ds = model.length / model.count;
        const next = v[(i + 1) % v.length]!;
        // Braking never asks for more than ~3 g.
        expect((v[i]! ** 2 - next ** 2) / (2 * ds)).toBeLessThan(31);
      }
    }
  });

  it("finishes a one-lap race in a believable time, and harder is faster", () => {
    for (let t = 0; t < TRACKS.length; t++) {
      const easy = lapTime(t, "easy");
      const medium = lapTime(t, "medium");
      const hard = lapTime(t, "hard");
      expect(hard).toBeLessThan(medium);
      expect(medium).toBeLessThan(easy);
      expect(hard).toBeGreaterThan(18_000);
      expect(easy).toBeLessThan(200_000);
    }
  });

  it("does not move before the lights go out, and the grid has no overlapping cars", () => {
    const model = new TrackModel(TRACKS[0]!);
    const field = new RivalField(model, 5, "medium", 3, 9);
    const before = field.rivals.map((r) => [r.x, r.z]);
    for (let i = 0; i < 120; i++) field.step(1 / 60, false, 0);
    expect(field.rivals.map((r) => [r.x, r.z])).toEqual(before);
    for (let i = 0; i < field.rivals.length; i++)
      for (let j = i + 1; j < field.rivals.length; j++)
        expect(Math.hypot(field.rivals[i]!.x - field.rivals[j]!.x, field.rivals[i]!.z - field.rivals[j]!.z)).toBeGreaterThan(5);
    expect(new Set(field.rivals.map((r) => r.name)).size).toBe(5);
  });

  it("puts the Worklyft car first and keeps the player's company out of the rival roster", () => {
    const model = new TrackModel(TRACKS[0]!);
    const field = new RivalField(model, 5, "medium", 3, 10, null, [], "Google");
    const names = field.rivals.map((r) => r.name);
    expect(names[0]).toBe(WORKLYFT);
    expect(names).not.toContain("Google");
    expect(new Set(names).size).toBe(names.length);
  });

  it("is deterministic for a seed", () => {
    const model = new TrackModel(TRACKS[1]!);
    const run = () => {
      const f = new RivalField(model, 3, "hard", 2, 42);
      for (let i = 0; i < 600; i++) f.step(1 / 60, true, i * 16.7);
      return f.rivals.map((r) => [r.name, Math.round(r.dist)]);
    };
    expect(run()).toEqual(run());
    expect(paceFor("hard")).toBeGreaterThan(paceFor("easy"));
  });
});

describe("race classification", () => {
  it("ranks finishers by time, then the rest by distance left, and awards points", () => {
    const mk = (id: string, dist: number, finishedAt: number | null, kmh = 150) => ({ id, name: id, x: 0, z: 0, yaw: 0, speedKmh: kmh, steer: 0, dist, finishedAt });
    const res = rankField({ id: "me", name: "Me", ms: 60_000 }, [mk("a", 3000, 55_000), mk("b", 2900, null), mk("c", 2000, null, 100), mk("d", 3000, 70_000)], 3000, 0);
    expect(res.map((r) => r.id)).toEqual(["a", "me", "b", "d", "c"].sort((x, y) => res.findIndex((r) => r.id === x) - res.findIndex((r) => r.id === y)));
    expect(res[0]!.id).toBe("a");
    expect(res[1]!.id).toBe("me");
    expect(res.map((r) => r.points)).toEqual([25, 18, 15, 12, 10]);
    expect(res.every((r, i) => r.place === i + 1)).toBe(true);
    expect(res.at(-1)!.id).toBe("c");
  });
});

describe("rivals and damage", () => {
  const model = new TrackModel(getTrack("apex-park"));
  const ctx = { ...NO_CONTEXT, damageOn: true };
  const drive = (f: RivalField, seconds: number, c = ctx) => {
    let ms = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      f.step(1 / 60, true, ms, c);
      ms += 1000 / 60;
    }
  };
  it("steers round a slow car in its way instead of driving through it", () => {
    const f = new RivalField(model, 1, "hard", 3, 4);
    drive(f, 12);
    const r = f.rivals[0]!;
    // park a blocker ahead on its line, slow (far enough that a fast car has room to react)
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    const blocker = { x: r.x + fx * 45, z: r.z + fz * 45, speed: 10 };
    let minGap = Infinity;
    for (let i = 0; i < 240; i++) {
      f.step(1 / 60, true, 0, { ...ctx, blockers: [blocker] });
      minGap = Math.min(minGap, Math.hypot(blocker.x - r.x, blocker.z - r.z));
      blocker.x += fx * 10 / 60;
      blocker.z += fz * 10 / 60;
    }
    expect(minGap).toBeGreaterThan(1.9);
  });
  it("a crashed rival stops at the track edge and reports an incident once", () => {
    const f = new RivalField(model, 2, "medium", 3, 5);
    drive(f, 10);
    f.crash("rival1", 50);
    drive(f, 8);
    const r = f.rivals[0]!;
    expect(r.status).toBe("stopped");
    expect(r.speedKmh).toBeLessThan(2);
    expect(f.incidents).toHaveLength(1);
    expect(Math.abs(f.incidents[0]!.lateral)).toBeGreaterThan(model.halfWidth - 2);
    f.remove("rival1");
    drive(f, 1);
    expect(r.status).toBe("gone");
  });
  it("a touched rival is shoved sideways", () => {
    const f = new RivalField(model, 1, "medium", 3, 6);
    drive(f, 10);
    const r = f.rivals[0]!;
    const before = Math.hypot(r.x, r.z);
    const fz = Math.cos(r.yaw), fx = Math.sin(r.yaw);
    expect(f.contact("rival1", -fz, fx, 10, 5000)).toBe(true);
    expect(f.contact("rival1", -fz, fx, 10, 5100)).toBe(false); // cooldown
    f.step(1 / 60, true, 5200, ctx);
    expect(Math.hypot(r.x, r.z)).not.toBe(before);
  });
  it("a badly damaged rival pits, is repaired and carries on", () => {
    const L = model.length;
    const pit = { dist: 100, lateral: model.halfWidth - 2.7 };
    const f = new RivalField(model, 1, "medium", 6, 7, pit);
    drive(f, 5);
    const r = f.rivals[0]!;
    for (let i = 0; i < 4; i++) r.damage.hit(26, 0.3, 1, "wall");
    expect(r.damage.integrity()).toBeLessThan(0.6);
    let serviced = false;
    let ms = 0;
    for (let t = 0; t < L / 25 * 2 + 40 && !serviced; t += 1 / 60) {
      f.step(1 / 60, true, ms, ctx);
      ms += 1000 / 60;
      if (r.status === "servicing") serviced = true;
    }
    expect(serviced).toBe(true);
    drive(f, 25);
    expect(r.status).toBe("racing");
    expect(r.damage.integrity()).toBe(1);
    expect(f.pitStops).toBe(1);
  });
});

describe("rivals under a red flag", () => {
  it("stop when the cap is zero, stay put, then drive off again", () => {
    const model = new TrackModel(TRACKS[0]!);
    const field = new RivalField(model, 3, "medium", 3, 7);
    let ms = 0;
    const run = (secs: number, cap: number | null) => {
      for (let i = 0; i < secs * 60; i++) {
        field.step(1 / 60, true, ms, { ...NO_CONTEXT, cap });
        ms += 1000 / 60;
      }
    };
    run(20, null);
    expect(field.rivals.every((r) => r.speedKmh > 40)).toBe(true);
    run(12, 0);
    for (const r of field.rivals) {
      expect(Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.dist)).toBe(true);
      expect(r.speedKmh).toBeLessThan(2);
    }
    const stopped = field.rivals.map((r) => r.dist);
    run(3, 0);
    field.rivals.forEach((r, i) => expect(Math.abs(r.dist - stopped[i]!)).toBeLessThan(0.5));
    run(8, null);
    expect(field.rivals.every((r) => r.speedKmh > 30)).toBe(true);
  });
});
