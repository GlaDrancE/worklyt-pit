import { describe, expect, it } from "vitest";
import { RaceControl, SC_MIN_S, type RcEvent } from "../src/race/raceControl";
import { carContact } from "../src/race/contact";

const track = { length: 1500, halfWidth: 7 };

function run(rc: RaceControl, seconds: number, leader = 0): RcEvent[] {
  const out: RcEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) out.push(...rc.update(1 / 60, leader + t * 40));
  return out;
}

describe("RaceControl", () => {
  it("a light stop only brings out the yellow flag and the truck", () => {
    const rc = new RaceControl(track);
    const first = rc.report({ id: "a", dist: 700, lateral: 5.5, severity: 0.2 });
    expect(first).toEqual([{ type: "yellow" }]);
    const ev = run(rc, 40);
    expect(ev.some((e) => e.type === "sc-out")).toBe(false);
    expect(ev.some((e) => e.type === "loaded")).toBe(true);
    expect(ev.some((e) => e.type === "truck-gone")).toBe(true);
    expect(rc.flag).toBe("green");
  });
  it("a heavy crash brings out the safety car, holds it, then releases the field", () => {
    const rc = new RaceControl(track);
    rc.report({ id: "a", dist: 400, lateral: -5.5, severity: 0.9 });
    const ev = run(rc, 60);
    const order = ev.map((e) => e.type).filter((t) => ["yellow", "sc-out", "loaded", "sc-in", "green"].includes(t));
    expect(order).toEqual(["sc-out", "loaded", "sc-in", "green"]);
    expect(rc.flag).toBe("green");
    expect(rc.sc.active).toBe(false);
  });
  it("keeps the safety car out for at least the minimum time", () => {
    const rc = new RaceControl(track);
    rc.report({ id: "a", dist: 300, lateral: 5, severity: 1 });
    let scInAt = -1;
    for (let t = 0; t < 80; t += 1 / 60) {
      for (const e of rc.update(1 / 60, t * 40)) if (e.type === "sc-in") scInAt = t;
    }
    expect(scInAt).toBeGreaterThan(SC_MIN_S);
  });
  it("the truck arrives next to the car and queues a second incident", () => {
    const rc = new RaceControl(track);
    rc.report({ id: "a", dist: 700, lateral: 5, severity: 0.2 });
    rc.report({ id: "b", dist: 1000, lateral: -5, severity: 0.2 });
    const ev = run(rc, 80);
    expect(ev.filter((e) => e.type === "loaded").map((e) => (e as { id: string }).id)).toEqual(["a", "b"]);
  });
});

describe("carContact", () => {
  const car = (x: number, z: number, vz = 0) => ({ x, z, yaw: 0, vx: 0, vz });
  it("finds no contact when the cars are apart", () => {
    expect(carContact(car(0, 0), car(0, 10))).toBeNull();
  });
  it("pushes the car behind away and reports the closing speed", () => {
    const c = carContact(car(0, 0, 30), car(0.2, 4.5, 10))!;
    expect(c).not.toBeNull();
    expect(c.nz).toBeLessThan(0); // the rear car is pushed backwards
    expect(c.closing).toBeCloseTo(20, 0);
  });
});

describe("virtual safety car and red flag", () => {
  const T = { length: 2000, halfWidth: 6 };
  it("a medium incident brings the virtual safety car, not the real one", () => {
    const rc = new RaceControl(T);
    const ev = rc.report({ id: "a", dist: 700, lateral: 5, severity: 0.5 });
    expect(rc.flag).toBe("vsc");
    expect(ev.map((e) => e.type)).toEqual(["yellow", "vsc"]);
    expect(rc.vscActive).toBe(true);
    expect(rc.sc.active).toBe(false);
    for (let t = 0; t < 300 && rc.flag === "vsc"; t += 0.1) rc.update(0.1, 800);
    expect(rc.flag).toBe("green");
  });
  it("a heavy incident during the virtual safety car upgrades to the real one", () => {
    const rc = new RaceControl(T);
    rc.report({ id: "a", dist: 700, lateral: 5, severity: 0.5 });
    rc.report({ id: "b", dist: 900, lateral: -5, severity: 0.8 });
    for (let t = 0; t < 5 && rc.flag !== "sc"; t += 0.1) rc.update(0.1, 800);
    expect(rc.flag).toBe("sc");
  });
  it("two bad incidents together stop the race, then it restarts with a countdown", () => {
    const rc = new RaceControl(T);
    rc.report({ id: "a", dist: 700, lateral: 5, severity: 0.8 });
    const ev = rc.report({ id: "b", dist: 1100, lateral: -5, severity: 0.7 });
    expect(rc.flag).toBe("red");
    expect(ev.some((e) => e.type === "red")).toBe(true);
    expect(rc.redActive).toBe(true);
    expect(rc.sc.active).toBe(false);
    let sawRestart = false;
    let sawCount = 0;
    for (let t = 0; t < 400 && rc.flag !== "green"; t += 0.1) {
      rc.update(0.1, 800);
      if (rc.flag === "restart") {
        sawRestart = true;
        sawCount = Math.max(sawCount, rc.restartIn);
      }
    }
    expect(sawRestart).toBe(true);
    expect(sawCount).toBeGreaterThan(2);
    expect(rc.flag).toBe("green");
    expect(rc.openIncidents).toBe(0);
  });
  it("three open incidents also stop the race", () => {
    const rc = new RaceControl(T);
    for (let i = 0; i < 3; i++) rc.report({ id: `r${i}`, dist: 300 * (i + 1), lateral: 4, severity: 0.2 });
    expect(rc.flag).toBe("red");
  });
});
