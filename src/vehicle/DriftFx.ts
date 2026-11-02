import * as THREE from "three";
import type { CarSnapshot } from "./VehiclePhysics";

/** Rear tyre contact points in the chassis frame (x, y, z). */
const REAR: ReadonlyArray<readonly [number, number, number]> = [
  [0.76, -0.647, -1.7],
  [-0.76, -0.647, -1.7],
];

const SMOKE_MAX = 220;
/** Marks are never recycled during a race: 20 000 quads is several kilometres of sliding. */
const SKID_MAX = 20000;
/** Height of the asphalt ribbon is 0.02; marks sit just above it (and the white lines). */
const ROAD_Y = 0.05;
const SKID_SPACING = 0.28;

/**
 * Tyre smoke and skid marks for a sliding car. Everything is pooled: a ring of smoke
 * particles drawn as one Points object and a ring of dark quads drawn as one InstancedMesh.
 */
export class DriftFx {
  readonly root = new THREE.Group();
  private readonly smokePos = new Float32Array(SMOKE_MAX * 3);
  private readonly smokeAge = new Float32Array(SMOKE_MAX).fill(99);
  private readonly smokeLife = new Float32Array(SMOKE_MAX).fill(1);
  private readonly smokeVel = new Float32Array(SMOKE_MAX * 3);
  private readonly smokeGeo = new THREE.BufferGeometry();
  private readonly smokeAlpha = new Float32Array(SMOKE_MAX);
  private readonly smokeSize = new Float32Array(SMOKE_MAX);
  private smokeNext = 0;
  private readonly skids: THREE.InstancedMesh;
  private skidNext = 0;
  private readonly last: Array<THREE.Vector3 | null> = [null, null];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly flat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private smokeCarry = 0;

  /** Marks laid so far this race. */
  get markCount(): number {
    return this.skids.count;
  }

  constructor() {
    this.smokeGeo.setAttribute("position", new THREE.BufferAttribute(this.smokePos, 3));
    this.smokeGeo.setAttribute("alpha", new THREE.BufferAttribute(this.smokeAlpha, 1));
    this.smokeGeo.setAttribute("size", new THREE.BufferAttribute(this.smokeSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float alpha; attribute float size; varying float vA;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 260.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.86), vA * smoothstep(0.5, 0.05, d));
        }`,
    });
    const smoke = new THREE.Points(this.smokeGeo, mat);
    smoke.frustumCulled = false;
    smoke.renderOrder = 5;
    this.root.add(smoke);

    const quad = new THREE.PlaneGeometry(0.3, SKID_SPACING * 1.6);
    quad.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      SKID_MAX,
    );
    this.skids.frustumCulled = false;
    this.skids.count = 0; // grows as marks are laid down; nothing is ever removed until the race ends
    this.root.add(this.skids);
  }

  private emitSmoke(p: THREE.Vector3, intensity: number): void {
    const i = this.smokeNext;
    this.smokeNext = (i + 1) % SMOKE_MAX;
    this.smokePos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
    this.smokePos[i * 3 + 1] = p.y + 0.08;
    this.smokePos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
    this.smokeVel[i * 3] = (Math.random() - 0.5) * 0.8;
    this.smokeVel[i * 3 + 1] = 0.6 + Math.random() * 0.8;
    this.smokeVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    this.smokeAge[i] = 0;
    this.smokeLife[i] = 0.9 + Math.random() * 0.7;
    this.smokeSize[i] = 0.7 + intensity * 0.6;
  }

  private stamp(p: THREE.Vector3, heading: number): void {
    this.euler.set(0, heading, 0);
    this.q.setFromEuler(this.euler);
    this.m.compose(this.tmp.set(p.x, ROAD_Y, p.z), this.q, this.s);
    this.skids.setMatrixAt(this.skidNext, this.m);
    this.skidNext = (this.skidNext + 1) % SKID_MAX;
    this.skids.count = Math.max(this.skids.count, this.skidNext === 0 ? SKID_MAX : this.skidNext);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param intensity 0..1, how hard the tyres are sliding (0 = not at all)
   * @param velYaw heading of the car's actual travel, so marks follow the slide
   */
  update(dt: number, snap: CarSnapshot, intensity: number, velYaw: number, onRoad = true): void {
    this.flat.set(snap.qx, snap.qy, snap.qz, snap.qw);
    const wheels: THREE.Vector3[] = REAR.map((r) => new THREE.Vector3(r[0], r[1], r[2]).applyQuaternion(this.flat).add(this.tmp.set(snap.x, snap.y, snap.z)).clone());
    const sliding = intensity > 0.05;
    this.smokeCarry += dt * (sliding ? 55 * intensity : 0);
    while (this.smokeCarry >= 1) {
      this.smokeCarry -= 1;
      this.emitSmoke(wheels[Math.random() < 0.5 ? 0 : 1]!, intensity);
    }
    wheels.forEach((w, i) => {
      if (!sliding || !onRoad) {
        this.last[i] = null;
        return;
      }
      const prev = this.last[i];
      if (!prev) {
        this.last[i] = w.clone();
        return;
      }
      // A fast car covers more than one mark's length per frame: fill the gap so the line is unbroken.
      const d = prev.distanceTo(w);
      const n = Math.min(40, Math.floor(d / SKID_SPACING));
      for (let k = 1; k <= n; k++) {
        this.stamp(this.tmp2.lerpVectors(prev, w, (k * SKID_SPACING) / d), velYaw);
      }
      if (n > 0) prev.lerp(w, (n * SKID_SPACING) / d);
    });
    for (let i = 0; i < SMOKE_MAX; i++) {
      const age = this.smokeAge[i]!;
      if (age > this.smokeLife[i]!) {
        this.smokeAlpha[i] = 0;
        continue;
      }
      const a = age + dt;
      this.smokeAge[i] = a;
      this.smokePos[i * 3]! += this.smokeVel[i * 3]! * dt;
      this.smokePos[i * 3 + 1]! += this.smokeVel[i * 3 + 1]! * dt;
      this.smokePos[i * 3 + 2]! += this.smokeVel[i * 3 + 2]! * dt;
      const t = a / this.smokeLife[i]!;
      this.smokeAlpha[i] = 0.5 * (1 - t) * Math.min(1, t * 8);
      this.smokeSize[i] = this.smokeSize[i]! * (1 + dt * 0.9);
    }
    (this.smokeGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeo.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeo.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
  }
}
