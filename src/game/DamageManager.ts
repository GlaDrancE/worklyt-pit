import * as THREE from "three";
import type { TrackModel } from "../track/TrackModel";
import { frameAt } from "../track/frame";
import type { CarView } from "../vehicle/CarView";
import type { VehiclePhysics, CarSnapshot } from "../vehicle/VehiclePhysics";
import { CAR_TUNING } from "../vehicle/VehiclePhysics";
import { CarDamage, MIN_HIT_SPEED, NO_EFFECTS, ZONES, describeZones, type DamageMode, type Zone } from "../vehicle/damage";
import { DamageFx } from "../vehicle/DamageFx";
import { makeRecoveryTruck, makeSafetyCar, makeYellowFlag, type Beacons, type Truck } from "../vehicle/Support";
import { RaceControl, SC_SPEED, VSC_SPEED, type RcEvent } from "../race/raceControl";
import { carContact, toCarFrame, type Body } from "../race/contact";
import { NO_CONTEXT, type RivalContext, type RivalField } from "../race/Rivals";
import type { PitStop } from "../race/pit";

export const SC_LIMIT_KMH = 150;
/** Virtual safety car, red flag and restart: the limit the player is held to (km/h). */
export const VSC_LIMIT_KMH = 100;
export const RED_LIMIT_KMH = 60;
export const RESTART_LIMIT_KMH = 35;
export const PENALTY_MS = 5000;
const BODY_COLORS = [0xc8141f, 0x1a1c21, 0xf4f4f2, 0xc8141f];

export interface DamageEnv {
  scene: THREE.Scene;
  model: TrackModel;
  car: VehiclePhysics;
  carView: CarView;
  rivals: { field: RivalField; views: CarView[] } | null;
  pit: PitStop | null;
  mode: DamageMode;
  toast(msg: string, ms?: number): void;
  thump(intensity: number): void;
  rumble(strength: number, ms: number): void;
  /** The car was teleported (recovery): the lap no longer counts. */
  teleported(pose: { x: number; z: number; yaw: number }): void;
  /** The lap in progress no longer counts (red flag). */
  invalidateLap(reason: string): void;
  /** A new contact or crash happened (for the clean-race count). */
  crashed(): void;
}

export interface StepInfo {
  simMs: number;
  /** Player progress along the race in metres (laps included). */
  playerDist: number;
  flipped: boolean;
  canDrive: boolean;
  wet: boolean;
}

/**
 * Everything about crashes in one place: the player's damage and its effects, contacts with rival
 * cars, debris, the yellow flag / safety car / recovery truck, penalties and recovery to the pit.
 */
export class DamageManager {
  readonly damage = new CarDamage();
  readonly on: boolean;
  readonly dfx: DamageFx | null;
  readonly rc: RaceControl | null;
  readonly root = new THREE.Group();
  penaltyMs = 0;
  /** Set while the recovery truck has the player's car (input is locked). */
  recov: { phase: "waiting" | "carried"; repaired: boolean; truckGone: boolean } | null = null;
  /** The player's car is on the truck: do not drive its view. */
  carried = false;
  private readonly sc: Beacons | null;
  private readonly truck: Truck | null;
  private readonly flag: Beacons | null;
  private readonly carriedViews = new Map<string, CarView>();
  private stoppedMs = 0;
  private speedingMs = 0;
  private lastPenaltyAt = -1e9;
  private lastHitAt = -1e9;
  private greenUntil = 0;
  private hintShown = false;
  readonly hits: Array<{ simMs: number; speed: number; zones: Zone[] }> = [];

  constructor(private readonly env: DamageEnv) {
    this.on = env.mode !== "off";
    if (this.on) {
      this.dfx = new DamageFx();
      this.rc = new RaceControl(env.model);
      this.sc = makeSafetyCar();
      this.truck = makeRecoveryTruck();
      this.flag = makeYellowFlag();
      for (const o of [this.sc.group, this.truck.group, this.flag.group]) {
        o.visible = false;
        this.root.add(o);
      }
      this.root.add(this.dfx.root);
      env.scene.add(this.root);
    } else {
      this.dfx = null;
      this.rc = null;
      this.sc = null;
      this.truck = null;
      this.flag = null;
    }
  }

  get realistic(): boolean {
    return this.env.mode === "realistic";
  }

  /** Seconds of repair work the car needs (0 unless damage is realistic). */
  repairSeconds(): number {
    return this.realistic ? this.damage.repairSeconds() : 0;
  }

  private applyEffects(): void {
    this.env.car.setDamageEffects(this.realistic ? this.damage.effects() : NO_EFFECTS);
  }

  /** Context for the rival cars: other cars to avoid, safety car speed limit, yellow-flag pace. */
  rivalContext(snap: CarSnapshot, wet: boolean): RivalContext {
    const blockers: Array<{ x: number; z: number; speed: number; solid?: boolean }> = [];
    if (!this.carried) blockers.push({ x: snap.x, z: snap.z, speed: snap.speedKmh / 3.6 });
    const rc = this.rc;
    if (rc?.sc.active) {
      const f = frameAt(this.env.model, rc.sc.dist, rc.sc.lateral);
      blockers.push({ x: f.x, z: f.z, speed: rc.sc.speed, solid: true });
    }
    if (!this.on) return { ...NO_CONTEXT, blockers };
    // Red flag and the restart countdown: every car stops where it is. Virtual safety car: one slow pace for all.
    const cap = rc?.redActive ? 0 : rc?.scActive ? SC_SPEED * 1.08 : rc?.vscActive ? VSC_SPEED * 1.04 : null;
    return { blockers, cap, scale: rc?.flag === "yellow" ? 0.8 : 1, mistakes: this.realistic && !rc?.redActive && !rc?.vscActive, wet, damageOn: true };
  }

  /** Called after the physics step for a contact with scenery (walls, barriers). */
  playerImpact(simMs: number, snap: CarSnapshot, dvx: number, dvz: number): void {
    if (!this.on) return;
    const speed = Math.hypot(dvx, dvz);
    if (speed < MIN_HIT_SPEED) return;
    this.hitPlayer(simMs, snap, -dvx / speed, -dvz / speed, speed, "wall");
  }

  private hitPlayer(simMs: number, snap: CarSnapshot, hx: number, hz: number, speed: number, kind: "car" | "wall"): void {
    const { lx, lz } = toCarFrame(snap.yaw, hx, hz);
    const info = this.damage.hit(speed, lx, lz, kind);
    if (info.severity <= 0) return;
    this.lastHitAt = simMs;
    this.env.carView.dent(lx, lz, info.severity);
    for (const z of info.lost) this.env.carView.lose(z);
    this.dfx?.burst(snap.x + hx * 1.5, snap.y + 0.1, snap.z + hz * 1.5, hx, hz, info.severity, BODY_COLORS);
    this.applyEffects();
    this.hits.push({ simMs, speed, zones: info.zones.map((z) => z.zone) });
    if (info.lost.length) this.env.toast(`Lost your ${describeZones(info.lost)}!`, 2800);
    else if (!this.hintShown && this.realistic && this.damage.integrity() < 0.8) {
      this.hintShown = true;
      this.env.toast("Car damaged: it will handle worse. Drive into the blue PIT box to repair it.", 3600);
    }
  }

  /** Hits between the player's car and the rivals; the rivals are not in the physics world. */
  private rivalContacts(simMs: number, snap: CarSnapshot, lv: { x: number; z: number }): void {
    const rv = this.env.rivals;
    if (!rv || this.carried) return;
    const me: Body = { x: snap.x, z: snap.z, yaw: snap.yaw, vx: lv.x, vz: lv.z };
    rv.field.rivals.forEach((st) => {
      if (st.status === "gone") return;
      const v = st.speedKmh / 3.6;
      const b: Body = { x: st.x, z: st.z, yaw: st.yaw, vx: Math.sin(st.yaw) * v, vz: Math.cos(st.yaw) * v };
      if (Math.abs(b.x - me.x) > 7 || Math.abs(b.z - me.z) > 7) return;
      const c = carContact(me, b);
      if (!c) return;
      // Shove the player out of the other car.
      const mass = CAR_TUNING.mass;
      const j = mass * (Math.max(0, c.closing) * 0.55 + c.depth * 1.6);
      this.env.car.chassis.applyImpulse({ x: c.nx * j, y: 0, z: c.nz * j }, true);
      const fresh = rv.field.contact(st.id, -c.nx, -c.nz, c.closing, simMs, this.on);
      if (!fresh) return;
      this.env.crashed();
      this.env.thump(Math.min(1, 0.3 + Math.max(0, c.closing) / 25));
      this.env.rumble(Math.min(1, 0.3 + Math.max(0, c.closing) / 25), 200);
      if (!this.on || c.closing < MIN_HIT_SPEED) return;
      this.hitPlayer(simMs, snap, -c.nx, -c.nz, c.closing, "car");
      // The player ran into the back of a car ahead: that is the player's fault.
      const { lz } = toCarFrame(snap.yaw, -c.nx, -c.nz);
      if (lz > 0.6 && c.closing > 4 && !this.rc?.redActive) this.penalise(simMs, "Avoidable contact", PENALTY_MS);
    });
  }

  penalise(simMs: number, reason: string, ms: number): void {
    if (!this.on || !this.realistic || !this.env.rivals) return;
    if (simMs - this.lastPenaltyAt < 5000) return;
    this.lastPenaltyAt = simMs;
    this.penaltyMs += ms;
    this.env.toast(`Penalty +${ms / 1000} s: ${reason}`, 3200);
  }

  /** The pit crew finished: fix the car. */
  repairPlayer(): Zone[] {
    const fixed = this.damage.repairAll();
    this.env.carView.repairVisual();
    this.applyEffects();
    this.hintShown = false;
    if (this.recov) this.recov.repaired = true;
    this.maybeRelease();
    return fixed;
  }

  private maybeRelease(): void {
    const r = this.recov;
    if (r && r.phase === "carried" && r.repaired && r.truckGone) {
      this.recov = null;
      this.env.toast("Repaired and back in the race", 2600);
    }
  }

  private handle(ev: RcEvent): void {
    const { env } = this;
    switch (ev.type) {
      case "yellow":
        env.toast("Yellow flag: incident on track, slow down", 3000);
        break;
      case "sc-out":
        env.toast("SAFETY CAR deployed. Stay behind it and under 150 km/h", 3600);
        break;
      case "sc-in":
        env.toast("Safety car in this lap", 3000);
        break;
      case "vsc":
        env.toast("VIRTUAL SAFETY CAR: hold a steady slow pace, under 100 km/h, no overtaking", 3600);
        break;
      case "vsc-end":
        env.toast("Virtual safety car ending", 2200);
        break;
      case "red":
        env.toast("RED FLAG: race stopped. Slow down and stop while the track is cleared", 4200);
        break;
      case "restart":
        env.toast("Restart in a few seconds: wait for the green flag", 3000);
        break;
      case "green":
        this.greenUntil = performance.now() + 3500;
        env.toast("Green flag: racing again", 2600);
        break;
      case "truck-out":
        if (this.truck) this.truck.group.visible = true;
        break;
      case "loaded": {
        this.dfx?.clearDebris();
        if (!this.truck) break;
        if (ev.id === "player") {
          this.carried = true;
          this.truck.bed.add(env.carView.root);
          env.carView.root.position.set(0, 0, 0);
          env.carView.root.quaternion.identity();
          this.recov = { phase: "carried", repaired: this.recov?.repaired ?? false, truckGone: false };
          const box = env.pit?.box;
          if (box) {
            env.car.reset(box.pose);
            env.teleported(box.pose);
          }
          env.toast("Car recovered to the pits: repairs under way", 3200);
        } else if (env.rivals) {
          const i = env.rivals.field.rivals.findIndex((r) => r.id === ev.id);
          const view = env.rivals.views[i];
          if (view) {
            this.truck.bed.add(view.root);
            view.root.position.set(0, 0, 0);
            view.root.quaternion.identity();
            this.carriedViews.set(ev.id, view);
          }
          env.rivals.field.remove(ev.id);
        }
        break;
      }
      case "truck-gone": {
        if (this.truck) this.truck.group.visible = false;
        if (ev.id === "player") {
          this.carried = false;
          this.env.scene.add(this.env.carView.root);
          if (this.recov) this.recov.truckGone = true;
          this.maybeRelease();
        } else {
          const v = this.carriedViews.get(ev.id);
          if (v) {
            this.env.scene.add(v.root);
            v.root.visible = false;
            this.carriedViews.delete(ev.id);
          }
        }
        break;
      }
    }
  }

  /** One fixed physics step. */
  step(dt: number, snap: CarSnapshot, lv: { x: number; z: number }, info: StepInfo): void {
    this.rivalContacts(info.simMs, snap, lv);
    const dfx = this.dfx;
    const rc = this.rc;
    if (!this.on || !dfx || !rc) return;
    const { env } = this;
    const near = env.model.nearest(snap.x, snap.z);
    const L = env.model.length;

    // Rival crashes and hits: bodywork, flying parts, and reports to race control.
    const rv = env.rivals;
    if (rv) {
      for (const h of rv.field.drainHits()) {
        const i = rv.field.rivals.findIndex((r) => r.id === h.id);
        const view = rv.views[i];
        const st = rv.field.rivals[i];
        if (!view || !st) continue;
        view.dent(h.lx, h.lz, h.severity);
        for (const z of h.lost) view.lose(z);
        const len = Math.hypot(h.lx, h.lz) || 1;
        const w = toCarFrame(-st.yaw, h.lx / len, h.lz / len); // local -> world (inverse rotation)
        dfx.burst(st.x + w.lx * 1.5, 0.5, st.z + w.lz * 1.5, w.lx, w.lz, h.severity, BODY_COLORS);
      }
      for (const inc of rv.field.incidents.splice(0)) {
        const st = rv.field.rivals.find((r) => r.id === inc.id);
        env.toast(`${st?.name ?? "A rival"} is out and stopped on track`, 3200);
        for (const e of rc.report(inc)) this.handle(e);
      }
    }

    // The player's car is wrecked and has stopped: call the truck.
    const wrecked = this.realistic && (this.damage.isImmobilised() || info.flipped);
    if (!this.recov && wrecked && snap.speedKmh < 4) {
      this.stoppedMs += dt * 1000;
      if (this.stoppedMs > (info.flipped ? 5000 : 2500)) {
        this.stoppedMs = 0;
        this.recov = { phase: "waiting", repaired: false, truckGone: false };
        const half = env.model.halfWidth - 1.3;
        const lateral = Math.max(-half, Math.min(half, near.lateral));
        for (const e of rc.report({ id: "player", dist: (near.index / env.model.count) * L, lateral, severity: 0.8 })) this.handle(e);
        env.toast("Your car has stopped: the recovery truck is coming", 3200);
      }
    } else if (!wrecked) {
      this.stoppedMs = 0;
    }

    // Race control.
    let leader = info.playerDist;
    if (rv) for (const r of rv.field.rivals) if (r.status !== "gone") leader = Math.max(leader, r.dist);
    for (const e of rc.update(dt, leader)) this.handle(e);

    // A red flag spoils the lap for timing: the clock kept running while the race was stopped.
    if (rc.redActive) env.invalidateLap("Red flag");

    // Rules: speed limits and overtaking under the safety car, virtual safety car and red flag.
    const limit = rc.flag === "restart" ? RESTART_LIMIT_KMH : rc.flag === "red" ? RED_LIMIT_KMH : rc.scActive ? SC_LIMIT_KMH : rc.vscActive ? VSC_LIMIT_KMH : null;
    if (this.realistic && limit !== null && info.canDrive && !this.recov) {
      if (snap.speedKmh > limit) this.speedingMs += dt * 1000;
      else this.speedingMs = Math.max(0, this.speedingMs - dt * 500);
      if (this.speedingMs > 2500) {
        this.speedingMs = 0;
        this.penalise(info.simMs, rc.redActive ? "ignoring the red flag" : rc.vscActive ? "speeding under the virtual safety car" : "speeding under the safety car", PENALTY_MS);
      }
      if (rc.flag === "sc" && rc.sc.active && info.playerDist > rc.sc.dist - 3) this.penalise(info.simMs, "overtaking the safety car", PENALTY_MS);
    } else {
      this.speedingMs = 0;
    }

    // Debris on the road cuts the tyres.
    if (this.realistic && info.canDrive) {
      const n = dfx.sweep(snap.x, snap.z, 1.4);
      if (n > 0) {
        const z: Zone = snap.x > 0 ? "wheelFL" : "wheelRR";
        this.damage.health[z] = Math.max(0, this.damage.health[z] - 0.06 * n);
        this.applyEffects();
        env.toast("Ran over debris", 1600);
      }
    }
  }

  /** Per rendered frame: place the safety car, truck and flag, and run the effects. */
  frame(dt: number, nowMs: number, snap: CarSnapshot): void {
    const dfx = this.dfx;
    const rc = this.rc;
    if (!this.on || !dfx || !rc) return;
    const t = nowMs / 1000;
    const model = this.env.model;
    const place = (o: THREE.Object3D, dist: number, lat: number): void => {
      const f = frameAt(model, dist, lat);
      o.position.set(f.x, 0, f.z);
      o.rotation.y = f.yaw;
    };
    if (this.sc) {
      this.sc.group.visible = rc.sc.active;
      if (rc.sc.active) {
        place(this.sc.group, rc.sc.dist, rc.sc.lateral);
        this.sc.update(rc.flag === "sc-in" ? 0 : t);
      }
    }
    if (this.truck?.group.visible) {
      place(this.truck.group, rc.truck.dist, rc.truck.lateral);
      this.truck.update(t);
    }
    if (this.flag) {
      const inc = rc.current ?? rc.queue[0] ?? null;
      const show = !!inc && rc.flag !== "green";
      this.flag.group.visible = show;
      if (show && inc) {
        place(this.flag.group, inc.dist - 70, Math.sign(inc.lateral || 1) * (model.halfWidth + 1.2));
        this.flag.update(t);
      }
    }
    const smokers: Array<{ x: number; y: number; z: number; yaw: number; engine: number; floor: number; speedKmh: number }> = [];
    if (!this.carried) smokers.push({ x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw, engine: this.damage.health.engine, floor: this.damage.health.floor, speedKmh: snap.speedKmh });
    for (const r of this.env.rivals?.field.rivals ?? []) {
      if (r.status === "gone") continue;
      smokers.push({ x: r.x, y: 0.4, z: r.z, yaw: r.yaw, engine: r.damage.health.engine, floor: r.damage.health.floor, speedKmh: r.speedKmh });
    }
    dfx.update(dt, smokers);
  }

  /** What the HUD should show. */
  hud(nowMs: number): { flag: { text: string; kind: "yellow" | "sc" | "green" | "red" } | null; damage: { health: Record<Zone, number>; text: string } | null } {
    const rc = this.rc;
    let flag: { text: string; kind: "yellow" | "sc" | "green" | "red" } | null = null;
    if (rc) {
      if (this.recov?.phase === "carried" && !this.recov.repaired) flag = { text: "CAR RECOVERED · REPAIRING IN THE PIT", kind: "yellow" };
      else if (rc.flag === "yellow") flag = { text: "YELLOW FLAG · INCIDENT AHEAD · SLOW DOWN", kind: "yellow" };
      else if (rc.flag === "sc") flag = { text: "SAFETY CAR · STAY BEHIND IT · MAX 150 KM/H", kind: "sc" };
      else if (rc.flag === "vsc") flag = { text: "VIRTUAL SAFETY CAR · SLOW PACE · MAX 100 KM/H", kind: "sc" };
      else if (rc.flag === "red") flag = { text: "RED FLAG · RACE STOPPED · KEEP UNDER 60 KM/H", kind: "red" };
      else if (rc.flag === "restart") flag = { text: `RESTART IN ${Math.ceil(rc.restartIn)} · STAY UNDER 35 KM/H`, kind: "red" };
      else if (rc.flag === "sc-in") flag = { text: "SAFETY CAR IN THIS LAP", kind: "sc" };
      else if (nowMs < this.greenUntil) flag = { text: "GREEN FLAG", kind: "green" };
    }
    const hurt = this.on && this.damage.damagedZones().length > 0;
    const damage = hurt
      ? {
          health: { ...this.damage.health },
          text: this.realistic ? `${Math.round(this.damage.integrity() * 100)}% · ${this.damage.repairSeconds().toFixed(0)} s to fix` : `${Math.round(this.damage.integrity() * 100)}%`,
        }
      : null;
    return { flag, damage };
  }

  /** Zones list for tests and the share card. */
  get zones(): readonly Zone[] {
    return ZONES;
  }

  get lastHit(): number {
    return this.lastHitAt;
  }
}
