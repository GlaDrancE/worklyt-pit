import * as THREE from "three";

const COUNT = 1600;
const BOX = { x: 70, y: 40, z: 70 };

/** Falling rain streaks in a box that follows the camera. One draw call. */
export class RainFx {
  readonly object: THREE.LineSegments;
  private readonly pos = new Float32Array(COUNT * 6);
  private readonly drops = new Float32Array(COUNT * 3);
  private readonly geo = new THREE.BufferGeometry();
  private active = false;

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.drops[i * 3 + 1] = Math.random() * BOX.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.object = new THREE.LineSegments(
      this.geo,
      new THREE.LineBasicMaterial({ color: 0xbfd4e6, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 6;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.object.visible = on;
  }

  /** @param speedKmh the car's speed: faster driving slants the rain towards the camera */
  update(dt: number, center: THREE.Vector3, headingX: number, headingZ: number, speedKmh: number): void {
    if (!this.active) return;
    const fall = 32 * dt;
    const slant = Math.min(1, speedKmh / 250) * 5; // streak length lean
    for (let i = 0; i < COUNT; i++) {
      let y = this.drops[i * 3 + 1]! - fall;
      if (y < 0) {
        y += BOX.y;
        this.drops[i * 3] = (Math.random() - 0.5) * BOX.x;
        this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      }
      this.drops[i * 3 + 1] = y;
      const x = center.x + this.drops[i * 3]!;
      const z = center.z + this.drops[i * 3 + 2]!;
      const o = i * 6;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x + headingX * slant * 0.3;
      this.pos[o + 4] = y + 1.3 + slant * 0.1;
      this.pos[o + 5] = z + headingZ * slant * 0.3;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
