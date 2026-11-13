import * as THREE from "three";
import trackrushLogoUrl from "../assets/trackrush-logo.png";
import type { TrackModel } from "./TrackModel";

const BOARD_WIDTH = 8;
const BOARD_HEIGHT = BOARD_WIDTH * (768 / 1202);
const BOARD_Y = 6.2;
const BILLBOARD_FRACTIONS = [0.08, 0.18, 0.28, 0.4, 0.55, 0.65, 0.8, 0.92];

let logoTexture: THREE.Texture | null = null;

export function getTrackrushLogoTexture(): THREE.Texture {
  if (!logoTexture) {
    logoTexture = new THREE.TextureLoader().load(trackrushLogoUrl);
    logoTexture.colorSpace = THREE.SRGBColorSpace;
    logoTexture.userData.shared = true;
  }
  return logoTexture;
}

/** Freestanding roadside signs with the supplied TrackRush logo. */
export function buildBillboards(model: TrackModel): THREE.Group {
  const group = new THREE.Group();
  group.name = "billboards";

  const logo = getTrackrushLogoTexture();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x4b5565, roughness: 0.5, metalness: 0.55 });
  const backingMaterial = new THREE.MeshBasicMaterial({ color: 0x07152e, side: THREE.DoubleSide });
  const logoMaterial = new THREE.MeshBasicMaterial({
    map: logo,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const offset = model.halfWidth + 1.4 + 3.2 + 1 + 8;

  BILLBOARD_FRACTIONS.forEach((fraction, i) => {
    const sample = model.samples[Math.floor(model.count * fraction)]!;
    const side = i % 2 === 0 ? -1 : 1;
    const x = sample.x + sample.nx * side * offset;
    const z = sample.z + sample.nz * side * offset;
    if (model.nearest(x, z).distance < model.halfWidth + 9) return;

    const sign = new THREE.Group();
    sign.position.set(x, 0, z);
    const facingX = -sample.nx * side - sample.tx * 1.3;
    const facingZ = -sample.nz * side - sample.tz * 1.3;
    sign.rotation.y = Math.atan2(facingX, facingZ);

    const postHeight = BOARD_Y + BOARD_HEIGHT / 2 + 0.2;
    for (const px of [-BOARD_WIDTH / 2 + 0.2, BOARD_WIDTH / 2 - 0.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, postHeight, 0.3), frameMaterial);
      post.position.set(px, postHeight / 2, -0.22);
      post.castShadow = true;
      sign.add(post);
    }

    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_WIDTH + 0.45, BOARD_HEIGHT + 0.45, 0.36),
      backingMaterial,
    );
    backing.position.y = BOARD_Y;
    backing.castShadow = true;
    sign.add(backing);

    const artwork = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT), logoMaterial);
    artwork.position.set(0, BOARD_Y, 0.2);
    sign.add(artwork);

    group.add(sign);
  });

  return group;
}
