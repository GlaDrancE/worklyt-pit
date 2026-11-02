// Turns the raw single-mesh car (tools/f1-car-source.glb) into the game-ready model:
// splits off the wheels, paints regions, converts to the game's units/axes and
// writes two levels of detail into src/assets/f1-car.glb.
// Usage: node tools/build-car-model.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";

const SRC = new URL("./f1-car-source.glb", import.meta.url);
const OUT = new URL("../src/assets/f1-car.glb", import.meta.url);

// ---- load -------------------------------------------------------------------
const b = readFileSync(SRC);
const jl = b.readUInt32LE(12);
const j = JSON.parse(b.toString("utf8", 20, 20 + jl));
const bin = b.subarray(20 + jl + 8);
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const acc = (i) => j.accessors[i];
const view = (a) => j.bufferViews[a.bufferView];
const P0 = new Float32Array(ab, (view(acc(1)).byteOffset ?? 0) + (acc(1).byteOffset ?? 0), acc(1).count * 3);
const I0 = new Uint32Array(ab, view(acc(0)).byteOffset ?? 0, acc(0).count);
const nv = P0.length / 3;

// ---- smooth normals (area weighted) ------------------------------------------
const N0 = new Float32Array(nv * 3);
for (let t = 0; t < I0.length; t += 3) {
  const a = I0[t], bb = I0[t + 1], c = I0[t + 2];
  const ux = P0[bb*3] - P0[a*3], uy = P0[bb*3+1] - P0[a*3+1], uz = P0[bb*3+2] - P0[a*3+2];
  const vx = P0[c*3] - P0[a*3], vy = P0[c*3+1] - P0[a*3+1], vz = P0[c*3+2] - P0[a*3+2];
  const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  for (const k of [a, bb, c]) { N0[k*3] += nx; N0[k*3+1] += ny; N0[k*3+2] += nz; }
}
for (let i = 0; i < nv; i++) {
  const l = Math.hypot(N0[i*3], N0[i*3+1], N0[i*3+2]) || 1;
  N0[i*3] /= l; N0[i*3+1] /= l; N0[i*3+2] /= l;
}

// The scan is noisy, which makes the clear-coat look crumpled. Relax the normals over the
// neighbouring vertices a few times so the paint reads as smooth, rounded bodywork.
{
  const nbr = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < I0.length; t += 3) {
    const a = I0[t], bb = I0[t + 1], c = I0[t + 2];
    nbr[a].add(bb); nbr[a].add(c); nbr[bb].add(a); nbr[bb].add(c); nbr[c].add(a); nbr[c].add(bb);
  }
  let cur = N0;
  for (let it = 0; it < 4; it++) {
    const nxt = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      let x = cur[i*3] * 1.5, y = cur[i*3+1] * 1.5, z = cur[i*3+2] * 1.5;
      for (const u of nbr[i]) { x += cur[u*3]; y += cur[u*3+1]; z += cur[u*3+2]; }
      const l = Math.hypot(x, y, z) || 1;
      nxt[i*3] = x / l; nxt[i*3+1] = y / l; nxt[i*3+2] = z / l;
    }
    cur = nxt;
  }
  N0.set(cur);
}

// ---- model-space landmarks (measured from the source mesh) ---------------------
const Z0 = -0.0195;           // lateral centre line
const HUB_Y = -0.091;         // wheel centre height
const R = 0.14;               // wheel radius
// Hub centres: [model x, model z] for the four wheels. Found from the tyre outer faces.
function fitWheel(x0, x1, zs) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < nv; i++) {
    const x = P0[i*3], y = P0[i*3+1], z = P0[i*3+2];
    if (x < x0 || x > x1 || y > 0.07) continue;
    if (zs < 0 ? z > -0.2 : z < 0.17) continue;
    if (Math.abs(z - Z0) > 0.33) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, wx: maxX - minX };
}
const wheelsModel = [
  { ...fitWheel(-0.72, -0.38, +1), rear: false, side: +1 },
  { ...fitWheel(-0.72, -0.38, -1), rear: false, side: -1 },
  { ...fitWheel(0.52, 0.86, +1), rear: true, side: +1 },
  { ...fitWheel(0.52, 0.86, -1), rear: true, side: -1 },
];
// Use the outer-face extent to get the true centre in x; mirror the pair for consistency.
const frontX = (wheelsModel[0].x + wheelsModel[1].x) / 2;
const rearX = (wheelsModel[2].x + wheelsModel[3].x) / 2;
for (const w of wheelsModel) w.x = w.rear ? rearX : frontX;
console.log("wheels (model):", wheelsModel.map((w) => `${w.rear ? "R" : "F"}${w.side > 0 ? "+" : "-"} x=${w.x.toFixed(3)} z=${w.z.toFixed(3)} w=${w.wx.toFixed(3)}`).join(" | "));

// ---- game-space mapping -----------------------------------------------------------
const WHEELBASE = 3.4, TRACK_HALF = 0.78, HUB_GAME_Y = -0.30, SW = 0.35 / R;
const xm = (frontX + rearX) / 2;
const LZ = WHEELBASE / (rearX - frontX);
const SX = TRACK_HALF / ((Math.abs(wheelsModel[0].z - Z0) + Math.abs(wheelsModel[1].z - Z0)) / 2);
const SY = SW;
const toGame = (x, y, z) => [(z - Z0) * SX, (y - HUB_Y) * SY + HUB_GAME_Y, -(x - xm) * LZ];
console.log(`scales: lateral ${SX.toFixed(3)}, vertical ${SY.toFixed(3)}, length ${LZ.toFixed(3)}, wheels ${SW.toFixed(3)}`);

// ---- triangle classification ---------------------------------------------------------
const tris = I0.length / 3;
const owner = new Int8Array(tris); // 0..3 wheel index, -1 body
const cls = new Uint8Array(tris);  // body: 0 paint, 1 carbon; wheel: 0 rubber, 1 rim, 2 band
for (let t = 0; t < tris; t++) {
  const a = I0[t*3], bb = I0[t*3+1], c = I0[t*3+2];
  const cx = (P0[a*3] + P0[bb*3] + P0[c*3]) / 3, cy = (P0[a*3+1] + P0[bb*3+1] + P0[c*3+1]) / 3, cz = (P0[a*3+2] + P0[bb*3+2] + P0[c*3+2]) / 3;
  let w = -1;
  for (let k = 0; k < 4; k++) {
    const W = wheelsModel[k];
    // Generous cylinder: also swallows the stray tyre-shoulder triangles the old test left on the body.
    if (Math.hypot(cx - W.x, cy - HUB_Y) < R * 1.06 && Math.abs(cz - W.z) < 0.12) { w = k; break; }
  }
  owner[t] = w;
  if (w < 0) {
    // The scan's front suspension is a pair of rough slabs that never move with the wheels.
    // They are dropped here; CarView draws clean arms and track rods that follow each wheel.
    const [gx, gy, gz] = toGame(cx, cy, cz);
    if (Math.abs(gx) > 0.17 && Math.abs(gx) < 0.70 && gz > 1.28 && gz < 1.9 && gy < 0.05) owner[t] = -2;
  }
  if (owner[t] >= 0) {
    const W = wheelsModel[w];
    const r = Math.hypot(cx - W.x, cy - HUB_Y) / R;
    const nz = (N0[a*3+2] + N0[bb*3+2] + N0[c*3+2]) / 3;
    const outerFace = Math.abs(nz) > 0.45;
    cls[t] = outerFace && r < 0.52 ? 1 : outerFace && r > 0.74 && r < 0.86 ? 2 : 0;
  } else if (owner[t] === -1) {
    const ny = (N0[a*3+1] + N0[bb*3+1] + N0[c*3+1]) / 3;
    const frontWing = cx < -0.80 && cy < -0.01;
    const rearWing = cx > 0.62 && cy > -0.12;
    const floor = cy < -0.17 || (ny < -0.6 && cy < -0.08);
    const halo = cy > 0.075 && cx > -0.40 && cx < 0.12;
    cls[t] = frontWing || rearWing || floor || halo ? 1 : 0;
  }
}
const count = (f) => { let n = 0; for (let t = 0; t < tris; t++) if (f(t)) n++; return n; };
console.log("tris: body paint", count((t) => owner[t] === -1 && cls[t] === 0), "carbon", count((t) => owner[t] === -1 && cls[t] === 1), "wheels", count((t) => owner[t] >= 0));

// ---- mesh building ------------------------------------------------------------------------
await MeshoptSimplifier.ready;
function build(sel, mapPos, mapNrm, targetTris) {
  const idx = [];
  for (let t = 0; t < tris; t++) if (sel(t)) idx.push(I0[t*3], I0[t*3+1], I0[t*3+2]);
  let indices = Uint32Array.from(idx);
  if (targetTris && indices.length / 3 > targetTris) {
    const [s] = MeshoptSimplifier.simplify(indices, P0, 3, targetTris * 3, 0.02, ["LockBorder"]);
    indices = s;
  }
  const remap = new Map();
  const pos = [], nrm = [], out = [];
  for (const v of indices) {
    let k = remap.get(v);
    if (k === undefined) {
      k = remap.size; remap.set(v, k);
      const [x, y, z] = mapPos(P0[v*3], P0[v*3+1], P0[v*3+2]);
      pos.push(x, y, z);
      const n = mapNrm(N0[v*3], N0[v*3+1], N0[v*3+2]);
      nrm.push(n[0], n[1], n[2]);
    }
    out.push(k);
  }
  return { pos: Float32Array.from(pos), nrm: Int8Array.from(nrm.map((n) => Math.round(n * 127))), idx: out, tris: out.length / 3 };
}
const bodyNrm = (nx, ny, nz) => { // model normal -> game normal (inverse transpose of the anisotropic scale)
  const gx = nz / SX, gy = ny / SY, gz = -nx / LZ;
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
};
const wheelNrm = (nx, ny, nz) => [nz, ny, -nx];

const LODS = { hi: { body: 70000, wheel: 4200 }, lo: { body: 13000, wheel: 1300 } };
const meshes = []; // {name, part}
for (const [lod, budget] of Object.entries(LODS)) {
  const bodyTotal = count((t) => owner[t] === -1);
  for (const [cn, ci] of [["paint", 0], ["carbon", 1]]) {
    const n = count((t) => owner[t] === -1 && cls[t] === ci);
    meshes.push({ name: `${lod}_${cn}`, part: build((t) => owner[t] === -1 && cls[t] === ci, toGame, bodyNrm, Math.round(budget.body * n / bodyTotal)) });
  }
  // Wheels are built in code (CarView) so they are perfectly round; none are exported.
}
for (const lod of Object.keys(LODS)) console.log(lod, "triangles:", meshes.filter((m) => m.name.startsWith(lod)).reduce((a, m) => a + m.part.tris, 0));

// ---- write GLB ------------------------------------------------------------------------------------
const chunks = [];
let off = 0;
const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [];
const push = (buf, target, stride) => {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.byteLength, target, ...(stride ? { byteStride: stride } : {}) });
  chunks.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  off += buf.byteLength;
  return bufferViews.length - 1;
};
for (const m of meshes) {
  const p = m.part;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i+k]); mx[k] = Math.max(mx[k], p.pos[i+k]); }
  const nrm4 = new Int8Array((p.nrm.length / 3) * 4);
  for (let i = 0; i < p.nrm.length / 3; i++) { nrm4[i*4] = p.nrm[i*3]; nrm4[i*4+1] = p.nrm[i*3+1]; nrm4[i*4+2] = p.nrm[i*3+2]; }
  const big = p.pos.length / 3 > 65535;
  const ind = big ? Uint32Array.from(p.idx) : Uint16Array.from(p.idx);
  const bvI = push(ind, 34963), bvP = push(p.pos, 34962), bvN = push(nrm4, 34962, 4);
  accessors.push({ bufferView: bvI, componentType: big ? 5125 : 5123, count: p.idx.length, type: "SCALAR" });
  accessors.push({ bufferView: bvP, componentType: 5126, count: p.pos.length / 3, type: "VEC3", min: mn, max: mx });
  accessors.push({ bufferView: bvN, componentType: 5120, normalized: true, count: p.nrm.length / 3, type: "VEC3" });
  const a = accessors.length - 3;
  gltfMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: a + 1, NORMAL: a + 2 }, indices: a, mode: 4 }] });
  nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
}
const total = off + ((4 - (off % 4)) % 4);
const json = { asset: { version: "2.0", generator: "trackrush build-car-model" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gltfMeshes, accessors, bufferViews, buffers: [{ byteLength: total }] };
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const binBuf = Buffer.concat([...chunks, Buffer.alloc(total - off)]);
const head = Buffer.alloc(12);
head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binBuf.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write("JSON", 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.write("BIN\0", 4);
writeFileSync(OUT, Buffer.concat([head, jh, js, bh, binBuf]));
console.log("wrote", OUT.pathname, ((12 + 8 + js.length + 8 + binBuf.length) / 1e6).toFixed(2), "MB");
