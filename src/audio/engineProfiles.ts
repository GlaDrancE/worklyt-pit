/** The engines you can choose from. They change the pitch, rev range and character of the sound. */
export type EngineId = "v10" | "v8" | "v6";

export interface EngineProfile {
  id: EngineId;
  name: string;
  blurb: string;
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  /** Scales the exhaust/intake resonance frequencies (smaller engines ring higher). */
  modeScale: number;
  /** 0..1: how uneven the cylinders are. More = rougher, more rasp. */
  roughness: number;
  /** Hybrid / turbo whine level (0 for the old naturally aspirated engines). */
  whine: number;
}

export const ENGINES: readonly EngineProfile[] = [
  { id: "v10", name: "V10 scream (classic)", blurb: "3.0 L V10 at 18,000 rpm: the high-pitched wail of the early 2000s.", cylinders: 10, idleRpm: 4800, redlineRpm: 18000, modeScale: 1.3, roughness: 0.7, whine: 0 },
  { id: "v8", name: "V8 howl", blurb: "2.4 L V8 at 18,000 rpm: harder, rawer edge.", cylinders: 8, idleRpm: 4500, redlineRpm: 18000, modeScale: 1.12, roughness: 1, whine: 0 },
  { id: "v6", name: "V6 hybrid (modern)", blurb: "1.6 L V6 turbo hybrid at 12,000 rpm with turbo and electric whine.", cylinders: 6, idleRpm: 4200, redlineRpm: 12000, modeScale: 1, roughness: 1, whine: 1 },
];

export const DEFAULT_ENGINE: EngineId = "v10";

export function getEngine(id: string): EngineProfile {
  return ENGINES.find((e) => e.id === id) ?? ENGINES.find((e) => e.id === DEFAULT_ENGINE)!;
}

/** Engine speeds the loops are rendered at, spread over the rev range. */
export function bandRpms(p: EngineProfile): number[] {
  return [0, 0.22, 0.48, 0.75, 1].map((f) => Math.round(p.idleRpm + f * (p.redlineRpm - p.idleRpm)));
}
