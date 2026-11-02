import RAPIER from "@dimforge/rapier3d-compat";
import type { Pose } from "../track/TrackModel";

import { NO_EFFECTS, type DamageEffects } from "./damage";
import { STEERING, lockAt, speedFactor, stepRack, visualWheelAngle } from "./steeringConfig";

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  handbrake: boolean;
}

export const NEUTRAL_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * Tuning for an open-wheel single-seater, sized from the public 2026 FIA
 * figures: 768 kg minimum weight, 3.4 m maximum wheelbase, 1.9 m maximum width,
 * about 5 m long, 18-inch wheels with narrower front and wider rear tyres,
 * and a 350 kW electric motor on top of a 1.6 L turbo engine.
 *
 * Units: metres, kilograms, newtons, watts, seconds.
 * The chassis frame has its origin mid-wheelbase, +Z forward, +Y up.
 */
export const CAR_TUNING = {
  mass: 768,
  length: 5.0,
  width: 1.9,
  wheelBase: 3.4,
  frontZ: 1.7,
  rearZ: -1.7,
  frontX: 0.8,
  rearX: 0.76,
  wheelRadius: 0.35,
  frontTyreWidth: 0.28,
  rearTyreWidth: 0.375,
  hardpointY: -0.12,
  suspensionRest: 0.2,
  maxSuspensionTravel: 0.1,
  suspensionStiffness: 90,
  suspensionCompression: 6,
  suspensionRelaxation: 3.5,
  /** Centre of mass: low and slightly rear-biased (about 45/55 front/rear). */
  com: { x: 0, y: -0.34, z: -0.17 },
  inertia: { x: 1100, y: 1100, z: 260 },
  /** Collision box (the wheels are ray-cast, so the box also stands in for the tyres). */
  box: { halfX: 0.95, halfY: 0.18, halfZ: 2.5, offsetY: -0.36, offsetZ: 0.3 },
  /** Peak drive force at the wheels (traction limited at low speed). */
  maxEngineForce: 9500,
  /** Power-limited above ~ 68 m/s. */
  powerW: 650_000,
  reverseForce: 2500,
  brakeForce: 330,
  handbrakeForce: 120,
  frictionSlipFront: 2.4,
  frictionSlipRear: 2.7,
  handbrakeRearSlip: 1.1,
  maxSteer: 0.36,
  /** Lateral acceleration (m/s²) the steering lock is scaled to at speed. */
  steerLateralAccel: 65,
  /** Aerodynamic drag, N per (m/s)². */
  dragCoeff: 0.76,
  /** Downforce, N per (m/s)². */
  downforce: 2.6,
  steerResponse: 7,
} as const;

/** Handling presets. "drift" trades grip for slide and adds a counter-steer assist. */
export type Handling = "grip" | "drift";

export const DRIFT: Record<"rearGrip"|"powerOversteer"|"handbrakeGrip"|"assistStart"|"assistFull"|"assistStrength"|"maxSlip"|"stabilise"|"steerFloor", number> = {
  /** Rear grip multiplier in drift handling. */
  rearGrip: 0.7,
  /** Extra rear grip lost per unit of throttle (power oversteer). */
  powerOversteer: 0.3,
  /** Rear grip multiplier while the handbrake is held. */
  handbrakeGrip: 0.42,
  /** Slip angle (rad) where the counter-steer assist starts and where it is at full strength. */
  assistStart: 0.08,
  assistFull: 0.3,
  /** How much of full lock the assist can apply. */
  assistStrength: 0.8,
  /** Slip angle (rad) beyond which a stabilising yaw torque pulls the nose back, so a drift cannot become a spin. */
  maxSlip: 0.5,
  /** Strength of that torque (N·m per rad of excess slip, per kg of mass). */
  stabilise: 400,
  /** Minimum steering lock (rad) available to counter-steer while sliding at speed. */
  steerFloor: 0.22,
};

export interface CarSnapshot {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Heading in radians, 0 = +Z, positive towards +X. */
  yaw: number;
  speedKmh: number;
  forwardSpeed: number;
  steering: number;
  upY: number;
}

/**
 * Raycast-vehicle physics (Rapier). The chassis faces local +Z.
 * Rapier steering is positive towards +X, which is the driver's LEFT when
 * facing +Z, so input (+1 = right) is negated when applied to the wheels.
 */
export class VehiclePhysics {
  readonly chassis: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  private readonly world: RAPIER.World;
  private steerState = 0;
  /** Front-wheel angle drawn on the model (rad). Derived from steerState, so it always agrees with the physics. */
  private steerVisual = 0;
  private surfaceGrip = 1;
  private handling: Handling = "grip";
  private assist: "off" | "low" | "high" = "off";
  private damageFx: DamageEffects = NO_EFFECTS;

  constructor(world: RAPIER.World, spawn: Pose) {
    this.world = world;
    const t = CAR_TUNING;

    const body = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, 0.9, spawn.z)
      .setRotation(yawQuat(spawn.yaw))
      .setLinearDamping(0)
      .setAngularDamping(0.5)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(t.mass, t.com, t.inertia, { x: 0, y: 0, z: 0, w: 1 });
    this.chassis = world.createRigidBody(body);

    const col = RAPIER.ColliderDesc.cuboid(t.box.halfX, t.box.halfY, t.box.halfZ)
      .setTranslation(0, t.box.offsetY, t.box.offsetZ)
      .setDensity(0)
      .setFriction(0.12)
      .setRestitution(0.05)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = world.createCollider(col, this.chassis);

    this.vehicle = world.createVehicleController(this.chassis);
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    const pts = [
      { x: t.frontX, y: t.hardpointY, z: t.frontZ }, // 0 front left (+X)
      { x: -t.frontX, y: t.hardpointY, z: t.frontZ }, // 1 front right
      { x: t.rearX, y: t.hardpointY, z: t.rearZ }, // 2 rear left
      { x: -t.rearX, y: t.hardpointY, z: t.rearZ }, // 3 rear right
    ];
    pts.forEach((p, i) => {
      this.vehicle.addWheel(p, down, axle, t.suspensionRest, t.wheelRadius);
      this.vehicle.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      this.vehicle.setWheelSuspensionCompression(i, t.suspensionCompression);
      this.vehicle.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
      this.vehicle.setWheelMaxSuspensionTravel(i, t.maxSuspensionTravel);
      this.vehicle.setWheelMaxSuspensionForce(i, 80000);
      this.vehicle.setWheelFrictionSlip(i, i < 2 ? t.frictionSlipFront : t.frictionSlipRear);
      this.vehicle.setWheelSideFrictionStiffness(i, 1);
    });
  }

  /** 0..1 multiplier on tyre grip (grass, kerbs). */
  setSurfaceGrip(factor: number): void {
    this.surfaceGrip = factor;
  }

  /** Stability help for Race handling: counter-steers a slide and pulls the nose back before a spin. */
  /** Performance lost to damage: power, downforce, per-wheel grip and a steering pull. */
  setDamageEffects(e: DamageEffects): void {
    this.damageFx = e;
  }

  setAssist(level: "off" | "low" | "high"): void {
    this.assist = level;
  }

  setHandling(h: Handling): void {
    this.handling = h;
  }

  /**
   * Slip angle of the car in radians: the angle between where it points and where it
   * is going. Positive when the car is travelling towards its +X (driver's left) side.
   * Zero when slow or reversing.
   */
  slipAngle(): number {
    const q = this.chassis.rotation();
    const lv = this.chassis.linvel();
    const fwd = this.forwardSpeed;
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const ry = 2 * (q.x * q.y + q.z * q.w);
    const rz = 2 * (q.x * q.z - q.y * q.w);
    const lateral = lv.x * rx + lv.y * ry + lv.z * rz;
    if (fwd < 3) return 0;
    return Math.atan2(lateral, fwd);
  }

  /** Signed speed along the car's forward axis (m/s), read live from the body. */
  get forwardSpeed(): number {
    const q = this.chassis.rotation();
    const lv = this.chassis.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return lv.x * fx + lv.y * fy + lv.z * fz;
  }

  /** Apply controls for one fixed step. Call before world.step(). */
  step(dt: number, input: CarInput): void {
    const t = CAR_TUNING;
    const v = this.forwardSpeed;
    const speed = Math.abs(v);

    // Speed-sensitive, smoothed steering. Lock is limited so full steering never
    // asks for more lateral g than the tyres can give.
    let maxSteer = lockAt(speed, t.wheelBase, t.steerLateralAccel);
    let steerIn = clamp(input.steer + (speed > 5 ? this.damageFx.steerBias : 0), -1, 1);
    const k = this.handling === "drift" ? 1 : this.assist === "high" ? 0.9 : this.assist === "low" ? 0.45 : 0;
    if (k > 0 && speed > 8 && v > 0) {
      // Counter-steer assist: when the tail swings out, steer towards the direction of travel
      // so a drift can be held on a keyboard instead of snapping into a spin.
      const slip = this.slipAngle();
      const w = clamp((Math.abs(slip) - DRIFT.assistStart) / (DRIFT.assistFull - DRIFT.assistStart), 0, 1);
      steerIn = clamp(steerIn - Math.sign(slip) * w * DRIFT.assistStrength * k, -1, 1);
      if (Math.abs(slip) > DRIFT.assistStart) maxSteer = Math.max(maxSteer, DRIFT.steerFloor);
      const excess = Math.abs(slip) - DRIFT.maxSlip;
      if (excess > 0) {
        const yawRate = this.chassis.angvel().y;
        const torque = (Math.sign(slip) * excess * DRIFT.stabilise - yawRate * 2) * t.mass * k;
        this.chassis.applyTorqueImpulse({ x: 0, y: torque * dt, z: 0 }, true);
      }
    }
    const target = steerIn * maxSteer;
    this.steerState = stepRack(this.steerState, target, dt, speed);
    this.steerVisual = visualWheelAngle(this.steerState, maxSteer, speed);
    const wheelSteer = -this.steerState;
    if (this.handling === "grip" && speed > 10) {
      // Hands off: let the yaw die away rather than carry on turning.
      const free = 1 - Math.min(1, Math.abs(steerIn));
      const calm = Math.min(1, speed / 30);
      const yawRate = this.chassis.angvel().y;
      this.chassis.applyTorqueImpulse({ x: 0, y: -yawRate * t.inertia.y * STEERING.yawDamping * free * calm * dt, z: 0 }, true);
    }
    const steerLoad = Math.min(1, Math.abs(this.steerState) / Math.max(maxSteer, 1e-3)) * speedFactor(speed);
    this.vehicle.setWheelSteering(0, wheelSteer);
    this.vehicle.setWheelSteering(1, wheelSteer);

    // Throttle / brake / reverse. Drive force is power-limited at high speed.
    let engine = 0;
    let brake = 0;
    if (input.throttle > 0 && input.brake === 0) {
      engine = input.throttle * this.damageFx.power * Math.min(t.maxEngineForce, t.powerW / Math.max(v, 1));
    } else if (input.brake > 0) {
      if (v > 1.5) {
        brake = input.brake * t.brakeForce;
      } else {
        engine = -input.brake * t.reverseForce * Math.max(0, 1 - (Math.max(-v, 0) / 14) ** 2);
      }
    }
    const handbrake = input.handbrake;
    const grip = this.surfaceGrip;

    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      this.vehicle.setWheelEngineForce(i, rear ? engine / 2 : 0);
      // Brake bias ~ 58% front, as on a real single-seater.
      let b = (rear ? 0.42 : 0.58) * brake * 0.5;
      if (rear && handbrake) b = Math.max(b, t.handbrakeForce / 2);
      this.vehicle.setWheelBrake(i, b);
      let base = rear ? (handbrake ? t.handbrakeRearSlip : t.frictionSlipRear) : t.frictionSlipFront;
      if (rear && this.handling === "drift") {
        base *= handbrake ? DRIFT.handbrakeGrip : DRIFT.rearGrip * (1 - DRIFT.powerOversteer * input.throttle);
      }
      if (!rear && this.handling === "grip") base *= 1 - STEERING.understeer * steerLoad;
      if (rear) base *= 1 + STEERING.rearStability * speedFactor(speed);
      this.vehicle.setWheelFrictionSlip(i, base * grip * this.damageFx.wheelGrip[i]!);
    }

    this.vehicle.updateVehicle(dt);

    // Aerodynamic drag and downforce as impulses (force * dt).
    const lv = this.chassis.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    if (sp > 0.01) {
      const drag = t.dragCoeff * sp * sp * dt;
      this.chassis.applyImpulse({ x: (-lv.x / sp) * drag, y: (-lv.y / sp) * drag, z: (-lv.z / sp) * drag }, true);
    }
    this.chassis.applyImpulse({ x: 0, y: -t.downforce * this.damageFx.downforce * sp * sp * dt, z: 0 }, true);
  }

  snapshot(): CarSnapshot {
    const p = this.chassis.translation();
    const q = this.chassis.rotation();
    // Forward = q * (0,0,1); up.y = 1 - 2(x² + z²)
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const fwd = this.forwardSpeed;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
      yaw: Math.atan2(fx, fz),
      speedKmh: Math.abs(fwd) * 3.6,
      forwardSpeed: fwd,
      steering: this.steerState,
      upY,
    };
  }

  wheel(i: number): { y: number; suspensionLength: number; rotation: number; steering: number; contact: boolean } {
    return {
      y: this.vehicle.wheelChassisConnectionPointCs(i)?.y ?? 0,
      suspensionLength: this.vehicle.wheelSuspensionLength(i) ?? CAR_TUNING.suspensionRest,
      rotation: this.vehicle.wheelRotation(i) ?? 0,
      steering: i < 2 ? this.steerVisual : 0,
      contact: this.vehicle.wheelIsInContact(i),
    };
  }

  /** Teleport the car (respawn). Velocity is cleared. */
  reset(pose: Pose): void {
    this.chassis.setTranslation({ x: pose.x, y: 0.9, z: pose.z }, true);
    this.chassis.setRotation(yawQuat(pose.yaw), true);
    this.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerState = 0;
    this.steerVisual = 0;
  }

  dispose(): void {
    this.world.removeCollider(this.collider, false);
    this.world.removeRigidBody(this.chassis);
  }
}

export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
