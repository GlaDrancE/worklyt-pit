import { stageDims } from "./stageDims";
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  age: number;
  life: number;
  wobble: number;
}

const COLORS = ["#ff2d3d", "#ffd21f", "#ffffff", "#1d6fd8", "#2ecc71", "#ff8c1a", "#c6ff2a", "#b46bff"];

/** Party-popper style confetti drawn on a full-screen canvas. No libraries. */
export class Confetti {
  private readonly ctx: CanvasRenderingContext2D | null;
  private pieces: Piece[] = [];
  private raf = 0;
  private last = 0;
  private readonly timers: number[] = [];
  private pending = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stageDims().w;
    const h = stageDims().h;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get active(): number {
    return this.pieces.length;
  }

  /** A popper fired from a screen corner: a fast cone of pieces. */
  private cannon(fromLeft: boolean, count: number): void {
    const w = stageDims().w;
    const h = stageDims().h;
    const x = fromLeft ? w * 0.04 : w * 0.96;
    const y = h * 0.95;
    const baseAngle = fromLeft ? -Math.PI * 0.32 : -Math.PI * 0.68;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (Math.random() - 0.5) * 0.7;
      const speed = h * (0.9 + Math.random() * 0.9);
      this.pieces.push(this.piece(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 2.8 + Math.random() * 1.6));
    }
  }

  private shower(count: number): void {
    const w = stageDims().w;
    for (let i = 0; i < count; i++) {
      this.pieces.push(this.piece(Math.random() * w, -20 - Math.random() * 200, (Math.random() - 0.5) * 80, 60 + Math.random() * 120, 4 + Math.random() * 2));
    }
  }

  private piece(x: number, y: number, vx: number, vy: number, life: number): Piece {
    return {
      x,
      y,
      vx,
      vy,
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 14,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      age: 0,
      life,
      wobble: Math.random() * Math.PI * 2,
    };
  }

  /** `big` is the winner's celebration; the small one is a polite pop. */
  celebrate(big: boolean): void {
    if (!this.ctx) return;
    this.stop();
    this.resize();
    const volleys = big ? 5 : 2;
    this.pending = volleys;
    for (let i = 0; i < volleys; i++) {
      this.timers.push(
        window.setTimeout(() => {
          this.pending--;
          this.cannon(true, big ? 90 : 45);
          this.cannon(false, big ? 90 : 45);
          if (big && i >= 1) this.shower(50);
        }, i * 650),
      );
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const w = stageDims().w;
    const h = stageDims().h;
    ctx.clearRect(0, 0, w, h);
    const gravity = h * 0.9;
    this.pieces = this.pieces.filter((p) => p.age < p.life && p.y < h + 40);
    for (const p of this.pieces) {
      p.age += dt;
      p.vy += gravity * dt;
      p.vx *= 1 - 0.9 * dt; // air drag
      p.vy *= 1 - 0.6 * dt;
      p.x += p.vx * dt + Math.sin(p.age * 4 + p.wobble) * 18 * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const fade = Math.min(1, (p.life - p.age) / 0.6);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.age * 9 + p.wobble)); // flutter
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (this.pieces.length > 0 || this.pending > 0) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      ctx.clearRect(0, 0, w, h);
      this.raf = 0;
    }
  };

  stop(): void {
    this.timers.splice(0).forEach((t) => window.clearTimeout(t));
    this.pending = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pieces = [];
    this.ctx?.clearRect(0, 0, stageDims().w, stageDims().h);
  }
}
