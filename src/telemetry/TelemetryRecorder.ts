/** One row of simulated game telemetry (Dataset B). Not real-world data. */
export interface TelemetrySample {
  session_id: string;
  timestamp_ms: number;
  track_id: string;
  lap_number: number;
  sector_number: number;
  position_x: number;
  position_z: number;
  heading_deg: number;
  speed_kmh: number;
  throttle: number;
  brake: number;
  steering: number;
  off_track: boolean;
  lap_elapsed_ms: number;
  collision_count: number;
}

export type TelemetryFrame = Omit<TelemetrySample, "session_id" | "track_id" | "timestamp_ms">;

export interface LapRecord {
  lap: number;
  ms: number;
  valid: boolean;
  sectors: Array<number | null>;
}

export interface SessionInfo {
  session_id: string;
  track_id: string;
  mode: "race" | "free";
  started_at: string;
}

/** Samples at a fixed rate (default 10 Hz) so data volume is predictable. */
export class TelemetryRecorder {
  readonly samples: TelemetrySample[] = [];
  readonly laps: LapRecord[] = [];
  private nextAt = 0;
  private readonly intervalMs: number;

  constructor(readonly info: SessionInfo, sampleHz = 10) {
    this.intervalMs = 1000 / sampleHz;
  }

  /** Call every physics step; only stores a row when the interval has elapsed. */
  tick(simMs: number, frame: TelemetryFrame): void {
    if (simMs < this.nextAt) return;
    this.nextAt = simMs + this.intervalMs;
    this.samples.push({
      session_id: this.info.session_id,
      timestamp_ms: Math.round(simMs),
      track_id: this.info.track_id,
      ...frame,
    });
  }

  addLap(lap: LapRecord): void {
    this.laps.push(lap);
  }

  get durationMs(): number {
    return this.samples.length ? this.samples[this.samples.length - 1]!.timestamp_ms : 0;
  }
}

export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ses_${Date.now().toString(36)}_${rand}`;
}
