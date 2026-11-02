import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROLS, deviceLayout, gearFor, resolveLayout, sanitizeControls, stageSize, tiltToSteer } from "../src/ui/orientation";

describe("layout resolution", () => {
  it("auto follows the device", () => {
    expect(resolveLayout("auto", 390, 844, true)).toEqual({ layout: "portrait", rotate: false });
    expect(resolveLayout("auto", 844, 390, true)).toEqual({ layout: "landscape", rotate: false });
    expect(deviceLayout(500, 500)).toBe("portrait");
  });
  it("a forced layout matching the device needs no rotation", () => {
    expect(resolveLayout("landscape", 844, 390, true)).toEqual({ layout: "landscape", rotate: false });
  });
  it("a forced layout against the device rotates on touch devices only", () => {
    expect(resolveLayout("landscape", 390, 844, true)).toEqual({ layout: "landscape", rotate: true });
    expect(resolveLayout("portrait", 844, 390, true)).toEqual({ layout: "portrait", rotate: true });
    expect(resolveLayout("landscape", 390, 844, false)).toEqual({ layout: "landscape", rotate: false });
  });
  it("the stage swaps its size when rotated", () => {
    expect(stageSize(390, 844, true)).toEqual({ w: 844, h: 390 });
    expect(stageSize(390, 844, false)).toEqual({ w: 390, h: 844 });
  });
});

describe("control preferences", () => {
  it("keeps good values and fixes junk", () => {
    expect(sanitizeControls({ scale: 1.2, opacity: 0.5, raise: 30 }, DEFAULT_CONTROLS.portrait)).toEqual({ scale: 1.2, opacity: 0.5, raise: 30 });
    expect(sanitizeControls({ scale: 9, opacity: -1, raise: "x" }, DEFAULT_CONTROLS.landscape)).toEqual({ scale: 1.5, opacity: 0.3, raise: 0 });
    expect(sanitizeControls(null, DEFAULT_CONTROLS.landscape)).toEqual(DEFAULT_CONTROLS.landscape);
  });
});

describe("gear and rpm", () => {
  it("is neutral when stopped, climbs through the gears, and rpm drops on each shift", () => {
    expect(gearFor(0).gear).toBe(0);
    let last = 0;
    let drops = 0;
    let prevRpm = 0;
    for (let v = 5; v <= 340; v += 1) {
      const g = gearFor(v);
      expect(g.gear).toBeGreaterThanOrEqual(last);
      expect(g.rpm).toBeGreaterThanOrEqual(0);
      expect(g.rpm).toBeLessThanOrEqual(1);
      if (g.gear > last && last > 0 && g.rpm < prevRpm) drops++;
      last = g.gear;
      prevRpm = g.rpm;
    }
    expect(last).toBe(8);
    expect(drops).toBe(7);
  });
});

describe("tilt steering", () => {
  it("is zero when held at the calibrated angle and ignores a small wobble", () => {
    expect(tiltToSteer(0, 9.8, 0, 9.8, 1, false)).toBe(0);
    expect(tiltToSteer(0, 9.8, -0.3, 9.8, 1, false)).toBe(0);
  });
  it("turning the phone clockwise steers right, anticlockwise left, and invert flips it", () => {
    const a = (deg: number) => [-Math.sin((deg * Math.PI) / 180) * 9.8, Math.cos((deg * Math.PI) / 180) * 9.8] as const;
    const right = tiltToSteer(0, 9.8, ...a(20), 1, false);
    const left = tiltToSteer(0, 9.8, ...a(-20), 1, false);
    expect(right).toBeGreaterThan(0.4);
    expect(left).toBeLessThan(-0.4);
    expect(tiltToSteer(0, 9.8, ...a(20), 1, true)).toBeLessThan(0);
    expect(tiltToSteer(0, 9.8, ...a(45), 1, false)).toBe(1);
  });
  it("gives the same answer whichever way the platform signs gravity, and in landscape", () => {
    const rot = (deg: number, sx: number, sy: number) => [sx * Math.cos((deg * Math.PI) / 180) - sy * Math.sin((deg * Math.PI) / 180), sx * Math.sin((deg * Math.PI) / 180) + sy * Math.cos((deg * Math.PI) / 180)] as const;
    const n = rot(90, 0, 9.8); // phone held in landscape
    const v = rot(90, ...rot(-15, 0, 9.8));
    const flipped = tiltToSteer(-n[0], -n[1], -v[0], -v[1], 1, false);
    expect(tiltToSteer(n[0], n[1], v[0], v[1], 1, false)).toBeCloseTo(flipped, 5);
  });
  it("reads nothing when the phone is lying flat", () => {
    expect(tiltToSteer(0, 9.8, 0.1, 0.2, 1, false)).toBe(0);
  });
});

import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/game/settings";

describe("orientation settings", () => {
  it("defaults follow the device with buttons and no tilt", () => {
    const s = sanitizeSettings({});
    expect(s.layout).toBe("auto");
    expect(s.ctrlStyle).toBe("buttons");
    expect(s.tilt).toBe(false);
    expect(s.easyDrive).toBe(false);
    expect(s.controls.portrait.scale).toBe(DEFAULT_SETTINGS.controls.portrait.scale);
  });
  it("keeps valid choices and repairs bad ones, per layout", () => {
    const s = sanitizeSettings({ layout: "portrait", ctrlStyle: "wheel", tilt: true, tiltSens: 99, controls: { portrait: { scale: 1.3 }, landscape: { opacity: "no" } } });
    expect(s.layout).toBe("portrait");
    expect(s.ctrlStyle).toBe("wheel");
    expect(s.tiltSens).toBe(2.5);
    expect(s.controls.portrait.scale).toBe(1.3);
    expect(s.controls.landscape.opacity).toBe(DEFAULT_SETTINGS.controls.landscape.opacity);
    expect(sanitizeSettings({ layout: "sideways" }).layout).toBe("auto");
  });
});
