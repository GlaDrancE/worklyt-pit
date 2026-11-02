/** Fixed-window request counter per key (an IP address). Small, in memory, and pruned so it can't grow forever. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
  ) {}

  /** True if this request is allowed. */
  allow(key: string, now = Date.now()): boolean {
    if (this.hits.size > this.maxKeys) {
      for (const [k, v] of this.hits) if (now - v.start > this.windowMs) this.hits.delete(k);
      if (this.hits.size > this.maxKeys) this.hits.clear();
    }
    const cur = this.hits.get(key);
    if (!cur || now - cur.start > this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    return ++cur.count <= this.limit;
  }
}
