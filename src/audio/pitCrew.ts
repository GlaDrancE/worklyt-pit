/** When the wheel guns fire during a pit stop. Pure timing, so it can be tested without audio. */
export class PitCrewClock {
  private acc = 0;
  private fired = 0;

  /** Seconds between gun bursts. */
  constructor(private readonly every = 0.42) {}

  reset(): void {
    this.acc = 0;
    this.fired = 0;
  }

  /** Returns how many bursts to play this step (0 or 1 in practice) and whether it is the long "whirr" of a loosening nut. */
  tick(dt: number): { fire: boolean; long: boolean } {
    this.acc += dt;
    if (this.acc < this.every) return { fire: false, long: false };
    this.acc -= this.every;
    this.fired++;
    return { fire: true, long: this.fired % 4 === 1 };
  }
}
