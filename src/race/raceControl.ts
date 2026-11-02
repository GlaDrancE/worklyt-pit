/**
 * Race control for incidents: yellow flag, safety car, and a recovery truck that
 * collects a stopped car. Pure logic in track coordinates (metres along the lap and
 * metres to the driver's right), so it can be tested without any graphics.
 */
export interface TrackLike {
  length: number;
  halfWidth: number;
}

export type Flag = "green" | "yellow" | "vsc" | "sc" | "sc-in" | "red" | "restart";

export interface Incident {
  id: string;
  /** Metres along the lap where the car stopped. */
  dist: number;
  /** Metres to the right of the centre line. */
  lateral: number;
  severity: number;
}

export type TruckState = "idle" | "driving" | "loading" | "leaving";

export interface Mover {
  dist: number;
  lateral: number;
  speed: number;
  active: boolean;
}

export type RcEvent =
  | { type: "yellow" }
  | { type: "sc-out" }
  | { type: "sc-in" }
  | { type: "vsc" }
  | { type: "vsc-end" }
  | { type: "red" }
  | { type: "restart" }
  | { type: "green" }
  | { type: "truck-out"; id: string }
  | { type: "loaded"; id: string }
  | { type: "truck-gone"; id: string };

export const SC_SPEED = 30; // m/s, about 108 km/h
/** Virtual safety car: no car on track, everyone holds the same slow pace. */
export const VSC_SPEED = 25; // m/s, 90 km/h
export const VSC_MIN_S = 10;
/** Heavy enough for the real safety car; lighter ones get the virtual one. */
export const SC_SEVERITY = 0.7;
export const VSC_SEVERITY = 0.4;
/** Red flag: this many open incidents at once, or two bad ones together. */
export const RED_OPEN = 3;
export const RED_BAD = 0.6;
export const RED_MIN_S = 14;
export const RESTART_S = 4;
export const SC_DELAY_S = 2.5;
export const SC_MIN_S = 18;
export const SC_IN_S = 6;
export const TRUCK_MAX = 24;
export const TRUCK_LOAD_S = 5;
export const POST_SPACING = 300;
const STOP_BEFORE = 6;
const LEAVE_DIST = 180;

export class RaceControl {
  flag: Flag = "green";
  readonly sc: Mover = { dist: 0, lateral: 0, speed: 0, active: false };
  readonly truck: Mover = { dist: 0, lateral: 0, speed: 0, active: false };
  truckState: TruckState = "idle";
  /** Incident the truck is working on. */
  current: Incident | null = null;
  readonly queue: Incident[] = [];
  /** Incidents still on the track (not yet loaded). */
  private open = 0;
  private scTimer = 0;
  private vscTimer = 0;
  private redTimer = 0;
  private scWanted = false;
  private scDelay = 0;
  private scInTimer = 0;
  private greenTimer = 0;
  private loadTimer = 0;
  private leaveLeft = 0;

  constructor(private readonly track: TrackLike) {}

  /** Number of incidents not yet cleared. */
  get openIncidents(): number {
    return this.open;
  }

  /** True while the virtual safety car holds the field to a fixed pace. */
  get vscActive(): boolean {
    return this.flag === "vsc";
  }

  /** True while the race is stopped (and during the countdown to the restart). */
  get redActive(): boolean {
    return this.flag === "red" || this.flag === "restart";
  }

  /** True while the field is held to safety-car speed. */
  get scActive(): boolean {
    return this.flag === "sc" || this.flag === "sc-in";
  }

  /** Report a stopped car. Heavy ones bring out the safety car. */
  report(inc: Incident): RcEvent[] {
    const ev: RcEvent[] = [];
    this.queue.push(inc);
    this.open++;
    if (this.flag === "green") {
      this.flag = "yellow";
      ev.push({ type: "yellow" });
    }
    const otherBad = this.queue.some((q) => q !== inc && q.severity >= RED_BAD) || (!!this.current && this.truckState !== "leaving" && this.current.severity >= RED_BAD);
    if (!this.redActive && (this.open >= RED_OPEN || (this.open >= 2 && inc.severity >= RED_BAD && otherBad))) {
      // A pile-up: stop the race while the track is cleared.
      this.flag = "red";
      this.redTimer = 0;
      this.scWanted = false;
      this.sc.active = false;
      ev.push({ type: "red" });
    } else if (inc.severity >= SC_SEVERITY && !this.scActive && !this.redActive && !this.scWanted) {
      this.scWanted = true;
      this.scDelay = SC_DELAY_S;
    } else if (inc.severity >= VSC_SEVERITY && this.flag === "yellow" && !this.scWanted) {
      this.flag = "vsc";
      this.vscTimer = 0;
      ev.push({ type: "vsc" });
    }
    this.greenTimer = 0;
    return ev;
  }

  /** Start the safety car just ahead of `leaderDist` (absolute distance, not wrapped). */
  private deploySc(leaderDist: number): void {
    this.sc.active = true;
    this.sc.dist = leaderDist + 70;
    this.sc.lateral = 0;
    this.sc.speed = SC_SPEED;
    this.flag = "sc";
    this.scTimer = 0;
    this.scWanted = false;
  }

  update(dt: number, leaderDist: number): RcEvent[] {
    const ev: RcEvent[] = [];
    const L = this.track.length;

    if (this.scWanted) {
      this.scDelay -= dt;
      if (this.scDelay <= 0) {
        this.deploySc(leaderDist);
        ev.push({ type: "sc-out" });
      }
    }
    if (this.sc.active) {
      this.sc.dist += this.sc.speed * dt;
      // On its way into the pits the safety car moves off the racing line.
      if (this.flag === "sc-in") this.sc.lateral += (this.track.halfWidth + 3.5 - this.sc.lateral) * Math.min(1, dt * 0.6);
    }

    // Recovery truck.
    if (this.truckState === "idle" && this.queue.length > 0) {
      const inc = this.queue.shift()!;
      this.current = inc;
      const post = Math.floor((inc.dist - 60) / POST_SPACING) * POST_SPACING;
      this.truck.dist = ((post % L) + L) % L;
      this.truck.lateral = Math.sign(inc.lateral || 1) * (this.track.halfWidth + 3.5);
      this.truck.speed = 0;
      this.truck.active = true;
      this.truckState = "driving";
      ev.push({ type: "truck-out", id: inc.id });
    }
    const inc = this.current;
    if (this.truckState === "driving" && inc) {
      let remaining = (((inc.dist - STOP_BEFORE - this.truck.dist) % L) + L) % L;
      if (remaining > L / 2) remaining = 0; // already past: stop here
      const vMax = Math.min(TRUCK_MAX, Math.sqrt(2 * 5 * Math.max(remaining, 0)) + 1.5);
      this.truck.speed += Math.sign(vMax - this.truck.speed) * Math.min(Math.abs(vMax - this.truck.speed), 6 * dt);
      const step = this.truck.speed * dt;
      this.truck.dist += Math.min(step, remaining);
      // Move across from the post to the edge of the track as it goes.
      const edge = Math.sign(inc.lateral || 1) * Math.min(this.track.halfWidth - 1.3, Math.abs(inc.lateral) || this.track.halfWidth - 1.3);
      this.truck.lateral += (edge - this.truck.lateral) * Math.min(1, dt * 1.2);
      if (remaining < 0.6) {
        this.truckState = "loading";
        this.loadTimer = TRUCK_LOAD_S;
        this.truck.speed = 0;
      }
    } else if (this.truckState === "loading") {
      this.loadTimer -= dt;
      if (this.loadTimer <= 0 && inc) {
        this.open = Math.max(0, this.open - 1);
        ev.push({ type: "loaded", id: inc.id });
        this.truckState = "leaving";
        this.leaveLeft = LEAVE_DIST;
      }
    } else if (this.truckState === "leaving" && inc) {
      this.truck.speed = Math.min(TRUCK_MAX, this.truck.speed + 6 * dt);
      const step = this.truck.speed * dt;
      this.truck.dist += step;
      this.leaveLeft -= step;
      this.truck.lateral += (Math.sign(this.truck.lateral) * (this.track.halfWidth + 3.5) - this.truck.lateral) * Math.min(1, dt * 0.8);
      if (this.leaveLeft <= 0) {
        this.truck.active = false;
        this.truckState = "idle";
        this.current = null;
        ev.push({ type: "truck-gone", id: inc.id });
      }
    }

    // Flag logic.
    if (this.flag === "sc") {
      this.scTimer += dt;
      if (this.open === 0 && this.queue.length === 0 && this.scTimer >= SC_MIN_S) {
        this.flag = "sc-in";
        this.scInTimer = SC_IN_S;
        ev.push({ type: "sc-in" });
      }
    } else if (this.flag === "sc-in") {
      this.scInTimer -= dt;
      if (this.scInTimer <= 0) {
        this.sc.active = false;
        this.flag = "green";
        ev.push({ type: "green" });
      }
    } else if (this.flag === "vsc") {
      this.vscTimer += dt;
      if (this.open === 0 && this.queue.length === 0 && this.vscTimer >= VSC_MIN_S) {
        this.flag = "green";
        ev.push({ type: "vsc-end" });
        ev.push({ type: "green" });
      }
    } else if (this.flag === "red") {
      this.redTimer += dt;
      if (this.open === 0 && this.queue.length === 0 && this.redTimer >= RED_MIN_S) {
        this.flag = "restart";
        this.redTimer = RESTART_S;
        ev.push({ type: "restart" });
      }
    } else if (this.flag === "restart") {
      this.redTimer -= dt;
      if (this.redTimer <= 0) {
        this.flag = "green";
        ev.push({ type: "green" });
      }
    } else if (this.flag === "yellow" && !this.scWanted) {
      if (this.open === 0 && this.queue.length === 0) {
        this.greenTimer += dt;
        if (this.greenTimer >= 3) {
          this.flag = "green";
          ev.push({ type: "green" });
        }
      }
    }
    return ev;
  }

  /** Reset everything (new race). */
  reset(): void {
    this.flag = "green";
    this.sc.active = false;
    this.truck.active = false;
    this.truckState = "idle";
    this.current = null;
    this.queue.length = 0;
    this.open = 0;
    this.scWanted = false;
    this.vscTimer = 0;
    this.redTimer = 0;
  }

  /** Seconds left before the restart (only while the restart countdown runs). */
  get restartIn(): number {
    return this.flag === "restart" ? Math.max(0, this.redTimer) : 0;
  }
}
