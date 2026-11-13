import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { RaceManager } from "../race/RaceManager";
import type { TrackModel } from "../track/TrackModel";
import type { Minimap } from "../track/Minimap";
import type { CarView } from "../vehicle/CarView";
import type { VehiclePhysics, CarInput } from "../vehicle/VehiclePhysics";
import type { DriftFx } from "../vehicle/DriftFx";
import type { DriftScorer } from "../race/drift";
import type { Conditions } from "./conditions";
import type { TyreModel } from "../race/tyres";
import type { PitStop } from "../race/pit";
import type { LampLights } from "./LampLights";
import type { DamageManager } from "./DamageManager";
import type { Achievement } from "../race/achievements";
import type { TelemetryRecorder } from "../telemetry/TelemetryRecorder";
import type { GhostPlayer, GhostRecorder } from "../race/ghost";
import type { RivalField } from "../race/Rivals";
import type { PlayerInfo, PlayerState } from "../net/protocol";

export type GameMode = "race" | "free";

/** The state of one race or free-drive session. Game owns it; helpers read it. */
export interface RivalSession {
  field: RivalField;
  views: CarView[];
  labels: THREE.Sprite[];
  laps: number;
}


export interface VersusSession {
  opponent: PlayerInfo;
  slot: 0 | 1;
  ghost: CarView;
  label: THREE.Sprite;
  target: PlayerState | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  oppFinishedMs: number | null;
  myFinishedMs: number | null;
  lastSend: number;
}

export interface Session {
  trackId: string;
  mode: GameMode;
  model: TrackModel;
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  groundHandle: number;
  car: VehiclePhysics;
  carView: CarView;
  playerLabel: THREE.Sprite;
  groups: THREE.Group[];
  race: RaceManager | null;
  telemetry: TelemetryRecorder;
  minimap: Minimap;
  simMs: number;
  collisions: number;
  lastCollisionMs: number;
  flippedSince: number | null;
  lastFlipToast: number;
  lastHud: number;
  lastInput: CarInput;
  sectorChips: Array<{ text: string; done: boolean; best: boolean }>;
  startedAt: string;
  topSpeedKmh: number;
  saved: boolean;
  newBest: boolean;
  versus: VersusSession | null;
  onlineRoomId: string | null;
  onlinePlayers: Map<string, VersusSession>;
  lastOnlineSend: number;
  rivals: RivalSession | null;
  /** Sim time (ms) when the lights went out. */
  goMs: number | null;
  /** Records this lap; replayed next time as the best-lap ghost. */
  ghostRec: GhostRecorder;
  ghostPlayer: GhostPlayer | null;
  ghostView: CarView | null;
  ghostPos: THREE.Vector3;
  ghostQuat: THREE.Quaternion;
  drift: DriftScorer;
  driftFx: DriftFx;
  /** Latest slip angle, smoothed for the smoke and skid marks. */
  slip: number;
  /** Collision count at the previous step, to spot a new crash. */
  lastCrashCount: number;
  conditions: Conditions;
  /** Storage key for personal best and ghost: the track plus non-standard conditions. */
  recordKey: string;
  tyres: TyreModel | null;
  pit: PitStop | null;
  pitStops: number;
  pitHint: number;
  pitProgress: number;
  newAchievements: Achievement[];
  lastAchCheck: number;
  place: string | null;
  /** What the pit crew is doing, for the progress bar. */
  pitWork: string;
  dm: DamageManager;
  /** Real light from the street lamps at dusk and night; null in daylight. */
  lampLights: LampLights | null;
  /** Whether the damage hint toasts have been shown. */
  dmgHint: number;
}
