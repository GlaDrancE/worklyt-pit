import * as THREE from "three";
import { buildGrandstands } from "./Grandstands";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { TrackModel } from "./TrackModel";
import type { PitBox } from "../race/pit";

const CURB_WIDTH = 1.4;
const BARRIER_GAP = 3.2; // metres between the kerb edge and the barrier
const BARRIER_HEIGHT = 1.0;
const BARRIER_THICK = 1.0;

const ASPHALT = new THREE.Color(0x2a2d33);
const RED = new THREE.Color(0xd8232a);
const WHITE = new THREE.Color(0xf2f2f2);
const LINE = new THREE.Color(0xe9e9e9);

/** Colour for a quad, or null to leave a gap (dashed lines). */
type ColorFn = (quadIndex: number) => THREE.Color | null;

/**
 * A flat ribbon along the centre line between two lateral offsets.
 * Built from separate quads so each quad can carry its own colour (kerb stripes).
 */
function ribbon(model: TrackModel, offA: number, offB: number, y: number, color: ColorFn): THREE.BufferGeometry {
  const n = model.count;
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = model.samples[i]!;
    const b = model.samples[(i + 1) % n]!;
    const c = color(i);
    if (!c) continue;
    const quad = [
      [a.x + a.nx * offA, a.z + a.nz * offA],
      [a.x + a.nx * offB, a.z + a.nz * offB],
      [b.x + b.nx * offA, b.z + b.nz * offA],
      [b.x + b.nx * offB, b.z + b.nz * offB],
    ] as const;
    // (a,b,c) and (b,d,c): wound so the normal faces +Y.
    for (const k of [0, 1, 2, 1, 3, 2] as const) {
      pos.push(quad[k][0], y, quad[k][1]);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Barrier wall (inner face + top) on one side. side = -1 left, +1 right. */
function barrierWall(model: TrackModel, side: -1 | 1): THREE.BufferGeometry {
  const n = model.count;
  const o = side * (model.halfWidth + CURB_WIDTH + BARRIER_GAP);
  const o2 = o + side * BARRIER_THICK;
  const pos: number[] = [];
  const col: number[] = [];
  const push = (x: number, y: number, z: number, c: THREE.Color) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < n; i++) {
    const a = model.samples[i]!;
    const b = model.samples[(i + 1) % n]!;
    const c = Math.floor(i / 3) % 2 === 0 ? RED : WHITE;
    const ax = a.x + a.nx * o;
    const az = a.z + a.nz * o;
    const bx = b.x + b.nx * o;
    const bz = b.z + b.nz * o;
    const ax2 = a.x + a.nx * o2;
    const az2 = a.z + a.nz * o2;
    const bx2 = b.x + b.nx * o2;
    const bz2 = b.z + b.nz * o2;
    // inner face
    for (const [x, y, z] of [
      [ax, 0, az], [ax, BARRIER_HEIGHT, az], [bx, 0, bz],
      [ax, BARRIER_HEIGHT, az], [bx, BARRIER_HEIGHT, bz], [bx, 0, bz],
    ] as const) push(x, y, z, c);
    // top
    for (const [x, y, z] of [
      [ax, BARRIER_HEIGHT, az], [ax2, BARRIER_HEIGHT, az2], [bx, BARRIER_HEIGHT, bz],
      [ax2, BARRIER_HEIGHT, az2], [bx2, BARRIER_HEIGHT, bz2], [bx, BARRIER_HEIGHT, bz],
    ] as const) push(x, y, z, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d")!;
  const size = 16;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#fff" : "#111";
      g.fillRect(x * size, y * size, size, size);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Visual meshes for road, kerbs, lines, barriers, start line and checkpoint markers. */
export function buildTrackMeshes(model: TrackModel): THREE.Group {
  const group = new THREE.Group();
  group.name = "track";
  const hw = model.halfWidth;

  const road = new THREE.Mesh(
    ribbon(model, -hw, hw, 0.02, () => ASPHALT),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  road.name = "road";
  road.receiveShadow = true;
  group.add(road);

  for (const side of [-1, 1] as const) {
    const edge = side * hw;
    const curb = new THREE.Mesh(
      ribbon(model, edge, edge + side * CURB_WIDTH, 0.03, (i) => (Math.floor(i / 2) % 2 === 0 ? RED : WHITE)),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    curb.receiveShadow = true;
    group.add(curb);

    const line = new THREE.Mesh(
      ribbon(model, edge - side * 0.55, edge - side * 0.3, 0.04, () => LINE),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    group.add(line);

    const wall = new THREE.Mesh(
      barrierWall(model, side),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Dashed centre line.
  const dash = new THREE.Mesh(
    ribbon(model, -0.12, 0.12, 0.04, (i) => (Math.floor(i / 3) % 2 === 0 ? LINE : null)),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  group.add(dash);

  // Start / finish line.
  const g0 = model.gates[0]!;
  const start = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 2.4),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  start.rotation.order = "YXZ";
  start.rotation.x = -Math.PI / 2;
  start.rotation.y = Math.atan2(g0.tx, g0.tz);
  start.position.set(g0.x, 0.05, g0.z);
  start.receiveShadow = true;
  group.add(start);

  // Start gantry.
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.5, metalness: 0.3 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 6, 0.8, 0.8), postMat);
  beam.position.y = 7;
  gantry.add(beam);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), postMat);
    post.position.set(sx * (hw + 3), 3.5, 0);
    gantry.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(hw * 1.2, 1.1, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xff2d3d, emissive: 0x551018, roughness: 0.4 }),
  );
  banner.position.y = 7;
  banner.position.z = 0.5;
  gantry.add(banner);
  gantry.position.set(g0.x, 0, g0.z);
  gantry.rotation.y = Math.atan2(g0.tx, g0.tz);
  gantry.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.add(gantry);

  // Checkpoint markers: thin posts at the kerb so players can see sector flow.
  const sectorColors = [0xffd23f, 0x3fa7ff, 0x7dff7a];
  for (const g of model.gates) {
    if (g.index === 0) continue;
    const sector = g.index <= model.sectorGates[0] ? 0 : g.index <= model.sectorGates[1] ? 1 : 2;
    const mat = new THREE.MeshStandardMaterial({
      color: sectorColors[sector]!,
      emissive: sectorColors[sector]!,
      emissiveIntensity: 0.35,
    });
    for (const side of [-1, 1]) {
      const offset = side * (hw + CURB_WIDTH + 0.4);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), mat);
      post.position.set(g.x + -g.tz * offset, 1.2, g.z + g.tx * offset);
      group.add(post);
    }
  }
  return group;
}

function pitTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1e5fd0";
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = "#fff";
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 248);
  g.fillStyle = "#fff";
  g.font = "800 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.translate(64, 128);
  g.rotate(-Math.PI / 2);
  g.fillText("PIT", 0, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The painted pit box and a sign beside it, so tyre stops are easy to find. */
export function buildPitBox(box: PitBox, withSign = true): THREE.Group {
  const group = new THREE.Group();
  group.name = "pit";
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(box.halfWidth * 2, box.halfLength * 2),
    new THREE.MeshStandardMaterial({ map: pitTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  );
  pad.rotation.order = "YXZ";
  pad.rotation.x = -Math.PI / 2;
  pad.rotation.y = box.yaw;
  pad.position.set(box.x, 0.055, box.z);
  pad.receiveShadow = true;
  group.add(pad);
  if (!withSign) return group;

  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1e5fd0";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#fff";
  g.font = "800 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("PIT", 64, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.2, 0.12),
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4 }),
  );
  const fx = Math.sin(box.yaw);
  const fz = Math.cos(box.yaw);
  // Right of the box (the driver's right, outside the kerb side of the road).
  const side = box.halfWidth + 3.0;
  sign.position.set(box.x - fz * side - fx * (box.halfLength - 0.5), 3.4, box.z + fx * side - fz * (box.halfLength - 0.5));
  sign.rotation.y = box.yaw + Math.PI;
  group.add(sign);
  return group;
}

/** Wet tarmac is darker and shinier. */
export function setTrackWet(track: THREE.Object3D, wet: boolean): void {
  const road = track.getObjectByName("road") as THREE.Mesh | undefined;
  if (!road) return;
  const m = road.material as THREE.MeshStandardMaterial;
  m.roughness = wet ? 0.28 : 0.95;
  m.metalness = wet ? 0.35 : 0;
  m.needsUpdate = true;
}

/** How brightly the street lamps glow (0 = off in daylight, 1 = night). */
export function setLampLevel(scenery: THREE.Object3D, level: number): void {
  const m = scenery.userData.lampMaterial as THREE.MeshStandardMaterial | undefined;
  if (m) m.emissiveIntensity = 0.1 + level * 2.6;
}

/** Static physics bodies for the barrier walls (no tunnelling: 1 m thick). */
export function buildTrackColliders(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  model: TrackModel,
): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  const n = model.count;
  const step = 2;
  const o = (s: -1 | 1) => s * (model.halfWidth + CURB_WIDTH + BARRIER_GAP + BARRIER_THICK / 2);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < n; i += step) {
      const a = model.samples[i]!;
      const b = model.samples[(i + step) % n]!;
      const ax = a.x + a.nx * o(side);
      const az = a.z + a.nz * o(side);
      const bx = b.x + b.nx * o(side);
      const bz = b.z + b.nz * o(side);
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const yaw = Math.atan2(dx, dz);
      const desc = rapier.ColliderDesc.cuboid(BARRIER_THICK / 2, BARRIER_HEIGHT / 2 + 0.2, len / 2 + 0.25)
        .setTranslation((ax + bx) / 2, BARRIER_HEIGHT / 2, (az + bz) / 2)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setFriction(0.3)
        .setRestitution(0.1);
      colliders.push(world.createCollider(desc));
    }
  }
  return colliders;
}

/** Trees (instanced) and a few buildings, placed away from the road. Deterministic. */
export function buildScenery(model: TrackModel, treeCount = 260): THREE.Group {
  const group = new THREE.Group();
  group.name = "scenery";
  const rand = mulberry32(model.def.id.length * 7919 + 17);

  const city = model.def.scenery === "city";
  if (city) addBuildings(group, model, rand);
  else addTrees(group, model, rand, treeCount);
  addLamps(group, model);

  // Public grandstands with spectators, outside the barriers.
  group.add(buildGrandstands(model, model.halfWidth + CURB_WIDTH + BARRIER_GAP + 9, model.def.id.length));
  return group;
}

function addTrees(group: THREE.Group, model: TrackModel, rand: () => number, treeCount: number): void {
  const b = model.bounds();
  const pad = 140;
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 6);
  const crownGeo = new THREE.ConeGeometry(2.6, 7, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b3a22 }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1f6b35, roughness: 0.9 }), treeCount);
  const m = new THREE.Matrix4();
  let placed = 0;
  let attempts = 0;
  while (placed < treeCount && attempts < treeCount * 30) {
    attempts++;
    const x = b.minX - pad + rand() * (b.maxX - b.minX + pad * 2);
    const z = b.minZ - pad + rand() * (b.maxZ - b.minZ + pad * 2);
    if (model.nearest(x, z).distance < model.halfWidth + 22) continue;
    const sc = 0.8 + rand() * 0.9;
    m.compose(new THREE.Vector3(x, 1.5 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
    trunks.setMatrixAt(placed, m);
    m.compose(new THREE.Vector3(x, (3 + 3.5) * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
    crowns.setMatrixAt(placed, m);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1d24";
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 12) {
    for (let x = 6; x < 60; x += 14) {
      g.fillStyle = Math.random() < 0.55 ? "#ffd98a" : "#2b3140";
      g.fillRect(x, y, 8, 7);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** City blocks: instanced boxes with lit windows, kept clear of the road. */
function addBuildings(group: THREE.Group, model: TrackModel, rand: () => number): void {
  const count = 170;
  const tex = windowTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 });
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
  const b = model.bounds();
  const pad = 110;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tint = new THREE.Color();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 60) {
    attempts++;
    const w = 16 + rand() * 24;
    const d = 16 + rand() * 24;
    const h = 20 + rand() * 70;
    const x = b.minX - pad + rand() * (b.maxX - b.minX + pad * 2);
    const z = b.minZ - pad + rand() * (b.maxZ - b.minZ + pad * 2);
    // Clear of the road, kerbs, barriers and grandstands.
    if (model.nearest(x, z).distance < model.halfWidth + 14 + Math.max(w, d) * 0.6) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() < 0.5 ? 0 : Math.PI / 2);
    m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(w, h, d));
    boxes.setMatrixAt(placed, m);
    boxes.setColorAt(placed, tint.setHSL(0.58 + rand() * 0.08, 0.1 + rand() * 0.15, 0.55 + rand() * 0.3));
    placed++;
  }
  boxes.count = placed;
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  group.add(boxes);
}

/** Where every street lamp head sits (x, z), in track order: left then right at each post. */
export function lampPositions(model: TrackModel): Array<{ x: number; z: number }> {
  const off = model.halfWidth + CURB_WIDTH + BARRIER_GAP + BARRIER_THICK + 1.2;
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < model.count; i += LAMP_STEP) {
    const s = model.samples[i]!;
    for (const side of [-1, 1]) out.push({ x: s.x + s.nx * (off - 0.7) * side, z: s.z + s.nz * (off - 0.7) * side });
  }
  return out;
}

/** Height of the lamp heads above the road. */
export const LAMP_HEIGHT = 8.1;
const LAMP_STEP = 18; // samples (36 m)

/** Street lamps outside the barriers, both sides. The glow is driven by setLampLevel. */
function addLamps(group: THREE.Group, model: TrackModel): void {
  const step = LAMP_STEP;
  const n = model.count;
  const total = Math.ceil(n / step) * 2;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b5058, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe2a8, emissiveIntensity: 0.1, roughness: 0.4 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 6), poleMat, total);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.25, 0.7), lampMat, total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const off = model.halfWidth + CURB_WIDTH + BARRIER_GAP + BARRIER_THICK + 1.2;
  let k = 0;
  for (let i = 0; i < n; i += step) {
    const s = model.samples[i]!;
    for (const side of [-1, 1]) {
      const x = s.x + s.nx * off * side;
      const z = s.z + s.nz * off * side;
      m.compose(new THREE.Vector3(x, 4, z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(k, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(s.tx, s.tz));
      m.compose(new THREE.Vector3(x - s.nx * side * 0.7, 8.1, z - s.nz * side * 0.7), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(k, m);
      q.identity();
      k++;
    }
  }
  poles.count = k;
  heads.count = k;
  group.add(poles, heads);
  group.userData.lampMaterial = lampMat;
}

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
