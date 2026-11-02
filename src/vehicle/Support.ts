import * as THREE from "three";

const std = (color: number, rough = 0.6, metal = 0.1): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function box(w: number, h: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function wheel(r: number, w: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), std(0x111111, 0.9));
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

export interface Beacons {
  group: THREE.Group;
  /** Flash the warning lights. */
  update(t: number): void;
}

function beacon(color: number, x: number, y: number, z: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), mat);
  mesh.position.set(x, y, z);
  return { mesh, mat };
}

/** The safety car: a low dark sports car with an amber light bar. +Z is forward. */
export function makeSafetyCar(): Beacons {
  const g = new THREE.Group();
  const body = std(0x20262b, 0.35, 0.5);
  g.add(box(1.95, 0.5, 4.7, body, 0, 0.55, 0));
  g.add(box(1.7, 0.42, 2.0, std(0x0e1114, 0.2, 0.6), 0, 0.99, -0.2));
  g.add(box(1.96, 0.08, 0.5, std(0x6ecb3a, 0.5), 0, 0.82, 2.0)); // green nose stripe
  g.add(box(1.96, 0.1, 0.6, std(0xdddddd, 0.5), 0, 0.88, -2.0)); // rear spoiler
  for (const [x, z] of [[0.95, 1.5], [-0.95, 1.5], [0.95, -1.5], [-0.95, -1.5]] as const) g.add(wheel(0.36, 0.3, x, 0.36, z));
  const a = beacon(0xffa000, -0.4, 1.28, -0.2);
  const b = beacon(0xffa000, 0.4, 1.28, -0.2);
  g.add(a.mesh, b.mesh);
  const bar = box(1.1, 0.05, 0.3, std(0x111111), 0, 1.22, -0.2);
  g.add(bar);
  return {
    group: g,
    update(t: number) {
      const on = Math.floor(t * 4) % 2 === 0;
      a.mat.emissiveIntensity = on ? 3 : 0.2;
      b.mat.emissiveIntensity = on ? 0.2 : 3;
    },
  };
}

export interface Truck extends Beacons {
  /** Where a loaded car sits (parent the car's root here). */
  bed: THREE.Object3D;
}

/** The recovery truck: red, with a flatbed and flashing lights. +Z is forward. */
export function makeRecoveryTruck(): Truck {
  const g = new THREE.Group();
  const red = std(0xd01818, 0.45, 0.2);
  g.add(box(2.5, 1.5, 2.1, red, 0, 1.15, 2.2)); // cab
  g.add(box(2.3, 0.7, 0.1, std(0x1a2733, 0.1, 0.6), 0, 1.45, 3.27)); // windscreen
  g.add(box(2.6, 0.32, 5.2, std(0x30343a, 0.7, 0.4), 0, 0.72, -1.0)); // bed
  g.add(box(2.62, 0.08, 5.2, std(0xf4f4f4, 0.6), 0, 0.9, -1.0)); // white stripe on the bed
  g.add(box(2.6, 0.5, 0.2, red, 0, 1.0, -3.5)); // tail board
  g.add(box(0.2, 1.6, 0.2, std(0x444a52, 0.5, 0.6), 0.9, 1.7, 0.4)); // crane post
  g.add(box(0.2, 0.2, 1.6, std(0x444a52, 0.5, 0.6), 0.9, 2.4, -0.3)); // crane arm
  for (const z of [2.4, -0.2, -2.3]) for (const x of [1.25, -1.25]) g.add(wheel(0.5, 0.35, x, 0.5, z));
  const a = beacon(0xffb300, -0.5, 2.0, 2.4);
  const b = beacon(0xffb300, 0.5, 2.0, 2.4);
  g.add(a.mesh, b.mesh);
  const bed = new THREE.Group();
  bed.position.set(0, 1.12, -1.0);
  bed.scale.setScalar(0.5);
  g.add(bed);
  return {
    group: g,
    bed,
    update(t: number) {
      const on = Math.floor(t * 3) % 2 === 0;
      a.mat.emissiveIntensity = on ? 3 : 0.2;
      b.mat.emissiveIntensity = on ? 0.2 : 3;
    },
  };
}

/** A marshal's yellow flag on a pole. */
export function makeYellowFlag(): Beacons {
  const g = new THREE.Group();
  g.add(box(0.07, 2.6, 0.07, std(0xdddddd, 0.6), 0, 1.3, 0));
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0xffc800, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), flagMat);
  flag.position.set(0.58, 2.2, 0);
  g.add(flag);
  return {
    group: g,
    update(t: number) {
      flag.rotation.y = Math.sin(t * 6) * 0.25;
    },
  };
}
