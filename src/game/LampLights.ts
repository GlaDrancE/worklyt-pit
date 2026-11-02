import * as THREE from "three";
import type { TrackModel } from "../track/TrackModel";
import { LAMP_HEIGHT, lampPositions } from "../track/TrackBuilder";

/**
 * Real light from the street lamps. A handful of point lights are handed to the lamps nearest the car, so the
 * road and barriers around you are lit by the lamps you drive under without paying for one light per lamp.
 */
export class LampLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private readonly spots: Array<{ x: number; z: number }>;
  private tick = 0;

  constructor(model: TrackModel, count: number, intensity: number) {
    this.group.name = "lamplights";
    this.spots = lampPositions(model);
    for (let i = 0; i < Math.min(count, this.spots.length); i++) {
      const l = new THREE.PointLight(0xffe3b0, intensity, 46, 1.4);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    this.update(model.samples[0]!.x, model.samples[0]!.z, true);
  }

  get count(): number {
    return this.lights.length;
  }

  /** Give the lights to the lamps nearest (x, z). Cheap enough to call every few frames. */
  update(x: number, z: number, force = false): void {
    if (!force && ++this.tick % 6 !== 0) return;
    const nearest = nearestSpots(this.spots, x, z, this.lights.length);
    nearest.forEach((p, i) => this.lights[i]!.position.set(p.x, LAMP_HEIGHT - 0.4, p.z));
  }
}

/** The k lamps closest to (x, z), nearest first. */
export function nearestSpots(spots: ReadonlyArray<{ x: number; z: number }>, x: number, z: number, k: number): Array<{ x: number; z: number }> {
  const best: Array<{ d: number; p: { x: number; z: number } }> = [];
  for (const p of spots) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (best.length < k) {
      best.push({ d, p });
      best.sort((a, b) => a.d - b.d);
    } else if (d < best[best.length - 1]!.d) {
      best[best.length - 1] = { d, p };
      best.sort((a, b) => a.d - b.d);
    }
  }
  return best.map((b) => b.p);
}
