import type { CarInput } from "../vehicle/VehiclePhysics";
import { DEFAULT_SETTINGS, shapeStick, type Settings } from "./settings";
import { tiltToSteer } from "../ui/orientation";
import { rampSteer, shapeSteer } from "../vehicle/steeringConfig";

export { rampSteer };

export type InputAction = "reset" | "camera" | "pause" | "mute" | "lamps";

type HeldKey = "throttle" | "brake" | "left" | "right" | "handbrake";

const KEY_MAP: Record<string, HeldKey> = {
  KeyW: "throttle",
  ArrowUp: "throttle",
  KeyS: "brake",
  ArrowDown: "brake",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
};

const ACTION_MAP: Record<string, InputAction> = {
  KeyR: "reset",
  KeyC: "camera",
  KeyP: "pause",
  KeyM: "mute",
  KeyL: "lamps",
  Escape: "pause",
};

export type InputConfig = Pick<Settings, "steerSpeed" | "deadzone" | "stickCurve" | "vibration" | "tilt" | "tiltSens" | "tiltInvert" | "easyDrive" | "steerSens">;

/**
 * Keyboard + touch + gamepad input. Everything is reduced to the same CarInput
 * so the physics never needs to know where it came from.
 */
export class InputManager {
  private readonly held = new Set<HeldKey>();
  private readonly pendingActions: InputAction[] = [];
  private readonly cleanup: Array<() => void> = [];
  /** Keyboard steering builds up while a key is held, so a quick tap only nudges the car. */
  private steerKey = 0;
  private cfg: InputConfig = DEFAULT_SETTINGS;
  /** Turns a screen position into a position on the (possibly turned) game stage. */
  private toStage: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });
  private wheelEl: HTMLElement | null = null;
  private wheelTarget = 0;
  private wheelValue = 0;
  private wheelShown = 0;
  private tiltSample: { x: number; y: number } | null = null;
  private tiltNeutral: { x: number; y: number } | null = null;
  private tiltValue = 0;
  private tiltListening = false;
  private padButtons: boolean[] = [];
  private padLabel: string | null = null;

  constructor(touchRoot: HTMLElement | null) {
    const down = (e: KeyboardEvent) => {
      const held = KEY_MAP[e.code];
      if (held) {
        this.held.add(held);
        e.preventDefault();
        return;
      }
      const action = ACTION_MAP[e.code];
      if (action && !e.repeat) this.pendingActions.push(action);
    };
    const up = (e: KeyboardEvent) => {
      const held = KEY_MAP[e.code];
      if (held) this.held.delete(held);
    };
    const blur = () => {
      this.held.clear();
      this.wheelTarget = 0;
      touchRoot?.querySelectorAll<HTMLElement>(".active").forEach((b) => b.classList.remove("active"));
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", hidden));
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.cleanup.push(
      () => window.removeEventListener("keydown", down),
      () => window.removeEventListener("keyup", up),
      () => window.removeEventListener("blur", blur),
    );

    if (touchRoot) {
      // Long-press must never open the browser's copy / select / share bubble over the controls.
      const block = (e: Event) => e.preventDefault();
      touchRoot.addEventListener("contextmenu", block);
      touchRoot.addEventListener("selectstart", block);
      touchRoot.addEventListener("dragstart", block);
      this.cleanup.push(
        () => touchRoot.removeEventListener("contextmenu", block),
        () => touchRoot.removeEventListener("selectstart", block),
        () => touchRoot.removeEventListener("dragstart", block),
      );
    }
    this.wheelEl = touchRoot?.querySelector<HTMLElement>("#wheel") ?? null;
    if (this.wheelEl) this.bindWheel(this.wheelEl);
    touchRoot?.querySelectorAll<HTMLButtonElement>("button[data-key]").forEach((btn) => {
      const key = btn.dataset.key as HeldKey;
      const pointers = new Set<number>();
      const on = (e: PointerEvent) => {
        e.preventDefault();
        pointers.add(e.pointerId);
        // Capture so sliding a thumb off the button doesn't drop the input mid-corner.
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable: fine */
        }
        this.held.add(key);
        btn.classList.add("active");
      };
      const off = (e: PointerEvent) => {
        e.preventDefault();
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
          this.held.delete(key);
          btn.classList.remove("active");
        }
      };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointercancel", off);
      btn.addEventListener("lostpointercapture", off);
    });
  }

  /** Drag sideways on the wheel to steer; letting go lets it spring back to centre. */
  private bindWheel(el: HTMLElement): void {
    let id = -1;
    let x0 = 0;
    let v0 = 0;
    const R = () => Math.max(40, el.getBoundingClientRect().width * 0.42);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const x = this.toStage(e.clientX, e.clientY).x;
      this.wheelTarget = Math.max(-1, Math.min(1, v0 + (x - x0) / R()));
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      id = e.pointerId;
      x0 = this.toStage(e.clientX, e.clientY).x;
      v0 = this.wheelValue;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
      el.classList.add("active");
    });
    el.addEventListener("pointermove", move);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.wheelTarget = 0;
      el.classList.remove("active");
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  }

  /** Lets the layout tell us how screen positions map onto the game stage. */
  setStageMapper(fn: (x: number, y: number) => { x: number; y: number }): void {
    this.toStage = fn;
  }

  /** Start listening to the phone's motion sensor. Must be called from a tap on iPhones (permission prompt). */
  async enableTilt(): Promise<"ok" | "denied" | "unsupported"> {
    if (typeof DeviceMotionEvent === "undefined") return "unsupported";
    const dm = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof dm.requestPermission === "function") {
      try {
        if ((await dm.requestPermission()) !== "granted") return "denied";
      } catch {
        return "denied";
      }
    }
    if (!this.tiltListening) {
      this.tiltListening = true;
      const on = (e: DeviceMotionEvent) => {
        const a = e.accelerationIncludingGravity;
        if (a && typeof a.x === "number" && typeof a.y === "number") {
          this.tiltSample = { x: a.x, y: a.y };
          if (!this.tiltNeutral) this.tiltNeutral = { ...this.tiltSample };
        }
      };
      window.addEventListener("devicemotion", on);
      this.cleanup.push(() => window.removeEventListener("devicemotion", on));
    }
    return "ok";
  }

  /** Treat the way the phone is held right now as "straight ahead". */
  calibrateTilt(): void {
    this.tiltNeutral = this.tiltSample ? { ...this.tiltSample } : null;
    this.tiltValue = 0;
  }

  get tiltReading(): boolean {
    return this.tiltSample !== null;
  }

  /** Current driving input, with a gamepad merged in if one is connected. */
  read(dt = 1 / 60, speedMs = 0): CarInput {
    let throttle = this.held.has("throttle") ? 1 : 0;
    let brake = this.held.has("brake") ? 1 : 0;
    const steerTarget = (this.held.has("right") ? 1 : 0) - (this.held.has("left") ? 1 : 0);
    this.steerKey = rampSteer(this.steerKey, steerTarget, dt, speedMs, this.cfg.steerSpeed);
    let steer = this.steerKey;
    if (this.wheelTarget !== 0 || this.wheelValue !== 0) {
      // Dragging follows the finger at once; letting go springs back quickly.
      this.wheelValue = this.wheelTarget !== 0 ? this.wheelTarget : rampSteer(this.wheelValue, 0, dt, speedMs);
      if (this.wheelTarget !== 0 && Math.abs(this.wheelValue) < 0.001) this.wheelValue = 0;
      if (Math.abs(steer) < 0.001) steer = this.wheelValue;
      if (this.wheelEl && Math.abs(this.wheelValue - this.wheelShown) > 0.004) {
        this.wheelShown = this.wheelValue;
        this.wheelEl.style.setProperty("--turn", `${(this.wheelValue * 120).toFixed(1)}deg`);
      }
    }
    if (this.cfg.tilt && this.tiltSample && this.tiltNeutral) {
      const raw = tiltToSteer(this.tiltNeutral.x, this.tiltNeutral.y, this.tiltSample.x, this.tiltSample.y, this.cfg.tiltSens, this.cfg.tiltInvert);
      this.tiltValue += (raw - this.tiltValue) * (1 - Math.exp(-dt * 18));
      if (Math.abs(steer) < 0.001) steer = this.tiltValue;
    }
    // Sensitivity and the centre-softening curve apply to keys, buttons, wheel and tilt alike.
    steer = shapeSteer(steer, this.cfg.steerSens);
    let handbrake = this.held.has("handbrake");

    const pad = this.activePad();
    this.padLabel = pad ? pad.id : null;
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      // D-pad steers like the keys; the left stick is analogue with a dead zone and a response curve.
      const dpad = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const stick = shapeStick(pad.axes[0] ?? 0, this.cfg.deadzone, this.cfg.stickCurve);
      if (Math.abs(steer) < 0.001) steer = dpad !== 0 ? dpad : stick;
      handbrake = handbrake || !!pad.buttons[0]?.pressed || !!pad.buttons[1]?.pressed;
      this.padActions(pad);
    }
    if (this.cfg.easyDrive) {
      if (brake < 0.05) throttle = 1;
      steer *= 0.75;
    }
    return { throttle, brake, steer, handbrake };
  }

  /** First connected, standard-looking controller. */
  private activePad(): Gamepad | null {
    if (typeof navigator.getGamepads !== "function") return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  /** Start = pause, Y = camera, X = reset, Back/Select = mute. One action per press. */
  private padActions(pad: Gamepad): void {
    const map: Array<[number, InputAction]> = [[9, "pause"], [3, "camera"], [2, "reset"], [8, "mute"]];
    for (const [idx, action] of map) {
      const down = !!pad.buttons[idx]?.pressed;
      if (down && !this.padButtons[idx]) this.pendingActions.push(action);
      this.padButtons[idx] = down;
    }
  }

  /** Apply the player's sensitivity, dead zone and rumble settings. */
  configure(cfg: InputConfig): void {
    this.cfg = cfg;
  }

  /** Name of the connected controller, or null. Read once per frame is fine. */
  get controllerName(): string | null {
    return this.padLabel ?? this.activePad()?.id ?? null;
  }

  /** Short rumble (collision, kerb). Silent when the controller or browser can't do it. */
  rumble(strength: number, ms: number): void {
    if (!this.cfg.vibration) return;
    const pad = this.activePad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    try {
      void pad?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) });
    } catch {
      /* unsupported */
    }
  }

  takeActions(): InputAction[] {
    return this.pendingActions.splice(0, this.pendingActions.length);
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
  }
}
