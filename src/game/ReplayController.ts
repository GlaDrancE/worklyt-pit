import * as THREE from "three";
import type { FollowCamera } from "../vehicle/FollowCamera";
import type { HUD } from "../ui/HUD";
import { renderLapCard, type ShareData } from "../ui/ShareCard";
import { REPLAY_CAMERAS, TV_CUT_MS, nextReplayCamera, replayCameraPose, type ReplayCamera } from "./replayCamera";
import { GHOST_OPACITY, Y_AXIS, scaleFade } from "./sceneHelpers";
import type { Session } from "./sessionTypes";

export interface ReplayDeps {
  session(): Session | null;
  hud: HUD;
  camera: THREE.PerspectiveCamera;
  followCam: FollowCamera;
  /** Bring the results panel back when the replay closes after a finished race. */
  showResultsAgain(): void;
  cardData(): ShareData | null;
}

/** Watches the saved best lap from a few camera angles, and draws the lap image. Owns no game state of its own. */
export class ReplayController {
  constructor(private readonly d: ReplayDeps) {}

  private rp: { t: number; cam: ReplayCamera; wall: number } | null = null;

  get active(): boolean {
    return this.rp !== null;
  }

  /** True when a best lap has been recorded in this session and can be watched. */
  get canReplay(): boolean {
    const s = this.d.session();
    return !!s && !!s.ghostPlayer && !!s.ghostView && !s.versus;
  }

  cameraName(): string {
    return REPLAY_CAMERAS[this.rp?.cam ?? 0];
  }

  start(): boolean {
    const s = this.d.session();
    if (!s || !this.canReplay) return false;
    this.d.hud.hideResults();
    this.d.hud.setVisible(false);
    s.carView.root.visible = false;
    for (const r of s.rivals?.views ?? []) r.root.visible = false;
    for (const l of s.rivals?.labels ?? []) l.visible = false;
    this.rp = { t: 0, cam: 0, wall: 0 };
    scaleFade(s.ghostView!.root, 1 / GHOST_OPACITY);
    s.ghostView!.root.visible = true;
    return true;
  }

  stop(): void {
    const s = this.d.session();
    if (!this.rp) return;
    this.rp = null;
    if (s) {
      s.carView.root.visible = true;
      for (const r of s.rivals?.views ?? []) r.root.visible = true;
      for (const l of s.rivals?.labels ?? []) l.visible = true;
      if (s.ghostView) {
        scaleFade(s.ghostView.root, 1);
        s.ghostView.root.visible = false;
      }
      this.d.hud.setVisible(true);
      this.d.showResultsAgain();
    }
    this.d.followCam.snap();
  }

  cycleCamera(): string {
    if (!this.rp) return "";
    this.rp.cam = nextReplayCamera(this.rp.cam);
    this.rp.wall = 0;
    return this.cameraName();
  }

  restart(): void {
    if (this.rp) this.rp.t = 0;
  }

  reset(): void {
    this.rp = null;
  }

  /** Replay position, for the on-screen clock. */
  clock(): { t: number; total: number } | null {
    const s = this.d.session();
    return this.rp && s?.ghostPlayer ? { t: this.rp.t, total: s.ghostPlayer.ms } : null;
  }

  update(s: Session, dt: number): void {
    const rp = this.rp!;
    const gp = s.ghostPlayer!;
    rp.t += dt * 1000;
    rp.wall += dt;
    if (rp.t > gp.ms + 1200) rp.t = 0; // loop, with a short pause on the line
    const pose = gp.at(Math.min(rp.t, gp.ms)) ?? gp.at(gp.ms - 1);
    if (!pose) return;
    const view = s.ghostView!;
    s.ghostPos.set(pose.x, 0.647, pose.z);
    s.ghostQuat.setFromAxisAngle(Y_AXIS, pose.yaw);
    view.syncRemote(s.ghostPos, s.ghostQuat, 0, pose.speedKmh, dt);
    const cut = (Math.floor(Math.min(rp.t, gp.ms) / TV_CUT_MS) + 1) * TV_CUT_MS;
    const ahead = gp.at(Math.min(cut, gp.ms)) ?? pose;
    const cam = replayCameraPose(rp.cam, pose, ahead, rp.wall);
    const k = rp.cam === 0 ? 1 - Math.exp(-dt * 9) : 1;
    if (rp.wall < dt * 1.5) this.d.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
    else this.d.camera.position.lerp(new THREE.Vector3(cam.pos.x, cam.pos.y, cam.pos.z), k);
    this.d.camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
    if (Math.abs(this.d.camera.fov - cam.fov) > 0.01) {
      this.d.camera.fov = cam.fov;
      this.d.camera.updateProjectionMatrix();
    }
  }

  /** Picture of the best lap's racing line coloured by speed, or null if there is no recording. */
  buildLapCard(): HTMLCanvasElement | null {
    const s = this.d.session();
    if (!s?.ghostPlayer) return null;
    const lap = s.ghostPlayer.lap;
    const line: Array<{ x: number; z: number; kmh: number }> = [];
    let top = 0;
    for (let i = 0; i < lap.t.length; i++) {
      let kmh = 0;
      if (i > 0) {
        const dtS = Math.max(0.001, (lap.t[i]! - lap.t[i - 1]!) / 1000);
        kmh = (Math.hypot(lap.x[i]! - lap.x[i - 1]!, lap.z[i]! - lap.z[i - 1]!) / dtS) * 3.6;
      }
      top = Math.max(top, kmh);
      line.push({ x: lap.x[i]!, z: lap.z[i]!, kmh });
    }
    const d = this.d.cardData();
    if (!d) return null;
    return renderLapCard({ driver: d.driver, track: d.track, conditions: d.conditions, theme: d.theme, lapMs: lap.ms, line, topSpeedKmh: top });
  }
}
