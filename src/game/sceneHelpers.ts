import * as THREE from "three";
import type { Pose, TrackModel } from "../track/TrackModel";
import { gridSlot } from "../race/Rivals";
import type { Livery } from "../vehicle/CarView";
import { WORKLYFT_LIVERY } from "../race/companies";

/** Small scene helpers used by the game: liveries, car fading, grid positions, name labels, clean-up. */

export const RIVAL_LIVERIES: Livery[] = [
  WORKLYFT_LIVERY,
  { body: 0x1d6fd8, accent: 0xffffff, helmet: 0xffd21f, compound: 0xf4f4f2, pod: 0xff4fd8 },
  { body: 0xf2b705, accent: 0x111111, helmet: 0xffffff, compound: 0xf4f4f2, pod: 0x1d6fd8 },
  { body: 0x1faa59, accent: 0xffffff, helmet: 0x111111, compound: 0xf4f4f2, pod: 0xffd21f },
  { body: 0xf4f4f4, accent: 0xc8141f, helmet: 0xc8141f, compound: 0xf4f4f2, pod: 0x111111 },
  { body: 0x7a3cff, accent: 0xffffff, helmet: 0xffffff, compound: 0xf4f4f2, pod: 0x00e5ff },
];

export const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Pale cyan, see-through: your own best lap. */
export const GHOST_OPACITY = 0.38;
export const GHOST_LIVERY: Livery = { body: 0x7fe9ff, accent: 0xffffff, helmet: 0xffffff, compound: 0xf4f4f2, pod: 0x7fe9ff };

/** Make every material on a car see-through and non-shadowing. */
export function fadeCar(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.transparent && mat.opacity < 0.9) continue; // leave the contact-shadow blobs as they are
      mat.transparent = true;
      mat.opacity = Math.min(mat.opacity, opacity);
      mat.userData.fadeBase = mat.opacity;
      mat.depthWrite = false;
    }
  });
}

/** Scale a faded car's see-through level (0 = gone, 1 = as set by fadeCar). Used to ease a ghost away when it is close. */
export function scaleFade(root: THREE.Object3D, k: number): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const base = mat.userData.fadeBase as number | undefined;
      if (base !== undefined) mat.opacity = base * k;
    }
  });
}


export function gridPose(model: TrackModel, slot: 0 | 1 | null): Pose {
  if (slot === null) return model.startPose(8);
  const p = model.startPose(slot === 0 ? 8 : 15);
  const off = slot === 0 ? -2.5 : 2.5;
  return { x: p.x + Math.cos(p.yaw) * off, z: p.z - Math.sin(p.yaw) * off, yaw: p.yaw };
}

/** Grid row `slot` (0 = pole) for a race against computer-driven cars. */
export function rowPose(model: TrackModel, slot: number): Pose {
  const g = gridSlot(slot);
  const p = model.startPose(g.metresBehind);
  return { x: p.x - Math.cos(p.yaw) * g.lateral, z: p.z + Math.sin(p.yaw) * g.lateral, yaw: p.yaw };
}

export function makeLabel(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  drawLabel(c, name);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.userData.labelCanvas = c;
  sprite.userData.labelText = name;
  sprite.scale.set(4.4, 1.1, 1);
  return sprite;
}

export function setLabelText(sprite: THREE.Sprite, name: string): void {
  if (sprite.userData.labelText === name) return;
  const canvas = sprite.userData.labelCanvas as HTMLCanvasElement | undefined;
  if (!canvas) throw new Error("Name label is missing its canvas.");
  drawLabel(canvas, name);
  const texture = sprite.material.map;
  if (!texture) throw new Error("Name label is missing its texture.");
  texture.needsUpdate = true;
  sprite.userData.labelText = name;
}

function drawLabel(c: HTMLCanvasElement, name: string): void {
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(11,13,18,0.75)";
  g.beginPath();
  g.roundRect(8, 24, 496, 80, 24);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "700 52px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(name, 256, 66, 470);
}
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.map && !std.map.userData.shared) std.map.dispose();
      m.dispose();
    }
  });
}
