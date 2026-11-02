import * as THREE from "three";
import { stageDims } from "../ui/stageDims";
import RAPIER from "@dimforge/rapier3d-compat";
import { createEnvironment, type Environment } from "./Environment";
import { InputManager, type InputAction } from "./InputManager";
import { FpsMonitor, QUALITY_ORDER, applyQuality, type QualityLevel } from "./QualitySettings";
import { RaceManager, type RaceEvent } from "../race/RaceManager";
import { loadBest, loadSetting, saveBest, saveSetting } from "../race/storage";
import { TrackModel } from "../track/TrackModel";
import { getTrack } from "../track/tracks";
import { buildPitBox, buildScenery, buildTrackColliders, buildTrackMeshes, setLampLevel, setTrackWet } from "../track/TrackBuilder";
import { Minimap } from "../track/Minimap";
import { CarView, type Livery } from "../vehicle/CarView";
import { FollowCamera } from "../vehicle/FollowCamera";
import { NEUTRAL_INPUT, VehiclePhysics, type CarInput, type Handling } from "../vehicle/VehiclePhysics";
import { DriftFx } from "../vehicle/DriftFx";
import { DriftScorer } from "../race/drift";
import { DEFAULT_CONDITIONS, conditionsKey, describeConditions, lookFor, resolveConditions, roadGrip, type Conditions } from "./conditions";
import { applySteerFeel } from "../vehicle/steeringConfig";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { RainFx } from "./RainFx";
import { TyreModel } from "../race/tyres";
import { opponentLivery } from "../race/unlocks";
import { PitCrewClock } from "../audio/pitCrew";
import type { GameMode, RivalSession, Session, VersusSession } from "./sessionTypes";
export type { GameMode } from "./sessionTypes";
import { GHOST_LIVERY, GHOST_OPACITY, RIVAL_LIVERIES, Y_AXIS, disposeObject, fadeCar, gridPose, makeLabel, rowPose, scaleFade } from "./sceneHelpers";
import { LampLights } from "./LampLights";
import { ghostVisibility } from "./ghostFade";
import { ReplayController } from "./ReplayController";
import { PIT_SECONDS, PitStop, insideBox, pitBoxFor, rivalPitBoxFor, RIVAL_BOX_OFFSET_M } from "../race/pit";
import { DamageManager } from "./DamageManager";
import { describeZones, type DamageMode } from "../vehicle/damage";
import { NO_CONTEXT } from "../race/Rivals";
import { evaluate, loadUnlocked, saveUnlocked, type RaceStats } from "../race/achievements";
import { renderShareCard, type ShareData } from "../ui/ShareCard";
import { TelemetryRecorder, newSessionId } from "../telemetry/TelemetryRecorder";
import { download, toCSV, toJSON } from "../telemetry/Exporter";
import { HUD, formatTime } from "../ui/HUD";
import { EngineSound } from "../audio/EngineSound";
import type { EngineId } from "../audio/engineProfiles";
import { addRecord, buildRecord, updateRecord, type DriverProfile } from "../race/history";
import type { PlayerInfo, PlayerState, Standing } from "../net/protocol";
import type { Confetti } from "../ui/Confetti";
import type { RankRow } from "../ui/HUD";
import { GhostPlayer, GhostRecorder, loadGhost, saveGhost } from "../race/ghost";
import { RivalField, rankField, type Difficulty } from "../race/Rivals";


export interface RivalOptions {
  count: number;
  difficulty: Difficulty;
  /** Fixed time of day and weather (daily challenge). Otherwise the player's settings decide. */
  conditions?: Conditions;
  /** Fixed rival names (championship), so the same drivers race all season. */
  names?: readonly string[];
}

/** What a finished race against rivals gives back to the menu code (daily challenge, championship, unlocks). */
export interface RaceOutcome {
  trackId: string;
  standings: Standing[];
  bestLapMs: number | null;
  /** Total race time of the player, penalties included. */
  totalMs: number;
}

export interface VersusInit {
  opponent: PlayerInfo;
  slot: 0 | 1;
  /** Time of day and weather both drivers agreed on. */
  conditions?: Conditions;
}

const STATE_SEND_MS = 50;

export type Phase = "menu" | "playing" | "paused" | "finished";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
/** Tarmac plus kerb: grip is normal here. Beyond it the tyres are on grass. */
const KERB_MARGIN = 1.4;
const GRASS_GRIP = 0.55;


export class Game {
  phase: Phase = "menu";
  readonly followCam: FollowCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly env: Environment;
  private readonly fpsMonitor = new FpsMonitor();
  private quality: QualityLevel;
  private session: Session | null = null;
  private acc = 0;
  private lastFrame = 0;
  private rafId = 0;
  private lastConfig: { trackId: string; mode: GameMode; rivals?: RivalOptions } | null = null;
  private readonly sound = new EngineSound();
  /** The player's driver profile; set by main.ts. */
  driver: DriverProfile = { id: "guest", name: "Guest Driver" };
  /** Online hooks, set by main.ts. */
  onSendState: ((s: PlayerState) => void) | null = null;
  onFinish: ((totalMs: number) => void) | null = null;
  onValidLap: ((trackId: string, ms: number) => void) | null = null;
  rankingProvider: ((trackId: string) => RankRow[]) | null = null;
  confetti: Confetti | null = null;
  /** The last 1v1 race that was saved, so a late result can still update it. */
  private lastVersusRecord: { id: string; opponent: PlayerInfo } | null = null;
  private lastWasVersus = false;

  get isVersus(): boolean {
    return !!this.session?.versus;
  }

  get lastRaceWasVersus(): boolean {
    return this.lastWasVersus;
  }

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: HUD,
    private readonly input: InputManager,
    quality: QualityLevel,
    private readonly minimapCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.3, 1800);
    this.camera.position.set(0, 6, -12);
    this.followCam = new FollowCamera(this.camera);
    this.replayer = new ReplayController({
      session: () => this.session,
      hud: this.hud,
      camera: this.camera,
      followCam: this.followCam,
      showResultsAgain: () => {
        const s = this.session;
        if (s && this.phase === "finished") this.hud.showResults(s.model.def.name, s.race?.laps ?? [], s.race?.bestMs ?? null, this.driver.name);
      },
      cardData: () => this.shareCardData(),
    });
    this.env = createEnvironment(this.scene, this.renderer);
    this.scene.add(this.rain.object);

    this.quality = quality;
    applyQuality(this.renderer, this.env.sun, quality);
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("trackrush-stage", this.resize);
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private handling: Handling = "grip";
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly rain = new RainFx();

  private playerLivery: Livery | undefined;
  onRaceResult: ((r: RaceOutcome) => void) | null = null;

  /** Paint scheme for the player's car, used from the next race. */
  setLivery(l: Livery): void {
    this.playerLivery = l;
  }

  /** Apply the player's settings. Most take effect at once; conditions and tyres apply from the next race. */
  applySettings(next: Settings): void {
    this.settings = next;
    this.input.configure(next);
    this.sound.setVolume(next.volume);
    this.session?.car.setAssist(next.easyDrive ? "high" : next.assist);
  }

  /** Pass-throughs so the settings screen can drive the tilt sensor. */
  get inputManager(): InputManager {
    return this.input;
  }

  get controllerName(): string | null {
    return this.input.controllerName;
  }

  /** Set sky, light, rain, road and ground for a session. */
  private applyConditions(s: Session, c: Conditions): void {
    s.conditions = c;
    s.recordKey = `${s.trackId}~v2${conditionsKey(c)}`;
    const look = lookFor(c);
    this.env.setConditions(c);
    this.env.setGroundKind(s.model.def.scenery === "city" ? "pavement" : "grass");
    s.groups.forEach((g) => {
      if (g.name === "track") setTrackWet(g, c.weather === "rain");
      if (g.name === "scenery") setLampLevel(g, look.lamps);
    });
    this.lampsOn = this.settings.streetLights;
    this.applyLamps(s);
    this.rain.setActive(c.weather === "rain");
    this.sound.setRain(c.weather === "rain");
  }

  /** Street lamps: glow plus real light at dusk and night, when the player has them on. */
  private lampsOn = true;

  private applyLamps(s: Session): void {
    const look = lookFor(s.conditions);
    const level = this.lampsOn ? look.lamps : 0.05;
    s.groups.forEach((g) => {
      if (g.name === "scenery") setLampLevel(g, level);
    });
    if (s.lampLights) {
      const old = s.lampLights.group;
      this.scene.remove(old);
      s.groups = s.groups.filter((g) => g !== (old as THREE.Group));
      s.lampLights = null;
    }
    if (this.lampsOn && look.lamps >= 0.5) {
      const count = this.quality === "low" ? 4 : this.quality === "medium" ? 6 : 8;
      s.lampLights = new LampLights(s.model, count, 480 * look.lamps);
      this.scene.add(s.lampLights.group);
      s.groups.push(s.lampLights.group);
    }
  }

  /** Switch the street lamps on or off during a race (key L). Returns the new state, or null if there is nothing to switch. */
  toggleLamps(): boolean | null {
    const s = this.session;
    if (!s || lookFor(s.conditions).lamps < 0.5) return null;
    this.lampsOn = !this.lampsOn;
    this.applyLamps(s);
    return this.lampsOn;
  }

  /** Leaderboards only take laps in the circuit's standard conditions, so wet laps don't mix with dry ones. */
  private isStandard(s: Session): boolean {
    const std = s.model.def.defaultConditions ?? DEFAULT_CONDITIONS;
    return s.conditions.time === std.time && s.conditions.weather === std.weather;
  }

  /** Race (grip) or Drift handling. Takes effect on the next session; 1v1 always uses Race handling. */
  setHandling(h: Handling | string): void {
    this.handling = h === "drift" ? "drift" : "grip";
  }

  /** Choose the engine sound (V10, V8 or V6 hybrid). */
  setEngine(id: EngineId | string): void {
    this.sound.setProfile(id);
  }

  /** Frames per second over the last half second. */
  get fps(): number {
    return this.fpsMonitor.fps;
  }

  get qualityLevel(): QualityLevel {
    return this.quality;
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    applyQuality(this.renderer, this.env.sun, level);
  }

  get currentTrackName(): string {
    return this.session ? this.session.model.def.name : "";
  }

  /** Start (or restart) a driving session. */
  start(trackId: string, mode: GameMode, versus?: VersusInit, rivalOpts?: RivalOptions): void {
    this.endSession();
    this.replayer.reset();
    this.confetti?.stop();
    if (versus) mode = "race";
    this.lastWasVersus = !!versus;
    this.driftHud = null;
    this.driftFlash = null;
    this.sound.start(); // runs inside the Start click, so the browser allows audio
    this.sound.setPaused(false);
    this.lastConfig = { trackId, mode, rivals: rivalOpts };
    const def = getTrack(trackId);
    const model = new TrackModel(def);

    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    const ground = world.createCollider(
      RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0).setFriction(0.9),
    );
    const groups: THREE.Group[] = [buildTrackMeshes(model), buildScenery(model)];
    for (const g of groups) this.scene.add(g);
    buildTrackColliders(RAPIER, world, model);

    const rivalCount = rivalOpts && mode === "race" && !versus ? Math.max(0, rivalOpts.count) : 0;
    const start = rivalCount > 0 ? rowPose(model, rivalCount) : gridPose(model, versus ? versus.slot : null);
    const car = new VehiclePhysics(world, start);
    const carView = new CarView(this.playerLivery, this.quality === "low" ? "lo" : "hi");
    this.scene.add(carView.root);
    groups.push(carView.root as THREE.Group);

    const info = { session_id: newSessionId(), track_id: def.id, mode, started_at: new Date().toISOString() };
    const telemetry = new TelemetryRecorder(info);

    const s: Session = {
      trackId: def.id,
      mode,
      model,
      world,
      events: new RAPIER.EventQueue(true),
      groundHandle: ground.handle,
      car,
      carView,
      groups,
      race: null,
      telemetry,
      minimap: new Minimap(this.minimapCanvas, model),
      simMs: 0,
      collisions: 0,
      lastCollisionMs: -1000,
      flippedSince: null,
      lastFlipToast: -10000,
      lastHud: 0,
      lastInput: NEUTRAL_INPUT,
      sectorChips: [],
      startedAt: info.started_at,
      topSpeedKmh: 0,
      saved: false,
      newBest: false,
      versus: null,
      rivals: null,
      goMs: null,
      ghostRec: new GhostRecorder(),
      ghostPlayer: null,
      ghostView: null,
      ghostPos: new THREE.Vector3(),
      ghostQuat: new THREE.Quaternion(),
      drift: new DriftScorer(),
      driftFx: new DriftFx(),
      slip: 0,
      lastCrashCount: 0,
      conditions: DEFAULT_CONDITIONS,
      recordKey: `${def.id}~v2`,
      tyres: null,
      pit: null,
      pitStops: 0,
      pitHint: 0,
      pitProgress: 0,
      newAchievements: [],
      lastAchCheck: 0,
      place: null,
      pitWork: "Changing tyres",
      dm: null as unknown as DamageManager,
      lampLights: null,
      dmgHint: 0,
    };
    this.applyConditions(s, versus ? versus.conditions ?? DEFAULT_CONDITIONS : rivalOpts?.conditions ?? resolveConditions(this.settings.time, this.settings.weather, def.defaultConditions));
    const dmgMode: DamageMode = versus ? "off" : this.settings.damage;
    if (this.settings.tyreWear || (!versus && dmgMode !== "off")) {
      if (this.settings.tyreWear) s.tyres = new TyreModel(this.settings.compound);
      s.pit = new PitStop(pitBoxFor(model));
      const pitMeshes = buildPitBox(s.pit.box);
      this.scene.add(pitMeshes);
      groups.push(pitMeshes);
    }
    this.scene.add(s.driftFx.root);
    groups.push(s.driftFx.root);
    car.setHandling(versus ? "grip" : this.handling);
    applySteerFeel(versus ? "standard" : this.settings.steerFeel);
    car.setAssist(this.settings.easyDrive ? "high" : this.settings.assist);
    if (rivalOpts && rivalOpts.count > 0 && mode === "race" && !versus) {
      let pitSpot: { dist: number; lateral: number } | null = null;
      if (s.pit) {
        // Rivals get a box of their own just before the player's, painted on the road.
        const rb = rivalPitBoxFor(model);
        const rivalMeshes = buildPitBox(rb, false);
        this.scene.add(rivalMeshes);
        groups.push(rivalMeshes);
        pitSpot = { dist: Math.round((100 - RIVAL_BOX_OFFSET_M) / 2) * (model.length / model.count), lateral: model.nearest(rb.x, rb.z).lateral };
      }
      const field = new RivalField(model, rivalOpts.count, rivalOpts.difficulty, def.laps, Date.now() % 100000, pitSpot, rivalOpts.names ?? []);
      const views: CarView[] = [];
      const labels: THREE.Sprite[] = [];
      field.rivals.forEach((r, i) => {
        const view = new CarView(RIVAL_LIVERIES[i % RIVAL_LIVERIES.length]!, "lo");
        const label = makeLabel(r.name);
        this.scene.add(view.root, label);
        groups.push(view.root as THREE.Group, label as unknown as THREE.Group);
        views.push(view);
        labels.push(label);
      });
      s.rivals = { field, views, labels, laps: def.laps };
    }
    s.dm = new DamageManager({
      scene: this.scene,
      model,
      car,
      carView,
      rivals: s.rivals ? { field: s.rivals.field, views: s.rivals.views } : null,
      pit: s.pit,
      mode: dmgMode,
      toast: (m, ms) => this.hud.toast(m, ms),
      thump: (i) => this.sound.thump(i),
      rumble: (a, ms) => this.input.rumble(a, ms),
      invalidateLap: (reason) => s.race?.invalidate(reason),
      teleported: (pose) => {
        s.race?.invalidate("Recovered to the pits");
        s.race?.resync(pose.x, pose.z);
        s.flippedSince = null;
        this.followCam.snap();
      },
      crashed: () => {
        s.collisions++;
        s.lastCollisionMs = s.simMs;
      },
    });
    groups.push(s.dm.root);
    if (versus) {
      const theirs = gridPose(model, versus.slot === 0 ? 1 : 0);
      const ghost = new CarView(opponentLivery(versus.opponent.colour, this.playerLivery));
      const label = makeLabel(versus.opponent.name);
      this.scene.add(ghost.root, label);
      groups.push(ghost.root as THREE.Group, label as unknown as THREE.Group);
      s.versus = {
        opponent: versus.opponent,
        slot: versus.slot,
        ghost,
        label,
        target: null,
        pos: new THREE.Vector3(theirs.x, 0.65, theirs.z),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, theirs.yaw, 0)),
        oppFinishedMs: null,
        myFinishedMs: null,
        lastSend: 0,
      };
    }
    if (mode === "race" && !versus) {
      const saved = loadGhost(s.recordKey);
      if (saved) {
        s.ghostPlayer = new GhostPlayer(saved);
        const view = new CarView(GHOST_LIVERY, "lo");
        fadeCar(view.root, GHOST_OPACITY);
        view.root.visible = false;
        this.scene.add(view.root);
        groups.push(view.root as THREE.Group);
        s.ghostView = view;
      }
    }
    this.session = s;
    this.hud.setGhost(null);

    this.hud.hideResults();
    this.hud.clearTransient();
    this.hud.setMode(mode);
    this.input.calibrateTilt();
    this.hud.setVisible(true);
    this.hud.setSpeed(0);
    this.hud.setPoints(null);
    this.hud.clearVersus();
    this.hud.setVersus(null);
    this.hud.setResultsButtons(!!versus);

    if (mode === "race") {
      const best = loadBest(s.recordKey);
      s.race = new RaceManager(
        { gates: model.gates, sectorGates: model.sectorGates, totalLaps: def.laps, bestMs: best },
        (e) => this.onRaceEvent(e),
      );
      s.race.begin(0);
      s.race.resync(start.x, start.z);
      const rows = this.rankingProvider?.(def.id) ?? [];
      this.hud.showGrid(`Fastest · ${def.name}`, rows.slice(0, 6), this.driver.id);
      this.hud.setLap(1, def.laps);
      this.hud.setTime(0);
      this.hud.setBest(best);
      this.hud.setLast(null);
      s.sectorChips = [0, 1, 2].map(() => ({ text: "--", done: false, best: false }));
      this.hud.setSectors(s.sectorChips);
    } else {
      this.hud.toast("Free Drive · no timing · R resets to the track", 3500);
    }

    if (versus) this.hud.toast(`1v1 vs ${versus.opponent.name}`, 2500);
    this.followCam.mode = 0;
    this.followCam.snap();
    this.acc = 0;
    this.phase = "playing";
  }

  restart(): void {
    if (this.lastConfig) this.start(this.lastConfig.trackId, this.lastConfig.mode, undefined, this.lastConfig.rivals);
  }

  toMenu(): void {
    this.endSession();
    this.replayer.reset();
    this.hud.setVisible(false);
    this.hud.hideResults();
    this.hud.hideGrid();
    this.hud.setVersus(null);
    this.confetti?.stop();
    this.hud.clearTransient();
    this.phase = "menu";
    this.sound.setPaused(true);
  }

  pause(): void {
    if (this.session?.versus) {
      this.hud.toast("You can't pause a 1v1 race", 1500);
      return;
    }
    if (this.phase === "playing") {
      this.phase = "paused";
      this.sound.setPaused(true);
    }
  }

  resume(): void {
    if (this.phase === "paused") {
      this.phase = "playing";
      this.sound.setPaused(false);
      this.lastFrame = performance.now();
    }
  }

  exportTelemetry(format: "csv" | "json" = "csv"): boolean {
    const s = this.session;
    if (!s || s.telemetry.samples.length === 0) {
      this.hud.toast("No telemetry recorded yet");
      return false;
    }
    const stamp = s.telemetry.info.session_id;
    if (format === "csv") download(`trackrush_${stamp}.csv`, toCSV(s.telemetry), "text/csv");
    else download(`trackrush_${stamp}.json`, toJSON(s.telemetry), "application/json");
    return true;
  }

  /** Debug / test hook: a read-only view of the live session. */
  debugState(): Record<string, unknown> | null {
    const s = this.session;
    if (!s) return null;
    const snap = s.car.snapshot();
    return {
      phase: this.phase,
      mode: s.mode,
      simMs: Math.round(s.simMs),
      x: snap.x,
      y: snap.y,
      z: snap.z,
      speedKmh: snap.speedKmh,
      gear: this.sound.drive.gear,
      rpm: Math.round(this.sound.drive.rpm),
      muted: this.sound.isMuted,
      raceState: s.race?.state ?? null,
      lap: s.race?.lapNumber ?? null,
      samples: s.telemetry.samples.length,
      collisions: s.collisions,
      fps: Math.round(this.fpsMonitor.fps),
      quality: this.quality,
    };
  }

  // ---------------------------------------------------------------- internals

  private readonly resize = (): void => {
    const { w, h } = stageDims();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  };

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    for (const a of this.input.takeActions()) this.onAction(a);

    const s = this.session;
    if (s && this.phase === "playing") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.step(s);
        this.acc -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0; // never spiral after a long stall
    }

    if (s) {
      const snap = s.car.snapshot();
      if (!s.dm.carried) s.carView.sync(snap, s.car, dt);
      s.carView.setBraking(s.lastInput.brake > 0 && snap.forwardSpeed > 1);
      if (s.versus) this.updateGhost(s.versus, dt);
      if (s.rivals) this.updateRivalViews(s.rivals, dt);
      s.dm.frame(dt, now, snap);
      if (s.ghostPlayer && s.ghostView && s.race && !this.replayer.active) this.updateBestGhost(s, dt);
      if (this.phase === "playing" || this.phase === "finished") {
        const lv = s.car.chassis.linvel();
        this.sound.update(dt, {
          speedKmh: snap.speedKmh,
          throttle: this.phase === "playing" ? s.lastInput.throttle : 0,
          brake: this.phase === "playing" ? s.lastInput.brake : 0,
          lateralSpeed: lv.x * Math.cos(snap.yaw) - lv.z * Math.sin(snap.yaw),
        });
      }
      if (this.phase === "playing" || this.phase === "finished") {
        const lv2 = s.car.chassis.linvel();
        const intensity = Math.min(1, Math.max(0, (Math.abs(s.slip) - 0.1) / 0.4)) * Math.min(1, snap.speedKmh / 60);
        const hb = s.lastInput.handbrake && snap.speedKmh > 30 ? 0.6 : 0;
        const lat = s.model.nearest(snap.x, snap.z).lateral;
        s.driftFx.update(dt, snap, Math.max(intensity, hb), Math.atan2(lv2.x, lv2.z), Math.abs(lat) <= s.model.halfWidth + 0.8);
      }
      if (this.replayer.active) this.replayer.update(s, dt);
      else if (this.phase !== "paused") this.followCam.update(dt, snap);
      this.sound.setView(this.followCam.mode);
      if (this.phase === "playing") {
        const others: Array<{ x: number; z: number; speedKmh: number }> = s.rivals
          ? s.rivals.field.rivals.map((r) => ({ x: r.x, z: r.z, speedKmh: r.speedKmh }))
          : [];
        if (s.versus?.target) others.push({ x: s.versus.pos.x, z: s.versus.pos.z, speedKmh: s.versus.target.speedKmh });
        if (others.length > 0) this.sound.updateOthers(dt, { x: snap.x, z: snap.z, yaw: snap.yaw }, others);
      }
      s.lampLights?.update(snap.x, snap.z);
      this.env.follow(snap.x, snap.z, snap.yaw);
      this.rain.update(dt, this.camera.position, Math.sin(snap.yaw), Math.cos(snap.yaw), snap.speedKmh);
      this.updateHud(s, snap.speedKmh, now);
      const dots: Array<{ x: number; z: number; color: string }> = s.rivals
        ? s.rivals.field.rivals.map((r) => ({ x: r.x, z: r.z, color: "#ffd21f" }))
        : [];
      if (s.versus) dots.push({ x: s.versus.pos.x, z: s.versus.pos.z, color: "#1d6fd8" });
      s.minimap.draw(snap.x, snap.z, snap.yaw, dots);
    }

    if (this.phase !== "menu" && this.fpsMonitor.tick(dt)) this.lowerQuality();
    else if (this.phase === "menu") this.fpsMonitor.tick(dt);

    this.renderer.render(this.scene, this.camera);
  };

  private step(s: Session): void {
    const canDrive = s.race ? s.race.canDrive : true;
    const locked = s.dm.recov?.phase === "carried";
    const input: CarInput = canDrive && !locked ? this.input.read(FIXED_DT, s.car.forwardSpeed) : { ...NEUTRAL_INPUT, handbrake: true };
    s.lastInput = input;

    const before = s.car.snapshot();
    const near = s.model.nearest(before.x, before.z);
    const onGrass = Math.abs(near.lateral) > s.model.halfWidth + KERB_MARGIN;
    const tyreGrip = s.tyres ? s.tyres.grip() : 1;
    s.car.setSurfaceGrip((onGrass ? GRASS_GRIP : 1) * roadGrip(s.conditions) * tyreGrip);

    s.car.step(FIXED_DT, input);
    const lv0 = s.car.chassis.linvel();
    const v0x = lv0.x;
    const v0z = lv0.z;
    s.world.step(s.events);
    s.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const me = s.car.collider.handle;
      if (h1 !== me && h2 !== me) return;
      const other = h1 === me ? h2 : h1;
      if (other === s.groundHandle) return;
      if (s.simMs - s.lastCollisionMs > 400) {
        s.collisions++;
        s.lastCollisionMs = s.simMs;
        this.sound.thump(Math.min(1, Math.abs(s.car.forwardSpeed) / 40 + 0.2));
        this.input.rumble(Math.min(1, Math.abs(s.car.forwardSpeed) / 40 + 0.25), 200);
        const lv1 = s.car.chassis.linvel();
        s.dm.playerImpact(s.simMs, s.car.snapshot(), lv1.x - v0x, lv1.z - v0z);
      }
    });

    s.simMs += FIXED_DT * 1000;
    const snap = s.car.snapshot();
    if (snap.speedKmh > s.topSpeedKmh) s.topSpeedKmh = snap.speedKmh;
    {
      const lv = s.car.chassis.linvel();
      s.dm.step(FIXED_DT, snap, { x: lv.x, z: lv.z }, {
        simMs: s.simMs,
        playerDist: this.progressOf(s, snap.x, snap.z) * s.model.length,
        flipped: snap.upY < 0.35,
        canDrive,
        wet: s.conditions.weather === "rain",
      });
    }
    if (s.simMs - s.lastAchCheck > 2000) {
      s.lastAchCheck = s.simMs;
      this.checkAchievements(s, false, null, 1);
    }
    if (s.pit && (canDrive || s.dm.recov)) {
      s.tyres?.update(FIXED_DT, { speedKmh: snap.speedKmh, slip: Math.abs(s.slip), brake: input.brake, throttle: input.throttle, wet: s.conditions.weather === "rain" });
      const repairS = s.dm.repairSeconds();
      const needS = (s.tyres ? PIT_SECONDS : 0) + repairS;
      if (needS > 0) {
        const ps = s.pit.update(FIXED_DT, snap.x, snap.z, snap.speedKmh, needS);
        s.pitProgress = ps.inBox ? ps.progress : 0;
        if (ps.inBox && !ps.done) {
          const b = this.pitClock.tick(FIXED_DT);
          if (b.fire) this.sound.pitGun(b.long);
        } else this.pitClock.reset();
        s.pitWork = repairS > 0 ? (s.tyres ? "Repairing the car and changing tyres" : "Repairing the car") : "Changing tyres";
        if (ps.done) {
          const fixed = repairS > 0 ? s.dm.repairPlayer() : [];
          if (s.tyres) s.tyres.fit(this.settings.compound);
          s.pitStops++;
          s.pitHint = 0;
          this.sound.cheer(0.4);
          this.hud.toast(fixed.length ? `Repaired: ${describeZones(fixed)}${s.tyres ? " · fresh tyres" : ""}` : `Fresh ${s.tyres!.compound.name.toLowerCase()} tyres fitted`, 3000);
          this.sound.thump(0.25);
        }
      } else {
        s.pitProgress = 0;
      }
      if (s.tyres && s.tyres.wear > 0.85 && s.pitHint < 2) {
        s.pitHint = 2;
        this.hud.toast("Tyres nearly gone: stop in the blue PIT box on the straight", 3200);
      } else if (s.tyres && s.tyres.wear > 0.6 && s.pitHint < 1) {
        s.pitHint = 1;
        this.hud.toast("Tyres wearing: a pit stop will bring the grip back", 3000);
      }
    }
    if (!s.versus && canDrive) {
      s.slip = s.car.slipAngle();
      const crashed = s.collisions !== s.lastCrashCount || snap.upY < 0.5;
      s.lastCrashCount = s.collisions;
      const d = s.drift.update(FIXED_DT, s.slip, snap.speedKmh, crashed);
      const ev = s.drift.consumeEvent();
      if (ev) {
        this.driftEvent(ev.kind, ev.points);
        if (ev.kind === "bank") this.checkAchievements(s, false, null, 1);
      }
      if (d.active || d.combo > 0) this.driftHud = { combo: d.combo, mult: d.multiplier, active: d.active };
      else this.driftHud = null;
    }
    const n2 = s.model.nearest(snap.x, snap.z);

    if (s.race?.canDrive && s.goMs === null) s.goMs = s.simMs;
    if (s.rivals) s.rivals.field.step(FIXED_DT, s.race ? s.race.canDrive : false, s.simMs, s.dm.on || s.rivals ? s.dm.rivalContext(snap, s.conditions.weather === "rain") : NO_CONTEXT);

    if (s.race?.canDrive && s.race.lapInProgress) {
      s.ghostRec.sample(s.race.currentLapMs(s.simMs), snap.x, snap.z, snap.yaw, n2.index / s.model.count);
    }

    if (s.race) {
      s.race.update(s.simMs, snap.x, snap.z);
      if (s.race.state === "finished") {
        this.phase = "finished";
      }
    }

    if (s.versus && s.simMs - s.versus.lastSend >= STATE_SEND_MS) {
      s.versus.lastSend = s.simMs;
      this.onSendState?.({
        x: snap.x,
        y: snap.y,
        z: snap.z,
        qx: snap.qx,
        qy: snap.qy,
        qz: snap.qz,
        qw: snap.qw,
        speedKmh: snap.speedKmh,
        progress: this.progressOf(s, snap.x, snap.z),
        // Wheel angle in the visual convention (positive = left), the opposite of the input sign.
        steer: -snap.steering,
      });
    }

    // Fell off the world or flipped: offer a reset.
    if (snap.y < -5) this.resetCar(true);
    if (snap.upY < 0.35) {
      s.flippedSince ??= s.simMs;
      if (s.simMs - s.flippedSince > 2000 && s.simMs - s.lastFlipToast > 6000) {
        this.hud.toast("Stuck? Press R to reset to the track");
        s.lastFlipToast = s.simMs;
      }
    } else {
      s.flippedSince = null;
    }

    s.telemetry.tick(s.simMs, {
      lap_number: s.race?.lapNumber ?? 0,
      sector_number: s.race?.currentSector() ?? 0,
      position_x: snap.x,
      position_z: snap.z,
      heading_deg: ((snap.yaw * 180) / Math.PI + 360) % 360,
      speed_kmh: snap.speedKmh,
      throttle: input.throttle,
      brake: input.brake,
      steering: input.steer,
      off_track: Math.abs(n2.lateral) > s.model.halfWidth,
      lap_elapsed_ms: s.race ? Math.round(s.race.currentLapMs(s.simMs)) : 0,
      collision_count: s.collisions,
    });
  }

  /** Unlock any achievements the race has earned so far (or in full, when `completed`). */
  private checkAchievements(s: Session, completed: boolean, position: number | null, fieldSize: number): void {
    if (s.versus && !completed) return;
    const unlocked = loadUnlocked();
    const racesBefore = Number(loadSetting("races-done", "0")) || 0;
    const stats: RaceStats = {
      trackId: s.trackId,
      completed,
      versus: !!s.versus,
      collisions: s.collisions,
      topSpeedKmh: s.topSpeedKmh,
      driftTotal: s.drift.total,
      driftBest: s.drift.best,
      pitStops: s.pitStops,
      tyreWearOn: !!s.tyres,
      finalTyreWear: s.tyres ? s.tyres.wear : 0,
      validLaps: s.race ? s.race.laps.filter((l) => l.valid).length : 0,
      position,
      fieldSize,
      conditions: s.conditions,
      racesBefore,
    };
    const fresh = evaluate(stats, new Set(Object.keys(unlocked)));
    const stamp = new Date().toISOString();
    for (const a of fresh) {
      unlocked[a.id] = stamp;
      s.newAchievements.push(a);
      if (!completed) this.hud.toast(`Achievement unlocked: ${a.name}`, 3000);
    }
    if (fresh.length) saveUnlocked(unlocked);
    if (completed) saveSetting("races-done", String(racesBefore + 1));
  }

  /** Everything the share card shows, from the race that is on screen. */
  shareCardData(): ShareData | null {
    const s = this.session;
    if (!s) return null;
    const outline: Array<[number, number]> = [];
    for (let i = 0; i < s.model.count; i += 3) outline.push([s.model.samples[i]!.x, s.model.samples[i]!.z]);
    return {
      driver: this.driver.name,
      track: s.model.def.name,
      conditions: describeConditions(s.conditions),
      theme: s.conditions.time,
      bestMs: s.race?.bestMs ?? null,
      laps: s.race ? s.race.laps.filter((l) => l.valid).length : 0,
      topSpeedKmh: s.topSpeedKmh,
      driftTotal: s.drift.total,
      collisions: s.collisions,
      pitStops: s.tyres ? s.pitStops : null,
      achievements: Object.keys(loadUnlocked()).length,
      place: s.place,
      outline,
    };
  }

  // Best-lap replay -------------------------------------------------------------
  private readonly pitClock = new PitCrewClock();
  private readonly replayer: ReplayController;

  get replaying(): boolean {
    return this.replayer.active;
  }
  get canReplay(): boolean {
    return this.replayer.canReplay;
  }
  replayCameraName(): string {
    return this.replayer.cameraName();
  }
  startReplay(): boolean {
    return this.replayer.start();
  }
  stopReplay(): void {
    this.replayer.stop();
  }
  cycleReplayCamera(): string {
    return this.replayer.cycleCamera();
  }
  restartReplay(): void {
    this.replayer.restart();
  }
  replayClock(): { t: number; total: number } | null {
    return this.replayer.clock();
  }
  buildLapCard(): HTMLCanvasElement | null {
    return this.replayer.buildLapCard();
  }

  buildShareCard(): HTMLCanvasElement | null {
    const d = this.shareCardData();
    return d ? renderShareCard(d) : null;
  }

  private driftHud: { combo: number; mult: number; active: boolean } | null = null;
  private driftFlash: { text: string; state: "bank" | "lost"; until: number } | null = null;

  private driftEvent(kind: "bank" | "lost", points: number): void {
    this.driftFlash = {
      text: kind === "bank" ? `+${points} drift banked` : `Combo lost  (${points})`,
      state: kind,
      until: performance.now() + 1800,
    };
  }

  private showDriftResult(s: Session): void {
    s.drift.finish();
    if (s.versus || s.drift.total <= 0) {
      this.hud.setDriftResult(null);
      return;
    }
    const key = `drift-best-${s.trackId}`;
    const prev = Number(loadSetting(key, "0")) || 0;
    const isBest = s.drift.total > prev;
    if (isBest) saveSetting(key, String(s.drift.total));
    this.hud.setDriftResult(`Drift score: ${s.drift.total}  (best combo ${s.drift.best})${isBest ? " · new best for this track" : ` · track best ${prev}`}`);
  }

  private resetCar(silent = false): void {
    const s = this.session;
    if (!s) return;
    if (s.race && !s.race.canDrive) return; // not during the countdown / after the flag
    if (s.dm.recov?.phase === "carried") return;
    const snap = s.car.snapshot();
    const near = s.model.nearest(snap.x, snap.z);
    const pose = s.model.poseAtSample(near.index);
    s.car.reset(pose);
    s.flippedSince = null;
    s.drift.update(FIXED_DT, 0, 0, true);
    if (s.race) {
      s.race.invalidate("Car reset");
      s.race.resync(pose.x, pose.z);
    }
    this.followCam.snap();
    if (!silent) this.hud.toast(s.race ? "Car reset · lap invalid" : "Car reset");
  }

  private onAction(a: InputAction): void {
    if (a === "pause") {
      if (this.phase === "playing") this.pause();
      else if (this.phase === "paused") this.resume();
      this.onPauseChange?.(this.phase === "paused");
      return;
    }
    if (this.phase !== "playing") return;
    if (a === "reset") this.resetCar();
    if (a === "camera") this.hud.toast(`Camera: ${this.followCam.cycle()}`, 1200);
    if (a === "lamps") {
      const on = this.toggleLamps();
      this.hud.toast(on === null ? "Street lights only matter at dusk and night" : on ? "Street lights on" : "Street lights off", 1400);
    }
    if (a === "mute") this.hud.toast(this.sound.toggleMute() ? "Sound off" : "Sound on", 1200);
  }

  /** Set by main.ts so the pause overlay follows keyboard pause/resume. */
  onPauseChange: ((paused: boolean) => void) | null = null;

  private onRaceEvent(e: RaceEvent): void {
    const s = this.session;
    if (!s) return;
    switch (e.type) {
      case "countdown":
        this.hud.countdown(String(e.value));
        break;
      case "go":
        this.hud.countdown("GO!", 900);
        break;
      case "sector": {
        const idx = e.sector - 1;
        s.sectorChips[idx] = { text: formatTime(e.splitMs), done: true, best: false };
        this.hud.setSectors(s.sectorChips);
        break;
      }
      case "invalid":
        this.hud.toast(`${e.reason} · lap invalid`, 2600);
        break;
      case "lap": {
        const r = e.result;
        s.telemetry.addLap({ lap: r.lap, ms: r.ms, valid: r.valid, sectors: r.sectors });
        this.hud.setLast(r.ms, r.valid);
        if (r.valid && this.isStandard(s)) this.onValidLap?.(s.trackId, r.ms);
        {
          const snapNow = s.car.snapshot();
          const rec = s.ghostRec.finish(r.ms, snapNow.x, snapNow.z, snapNow.yaw);
          const beatsGhost = !s.ghostPlayer || r.ms < s.ghostPlayer.ms;
          if (r.valid && (e.isBest || !s.ghostPlayer) && beatsGhost && rec.t.length > 20) {
            saveGhost(s.recordKey, rec);
            s.ghostPlayer = new GhostPlayer(rec);
            if (!s.ghostView) {
              const view = new CarView(GHOST_LIVERY, "lo");
              fadeCar(view.root, GHOST_OPACITY);
              view.root.visible = false;
              this.scene.add(view.root);
              s.groups.push(view.root as THREE.Group);
              s.ghostView = view;
            }
          }
          s.ghostRec = new GhostRecorder();
        }
        if (r.valid) this.sound.cheer(e.isBest ? 1 : 0.5);
        if (r.valid && e.isBest) {
          saveBest(s.recordKey, r.ms);
          s.newBest = true;
          this.hud.setBest(r.ms);
          this.hud.toast(`New personal best · ${formatTime(r.ms)}`, 3000);
        } else if (!r.valid) {
          this.hud.toast(`Lap ${r.lap} invalid · ${formatTime(r.ms)}`, 2600);
        } else {
          this.hud.toast(`Lap ${r.lap} · ${formatTime(r.ms)}`, 2400);
        }
        s.sectorChips = [0, 1, 2].map(() => ({ text: "--", done: false, best: false }));
        // Show the finished lap's sectors until the next split arrives.
        r.sectors.forEach((v, i) => {
          s.sectorChips[i] = {
            text: formatTime(v),
            done: v !== null,
            best: v !== null && r.valid && s.race?.bestSectors[i] === v,
          };
        });
        this.hud.setSectors(s.sectorChips);
        break;
      }
      case "finished": {
        this.hud.setGhost(null);
        const total = e.laps.reduce((a, l) => a + l.ms, 0);
        const validLaps = e.laps.filter((l) => l.valid).length;
        const solo = !s.versus;
        let standings: Standing[] | null = null;
        if (s.rivals) standings = this.fieldStandings(s, s.simMs - (s.goMs ?? 0) + s.dm.penaltyMs);
        const mine = standings?.find((x) => x.id === this.driver.id);
        const points = mine ? mine.points : solo ? validLaps * 10 + (s.newBest ? 10 : 0) : undefined;
        this.saveRace(s, true, points, mine ? { position: mine.place, fieldSize: standings!.length } : undefined);
        this.sound.cheer(1);
        this.hud.showResults(s.model.def.name, e.laps, s.race?.bestMs ?? null, this.driver.name);
        this.showDriftResult(s);
        s.place = mine ? `P${mine.place} of ${standings!.length}` : null;
        this.checkAchievements(s, true, mine ? mine.place : null, standings ? standings.length : 1);
        this.hud.setResultAchievements(s.newAchievements);
        s.newAchievements = [];
        if (standings && mine) {
          this.hud.setVersus(null);
          this.hud.showVersusResult(standings, this.driver.id, false);
          const pen = s.dm.penaltyMs > 0 ? ` · time penalties +${s.dm.penaltyMs / 1000} s included` : "";
          this.hud.setPoints(`Points earned: +${mine.points}  (P${mine.place} of ${standings.length})${pen}`);
          this.confetti?.celebrate(mine.place === 1);
          if (mine.place <= 3) this.sound.celebrate(mine.place === 1);
          this.onRaceResult?.({ trackId: s.trackId, standings, bestLapMs: s.race?.bestMs ?? null, totalMs: mine.totalMs ?? 0 });
        } else if (solo) {
          this.hud.setPoints(`Points earned: +${points ?? 0}  (10 per valid lap${s.newBest ? ", +10 personal best" : ""})`);
          this.confetti?.celebrate(s.newBest);
        } else if (s.versus) {
          s.versus.myFinishedMs = total;
          this.hud.setVersus(null);
          this.hud.showVersusWaiting(s.versus.opponent.name);
          this.onFinish?.(total);
        }
        break;
      }
    }
  }

  private updateHud(s: Session, kmh: number, now: number): void {
    if (now - s.lastHud < 50) return;
    s.lastHud = now;
    this.hud.setSpeed(kmh);
    if (s.race) {
      this.hud.setTime(s.race.currentLapMs(s.simMs));
      this.hud.setLap(Math.min(s.race.lapNumber, s.model.def.laps), s.model.def.laps);
      const laps = s.model.def.laps;
      const left = Math.max(0, laps - Math.min(s.race.lapNumber, laps));
      if (s.rivals) {
        const sn = s.car.snapshot();
        const L = s.model.length;
        let p = this.progressOf(s, sn.x, sn.z);
        if (s.race.lapNumber === 1 && p > 0.9) p -= 1;
        const mine = (s.race.lapNumber - 1) * L + p * L;
        const ahead = s.rivals.field.rivals.filter((c) => c.status !== "gone" && c.dist > mine).length;
        this.hud.setPosition(ahead + 1, s.rivals.field.rivals.length + 1, left);
      } else this.hud.setPosition(null, 1, left);
    }
    this.hud.setTyres(s.tyres ? { name: s.tyres.compound.name, color: s.tyres.compound.color, lifePercent: s.tyres.lifePercent } : null);
    if (this.phase === "playing" && s.pitProgress > 0) this.hud.setPit(`${s.pitWork}… hold still`, s.pitProgress);
    else this.hud.setPit(null);
    {
      const h = s.dm.hud(now);
      this.hud.setFlag(h.flag ? h.flag.text : null, h.flag ? h.flag.kind : "yellow");
      this.hud.setDamage(h.damage ? h.damage.health : null, h.damage ? h.damage.text : "");
    }
    if (this.phase === "playing") {
      if (this.driftFlash && now < this.driftFlash.until && !this.driftHud) this.hud.setDrift(this.driftFlash.text, this.driftFlash.state);
      else if (this.driftHud) this.hud.setDrift(`DRIFT ${this.driftHud.combo}`, this.driftHud.active ? "" : "idle", this.driftHud.mult);
      else this.hud.setDrift(null);
    } else this.hud.setDrift(null);
    if (s.ghostPlayer && s.race?.canDrive && s.race.lapInProgress && this.phase === "playing") {
      const me = s.car.snapshot();
      const frac = s.model.nearest(me.x, me.z).index / s.model.count;
      const d = s.ghostPlayer.deltaMs(s.race.currentLapMs(s.simMs), frac);
      this.hud.setGhost(d === null ? null : `${d <= 0 ? "−" : "+"}${(Math.abs(d) / 1000).toFixed(2)} s vs your best`, d === null ? "" : d <= 0 ? "ahead" : "behind");
    }
    if (s.rivals && this.phase === "playing") {
      const me = s.car.snapshot();
      const mine = this.progressOf(s, me.x, me.z);
      const others = s.rivals.field.rivals.map((r) => r.dist / s.model.length);
      const ahead = others.filter((p) => p > mine).sort((a, b) => a - b);
      const place = ahead.length + 1;
      const total = others.length + 1;
      const gapAhead = ahead.length ? Math.round((ahead[0]! - mine) * s.model.length) : 0;
      const tail = ahead.length ? ` · ${gapAhead} m to P${place - 1}` : " · leading";
      this.hud.setVersus(`P${place} / ${total}${tail}`, place === 1 ? "ahead" : "");
    }
    if (s.versus && this.phase === "playing") {
      const v = s.versus;
      if (!v.target) {
        this.hud.setVersus(`vs ${v.opponent.name} · waiting for their car…`);
      } else {
        const mine = this.progressOf(s, s.car.snapshot().x, s.car.snapshot().z);
        const gap = Math.round((mine - v.target.progress) * s.model.length);
        const ahead = gap >= 0;
        const tail = v.oppFinishedMs !== null ? ` · ${v.opponent.name} has finished!` : "";
        this.hud.setVersus(`${ahead ? "P1" : "P2"} · ${ahead ? "+" : "−"}${Math.abs(gap)} m vs ${v.opponent.name}${tail}`, ahead ? "ahead" : "behind");
      }
    }
  }

  /** Laps completed plus the fraction of the current lap, so two cars can be compared. */
  private progressOf(s: Session, x: number, z: number): number {
    if (!s.race) return 0;
    const frac = s.model.nearest(x, z).index / s.model.count;
    const done = s.race.laps.length;
    // Before the first line crossing the grid slot sits just behind the line.
    if (done === 0 && frac > 0.5 && s.race.currentLapMs(s.simMs) < 10000) return frac - 1;
    return done + frac;
  }

  /** Replay the best lap next to the player and show the time gap to it. */
  private updateBestGhost(s: Session, dt: number): void {
    const view = s.ghostView!;
    const race = s.race!;
    const lapMs = race.canDrive && race.lapInProgress ? race.currentLapMs(s.simMs) : -1;
    const pose = s.ghostPlayer!.at(lapMs);
    if (!pose) {
      view.root.visible = false;
      return;
    }
    const me = s.carView.root.position;
    const inPits = s.pitProgress > 0 || (!!s.pit && insideBox(s.pit.box, me.x, me.z));
    const vis = ghostVisibility(Math.hypot(pose.x - me.x, pose.z - me.z), inPits);
    view.root.visible = vis > 0.02;
    if (!view.root.visible) return;
    scaleFade(view.root, vis);
    s.ghostPos.set(pose.x, 0.647, pose.z);
    s.ghostQuat.setFromAxisAngle(Y_AXIS, pose.yaw);
    view.syncRemote(s.ghostPos, s.ghostQuat, 0, pose.speedKmh, dt);
  }

  private updateGhost(v: VersusSession, dt: number): void {
    if (v.target) {
      const k = 1 - Math.exp(-dt * 14);
      v.pos.lerp(new THREE.Vector3(v.target.x, v.target.y, v.target.z), k);
      v.quat.slerp(new THREE.Quaternion(v.target.qx, v.target.qy, v.target.qz, v.target.qw), k);
    }
    v.ghost.syncRemote(v.pos, v.quat, v.target?.steer ?? 0, v.target?.speedKmh ?? 0, dt);
    v.label.position.set(v.pos.x, v.pos.y + 2.3, v.pos.z);
  }

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  private updateRivalViews(r: RivalSession, dt: number): void {
    r.field.rivals.forEach((st, i) => {
      if (st.status === "gone") return;
      this.tmpPos.set(st.x, 0.65, st.z);
      this.tmpQuat.setFromAxisAngle(this.yAxis, st.yaw);
      r.views[i]!.syncRemote(this.tmpPos, this.tmpQuat, st.steer, st.speedKmh, dt);
      r.labels[i]!.position.set(st.x, 2.9, st.z);
    });
  }

  /** Results against the computer-driven cars, ranked by (estimated) race time. */
  private fieldStandings(s: Session, myElapsedMs: number): Standing[] {
    const r = s.rivals!;
    return rankField({ id: this.driver.id, name: this.driver.name, ms: myElapsedMs }, r.field.rivals, r.field.totalDistance, s.goMs ?? 0);
  }

  /** Online hooks called by main.ts when the relay delivers something. */
  receiveOpponent(state: PlayerState): void {
    const v = this.session?.versus;
    if (!v) return;
    if (!v.target) v.pos.set(state.x, state.y, state.z);
    v.target = state;
  }

  opponentFinished(name: string, totalMs: number): void {
    const v = this.session?.versus;
    if (!v) return;
    v.oppFinishedMs = totalMs;
    this.hud.toast(`${name} finished · ${formatTime(totalMs)}`, 3000);
  }

  opponentLeft(name: string): void {
    if (this.session?.versus) this.hud.toast(`${name} left the race`, 3500);
  }

  /** Final standings from the relay: show the table, points and the celebration. */
  applyResult(standings: Standing[], forfeit: boolean): void {
    const s = this.session;
    if (!s?.versus) return;
    if (this.phase === "playing" || this.phase === "paused") {
      // Opponent quit: the race is over for us too.
      this.phase = "finished";
      this.saveRace(s, false);
      this.hud.showResults(s.model.def.name, s.race?.laps ?? [], s.race?.bestMs ?? null, this.driver.name);
      this.showDriftResult(s);
    }
    const me = standings.find((x) => x.id === this.driver.id);
    const other = standings.find((x) => x.id !== this.driver.id);
    this.hud.setVersus(null);
    this.hud.showVersusResult(standings, this.driver.id, forfeit);
    if (me) {
      this.hud.setPoints(`Points earned: +${me.points}  (${me.place === 1 ? "1st" : "2nd"} place)`);
      if (this.lastVersusRecord) {
        updateRecord(this.lastVersusRecord.id, {
          points: me.points,
          versus: {
            opponentId: other?.id ?? this.lastVersusRecord.opponent.id,
            opponentName: other?.name ?? this.lastVersusRecord.opponent.name,
            place: me.place,
            ...(forfeit ? { forfeit: true } : {}),
          },
        });
      }
      this.confetti?.celebrate(me.place === 1);
      if (me.place === 1) this.sound.celebrate(true);
    }
  }

  private lowerQuality(): void {
    const i = QUALITY_ORDER.indexOf(this.quality);
    if (i > 0) {
      this.setQuality(QUALITY_ORDER[i - 1]!);
      this.hud.toast(`Frame rate low · graphics set to ${this.quality}`, 3000);
      this.onQualityChange?.(this.quality);
    }
  }

  onQualityChange: ((level: QualityLevel) => void) | null = null;

  /** Store this race in the history. Quitting early only counts if a lap was finished. */
  private saveRace(s: Session, completed: boolean, points?: number, field?: { position: number; fieldSize: number }): void {
    if (!s.race || s.saved) return;
    if (!completed && s.race.laps.length === 0) return;
    s.saved = true;
    const rec = buildRecord({
        driver: this.driver,
        trackId: s.trackId,
        trackName: s.model.def.name,
        startedAt: s.startedAt,
        completed,
        totalLaps: s.model.def.laps,
        laps: s.race.laps,
        collisions: s.collisions,
        topSpeedKmh: s.topSpeedKmh,
        ...(points !== undefined ? { points } : {}),
        ...(field ?? {}),
        ...(s.versus
          ? { versus: { opponentId: s.versus.opponent.id, opponentName: s.versus.opponent.name, place: null } }
          : {}),
      });
    addRecord(rec);
    if (s.versus) this.lastVersusRecord = { id: rec.id, opponent: s.versus.opponent };
  }

  private endSession(): void {
    const s = this.session;
    if (!s) return;
    this.saveRace(s, false);
    for (const g of s.groups) {
      this.scene.remove(g);
      disposeObject(g);
    }
    s.events.free();
    s.world.free();
    this.session = null;
    this.env.setConditions(DEFAULT_CONDITIONS);
    this.env.setGroundKind("grass");
    this.rain.setActive(false);
    this.sound.setRain(false);
    this.hud.setTyres(null);
    this.hud.setPit(null);
    this.hud.setFlag(null);
    this.hud.setDamage(null);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("trackrush-stage", this.resize);
    this.endSession();
    this.input.dispose();
    this.sound.dispose();
    this.renderer.dispose();
  }
}

