import { describe, expect, it } from "vitest";
import { BAND_RPMS, bandWeights, renderEngineLoop } from "../src/audio/engineSynth";

const SR = 44100;

function magnitudeAt(data: Float32Array, hz: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < data.length; i++) {
    const w = (2 * Math.PI * hz * i) / SR;
    re += data[i]! * Math.cos(w);
    im += data[i]! * Math.sin(w);
  }
  return Math.hypot(re, im) / data.length;
}

describe("engine loop synthesis", () => {
  for (const load of ["on", "off"] as const) {
    it(`renders a clean, finite, level-matched ${load}-throttle loop at every band`, () => {
      for (const rpm of BAND_RPMS) {
        const loop = renderEngineLoop({ rpm, load, sampleRate: SR });
        let sum = 0;
        for (const v of loop.data) {
          expect(Number.isFinite(v)).toBe(true);
          expect(Math.abs(v)).toBeLessThan(1.2);
          sum += v * v;
        }
        const rms = Math.sqrt(sum / loop.data.length);
        expect(rms).toBeGreaterThan(0.1);
        expect(rms).toBeLessThan(0.4);
        // Rounded to a whole number of engine cycles, within a few percent of the request.
        expect(Math.abs(loop.rpm - rpm) / rpm).toBeLessThan(0.03);
        const cycles = (loop.data.length / SR) * (loop.rpm / 120);
        expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-6);
      }
    });
  }

  it("has its strongest low note at the firing frequency, not between harmonics", () => {
    const loop = renderEngineLoop({ rpm: 7600, load: "on", sampleRate: SR });
    const f = loop.firingHz; // V6: three firings per crank revolution
    expect(f).toBeCloseTo((loop.rpm / 60) * 3, 3);
    expect(magnitudeAt(loop.data, f)).toBeGreaterThan(magnitudeAt(loop.data, f * 1.5) * 2);
  });

  it("is brighter on throttle than off throttle", () => {
    const hi = (d: Float32Array) => {
      let e = 0;
      for (let i = 1; i < d.length; i++) e += (d[i]! - d[i - 1]!) ** 2;
      return e / d.length;
    };
    const on = renderEngineLoop({ rpm: 9600, load: "on", sampleRate: SR }).data;
    const off = renderEngineLoop({ rpm: 9600, load: "off", sampleRate: SR }).data;
    expect(hi(on)).toBeGreaterThan(hi(off));
  });

  it("is deterministic", () => {
    const a = renderEngineLoop({ rpm: 5800, load: "on", sampleRate: SR }).data;
    const b = renderEngineLoop({ rpm: 5800, load: "on", sampleRate: SR }).data;
    expect(a).toEqual(b);
  });

  it("cross-fades with constant power and never exceeds one", () => {
    for (let rpm = 3000; rpm <= 13000; rpm += 137) {
      const w = bandWeights(rpm);
      const power = w.reduce((a, x) => a + x * x, 0);
      expect(power).toBeCloseTo(1, 6);
    }
  });
});

import { ENGINES, bandRpms } from "../src/audio/engineProfiles";
import { newDrivetrain, stepDrivetrain } from "../src/audio/drivetrain";

describe("engine profiles", () => {
  it("renders every band of every engine cleanly, with firing rate matching its cylinders", () => {
    for (const p of ENGINES) {
      for (const rpm of bandRpms(p)) {
        const loop = renderEngineLoop({ rpm, load: "on", sampleRate: SR, cylinders: p.cylinders, modeScale: p.modeScale, roughness: p.roughness });
        expect(loop.data.every(Number.isFinite)).toBe(true);
        expect(loop.firingHz).toBeCloseTo((loop.rpm / 120) * p.cylinders, 3);
      }
    }
  });

  it("revs to each engine's own redline and shifts through all gears", () => {
    for (const p of ENGINES) {
      const s = newDrivetrain();
      const range = { idleRpm: p.idleRpm, redlineRpm: p.redlineRpm };
      let peak = 0;
      for (let kmh = 0; kmh <= 340; kmh += 0.5) {
        for (let i = 0; i < 6; i++) stepDrivetrain(s, kmh, 1, 1 / 360, range);
        peak = Math.max(peak, s.rpm);
        expect(s.rpm).toBeLessThanOrEqual(p.redlineRpm);
      }
      expect(s.gear).toBe(8);
      expect(peak).toBeGreaterThan(p.redlineRpm * 0.9);
    }
  });
});
