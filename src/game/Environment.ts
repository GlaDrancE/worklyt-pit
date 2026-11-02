import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { lookFor, type Conditions } from "./conditions";

export interface Environment {
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  /** Keep the shadow frustum (and the headlights) centred on the car. */
  follow(x: number, z: number, yaw?: number): void;
  /** Apply time of day and weather to sky, fog, lights and ground. */
  setConditions(c: Conditions): void;
  /** City circuits sit on pavement rather than grass. */
  setGroundKind(kind: "grass" | "pavement"): void;
}

function skyTexture(top: string, mid: string, horizon: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3f7d3a";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 60 + Math.random() * 50;
    g.fillStyle = `rgba(${v * 0.55}, ${v + 40}, ${v * 0.5}, 0.35)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(300, 300);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  const first = lookFor({ time: "day", weather: "clear" });
  scene.background = skyTexture(first.skyTop, first.skyMid, first.skyHorizon);
  // Soft studio reflections so the clearcoat paint and carbon have something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();
  scene.fog = new THREE.Fog(0xcfe3f1, 180, 900);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5d3a, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.set(80, 140, 60);
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = -50;
  cam.right = 50;
  cam.top = 50;
  cam.bottom = -50;
  cam.near = 10;
  cam.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Headlights: one spot light that rides just ahead of the car. Off in daylight.
  const head = new THREE.SpotLight(0xfff4e0, 0, 110, 0.6, 0.55, 1.2);
  head.castShadow = false;
  scene.add(head, head.target);

  const grassMap = ground.material.map;
  const groundMat = ground.material;
  let oldSky: THREE.CanvasTexture | null = scene.background as THREE.CanvasTexture;
  let groundKind: "grass" | "pavement" = "grass";
  let groundTint = 0xffffff;
  const paintGround = () => {
    // Grass colour comes from the texture; pavement has no texture so needs a base colour of its own.
    groundMat.color.setHex(groundKind === "pavement" ? 0x474b53 : 0xffffff).multiply(new THREE.Color(groundTint));
  };

  const offset = new THREE.Vector3(80, 140, 60);
  return {
    sun,
    ground,
    follow(x: number, z: number, yaw = 0) {
      sun.target.position.set(x, 0, z);
      sun.position.set(x + offset.x, offset.y, z + offset.z);
      sun.target.updateMatrixWorld();
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      head.position.set(x + fx * 1.5, 0.9, z + fz * 1.5);
      head.target.position.set(x + fx * 30, 0, z + fz * 30);
      head.target.updateMatrixWorld();
    },
    setConditions(c: Conditions) {
      const l = lookFor(c);
      const sky = skyTexture(l.skyTop, l.skyMid, l.skyHorizon);
      oldSky?.dispose();
      oldSky = sky;
      scene.background = sky;
      scene.fog = new THREE.Fog(l.fog, l.fogNear, l.fogFar);
      scene.environmentIntensity = l.envIntensity;
      hemi.color.setHex(l.hemiSky);
      hemi.groundColor.setHex(l.hemiGround);
      hemi.intensity = l.hemiIntensity;
      sun.color.setHex(l.sunColor);
      sun.intensity = l.sunIntensity;
      groundTint = l.groundTint;
      paintGround();
      head.intensity = l.headlight;
    },
    setGroundKind(kind: "grass" | "pavement") {
      groundKind = kind;
      groundMat.map = kind === "pavement" ? null : grassMap;
      groundMat.needsUpdate = true;
      paintGround();
    },
  };
}
