import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type CarLod = "hi" | "lo";

/**
 * The car body and wheels as loaded from src/assets/f1-car.glb (built by
 * tools/build-car-model.mjs from the supplied model). Geometry is loaded once
 * and shared by every car on track; each car gets its own materials.
 */
export interface CarTemplate {
  geometry(name: string): THREE.BufferGeometry | null;
}

let template: CarTemplate | null = null;

export function getCarTemplate(): CarTemplate | null {
  return template;
}

/** Load the model once at start-up. Failing is fine: the built-in car is used instead. */
export async function loadCarModel(): Promise<boolean> {
  if (template) return true;
  try {
    // A separate chunk, so the menu does not wait for 1.6 MB of model data before it can appear.
    const { default: carUrl } = await import("../assets/f1-car.glb?inline");
    const buf = await (await fetch(carUrl)).arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(buf, "");
    const parts = new Map<string, THREE.BufferGeometry>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name) {
        m.geometry.userData.shared = true; // never disposed when a race ends
        parts.set(m.name, m.geometry);
      }
    });
    if (!parts.has("hi_paint") || !parts.has("lo_paint")) return false;
    template = { geometry: (name) => parts.get(name) ?? null };
    return true;
  } catch (e) {
    console.warn("Car model could not be loaded; using the built-in car.", e);
    return false;
  }
}
