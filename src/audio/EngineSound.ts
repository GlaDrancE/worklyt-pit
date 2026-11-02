import { newDrivetrain, stepDrivetrain, type DrivetrainState } from "./drivetrain";
import { DEFAULT_ENGINE, bandRpms, getEngine, type EngineId, type EngineProfile } from "./engineProfiles";
import { bandWeights, renderEngineLoop } from "./engineSynth";

export interface SoundInput {
  speedKmh: number;
  throttle: number;
  brake: number;
  /** Sideways speed in m/s (tyre scrub). */
  lateralSpeed: number;
}

/** Where the listener (the player's car) is, in world metres, and which way it faces. */
export interface Listener {
  x: number;
  z: number;
  yaw: number;
}

/** Another car whose engine should be heard. */
export interface OtherCar {
  x: number;
  z: number;
  speedKmh: number;
}

const MAX_VOICES = 4;
const SPEED_OF_SOUND = 343;

interface Voice {
  src: AudioBufferSourceNode;
  tone: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  drive: DrivetrainState;
  lastDist: number | null;
}

/**
 * Synthesised racing engine, wind and tyre noise. The engine loops are rendered
 * at start-up from a firing-pulse / exhaust-resonance model (see engineSynth.ts),
 * so there are no audio files and nothing to download. Other cars on track are
 * heard too, panned left/right with distance and Doppler pitch shift. The
 * AudioContext is only created after a user gesture.
 */
export class EngineSound {
  profile: EngineProfile = getEngine(DEFAULT_ENGINE);
  readonly drive: DrivetrainState = newDrivetrain();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private engineTone: BiquadFilterNode | null = null;
  private onBus: GainNode | null = null;
  private offBus: GainNode | null = null;
  private onGain: GainNode | null = null;
  private offGain: GainNode | null = null;
  private verbGain: GainNode | null = null;
  private bands: Array<{ on: AudioBufferSourceNode; off: AudioBufferSourceNode; gain: GainNode; offGain: GainNode; baseRpm: number }> = [];
  private voiceBuffer: AudioBuffer | null = null;
  private voiceBaseRpm = 1;
  private voices: Voice[] = [];
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainOn = false;
  private windFilter: BiquadFilterNode | null = null;
  private squealGain: GainNode | null = null;
  private squealOsc: OscillatorNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private crowdGain: GainNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private gearOsc: OscillatorNode | null = null;
  private gearGain: GainNode | null = null;
  private muted = false;
  private paused = false;
  private lastThrottle = 0;
  /** FollowCamera mode: 0 chase, 1 far chase, 2 bonnet, 3 top-down, 4 side. */
  private view = 0;
  volume = 0.6;

  /** Choose the engine. Takes effect immediately, even mid-race. */
  setProfile(id: EngineId | string): void {
    const next = getEngine(id);
    if (next.id === this.profile.id) return;
    this.profile = next;
    this.drive.rpm = next.idleRpm;
    this.drive.gear = 1;
    if (this.ctx) this.buildEngine();
  }

  /** Tell the mixer which camera is active: the bonnet camera hears more engine, far cameras more air. */
  setView(mode: number): void {
    this.view = mode;
  }

  /** Create (or wake) the audio graph. Call from a click or key handler. */
  start(): void {
    try {
      if (!this.ctx) this.build();
      void this.ctx?.resume();
    } catch {
      this.ctx = null; // no audio available: the game keeps working silently
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMaster();
    return this.muted;
  }

  /** Master volume 0..1 (the default is 0.6). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyMaster();
  }

  /** Steady rain on the bodywork, behind the engine. */
  setRain(on: boolean): void {
    this.rainOn = on;
    this.rainGain?.gain.setTargetAtTime(on ? 0.11 : 0, this.ctx?.currentTime ?? 0, 0.4);
  }

  /** The grandstand swells for a moment (a good lap, a finish). */
  cheer(strength = 1): void {
    const ctx = this.ctx;
    const g = this.crowdGain?.gain;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.035 + 0.12 * Math.min(1, strength), t + 0.35);
    g.linearRampToValueAtTime(0.035, t + 3.2);
  }

  /** One burst of the pit crew's wheel gun: a hard buzz of noise plus a rattling tone. */
  pitGun(long = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const dur = long ? 0.32 : 0.16;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 1.4;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(long ? 190 : 260, t);
    osc.frequency.linearRampToValueAtTime(long ? 260 : 210, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g);
    osc.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    osc.start(t);
    src.stop(t + dur + 0.02);
    osc.stop(t + dur + 0.02);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : this.volume, t, 0.05);
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    // Engine buses: on-throttle and off-throttle loops are blended, then toned and sent to a short reflection.
    this.engineTone = ctx.createBiquadFilter();
    this.engineTone.type = "lowpass";
    this.engineTone.frequency.value = 6000;
    this.engineTone.Q.value = 0.5;
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.onGain = ctx.createGain();
    this.offGain = ctx.createGain();
    this.onGain.gain.value = 0;
    this.offGain.gain.value = 1;
    this.onBus = ctx.createGain();
    this.offBus = ctx.createGain();
    this.onBus.connect(this.onGain).connect(this.engineTone);
    this.offBus.connect(this.offGain).connect(this.engineTone);
    this.engineTone.connect(this.engineBus).connect(this.master);

    // A short, dark reflection so the car sounds like it is at a track, not in a box.
    const verb = ctx.createConvolver();
    const irLen = Math.round(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        lp += 0.25 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-i / (ctx.sampleRate * 0.28));
      }
    }
    verb.buffer = ir;
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.16;
    this.engineBus.connect(verb).connect(this.verbGain).connect(this.master);

    this.buildEngine();

    // Shared noise buffer for wind and pops.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Rain: bright hissing noise, only audible in wet sessions.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    rain.playbackRate.value = 0.9;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = "highpass";
    rainHp.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = this.rainOn ? 0.11 : 0;
    rain.connect(rainHp).connect(this.rainGain).connect(this.master);
    rain.start();

    // Hybrid / turbo whine, rising with revs (only audible on the V6).
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = "sine";
    this.whineOsc.frequency.value = 2400;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.master);
    this.whineOsc.start();

    // Gearbox whine: pitch follows road speed.
    this.gearOsc = ctx.createOscillator();
    this.gearOsc.type = "triangle";
    this.gearOsc.frequency.value = 300;
    this.gearGain = ctx.createGain();
    this.gearGain.gain.value = 0;
    this.gearOsc.connect(this.gearGain).connect(this.master);
    this.gearOsc.start();

    // Quiet grandstand crowd bed.
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noiseBuf;
    crowd.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 520;
    crowdFilter.Q.value = 0.35;
    const crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.035;
    this.crowdGain = crowdGain;
    crowd.connect(crowdFilter).connect(crowdGain).connect(this.master);
    crowd.start();

    // Tyre squeal: a thin, wobbling tone.
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = "sawtooth";
    this.squealOsc.frequency.value = 880;
    const sqFilter = ctx.createBiquadFilter();
    sqFilter.type = "bandpass";
    sqFilter.frequency.value = 1500;
    sqFilter.Q.value = 3;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealOsc.connect(sqFilter).connect(this.squealGain).connect(this.master);
    this.squealOsc.start();

    this.applyMaster();
  }

  /** (Re)render the engine loops for the chosen engine. */
  private buildEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.onBus || !this.offBus) return;
    for (const b of this.bands) {
      for (const n of [b.on, b.off]) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
      b.gain.disconnect();
      b.offGain.disconnect();
    }
    this.bands = [];
    this.clearVoices();
    const p = this.profile;
    const rpms = bandRpms(p);
    rpms.forEach((rpm, index) => {
      const make = (load: "on" | "off", bus: GainNode) => {
        const loop = renderEngineLoop({ rpm, load, sampleRate: ctx.sampleRate, cylinders: p.cylinders, modeScale: p.modeScale, roughness: p.roughness });
        const buffer = ctx.createBuffer(1, loop.data.length, ctx.sampleRate);
        buffer.copyToChannel(loop.data, 0);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(bus);
        src.start();
        return { src, gain, rpm: loop.rpm, buffer };
      };
      const on = make("on", this.onBus!);
      const off = make("off", this.offBus!);
      this.bands.push({ on: on.src, off: off.src, gain: on.gain, offGain: off.gain, baseRpm: on.rpm });
      if (index === 3) {
        this.voiceBuffer = on.buffer;
        this.voiceBaseRpm = on.rpm;
      }
    });
  }

  private clearVoices(): void {
    for (const v of this.voices) {
      try {
        v.src.stop();
      } catch {
        /* already stopped */
      }
      v.src.disconnect();
      v.gain.disconnect();
    }
    this.voices = [];
  }

  private ensureVoices(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.voiceBuffer || this.voices.length > 0) return;
    for (let i = 0; i < MAX_VOICES; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.voiceBuffer;
      src.loop = true;
      src.loopStart = 0;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 6000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      src.connect(tone).connect(gain).connect(pan).connect(this.master);
      // Start each voice at a different point so identical cars don't phase together.
      src.start(0, (i * 0.23) % Math.max(0.1, this.voiceBuffer.duration));
      this.voices.push({ src, tone, gain, pan, drive: newDrivetrain(), lastDist: null });
    }
  }

  /** Call once per rendered frame. */
  update(dt: number, inp: SoundInput): void {
    const range = { idleRpm: this.profile.idleRpm, redlineRpm: this.profile.redlineRpm };
    const shifted = stepDrivetrain(this.drive, inp.speedKmh, inp.throttle, dt, range);
    const ctx = this.ctx;
    if (!ctx || !this.engineBus || !this.engineTone) return;
    const t = ctx.currentTime;

    const rpm = this.drive.rpm;
    const rpmNorm = (rpm - range.idleRpm) / (range.redlineRpm - range.idleRpm);

    // Cross-fade the two nearest rpm loops and pitch each one to the exact engine speed.
    const w = bandWeights(rpm, this.bands.map((b) => b.baseRpm));
    this.bands.forEach((b, i) => {
      const rate = Math.min(1.6, Math.max(0.6, rpm / b.baseRpm));
      b.on.playbackRate.setTargetAtTime(rate, t, 0.03);
      b.off.playbackRate.setTargetAtTime(rate, t, 0.03);
      b.gain.gain.setTargetAtTime(w[i]!, t, 0.03);
      b.offGain.gain.setTargetAtTime(w[i]!, t, 0.03);
    });

    // Camera changes what you hear: the bonnet camera is right behind the engine and intake,
    // far and top-down cameras are more distant and airy.
    const cockpit = this.view === 2;
    const distant = this.view === 1 || this.view === 3;
    const viewTone = cockpit ? 0.8 : distant ? 0.7 : 1;
    const viewLevel = cockpit ? 1.15 : distant ? 0.8 : 1;
    this.verbGain?.gain.setTargetAtTime(cockpit ? 0.08 : distant ? 0.28 : 0.16, t, 0.2);

    // Throttle opens up the exhaust note; lifting drops to the quieter, burbling overrun loop.
    const cut = this.drive.shiftTimer > 0 ? 0.4 : 1;
    const thr = Math.min(1, Math.max(0, inp.throttle));
    this.onGain?.gain.setTargetAtTime(thr, t, 0.06);
    this.offGain?.gain.setTargetAtTime(0.35 + (1 - thr) * 0.65, t, 0.06);
    this.engineBus.gain.setTargetAtTime((0.3 + rpmNorm * 0.55) * cut * viewLevel, t, 0.03);
    this.engineTone.frequency.setTargetAtTime((2400 + rpmNorm * 4200 + thr * 1500) * viewTone, t, 0.05);

    const whine = this.profile.whine;
    this.whineOsc?.frequency.setTargetAtTime(1800 + rpmNorm * 3600, t, 0.05);
    this.whineGain?.gain.setTargetAtTime(whine * (0.003 + rpmNorm * 0.009) * (0.4 + thr * 0.6) * (cockpit ? 2 : 1), t, 0.08);
    this.gearOsc?.frequency.setTargetAtTime(180 + inp.speedKmh * 4.2, t, 0.05);
    this.gearGain?.gain.setTargetAtTime(Math.min(1, inp.speedKmh / 200) * 0.012 * (0.5 + thr * 0.5) * (cockpit ? 2 : 1), t, 0.08);

    // Overrun pops when the driver lifts at high revs.
    if (this.lastThrottle > 0.6 && inp.throttle < 0.1 && rpmNorm > 0.35) this.pop(0.5);
    if (shifted && inp.throttle > 0.5) this.pop(0.18);
    this.lastThrottle = inp.throttle;

    const v = Math.min(inp.speedKmh / 330, 1);
    this.windGain?.gain.setTargetAtTime((0.02 + v * v * 0.5) * (cockpit ? 1.3 : 1), t, 0.1);
    this.windFilter?.frequency.setTargetAtTime(350 + v * 1600, t, 0.1);

    const scrub = Math.min(1, Math.max(0, (Math.abs(inp.lateralSpeed) - 2.5) / 7)) * Math.min(inp.speedKmh / 40, 1);
    const lockUp = inp.brake > 0.9 && inp.speedKmh > 60 ? 0.25 : 0;
    this.squealGain?.gain.setTargetAtTime(Math.min(1, scrub + lockUp) * 0.09, t, 0.05);
    this.squealOsc?.frequency.setTargetAtTime(760 + scrub * 380 + Math.sin(t * 23) * 30, t, 0.05);
  }

  /**
   * Make the other cars on track audible. The nearest few get a voice that is
   * panned to the correct side, fades with distance, loses treble when far
   * away and shifts pitch as the car approaches or recedes (Doppler).
   */
  updateOthers(dt: number, me: Listener, others: readonly OtherCar[]): void {
    const ctx = this.ctx;
    if (!ctx || dt <= 0) return;
    this.ensureVoices();
    if (this.voices.length === 0) return;
    const t = ctx.currentTime;
    const range = { idleRpm: this.profile.idleRpm, redlineRpm: this.profile.redlineRpm };
    // The car faces (sin yaw, cos yaw); its driver's right-hand side is (-cos yaw, sin yaw).
    const rightX = -Math.cos(me.yaw);
    const rightZ = Math.sin(me.yaw);

    const ranked = others
      .map((o) => ({ o, d: Math.hypot(o.x - me.x, o.z - me.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.voices.length);

    this.voices.forEach((voice, i) => {
      const r = ranked[i];
      if (!r || r.d > 260) {
        voice.gain.gain.setTargetAtTime(0, t, 0.1);
        voice.lastDist = null;
        return;
      }
      const { o, d } = r;
      const throttle = o.speedKmh > 20 ? 0.85 : 0.2;
      stepDrivetrain(voice.drive, o.speedKmh, throttle, dt, range);
      // Doppler from the change in distance since the last frame (positive = moving apart).
      const radial = voice.lastDist === null ? 0 : (d - voice.lastDist) / dt;
      voice.lastDist = d;
      const doppler = Math.min(1.25, Math.max(0.8, SPEED_OF_SOUND / (SPEED_OF_SOUND + Math.max(-90, Math.min(90, radial)))));
      voice.src.playbackRate.setTargetAtTime(Math.min(1.9, Math.max(0.5, (voice.drive.rpm / this.voiceBaseRpm) * doppler)), t, 0.04);
      const side = d > 0.5 ? ((o.x - me.x) * rightX + (o.z - me.z) * rightZ) / d : 0;
      voice.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, side)), t, 0.05);
      const level = 0.55 / Math.pow(1 + d / 18, 1.35);
      voice.gain.gain.setTargetAtTime(level, t, 0.05);
      voice.tone.frequency.setTargetAtTime(Math.max(900, 9000 / (1 + d / 35)), t, 0.1);
    });
  }

  /** Short noise burst: exhaust pop. */
  private pop(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 500 + Math.random() * 700;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(level * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }

  /** Party-popper bangs and a short rising chord for the finish celebration. */
  celebrate(big: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const pops = big ? 6 : 3;
    for (let i = 0; i < pops; i++) {
      window.setTimeout(() => this.pop(0.9), i * (big ? 340 : 420));
    }
    const t0 = ctx.currentTime + 0.05;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 783.99];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  /** Impact thump for barrier hits. */
  thump(strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(0.7 * Math.min(1, strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.35);
    this.pop(0.5 * strength);
  }

  dispose(): void {
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
