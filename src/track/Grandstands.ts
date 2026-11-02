import * as THREE from "three";
import type { TrackModel } from "./TrackModel";

const TIERS = 5;
const TIER_H = 0.9;
const TIER_D = 1.15;
const STAND_W = 14;
const SEAT_GAP = 0.95;

const SHIRTS = [0xe63946, 0xf1faee, 0x1d6fd8, 0xffd21f, 0x2ecc71, 0xff8c1a, 0x9b59b6, 0x111418, 0xffffff, 0x17c3b2];
const SKIN = [0xf1c9a5, 0xd9a577, 0xb07d52, 0x7d5233, 0x5a3a24];

function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = fg;
  g.font = "700 38px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spot {
  x: number;
  z: number;
  /** Direction pointing away from the track. */
  ox: number;
  oz: number;
}

/**
 * Tiered public grandstands with an instanced crowd, advertising boards,
 * catch fencing and flags, placed outside the barriers like a real circuit.
 * `offset` is the distance from the track centre line to the front of a stand.
 */
export function buildGrandstands(model: TrackModel, offset: number, seed = 5): THREE.Group {
  const group = new THREE.Group();
  group.name = "grandstands";

  const spots: Spot[] = [];
  const addSpot = (x: number, z: number, ox: number, oz: number) => {
    // Keep clear of other parts of the circuit that run close by.
    const side = [-STAND_W / 2, 0, STAND_W / 2];
    for (const s of side) {
      const px = x + -oz * s + ox * TIERS * TIER_D * 0.5;
      const pz = z + ox * s + oz * TIERS * TIER_D * 0.5;
      if (model.nearest(px, pz).distance < offset - 1.5) return;
    }
    spots.push({ x, z, ox, oz });
  };

  // Main straight: a long run of stands on both sides.
  const g0 = model.gates[0]!;
  for (const [side, from, to] of [[1, -3, 3], [-1, -2, 2]] as const) {
    const ox = side * -g0.tz;
    const oz = side * g0.tx;
    for (let k = from; k <= to; k++) {
      const along = k * (STAND_W + 2);
      addSpot(g0.x + g0.tx * along + ox * offset, g0.z + g0.tz * along + oz * offset, ox, oz);
    }
  }
  // Further round the lap, near the middle of each sector.
  const n = model.gates.length;
  for (const [frac, side] of [[0.3, 1], [0.5, -1], [0.7, 1]] as const) {
    const g = model.gates[Math.floor(n * frac) % n]!;
    const ox = side * -g.tz;
    const oz = side * g.tx;
    for (const along of [-8, 8]) {
      addSpot(g.x + g.tx * along + ox * offset, g.z + g.tz * along + oz * offset, ox, oz);
    }
  }

  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.85 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x6f7a8c, roughness: 0.9 });
  const roofA = new THREE.MeshStandardMaterial({ color: 0xff2d3d, roughness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.5, metalness: 0.4 });
  const fenceMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const boardMats = [
    new THREE.MeshBasicMaterial({ map: bannerTexture("TRACKRUSH PRO", "#d8101e", "#ffffff") }),
    new THREE.MeshBasicMaterial({ map: bannerTexture("ORIGINAL CIRCUITS", "#0d1117", "#ffd21f") }),
    new THREE.MeshBasicMaterial({ map: bannerTexture("APEX RACING", "#1d6fd8", "#ffffff") }),
  ];
  const flagMats = [0xff2d3d, 0xffffff, 0x1d6fd8, 0xffd21f].map(
    (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }),
  );

  const seatsPerRow = Math.floor(STAND_W / SEAT_GAP);
  const capacity = spots.length * TIERS * seatsPerRow;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.72, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.9 }), Math.max(capacity, 1));
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(capacity, 1));
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(capacity, 1));

  const rand = (() => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  let people = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();

  spots.forEach((sp, si) => {
    const yaw = Math.atan2(sp.ox, sp.oz); // local +Z points away from the track
    const stand = new THREE.Group();
    stand.position.set(sp.x, 0, sp.z);
    stand.rotation.y = yaw;
    q.setFromEuler(new THREE.Euler(0, yaw, 0));

    // Stepped terraces, rising away from the track.
    for (let i = 0; i < TIERS; i++) {
      const h = TIER_H * (i + 1);
      const tier = new THREE.Mesh(new THREE.BoxGeometry(STAND_W, h, TIER_D), i % 2 ? concrete : seatMat);
      tier.position.set(0, h / 2, TIER_D * (i + 0.5));
      tier.castShadow = true;
      tier.receiveShadow = true;
      stand.add(tier);
    }
    // Roof on four posts, with a flag at each end.
    const depth = TIERS * TIER_D;
    const roofY = TIER_H * TIERS + 3.4;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(STAND_W + 1, 0.35, depth + 1.4), roofA);
    roof.position.set(0, roofY, depth / 2 + 0.2);
    roof.rotation.x = -0.06;
    roof.castShadow = true;
    stand.add(roof);
    for (const px of [-STAND_W / 2 + 0.2, STAND_W / 2 - 0.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, roofY, 6), postMat);
      post.position.set(px, roofY / 2, depth - 0.3);
      post.castShadow = true;
      stand.add(post);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), postMat);
      pole.position.set(px, roofY + 1.2, depth - 0.3);
      stand.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), flagMats[(si + (px > 0 ? 1 : 0)) % flagMats.length]);
      flag.position.set(px + (px > 0 ? -0.58 : 0.58), roofY + 1.9, depth - 0.3);
      flag.rotation.y = Math.PI / 2;
      stand.add(flag);
    }
    // Advertising board and catch fence in front of the stand.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(STAND_W, 1.0), boardMats[si % boardMats.length]);
    board.position.set(0, 0.6, -0.04);
    board.rotation.y = Math.PI; // faces the track
    stand.add(board);
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(STAND_W + 1, 2.6), fenceMat);
    fence.position.set(0, 2.2, -0.9);
    stand.add(fence);
    for (let k = 0; k <= 7; k++) {
      const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 5), postMat);
      fp.position.set(-STAND_W / 2 - 0.5 + k * ((STAND_W + 1) / 7), 1.7, -0.9);
      stand.add(fp);
    }
    group.add(stand);

    // Crowd: one row of spectators per terrace, in the sun and facing the track.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (let i = 0; i < TIERS; i++) {
      const topY = TIER_H * (i + 1);
      for (let k = 0; k < seatsPerRow; k++) {
        if (rand() < 0.12) continue; // a few empty seats
        const lx = -STAND_W / 2 + SEAT_GAP * (k + 0.5) + (rand() - 0.5) * 0.2;
        const lz = TIER_D * (i + 0.5) - 0.1;
        const wx = sp.x + cos * lx + sin * lz;
        const wz = sp.z - sin * lx + cos * lz;
        const s = 0.9 + rand() * 0.2;
        const cheer = rand() < 0.3 ? 0.35 : 0;
        m.compose(new THREE.Vector3(wx, topY + 0.36 * s, wz), q, new THREE.Vector3(s, s, s));
        bodies.setMatrixAt(people, m);
        bodies.setColorAt(people, col.setHex(SHIRTS[Math.floor(rand() * SHIRTS.length)]!));
        m.compose(new THREE.Vector3(wx, topY + 0.88 * s, wz), q, new THREE.Vector3(s, s, s));
        heads.setMatrixAt(people, m);
        heads.setColorAt(people, col.setHex(SKIN[Math.floor(rand() * SKIN.length)]!));
        // One raised arm for the cheering fans.
        const armY = topY + (0.72 + cheer) * s;
        const ax = wx + cos * 0.26 * s;
        const az = wz - sin * 0.26 * s;
        m.compose(new THREE.Vector3(ax, armY, az), q, new THREE.Vector3(s, 0.6 + cheer * 1.5, s));
        arms.setMatrixAt(people, m);
        arms.setColorAt(people, col.setHex(SKIN[Math.floor(rand() * SKIN.length)]!));
        people++;
      }
    }
  });

  for (const mesh of [bodies, heads, arms]) {
    mesh.count = people;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
