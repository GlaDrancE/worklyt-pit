import * as THREE from "three";

const SHARD_MAX = 140;
const PUFF_MAX = 240;

/**
 * Crash effects: flying body parts that stay on the track as debris, sparks, and
 * smoke from damaged engines. Everything is pooled (one InstancedMesh, one Points).
 */
export class DamageFx {
  readonly root = new THREE.Group();
  private readonly shards: THREE.InstancedMesh;
  private readonly sp = new Float32Array(SHARD_MAX * 3);
  private readonly sv = new Float32Array(SHARD_MAX * 3);
  private readonly sr = new Float32Array(SHARD_MAX * 3);
  private readonly sw = new Float32Array(SHARD_MAX * 3);
  /** 0 free, 1 flying, 2 resting on the ground. */
  private readonly mode = new Uint8Array(SHARD_MAX);
  private shardNext = 0;

  private readonly pPos = new Float32Array(PUFF_MAX * 3);
  private readonly pVel = new Float32Array(PUFF_MAX * 3);
  private readonly pAge = new Float32Array(PUFF_MAX).fill(99);
  private readonly pLife = new Float32Array(PUFF_MAX).fill(1);
  private readonly pAlpha = new Float32Array(PUFF_MAX);
  private readonly pSize = new Float32Array(PUFF_MAX);
  private readonly pColor = new Float32Array(PUFF_MAX * 3);
  private pNext = 0;
  private readonly puffGeo = new THREE.BufferGeometry();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3();
  private carry = 0;

  constructor() {
    this.shards = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.035, 0.17),
      new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }),
      SHARD_MAX,
    );
    this.shards.frustumCulled = false;
    this.shards.castShadow = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SHARD_MAX; i++) {
      this.shards.setMatrixAt(i, zero);
      this.shards.setColorAt(i, new THREE.Color(0x222222));
    }
    this.root.add(this.shards);

    this.puffGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    this.puffGeo.setAttribute("alpha", new THREE.BufferAttribute(this.pAlpha, 1));
    this.puffGeo.setAttribute("size", new THREE.BufferAttribute(this.pSize, 1));
    this.puffGeo.setAttribute("tint", new THREE.BufferAttribute(this.pColor, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float alpha; attribute float size; attribute vec3 tint; varying float vA; varying vec3 vC;
        void main() {
          vA = alpha; vC = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 260.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.05, d));
        }`,
    });
    const pts = new THREE.Points(this.puffGeo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.root.add(pts);
  }

  /** Number of pieces lying on the ground. */
  get debrisCount(): number {
    let n = 0;
    for (let i = 0; i < SHARD_MAX; i++) if (this.mode[i] === 2) n++;
    return n;
  }

  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number): void {
    const i = this.pNext;
    this.pNext = (i + 1) % PUFF_MAX;
    this.pPos.set([x, y, z], i * 3);
    this.pVel.set([vx, vy, vz], i * 3);
    this.pColor.set([r, g, b], i * 3);
    this.pAge[i] = 0;
    this.pLife[i] = life;
    this.pSize[i] = size;
  }

  /**
   * A hit at (x, z): body parts fly off and sparks fly. `dirX/dirZ` is the world direction the
   * parts are thrown in; `colors` are the paint and carbon colours of the car.
   */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, severity: number, colors: readonly number[]): void {
    const n = Math.round(3 + severity * 11);
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.shardNext;
      this.shardNext = (i + 1) % SHARD_MAX;
      const sp = 2 + Math.random() * (4 + severity * 7);
      const a = Math.atan2(dirX, dirZ) + (Math.random() - 0.5) * 2.2;
      this.sp.set([x, y + 0.2, z], i * 3);
      this.sv.set([Math.sin(a) * sp, 2 + Math.random() * 3.5, Math.cos(a) * sp], i * 3);
      this.sr.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.sw.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16], i * 3);
      this.mode[i] = 1;
      c.setHex(colors[k % colors.length]!);
      this.shards.setColorAt(i, c);
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
    // Sparks and a puff of dust.
    for (let k = 0; k < 10 + severity * 14; k++) {
      const a = Math.random() * 6.28;
      const s = 2 + Math.random() * 5;
      this.puff(x, y + 0.2, z, Math.sin(a) * s, 1 + Math.random() * 2.5, Math.cos(a) * s, 0.16 + Math.random() * 0.12, 0.25 + Math.random() * 0.3, 1, 0.65, 0.2);
    }
    for (let k = 0; k < 3 + severity * 4; k++) {
      this.puff(x, y + 0.3, z, (Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2, 1 + severity, 1.1, 0.6, 0.58, 0.55);
    }
  }

  /** Remove resting pieces within `r` of (x, z); returns how many were hit. */
  sweep(x: number, z: number, r: number): number {
    let n = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SHARD_MAX; i++) {
      if (this.mode[i] !== 2) continue;
      if (Math.hypot(this.sp[i * 3]! - x, this.sp[i * 3 + 2]! - z) < r) {
        this.mode[i] = 0;
        this.shards.setMatrixAt(i, zero);
        n++;
      }
    }
    if (n) this.shards.instanceMatrix.needsUpdate = true;
    return n;
  }

  clearDebris(): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SHARD_MAX; i++) {
      if (this.mode[i] === 2) {
        this.mode[i] = 0;
        this.shards.setMatrixAt(i, zero);
      }
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /**
   * Step the effects. `smokers` are cars with a damaged engine (health 0..1 of the engine) or
   * a scraping floor; they trail smoke and sparks.
   */
  update(dt: number, smokers: ReadonlyArray<{ x: number; y: number; z: number; yaw: number; engine: number; floor: number; speedKmh: number }>): void {
    let moved = false;
    for (let i = 0; i < SHARD_MAX; i++) {
      if (this.mode[i] !== 1) continue;
      const j = i * 3;
      this.sv[j + 1]! -= 9.81 * dt;
      this.sp[j]! += this.sv[j]! * dt;
      this.sp[j + 1]! += this.sv[j + 1]! * dt;
      this.sp[j + 2]! += this.sv[j + 2]! * dt;
      this.sr[j]! += this.sw[j]! * dt;
      this.sr[j + 1]! += this.sw[j + 1]! * dt;
      this.sr[j + 2]! += this.sw[j + 2]! * dt;
      if (this.sp[j + 1]! <= 0.04) {
        this.sp[j + 1] = 0.04;
        if (Math.abs(this.sv[j + 1]!) > 1.2) {
          this.sv[j + 1] = -this.sv[j + 1]! * 0.35;
          this.sv[j] = this.sv[j]! * 0.6;
          this.sv[j + 2] = this.sv[j + 2]! * 0.6;
        } else {
          this.mode[i] = 2;
          this.sr[j] = 0;
          this.sr[j + 2] = 0;
        }
      }
      this.e.set(this.sr[j]!, this.sr[j + 1]!, this.sr[j + 2]!);
      this.q.setFromEuler(this.e);
      this.m.compose(this.pos.set(this.sp[j]!, this.sp[j + 1]!, this.sp[j + 2]!), this.q, this.one.set(1, 1, 1));
      this.shards.setMatrixAt(i, this.m);
      moved = true;
    }
    if (moved) this.shards.instanceMatrix.needsUpdate = true;

    this.carry += dt;
    for (const c of smokers) {
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      if (c.engine < 0.55) {
        const heavy = c.engine < 0.3;
        const rate = heavy ? 0.03 : 0.07;
        if (this.carry > rate) {
          const shade = heavy ? 0.12 : 0.62;
          this.puff(c.x - fx * 1.9, c.y + 0.7, c.z - fz * 1.9, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, heavy ? 1.3 : 0.9, 1.4, shade, shade, shade);
        }
      }
      if (c.floor < 0.6 && c.speedKmh > 90 && Math.random() < dt * 30) {
        const s = 3 + Math.random() * 3;
        this.puff(c.x - fx * 0.5, 0.12, c.z - fz * 0.5, -fx * s + (Math.random() - 0.5) * 2, 0.8 + Math.random(), -fz * s + (Math.random() - 0.5) * 2, 0.14, 0.3, 1, 0.7, 0.25);
      }
    }
    if (this.carry > 0.07) this.carry = 0;

    for (let i = 0; i < PUFF_MAX; i++) {
      const age = (this.pAge[i]! += dt);
      const life = this.pLife[i]!;
      if (age >= life) {
        this.pAlpha[i] = 0;
        continue;
      }
      const j = i * 3;
      this.pPos[j]! += this.pVel[j]! * dt;
      this.pPos[j + 1]! += this.pVel[j + 1]! * dt;
      this.pPos[j + 2]! += this.pVel[j + 2]! * dt;
      this.pVel[j + 1] = this.pVel[j + 1]! * (1 - dt * 0.8);
      const k = age / life;
      this.pAlpha[i] = (1 - k) * 0.7;
    }
    this.puffGeo.attributes.position!.needsUpdate = true;
    this.puffGeo.attributes.alpha!.needsUpdate = true;
    this.puffGeo.attributes.size!.needsUpdate = true;
    this.puffGeo.attributes.tint!.needsUpdate = true;
  }

  dispose(): void {
    this.shards.geometry.dispose();
    (this.shards.material as THREE.Material).dispose();
    this.puffGeo.dispose();
  }
}
