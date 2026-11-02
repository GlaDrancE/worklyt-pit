import type { TrackModel } from "./TrackModel";

const SECTOR_COLORS = ["#ffd23f", "#3fa7ff", "#7dff7a"];

/** 2D minimap: the circuit is rendered once, only the car marker is drawn per frame. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly scale: number;
  private readonly offX: number;
  private readonly offY: number;
  private readonly minX: number;
  private readonly minZ: number;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly model: TrackModel) {
    this.ctx = canvas.getContext("2d")!;
    const b = model.bounds();
    const pad = 16;
    const w = canvas.width;
    const h = canvas.height;
    const spanX = b.maxX - b.minX || 1;
    const spanZ = b.maxZ - b.minZ || 1;
    this.scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    this.offX = (w - spanX * this.scale) / 2;
    this.offY = (h - spanZ * this.scale) / 2;
    this.minX = b.minX;
    this.minZ = b.minZ;

    this.base = document.createElement("canvas");
    this.base.width = w;
    this.base.height = h;
    this.renderBase();
  }

  private mx(x: number): number {
    return this.offX + (x - this.minX) * this.scale;
  }
  private my(z: number): number {
    return this.offY + (z - this.minZ) * this.scale;
  }

  private renderBase(): void {
    const g = this.base.getContext("2d")!;
    const m = this.model;
    const n = m.count;
    const idx = (gate: number) => m.nearest(m.gates[gate]!.x, m.gates[gate]!.z).index;
    const bounds = [0, idx(m.sectorGates[0]), idx(m.sectorGates[1]), n];

    g.lineCap = "round";
    g.lineJoin = "round";
    // Road outline then sector colours.
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 9;
    this.path(g, 0, n);
    g.stroke();
    for (let s = 0; s < 3; s++) {
      g.strokeStyle = SECTOR_COLORS[s]!;
      g.lineWidth = 4;
      this.path(g, bounds[s]!, Math.min(bounds[s + 1]! + 1, n));
      g.stroke();
    }
    // Checkpoint ticks.
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 1;
    for (const gate of m.gates) {
      if (gate.index === 0) continue;
      const nx = -gate.tz;
      const nz = gate.tx;
      g.beginPath();
      g.moveTo(this.mx(gate.x + nx * 7), this.my(gate.z + nz * 7));
      g.lineTo(this.mx(gate.x - nx * 7), this.my(gate.z - nz * 7));
      g.stroke();
    }
    // Start/finish.
    const g0 = m.gates[0]!;
    g.strokeStyle = "#fff";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(this.mx(g0.x + -g0.tz * 9), this.my(g0.z + g0.tx * 9));
    g.lineTo(this.mx(g0.x - -g0.tz * 9), this.my(g0.z - g0.tx * 9));
    g.stroke();
  }

  private path(g: CanvasRenderingContext2D, from: number, to: number): void {
    const s = this.model.samples;
    const n = s.length;
    g.beginPath();
    for (let i = from; i < to; i++) {
      const p = s[i % n]!;
      if (i === from) g.moveTo(this.mx(p.x), this.my(p.z));
      else g.lineTo(this.mx(p.x), this.my(p.z));
    }
  }

  draw(x: number, z: number, yaw: number, others: ReadonlyArray<{ x: number; z: number; color: string }> = []): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);
    for (const o of others) {
      ctx.fillStyle = o.color;
      ctx.strokeStyle = "#0b0d12";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.mx(o.x), this.my(o.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const cx = this.mx(x);
    const cy = this.my(z);
    const dx = Math.sin(yaw);
    const dy = Math.cos(yaw);
    ctx.fillStyle = "#ff2d3d";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 8, cy + dy * 8);
    ctx.lineTo(cx - dx * 5 + dy * 5, cy - dy * 5 - dx * 5);
    ctx.lineTo(cx - dx * 5 - dy * 5, cy - dy * 5 + dx * 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
