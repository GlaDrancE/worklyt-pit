import * as THREE from "three";
import { CAR_TUNING, type CarSnapshot, type VehiclePhysics } from "./VehiclePhysics";
import type { Zone } from "./damage";
import { getCarTemplate, type CarLod, type CarTemplate } from "./carModel";

/**
 * Original open-wheel single-seater. The proportions follow modern F1 cars
 * (long wheelbase, very wide low front wing with tall endplates, narrow nose,
 * high periscope airbox, undercut sidepods, a thin rear-wing pylon and a big
 * diffuser) and the public 2026 FIA size limits. The livery and every detail
 * are original: no real team's colours, sponsors or logos.
 *
 * Local coordinates: origin at the physics chassis origin, +Z forward, +Y up.
 * `GROUND` is where the road surface sits in that frame when the car is at rest.
 */
const GROUND = -0.647;
const P = (x: number, h: number, z: number) => new THREE.Vector3(x, GROUND + h, z);

interface Section {
  z: number;
  cx: number;
  w: number;
  yb: number;
  yt: number;
}

const RING = 8;
const Y_UP = new THREE.Vector3(0, 1, 0);

function ring(s: Section): Array<[number, number]> {
  const c = Math.min(s.w * 0.5, (s.yt - s.yb) * 0.35);
  const l = s.cx - s.w;
  const r = s.cx + s.w;
  return [
    [l + c, s.yb],
    [r - c, s.yb],
    [r, s.yb + c],
    [r, s.yt - c],
    [r - c, s.yt],
    [l + c, s.yt],
    [l, s.yt - c],
    [l, s.yb + c],
  ];
}

/** Smooth lofted body between cross-sections, with end caps. */
function loft(sections: Section[], material: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of sections) for (const [x, y] of ring(s)) pos.push(x, GROUND + y, s.z);
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < RING; k++) {
      const a = i * RING + k;
      const b = i * RING + ((k + 1) % RING);
      const c = (i + 1) * RING + k;
      const d = (i + 1) * RING + ((k + 1) % RING);
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (i: number, flip: boolean) => {
    const s = sections[i]!;
    const centre = pos.length / 3;
    pos.push(s.cx, GROUND + (s.yb + s.yt) / 2, s.z);
    for (let k = 0; k < RING; k++) {
      const a = i * RING + k;
      const b = i * RING + ((k + 1) % RING);
      idx.push(centre, flip ? b : a, flip ? a : b);
    }
  };
  cap(0, false);
  cap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, at: THREE.Vector3, rotX = 0, rotZ = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.copy(at);
  m.rotation.x = rotX;
  m.rotation.z = rotZ;
  m.castShadow = true;
  return m;
}

function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

/** Tyre with rounded shoulders; axis along X. */
function tyreGeometry(radius: number, width: number): THREE.BufferGeometry {
  const hw = width / 2;
  const pts = [
    new THREE.Vector2(radius * 0.7, -hw),
    new THREE.Vector2(radius * 0.93, -hw * 0.98),
    new THREE.Vector2(radius * 0.985, -hw * 0.86),
    new THREE.Vector2(radius, -hw * 0.6),
    new THREE.Vector2(radius, hw * 0.6),
    new THREE.Vector2(radius * 0.985, hw * 0.86),
    new THREE.Vector2(radius * 0.93, hw * 0.98),
    new THREE.Vector2(radius * 0.7, hw),
  ];
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Soft dark ellipse used as a contact shadow so the car never looks like it floats. */
function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.9)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export interface Livery {
  body: number;
  accent: number;
  helmet: number;
  compound: number;
  pod: number;
}

/** TrackRush house colours: signal red over carbon, white accents, yellow-banded (medium) tyres. */
export const DEFAULT_LIVERY: Livery = {
  body: 0xc8141f,
  accent: 0xf4f4f2,
  helmet: 0xf2f2f2,
  compound: 0xffd21f,
  pod: 0xc6ff2a,
};

/** Visible tyre widths on the supplied model: slim fronts, wide rears, like the real cars. */
const MODEL_FRONT_TYRE = 0.34;
const MODEL_REAR_TYRE = 0.46;

/** Slightly domed wheel cover for one side of a wheel (axis along X). */
function coverGeometry(halfWidth: number, side: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0.022),
    new THREE.Vector2(0.07, 0.02),
    new THREE.Vector2(0.17, 0.011),
    new THREE.Vector2(0.262, 0.003),
    new THREE.Vector2(0.262, -0.004),
  ];
  const g = new THREE.LatheGeometry(pts, 40);
  // Lathe axis is Y: turn it onto X and push it out to the sidewall.
  g.rotateZ(-Math.PI / 2 * side);
  g.translate(side * halfWidth, 0, 0);
  return g;
}

interface Arm {
  mesh: THREE.Mesh;
  wheel: number;
  /** Fixed end, in car coordinates. */
  from: THREE.Vector3;
  /** Moving end relative to the wheel centre, before steering is applied. */
  to: THREE.Vector3;
}

export class CarView {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly wheelSpin: THREE.Object3D[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private readonly rearLight: THREE.MeshStandardMaterial;
  private readonly rearFlap: THREE.Mesh;
  private readonly frontFlap: THREE.Mesh;
  private flapOpen = 0;
  private readonly armGroup = new THREE.Group();
  private readonly arms: Arm[] = [];
  private readonly paintMat: THREE.MeshPhysicalMaterial;
  private readonly paintBase: THREE.Color;
  private bodyMeshes: Array<{ mesh: THREE.Mesh; orig: Float32Array | null; name: string }> = [];
  private hasModel = false;
  private readonly scorch = new THREE.Color(0x1a1512);
  private remoteSpin = 0;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly tmpDir = new THREE.Vector3();

  constructor(livery: Livery = DEFAULT_LIVERY, lod: CarLod = "hi") {
    const paint = new THREE.MeshPhysicalMaterial({
      color: livery.body,
      roughness: 0.34,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    });
    const white = new THREE.MeshPhysicalMaterial({ color: livery.accent, roughness: 0.35, clearcoat: 0.8, side: THREE.DoubleSide });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide });
    const carbonDark = new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
    const matte = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.95 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9ea4ad, roughness: 0.35, metalness: 0.9 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.9 });
    const bandMat = new THREE.MeshStandardMaterial({ color: livery.compound, roughness: 0.55, side: THREE.DoubleSide });
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
    const helmetMat = new THREE.MeshPhysicalMaterial({ color: livery.helmet, roughness: 0.25, clearcoat: 1 });
    const podMat = new THREE.MeshStandardMaterial({ color: livery.pod, roughness: 0.5 });
    const led = new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x30ff60, emissiveIntensity: 0.8 });
    this.rearLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.6 });
    this.paintMat = paint;
    this.paintBase = new THREE.Color(livery.body);

    const tpl = getCarTemplate();
    if (tpl) {
      // Flaps only exist on the built-in car; keep harmless stand-ins so the sync code is shared.
      this.rearFlap = new THREE.Mesh();
      this.frontFlap = new THREE.Mesh();
      this.buildFromModel(tpl, lod, { paint, carbon, tyreMat, coverMat, bandMat, helmetMat });
      this.addDecals();
      this.collectBody();
      return;
    }

    const add = <T extends THREE.Object3D>(o: T): T => {
      this.root.add(o);
      return o;
    };

    // --- Monocoque, nose, painted front half ---------------------------------
    add(
      loft(
        [
          { z: 2.5, cx: 0, w: 0.045, yb: 0.17, yt: 0.23 },
          { z: 2.25, cx: 0, w: 0.09, yb: 0.16, yt: 0.29 },
          { z: 1.85, cx: 0, w: 0.15, yb: 0.15, yt: 0.36 },
          { z: 1.4, cx: 0, w: 0.22, yb: 0.13, yt: 0.44 },
          { z: 0.9, cx: 0, w: 0.28, yb: 0.12, yt: 0.52 },
          { z: 0.35, cx: 0, w: 0.31, yb: 0.11, yt: 0.58 },
          { z: -0.2, cx: 0, w: 0.31, yb: 0.11, yt: 0.6 },
          { z: -0.55, cx: 0, w: 0.28, yb: 0.11, yt: 0.62 },
        ],
        paint,
      ),
    );
    // Dark rear engine cover (coke-bottle taper to a thin tail).
    add(
      loft(
        [
          { z: -0.55, cx: 0, w: 0.28, yb: 0.11, yt: 0.62 },
          { z: -1.0, cx: 0, w: 0.24, yb: 0.11, yt: 0.62 },
          { z: -1.45, cx: 0, w: 0.17, yb: 0.12, yt: 0.55 },
          { z: -1.85, cx: 0, w: 0.11, yb: 0.14, yt: 0.43 },
          { z: -2.15, cx: 0, w: 0.08, yb: 0.17, yt: 0.34 },
        ],
        carbon,
      ),
    );
    // White stripe along the nose and a thin accent over the engine cover.
    add(box(0.07, 0.012, 1.3, white, P(0, 0.455, 1.5), -0.07));
    add(box(0.05, 0.012, 0.9, white, P(0, 0.625, -1.0)));
    // Cockpit opening.
    add(box(0.42, 0.04, 0.7, matte, P(0, 0.595, 0.0)));

    // --- Periscope airbox with camera pod -------------------------------------
    add(
      loft(
        [
          { z: -0.05, cx: 0, w: 0.1, yb: 0.58, yt: 0.72 },
          { z: -0.28, cx: 0, w: 0.14, yb: 0.58, yt: 0.96 },
          { z: -0.75, cx: 0, w: 0.11, yb: 0.6, yt: 0.92 },
          { z: -1.35, cx: 0, w: 0.06, yb: 0.58, yt: 0.72 },
          { z: -1.9, cx: 0, w: 0.025, yb: 0.42, yt: 0.52 },
        ],
        carbon,
      ),
    );
    add(box(0.17, 0.12, 0.05, matte, P(0, 0.84, -0.27)));
    add(box(0.17, 0.05, 0.05, paint, P(0, 0.95, -0.25)));
    // Camera pod on top, like the roll-hoop fairing on real cars.
    add(box(0.2, 0.035, 0.07, podMat, P(0, 1.0, -0.3)));
    add(box(0.03, 0.05, 0.03, carbonDark, P(0, 0.97, -0.3)));

    // --- Sidepods: painted upper, dark undercut lower --------------------------
    for (const s of [-1, 1]) {
      add(
        loft(
          [
            { z: 0.62, cx: s * 0.46, w: 0.2, yb: 0.2, yt: 0.52 },
            { z: 0.1, cx: s * 0.54, w: 0.26, yb: 0.2, yt: 0.55 },
            { z: -0.7, cx: s * 0.48, w: 0.24, yb: 0.2, yt: 0.46 },
            { z: -1.3, cx: s * 0.36, w: 0.17, yb: 0.2, yt: 0.34 },
            { z: -1.85, cx: s * 0.25, w: 0.1, yb: 0.18, yt: 0.24 },
          ],
          paint,
        ),
      );
      add(
        loft(
          [
            { z: 0.55, cx: s * 0.42, w: 0.17, yb: 0.07, yt: 0.22 },
            { z: 0.1, cx: s * 0.46, w: 0.2, yb: 0.06, yt: 0.22 },
            { z: -0.7, cx: s * 0.42, w: 0.2, yb: 0.06, yt: 0.22 },
            { z: -1.35, cx: s * 0.32, w: 0.15, yb: 0.07, yt: 0.21 },
            { z: -1.85, cx: s * 0.23, w: 0.09, yb: 0.08, yt: 0.18 },
          ],
          carbon,
        ),
      );
      // Sidepod inlet.
      add(box(0.3, 0.2, 0.03, matte, P(s * 0.5, 0.38, 0.66)));
      // Mirror on a stalk, plus a thin antenna on the nose side.
      add(strut(P(s * 0.32, 0.55, 0.52), P(s * 0.5, 0.63, 0.5), 0.012, carbon));
      add(box(0.13, 0.07, 0.03, carbon, P(s * 0.55, 0.64, 0.5)));
      add(box(0.13, 0.015, 0.02, podMat, P(s * 0.55, 0.675, 0.5)));
      add(strut(P(s * 0.28, 0.5, 1.2), P(s * 0.28, 0.78, 1.2), 0.004, matte));
      // Floor-edge vanes ahead of the rear tyres.
      for (const dz of [0.9, 0.65, 0.4]) add(box(0.012, 0.09, 0.3, carbonDark, P(s * (0.62 + (0.9 - dz) * 0.06), 0.1, dz - 0.2), 0, s * 0.25));
    }

    // --- Floor and diffuser -----------------------------------------------------
    add(
      loft(
        [
          { z: 1.35, cx: 0, w: 0.45, yb: 0.03, yt: 0.06 },
          { z: 0.7, cx: 0, w: 0.9, yb: 0.03, yt: 0.06 },
          { z: -1.0, cx: 0, w: 0.94, yb: 0.03, yt: 0.06 },
          { z: -1.9, cx: 0, w: 0.64, yb: 0.03, yt: 0.06 },
        ],
        carbonDark,
      ),
    );
    add(
      loft(
        [
          { z: -1.9, cx: 0, w: 0.62, yb: 0.03, yt: 0.06 },
          { z: -2.28, cx: 0, w: 0.56, yb: 0.2, yt: 0.24 },
        ],
        carbonDark,
      ),
    );
    for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) add(box(0.012, 0.15, 0.4, carbonDark, P(x, 0.13, -2.1)));
    // Exhaust tail pipe poking out under the beam wing.
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3340, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
    pipe.rotation.x = Math.PI / 2;
    pipe.position.copy(P(0, 0.4, -2.2));
    add(pipe);

    // --- Front wing: wide, three elements, tall curved endplates ----------------
    add(box(1.6, 0.025, 0.32, carbon, P(0, 0.07, 2.62)));
    this.frontFlap = box(1.5, 0.022, 0.22, carbon, P(0, 0.14, 2.56), 0.18);
    add(this.frontFlap);
    add(box(1.38, 0.02, 0.18, carbon, P(0, 0.205, 2.5), 0.3));
    add(box(0.5, 0.02, 0.2, paint, P(0, 0.235, 2.46), 0.2)); // painted centre flap
    for (const s of [-1, 1]) {
      add(box(0.025, 0.3, 0.6, paint, P(s * 0.81, 0.2, 2.55)));
      add(box(0.027, 0.04, 0.6, white, P(s * 0.81, 0.35, 2.55)));
      add(box(0.45, 0.018, 0.12, carbonDark, P(s * 0.58, 0.25, 2.5), 0.2)); // cascade
      add(box(0.03, 0.15, 0.28, carbon, P(s * 0.07, 0.15, 2.38)));
      // Brake-duct / wheel-wake fairing inboard of the front tyre.
      add(box(0.02, 0.3, 0.55, carbonDark, P(s * (CAR_TUNING.frontX - CAR_TUNING.frontTyreWidth / 2 - 0.045), 0.35, CAR_TUNING.frontZ)));
      add(box(0.12, 0.02, 0.5, carbon, P(s * (CAR_TUNING.frontX - CAR_TUNING.frontTyreWidth / 2 - 0.1), 0.52, CAR_TUNING.frontZ + 0.05), 0, s * 0.18));
    }

    // --- Rear wing: pylon-mounted, big endplates, beam wing -----------------------
    add(box(1.0, 0.02, 0.28, carbon, P(0, 0.78, -2.04), -0.18));
    this.rearFlap = box(1.0, 0.02, 0.2, carbon, P(0, 0.92, -2.12), -0.4);
    add(this.rearFlap);
    add(box(0.8, 0.018, 0.14, carbonDark, P(0, 0.27, -2.26), -0.1)); // beam wing
    for (const s of [-1, 1]) {
      add(box(0.02, 0.62, 0.6, paint, P(s * 0.5, 0.64, -2.04)));
      add(box(0.022, 0.05, 0.6, white, P(s * 0.5, 0.95, -2.04)));
      add(box(0.024, 0.04, 0.1, led, P(s * 0.5, 0.42, -2.34)));
    }
    add(box(0.06, 0.45, 0.14, carbon, P(0, 0.58, -1.97)));
    add(box(0.13, 0.11, 0.03, this.rearLight, P(0, 0.33, -2.3)));

    // --- Halo ---------------------------------------------------------------------
    const haloCurve = new THREE.CatmullRomCurve3([
      P(-0.3, 0.6, -0.1),
      P(-0.32, 0.72, 0.1),
      P(-0.2, 0.8, 0.42),
      P(0, 0.82, 0.58),
      P(0.2, 0.8, 0.42),
      P(0.32, 0.72, 0.1),
      P(0.3, 0.6, -0.1),
    ]);
    const halo = new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 28, 0.02, 8), carbon);
    halo.castShadow = true;
    add(halo);
    add(strut(P(0, 0.82, 0.58), P(0, 0.58, 0.72), 0.022, carbon));

    // --- Driver -----------------------------------------------------------------------
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), helmetMat);
    helmet.position.copy(P(0, 0.72, -0.04));
    helmet.scale.set(0.95, 1, 1.1);
    helmet.castShadow = true;
    add(helmet);
    add(box(0.2, 0.065, 0.1, matte, P(0, 0.725, 0.06)));
    add(box(0.14, 0.08, 0.02, new THREE.MeshStandardMaterial({ color: livery.body }), P(0, 0.8, -0.04)));

    // --- Suspension arms ---------------------------------------------------------------
    const axles = [
      { z: CAR_TUNING.frontZ, x: CAR_TUNING.frontX, tyreW: CAR_TUNING.frontTyreWidth },
      { z: CAR_TUNING.rearZ, x: CAR_TUNING.rearX, tyreW: CAR_TUNING.rearTyreWidth },
    ];
    for (const a of axles) {
      for (const s of [-1, 1]) {
        const hubX = s * (a.x - a.tyreW / 2 + 0.02);
        const bodyX = s * 0.27;
        for (const dz of [-0.2, 0.2]) {
          add(strut(P(bodyX, 0.36, a.z + dz), P(hubX, 0.38, a.z), 0.012, carbon));
          add(strut(P(bodyX, 0.13, a.z + dz), P(hubX, 0.3, a.z), 0.012, carbon));
        }
        add(strut(P(s * 0.12, 0.45, a.z + 0.15), P(hubX, 0.37, a.z), 0.012, metal));
      }
    }

    // --- Wheels ----------------------------------------------------------------------------
    const r = CAR_TUNING.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      const width = rear ? CAR_TUNING.rearTyreWidth : CAR_TUNING.frontTyreWidth;
      const steer = new THREE.Group();
      const spin = new THREE.Group();

      const tyre = new THREE.Mesh(tyreGeometry(r, width), tyreMat);
      tyre.castShadow = true;
      spin.add(tyre);

      for (const side of [-1, 1]) {
        // Compound-coloured sidewall band, dark wheel cover, hub nut.
        const band = new THREE.Mesh(new THREE.RingGeometry(0.262, 0.305, 48), bandMat);
        band.rotation.y = (Math.PI / 2) * side;
        band.position.x = side * (width / 2 + 0.001);
        spin.add(band);
        const cover = new THREE.Mesh(new THREE.CircleGeometry(0.262, 40), coverMat);
        cover.rotation.y = (Math.PI / 2) * side;
        cover.position.x = side * (width / 2 + 0.003);
        spin.add(cover);
        const ringAcc = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 32), bandMat);
        ringAcc.rotation.y = (Math.PI / 2) * side;
        ringAcc.position.x = side * (width / 2 + 0.006);
        spin.add(ringAcc);
        const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), metal);
        nut.rotation.z = Math.PI / 2;
        nut.position.x = side * (width / 2 + 0.008);
        spin.add(nut);
      }
      // A marker so rotation reads at speed.
      const mark = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 0.05, 0.1), white);
      mark.position.y = r - 0.04;
      spin.add(mark);

      steer.add(spin);
      this.root.add(steer);
      this.wheels.push(steer);
      this.wheelSpin.push(spin);
    }

    this.addDecals();
    this.collectBody();
  }

  /** The supplied F1 model: painted body, carbon wings/floor/halo and four spinning, steering wheels. */
  private buildFromModel(
    tpl: CarTemplate,
    lod: CarLod,
    m: Record<"paint" | "carbon" | "tyreMat" | "coverMat" | "bandMat" | "helmetMat", THREE.Material>,
  ): void {
    const addMesh = (parent: THREE.Object3D, name: string, mat: THREE.Material, shadow = true): void => {
      const g = tpl.geometry(`${lod}_${name}`);
      if (!g) return;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = shadow;
      parent.add(mesh);
    };
    addMesh(this.root, "paint", m.paint);
    addMesh(this.root, "carbon", m.carbon);
    // Wheels are built here rather than cut from the scan, so they are perfectly round.
    const metal = new THREE.MeshStandardMaterial({ color: 0x9ea4ad, roughness: 0.35, metalness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const width = i < 2 ? MODEL_FRONT_TYRE : MODEL_REAR_TYRE;
      const r = CAR_TUNING.wheelRadius;
      const tyre = new THREE.Mesh(tyreGeometry(r, width), m.tyreMat);
      tyre.castShadow = true;
      spin.add(tyre);
      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.RingGeometry(0.262, 0.305, 64), m.bandMat);
        band.rotation.y = (Math.PI / 2) * side;
        band.position.x = side * (width / 2 + 0.001);
        spin.add(band);
        const cover = new THREE.Mesh(coverGeometry(width / 2, side), m.coverMat);
        spin.add(cover);
        const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), metal);
        nut.rotation.z = Math.PI / 2;
        nut.position.x = side * (width / 2 + 0.024);
        spin.add(nut);
      }
      // Brake drum behind the wheel: steers with it but does not spin.
      const xSign = i % 2 === 0 ? 1 : -1;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 28), m.coverMat);
      drum.rotation.z = Math.PI / 2;
      drum.position.x = -xSign * (width / 2 + 0.03);
      steer.add(drum);
      steer.add(spin);
      this.root.add(steer);
      this.wheels.push(steer);
      this.wheelSpin.push(spin);
    }
    if (lod === "hi") this.buildArms(m.carbon, metal);
    // Driver's helmet in the cockpit and a brake light at the back.
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), m.helmetMat);
    helmet.position.set(0, 0.17, 0.33);
    helmet.scale.set(0.95, 1, 1.1);
    this.root.add(helmet);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.03), this.rearLight);
    light.position.set(0, -0.02, -2.4);
    this.root.add(light);
  }

  /** Wishbones, push-rod and track rod from the chassis to each front hub. They follow bump and steering. */
  private buildArms(carbon: THREE.Material, metal: THREE.Material): void {
    const t = CAR_TUNING;
    this.root.add(this.armGroup);
    const mk = (mat: THREE.Material, rad: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 1, 6), mat);
      mesh.castShadow = true;
      this.armGroup.add(mesh);
      return mesh;
    };
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1; // +X is the left wheel
      const z = t.frontZ;
      const inner = -s * 0.2; // towards the car, from the hub centre
      const add = (mat: THREE.Material, rad: number, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) =>
        this.arms.push({ mesh: mk(mat, rad), wheel: i, from: new THREE.Vector3(s * fx, fy, fz), to: new THREE.Vector3(inner + tx, ty, tz) });
      // Upper and lower wishbones (two legs each), outer ends meeting at the hub.
      add(carbon, 0.014, 0.16, -0.1, z + 0.3, 0, 0.12, 0.01);
      add(carbon, 0.014, 0.16, -0.1, z - 0.3, 0, 0.12, -0.01);
      add(carbon, 0.016, 0.17, -0.42, z + 0.32, 0, -0.13, 0.01);
      add(carbon, 0.016, 0.17, -0.42, z - 0.32, 0, -0.13, -0.01);
      // Push-rod to the inboard rocker, and the steering track rod behind the axle.
      add(metal, 0.01, 0.12, -0.04, z + 0.05, 0, 0.1, 0.0);
      add(metal, 0.009, 0.12, -0.24, z - 0.42, 0.0, -0.02, -0.12);
    }
  }

  private updateArms(): void {
    for (const a of this.arms) {
      const w = this.wheels[a.wheel]!;
      const ang = w.rotation.y;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const bx = w.position.x + a.to.x * c + a.to.z * sn;
      const by = w.position.y + a.to.y;
      const bz = w.position.z - a.to.x * sn + a.to.z * c;
      const dx = bx - a.from.x;
      const dy = by - a.from.y;
      const dz = bz - a.from.z;
      const len = Math.hypot(dx, dy, dz) || 1e-3;
      a.mesh.position.set(a.from.x + dx / 2, a.from.y + dy / 2, a.from.z + dz / 2);
      a.mesh.quaternion.setFromUnitVectors(Y_UP, this.tmpDir.set(dx / len, dy / len, dz / len));
      a.mesh.scale.y = len;
      a.mesh.visible = w.visible;
    }
  }

  private addDecals(): void {
    const blob = blobTexture();
    const blobMat = new THREE.MeshBasicMaterial({
      map: blob,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    const makeDecal = (w: number, l: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), blobMat);
      m.matrixAutoUpdate = false;
      m.renderOrder = 2;
      this.root.add(m);
      this.decals.push(m);
    };
    makeDecal(1.9, 4.9); // under the floor
    makeDecal(0.55, 0.95);
    makeDecal(0.55, 0.95);
    makeDecal(0.6, 0.95);
    makeDecal(0.6, 0.95);
  }

  /** Remember the body meshes so they can be dented later (geometry is cloned on the first hit). */
  private collectBody(): void {
    this.hasModel = !!getCarTemplate();
    const skip = new Set<THREE.Object3D>([...this.wheels, ...this.decals, this.armGroup]);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.geometry.type === "SphereGeometry") return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (skip.has(p)) return;
      if (m.material === this.rearLight) return;
      this.bodyMeshes.push({ mesh: m, orig: null, name: m.userData.part ?? "" });
    });
  }

  private ownGeometry(b: { mesh: THREE.Mesh; orig: Float32Array | null }): THREE.BufferGeometry {
    if (!b.orig) {
      const g = b.mesh.geometry.clone();
      g.userData.shared = false;
      b.mesh.geometry = g;
      b.orig = (g.attributes.position!.array as Float32Array).slice();
    }
    return b.mesh.geometry;
  }

  /**
   * Crumple the bodywork around a hit. (lx, lz) is the direction of the hit in the car's frame:
   * lx to the left, lz to the front. Dents are permanent until repairVisual().
   */
  dent(lx: number, lz: number, severity: number): void {
    const len = Math.hypot(lx, lz) || 1;
    const px = (lx / len) * 0.95;
    const pz = (lz / len) * 2.3 + 0.2;
    const radius = 0.55 + severity * 0.9;
    const depth = 0.07 + severity * 0.32;
    for (const b of this.bodyMeshes) {
      const g = this.ownGeometry(b);
      const pos = g.attributes.position!;
      const a = pos.array as Float32Array;
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        const x = a[i * 3]!;
        const y = a[i * 3 + 1]!;
        const z = a[i * 3 + 2]!;
        const d = Math.hypot(x - px, (y + 0.1) * 0.7, z - pz);
        if (d >= radius) continue;
        const f = (1 - d / radius) ** 2;
        const h = Math.sin(i * 12.9898) * 43758.5453;
        const jitter = 0.55 + 0.9 * (h - Math.floor(h));
        const dx = -px, dz = -pz + 0.2;
        const dl = Math.hypot(dx, dz) || 1;
        a[i * 3] = x + (dx / dl) * depth * f * jitter;
        a[i * 3 + 1] = y - depth * 0.35 * f * jitter * (Math.abs(lz) > 0.5 ? 1 : 0.4);
        a[i * 3 + 2] = z + (dz / dl) * depth * f * jitter;
        changed = true;
      }
      if (changed) {
        pos.needsUpdate = true;
        g.computeVertexNormals();
      }
    }
    this.setScorch(Math.min(1, this.scorchLevel + severity * 0.25));
  }

  private scorchLevel = 0;

  /** Darken the paint: scuffs and burn marks. 0 = clean. */
  setScorch(v: number): void {
    this.scorchLevel = v;
    this.paintMat.color.copy(this.paintBase).lerp(this.scorch, v * 0.55);
  }

  /** A part has come off. The wings are flattened away; wheels are hidden. */
  lose(zone: Zone): void {
    if (zone.startsWith("wheel")) {
      const i = ["wheelFL", "wheelFR", "wheelRL", "wheelRR"].indexOf(zone);
      if (i >= 0) this.wheels[i]!.visible = false;
      return;
    }
    if (!this.hasModel) return;
    if (zone !== "frontWing" && zone !== "rearWing") return;
    for (const b of this.bodyMeshes) {
      const g = this.ownGeometry(b);
      const pos = g.attributes.position!;
      const a = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const z = a[i * 3 + 2]!;
        if (zone === "frontWing" && z > 2.25) a[i * 3 + 2] = 2.25;
        if (zone === "rearWing" && z < -1.95) a[i * 3 + 2] = -1.95;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
    }
  }

  /** Brand-new bodywork again. */
  repairVisual(): void {
    for (const b of this.bodyMeshes) {
      if (!b.orig) continue;
      const g = b.mesh.geometry;
      (g.attributes.position!.array as Float32Array).set(b.orig);
      g.attributes.position!.needsUpdate = true;
      g.computeVertexNormals();
    }
    for (const w of this.wheels) w.visible = true;
    this.setScorch(0);
  }

  setBraking(on: boolean): void {
    this.rearLight.emissiveIntensity = on ? 3 : 0.6;
  }

  sync(snap: CarSnapshot, physics: VehiclePhysics, dt = 1 / 60): void {
    this.root.position.set(snap.x, snap.y, snap.z);
    this.root.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw);
    this.root.updateMatrixWorld(true);

    const t = CAR_TUNING;
    const xs = [t.frontX, -t.frontX, t.rearX, -t.rearX];
    const zs = [t.frontZ, t.frontZ, t.rearZ, t.rearZ];
    for (let i = 0; i < 4; i++) {
      const w = physics.wheel(i);
      const steer = this.wheels[i]!;
      steer.position.set(xs[i]!, w.y - w.suspensionLength, zs[i]!);
      steer.rotation.y = i < 2 ? w.steering : 0;
      this.wheelSpin[i]!.rotation.x = w.rotation;
    }
    this.updateArms();
    this.finishSync(snap.yaw, snap.x, snap.z, snap.speedKmh, Math.abs(snap.steering), dt);
  }

  /** Pose a car that is driven by someone else (online opponent). Wheels sit at their resting height. */
  syncRemote(pos: THREE.Vector3, quat: THREE.Quaternion, steer: number, speedKmh: number, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    this.root.updateMatrixWorld(true);
    const t = CAR_TUNING;
    const xs = [t.frontX, -t.frontX, t.rearX, -t.rearX];
    const zs = [t.frontZ, t.frontZ, t.rearZ, t.rearZ];
    this.remoteSpin += ((speedKmh / 3.6) / t.wheelRadius) * dt;
    for (let i = 0; i < 4; i++) {
      this.wheels[i]!.position.set(xs[i]!, -0.12 - 0.18, zs[i]!);
      this.wheels[i]!.rotation.y = i < 2 ? steer : 0;
      this.wheelSpin[i]!.rotation.x = this.remoteSpin;
    }
    this.updateArms();
    const yaw = Math.atan2(2 * (quat.x * quat.z + quat.w * quat.y), 1 - 2 * (quat.x * quat.x + quat.y * quat.y));
    this.finishSync(yaw, pos.x, pos.z, speedKmh, Math.abs(steer), dt);
  }

  private finishSync(yaw: number, x: number, z: number, speedKmh: number, steerAbs: number, dt: number): void {
    // Lay the contact shadows flat on the road under the car.
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, yaw, 0, "YXZ"));
    const inv = this.tmpMat.copy(this.root.matrixWorld).invert();
    const place = (decal: THREE.Mesh, px: number, pz: number) => {
      this.tmpPos.set(px, 0.035, pz);
      const world = new THREE.Matrix4().compose(this.tmpPos, this.tmpQuat.copy(yawQ), this.one);
      decal.matrix.copy(inv).multiply(world);
      decal.matrixWorldNeedsUpdate = true;
    };
    place(this.decals[0]!, x + Math.sin(yaw) * 0.1, z + Math.cos(yaw) * 0.1);
    const t = CAR_TUNING;
    const xs = [t.frontX, -t.frontX, t.rearX, -t.rearX];
    const zs = [t.frontZ, t.frontZ, t.rearZ, t.rearZ];
    for (let i = 0; i < 4; i++) {
      const wp = this.root.localToWorld(new THREE.Vector3(xs[i]!, 0, zs[i]!));
      place(this.decals[i + 1]!, wp.x, wp.z);
    }

    // Straight mode: both wings flatten at speed when the wheel is nearly straight.
    const straight = speedKmh > 170 && steerAbs < 0.02 ? 1 : 0;
    this.flapOpen += (straight - this.flapOpen) * Math.min(1, dt * 6);
    this.rearFlap.rotation.x = -0.4 + 0.36 * this.flapOpen;
    this.frontFlap.rotation.x = 0.18 - 0.14 * this.flapOpen;
  }
}
