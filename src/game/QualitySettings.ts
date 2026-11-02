import * as THREE from "three";

export type QualityLevel = "low" | "medium" | "high";
export const QUALITY_ORDER: readonly QualityLevel[] = ["low", "medium", "high"];

interface Preset {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
}

export const PRESETS: Record<QualityLevel, Preset> = {
  low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 512, antialias: false },
  medium: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 1024, antialias: true },
  high: { pixelRatioCap: 2, shadows: true, shadowMapSize: 2048, antialias: true },
};

export interface DeviceHints {
  /** Touch-first device (phone or tablet). */
  coarse: boolean;
  cores?: number;
  /** Approximate RAM in GB, where the browser reports it. */
  memoryGb?: number;
}

/** First-run graphics level: phones and weak machines start on Low, everything else on Medium. */
export function pickDefaultQuality(d: DeviceHints): QualityLevel {
  if (d.coarse) return "low";
  if ((d.cores !== undefined && d.cores <= 2) || (d.memoryGb !== undefined && d.memoryGb <= 2)) return "low";
  return "medium";
}

export function defaultQuality(): QualityLevel {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  return pickDefaultQuality({
    coarse: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
    cores: nav?.hardwareConcurrency,
    memoryGb: nav?.deviceMemory,
  });
}

export function applyQuality(
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  level: QualityLevel,
): void {
  const p = PRESETS[level];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
  renderer.shadowMap.enabled = p.shadows;
  sun.castShadow = p.shadows;
  if (sun.shadow.mapSize.x !== p.shadowMapSize) {
    sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
}

/** Watches frame times and asks for a lower preset when the game can't keep up. */
export class FpsMonitor {
  fps = 60;
  private acc = 0;
  private frames = 0;
  private lowFor = 0;

  /** Returns true when quality should drop one level. */
  tick(dt: number): boolean {
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return false;
    this.fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    this.lowFor = this.fps < 38 ? this.lowFor + 0.5 : 0;
    if (this.lowFor >= 4) {
      this.lowFor = 0;
      return true;
    }
    return false;
  }
}
