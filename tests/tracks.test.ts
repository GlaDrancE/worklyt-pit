import { describe, expect, it } from "vitest";
import { TRACKS } from "../src/track/tracks";
import { TrackModel } from "../src/track/TrackModel";

/** Radius of the circle through three consecutive centre-line samples. */
function minRadius(m: TrackModel): number {
  let min = Infinity;
  const n = m.count;
  for (let i = 0; i < n; i++) {
    const a = m.samples[i]!, b = m.samples[(i + 1) % n]!, c = m.samples[(i + 2) % n]!;
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
    if (area2 < 1e-6) continue;
    min = Math.min(min, (ab * bc * ca) / (2 * area2));
  }
  return min;
}

describe.each(TRACKS.map((t) => [t.id, t] as const))("track %s", (_id, def) => {
  const m = new TrackModel(def);
  // Barrier wall sits halfWidth + kerb + gap + thickness from the centre line.
  const wallOffset = m.halfWidth + 1.4 + 3.2 + 1;

  it("has no corner tighter than its barriers allow (walls would fold over)", () => {
    expect(minRadius(m)).toBeGreaterThan(wallOffset * 1.15);
  });

  it("never runs two stretches of road closer than their barriers", () => {
    let min = Infinity;
    const n = m.count;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const arc = Math.min(j - i, n - (j - i)) * 2;
        if (arc < 60) continue;
        const a = m.samples[i]!, b = m.samples[j]!;
        min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(min).toBeGreaterThan(wallOffset * 2 + 4);
  });

  it("is a sensible length for its lap count", () => {
    if (def.training) {
      // Training grounds are short drills: never more than 2 km a lap.
      expect(m.length).toBeGreaterThan(900);
      expect(m.length).toBeLessThanOrEqual(2000);
    } else {
      expect(m.length).toBeGreaterThan(2000);
      expect(m.length).toBeLessThan(5000);
    }
  });
});
