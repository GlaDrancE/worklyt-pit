import { formatTime } from "./HUD";

export interface ShareData {
  driver: string;
  track: string;
  conditions: string;
  theme: "day" | "dusk" | "night";
  bestMs: number | null;
  laps: number;
  topSpeedKmh: number;
  driftTotal: number;
  collisions: number;
  /** Null when tyre wear was off. */
  pitStops: number | null;
  achievements: number;
  /** e.g. "P2 of 4"; null with no rivals. */
  place: string | null;
  /** Centre line of the circuit as [x, z] points, drawn as a little map. */
  outline: ReadonlyArray<readonly [number, number]>;
}

const SKY: Record<ShareData["theme"], [string, string]> = {
  day: ["#1f5fa8", "#7fb8e8"],
  dusk: ["#2a2f66", "#e0735f"],
  night: ["#05070f", "#1a2447"],
};

/** A 1200×630 picture of the race result, drawn on a canvas. Nothing leaves the device. */
export function renderShareCard(d: ShareData): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;

  const [top, bottom] = SKY[d.theme];
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, top);
  bg.addColorStop(1, bottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,0.38)";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ff2d3d";
  g.fillRect(0, 0, 14, H);

  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";
  g.font = "800 30px system-ui, sans-serif";
  g.fillText("TRACKRUSH PRO", 56, 74);
  g.font = "500 24px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillText(`${d.track} · ${d.conditions}`, 56, 112);

  g.fillStyle = "#fff";
  g.font = "700 40px system-ui, sans-serif";
  g.fillText(d.driver, 56, 200);

  g.font = "500 22px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.fillText("BEST LAP", 56, 290);
  g.fillStyle = "#fff";
  g.font = "800 110px system-ui, sans-serif";
  g.fillText(formatTime(d.bestMs), 52, 390);

  const stats: Array<[string, string]> = [
    ["LAPS", String(d.laps)],
    ["TOP SPEED", `${Math.round(d.topSpeedKmh)} km/h`],
    ["DRIFT", String(d.driftTotal)],
    ["HITS", String(d.collisions)],
  ];
  if (d.pitStops !== null) stats.push(["PIT STOPS", String(d.pitStops)]);
  if (d.place) stats.unshift(["POSITION", d.place]);
  stats.forEach(([label, value], i) => {
    const x = 56 + i * 178;
    g.fillStyle = "rgba(255,255,255,0.65)";
    g.font = "600 18px system-ui, sans-serif";
    g.fillText(label, x, 480);
    g.fillStyle = "#fff";
    g.font = "700 30px system-ui, sans-serif";
    g.fillText(value, x, 520);
  });
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.font = "500 20px system-ui, sans-serif";
  g.fillText(`${d.achievements} achievement${d.achievements === 1 ? "" : "s"} unlocked`, 56, 586);

  // Track outline, scaled into the right-hand box.
  if (d.outline.length > 3) {
    const box = { x: 760, y: 90, w: 380, h: 420 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of d.outline) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const scale = Math.min(box.w / (maxX - minX || 1), box.h / (maxZ - minZ || 1));
    const ox = box.x + (box.w - (maxX - minX) * scale) / 2;
    const oy = box.y + (box.h - (maxZ - minZ) * scale) / 2;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.beginPath();
    d.outline.forEach(([x, z], i) => {
      const px = ox + (x - minX) * scale;
      const py = oy + (maxZ - z) * scale;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = "#fff";
    g.lineWidth = 9;
    g.stroke();
    const [sx, sz] = d.outline[0]!;
    g.fillStyle = "#ff2d3d";
    g.beginPath();
    g.arc(ox + (sx - minX) * scale, oy + (maxZ - sz) * scale, 11, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Share the picture with the phone's share sheet if it can; the caller shows it for saving otherwise. */
export async function tryNativeShare(canvas: HTMLCanvasElement, text: string): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob || typeof navigator.share !== "function") return false;
    const file = new File([blob], "trackrush-result.png", { type: "image/png" });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], text });
    return true;
  } catch {
    return false; // cancelled or unsupported
  }
}

export interface LapCardData {
  driver: string;
  track: string;
  conditions: string;
  theme: ShareData["theme"];
  lapMs: number;
  /** The racing line actually driven, with the speed at each point (km/h). */
  line: ReadonlyArray<{ x: number; z: number; kmh: number }>;
  topSpeedKmh: number;
}

/** Blue (slow) to red (fast) for a speed between 0 and `max`. */
export function speedColour(kmh: number, max: number): string {
  const k = Math.min(1, Math.max(0, max > 0 ? kmh / max : 0));
  return `hsl(${Math.round(220 - 220 * k)} 90% 55%)`;
}

/** A 1200×630 picture of one lap: the line you drove, coloured by speed. Drawn on a canvas; nothing leaves the device. */
export function renderLapCard(d: LapCardData): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const [top, bottom] = SKY[d.theme];
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, top);
  bg.addColorStop(1, bottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ff2d3d";
  g.fillRect(0, 0, 14, H);

  g.fillStyle = "#fff";
  g.font = "800 30px system-ui, sans-serif";
  g.fillText("TRACKRUSH PRO", 56, 74);
  g.font = "500 24px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillText(`${d.track} · ${d.conditions}`, 56, 112);
  g.fillStyle = "#fff";
  g.font = "700 40px system-ui, sans-serif";
  g.fillText(d.driver, 56, 200);
  g.font = "500 22px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.fillText("LAP TIME", 56, 290);
  g.fillStyle = "#fff";
  g.font = "800 110px system-ui, sans-serif";
  g.fillText(formatTime(d.lapMs), 52, 390);
  g.font = "600 22px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillText(`Top speed ${Math.round(d.topSpeedKmh)} km/h`, 56, 450);

  // Speed key.
  const kx = 56;
  const ky = 540;
  for (let i = 0; i < 200; i++) {
    g.fillStyle = speedColour(i, 199);
    g.fillRect(kx + i * 1.5, ky, 2, 14);
  }
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.font = "500 16px system-ui, sans-serif";
  g.fillText("slow", kx, ky + 36);
  g.fillText("fast", kx + 270, ky + 36);

  if (d.line.length > 3) {
    const box = { x: 700, y: 60, w: 440, h: 510 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of d.line) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const scale = Math.min(box.w / (maxX - minX || 1), box.h / (maxZ - minZ || 1));
    const ox = box.x + (box.w - (maxX - minX) * scale) / 2;
    const oy = box.y + (box.h - (maxZ - minZ) * scale) / 2;
    const px = (x: number) => ox + (x - minX) * scale;
    const py = (z: number) => oy + (maxZ - z) * scale;
    const max = Math.max(1, ...d.line.map((p) => p.kmh));
    g.lineJoin = "round";
    g.lineCap = "round";
    g.lineWidth = 12;
    for (let i = 1; i < d.line.length; i++) {
      const a = d.line[i - 1]!;
      const b = d.line[i]!;
      g.strokeStyle = speedColour((a.kmh + b.kmh) / 2, max);
      g.beginPath();
      g.moveTo(px(a.x), py(a.z));
      g.lineTo(px(b.x), py(b.z));
      g.stroke();
    }
    const s0 = d.line[0]!;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(px(s0.x), py(s0.z), 9, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
