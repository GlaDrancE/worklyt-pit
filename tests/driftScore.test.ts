import { describe, expect, it } from "vitest";
import { DriftScorer } from "../src/race/drift";

const DT = 1 / 60;
function slide(s: DriftScorer, seconds: number, slip = 0.5, kmh = 100) {
  for (let i = 0; i < seconds * 60; i++) s.update(DT, slip, kmh, false);
}

describe("DriftScorer", () => {
  it("scores nothing while gripping", () => {
    const s = new DriftScorer();
    slide(s, 3, 0.05, 150);
    expect(s.update(DT, 0.05, 150, false).combo).toBe(0);
  });
  it("ignores slides at low speed", () => {
    const s = new DriftScorer();
    slide(s, 3, 0.6, 20);
    expect(s.update(DT, 0.6, 20, false).combo).toBe(0);
  });
  it("builds a combo, then banks it after the grace period", () => {
    const s = new DriftScorer();
    slide(s, 2);
    expect(s.update(DT, 0.5, 100, false).combo).toBeGreaterThan(50);
    expect(s.total).toBe(0);
    slide(s, 1, 0, 100);
    expect(s.total).toBeGreaterThan(50);
    expect(s.consumeEvent()?.kind).toBe("bank");
    expect(s.consumeEvent()).toBeNull();
  });
  it("a brief straightening inside the grace period keeps the combo alive", () => {
    const s = new DriftScorer();
    slide(s, 1.5);
    slide(s, 0.4, 0, 100);
    slide(s, 1.5);
    slide(s, 1, 0, 100);
    expect(s.best).toBeGreaterThan(0);
    expect(s.total).toBe(s.best); // one combo, not two
  });
  it("longer drifts are worth disproportionately more", () => {
    const a = new DriftScorer();
    slide(a, 2);
    slide(a, 1, 0, 100);
    const b = new DriftScorer();
    slide(b, 6);
    slide(b, 1, 0, 100);
    expect(b.total).toBeGreaterThan(a.total * 3.5);
  });
  it("a crash loses the combo", () => {
    const s = new DriftScorer();
    slide(s, 3);
    s.update(DT, 0.5, 100, true);
    expect(s.total).toBe(0);
    expect(s.consumeEvent()?.kind).toBe("lost");
  });
  it("finish banks a running combo and reset clears everything", () => {
    const s = new DriftScorer();
    slide(s, 2);
    s.finish();
    expect(s.total).toBeGreaterThan(0);
    s.reset();
    expect(s.total).toBe(0);
    expect(s.best).toBe(0);
  });
});
