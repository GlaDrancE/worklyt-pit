/**
 * Offline engine-note synthesis. Instead of stacking oscillators, this models
 * what a real exhaust does: every cylinder firing is a sharp pressure pulse
 * that rings the exhaust and intake pipes at fixed resonant frequencies. The
 * pulses are laid down in a circular buffer so the result loops with no click.
 *
 * The game renders a handful of these loops at different engine speeds, once
 * for "on throttle" and once for "off throttle", and cross-fades between them
 * while pitch-shifting slightly. That is how most racing games do engine audio,
 * except the source recordings are generated here, so there is nothing to download.
 */

export type EngineLoad = "on" | "off";

export interface LoopSpec {
  /** Target engine speed. The loop is rounded to a whole number of engine cycles. */
  rpm: number;
  load: EngineLoad;
  sampleRate: number;
  seed?: number;
  /** Cylinder count of a four-stroke engine. */
  cylinders?: number;
  /** Multiplies the resonance frequencies (default 1). */
  modeScale?: number;
  /** 0..1.5: cylinder-to-cylinder unevenness (default 1). */
  roughness?: number;
}

export interface EngineLoop {
  data: Float32Array<ArrayBuffer>;
  /** The engine speed the loop actually represents after rounding. */
  rpm: number;
  /** Firing events per second at that speed. */
  firingHz: number;
}

/** Engine speeds the game renders loops for. */
export const BAND_RPMS = [4200, 5800, 7600, 9600, 12000] as const;

/** Resonant modes of the exhaust/intake (Hz), their level and ring-down time (s). */
const MODES: Record<EngineLoad, ReadonlyArray<readonly [number, number, number]>> = {
  on: [
    [150, 1.0, 0.016],
    [330, 0.95, 0.013],
    [590, 0.85, 0.011],
    [1020, 0.8, 0.009],
    [1560, 0.65, 0.0075],
    [2350, 0.5, 0.006],
    [3600, 0.38, 0.0045],
    [5300, 0.22, 0.0035],
  ],
  off: [
    [130, 1.0, 0.02],
    [290, 0.8, 0.014],
    [520, 0.5, 0.01],
    [900, 0.28, 0.008],
    [1400, 0.14, 0.006],
    [2200, 0.06, 0.004],
  ],
};

/** Cylinders never fire identically: small fixed differences give the engine its rasp. */
const CYLINDER_GAIN = [1.0, 0.9, 1.06, 0.94, 1.03, 0.88, 1.01, 0.92] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sound of one firing: a crack, then the pipes ringing down. */
function impulseResponse(load: EngineLoad, sr: number, rand: () => number, modeScale: number, variants = 3): Float32Array[] {
  const len = Math.round(sr * 0.06);
  const modes = MODES[load];
  const base = new Float32Array(len);
  for (const [f0, amp, decay] of modes) {
    const f = Math.min(f0 * modeScale, sr * 0.45);
    const w = (2 * Math.PI * f) / sr;
    const phase = rand() * 0.6;
    for (let i = 0; i < len; i++) base[i] += amp * Math.sin(w * i + phase) * Math.exp(-i / (sr * decay));
  }
  const crack = load === "on" ? 0.55 : 0.12;
  const out: Float32Array[] = [];
  for (let v = 0; v < variants; v++) {
    const ir = Float32Array.from(base);
    // Combustion crack: short, bright noise burst (differentiated so it is mostly treble).
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const n = rand() * 2 - 1;
      ir[i] += crack * (n - 0.7 * prev) * Math.exp(-i / (sr * 0.0022));
      prev = n;
    }
    out.push(ir);
  }
  return out;
}

export function renderEngineLoop(spec: LoopSpec): EngineLoop {
  const sr = spec.sampleRate;
  const cyl = spec.cylinders ?? 6;
  const rand = mulberry32((spec.seed ?? 7) + Math.round(spec.rpm) + (spec.load === "on" ? 1000 : 0));

  const cycleSec = 120 / spec.rpm; // one four-stroke cycle = two crank revolutions
  const cycles = Math.max(2, Math.round(0.9 / cycleSec));
  const n = Math.round(cycles * cycleSec * sr);
  const rpm = (cycles * 120 * sr) / n;
  const firingHz = (rpm / 120) * cyl;

  const modeScale = spec.modeScale ?? 1;
  const rough = spec.roughness ?? 1;
  const irs = impulseResponse(spec.load, sr, rand, modeScale);
  const buf = new Float32Array(n);
  const pulses = cycles * cyl;
  const spacing = n / pulses;
  for (let k = 0; k < pulses; k++) {
    const cylinder = k % cyl;
    // Fixed per-cylinder timing error (repeats every cycle, so the loop stays seamless).
    const dev = (CYLINDER_GAIN[cylinder % CYLINDER_GAIN.length]! - 1) * rough;
    const jitter = (dev + 0.03) * 0.08;
    const pos = Math.round((k + jitter) * spacing + n) % n;
    const amp = (1 + dev) * (0.96 + rand() * 0.08);
    const ir = irs[Math.floor(rand() * irs.length)]!;
    for (let j = 0; j < ir.length; j++) buf[(pos + j) % n] += ir[j]! * amp;
  }

  // Intake / mechanical hiss that follows the firing rate (circular one-pole low-pass of noise).
  const hiss = spec.load === "on" ? 0.05 : 0.015;
  let lp = 0;
  const a = Math.min(0.9, (2 * Math.PI * Math.max(1500, firingHz * 3)) / sr);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      lp += a * ((rand() * 2 - 1) - lp);
      if (pass === 1) buf[i] += hiss * lp * (0.6 + 0.4 * Math.sin((2 * Math.PI * i * firingHz) / (sr)));
    }
  }

  // Soft clip adds the harmonics a real exhaust has, then even out the level.
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(buf[i]! * (spec.load === "on" ? 0.55 : 0.8));
    buf[i] = v;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / n) || 1;
  const target = spec.load === "on" ? 0.3 : 0.2;
  const g = target / rms;
  for (let i = 0; i < n; i++) buf[i] = buf[i]! * g;
  return { data: buf, rpm, firingHz };
}

/** Pair of cross-fade gains for the two loops either side of an engine speed. */
export function bandWeights(rpm: number, bands: readonly number[] = BAND_RPMS): number[] {
  const w = bands.map(() => 0);
  if (rpm <= bands[0]!) {
    w[0] = 1;
    return w;
  }
  const last = bands.length - 1;
  if (rpm >= bands[last]!) {
    w[last] = 1;
    return w;
  }
  let i = 0;
  while (rpm > bands[i + 1]!) i++;
  const t = (rpm - bands[i]!) / (bands[i + 1]! - bands[i]!);
  w[i] = Math.cos(t * Math.PI * 0.5);
  w[i + 1] = Math.sin(t * Math.PI * 0.5);
  return w;
}
