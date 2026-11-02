/** Messages shared by the game client and the relay server. */

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speedKmh: number;
  /** Laps completed plus the fraction of the current lap (0..totalLaps). */
  progress: number;
  /** Front-wheel steering angle (radians) for the ghost car's wheels. */
  steer: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Id of the paint scheme this driver chose for the race (see CAR_COLOURS). */
  colour?: string;
}

export interface Standing {
  id: string;
  name: string;
  /** Total race time in ms, or null if the driver didn't finish. */
  totalMs: number | null;
  place: number;
  points: number;
}

export interface BoardEntry {
  id: string;
  name: string;
  bestMs: number;
}

export type ClientMsg =
  | { t: "hello"; id: string; name: string; colour?: string; token?: string }
  | { t: "colour"; colour: string }
  | { t: "invite"; to: string; trackId: string }
  | { t: "inviteReply"; from: string; accept: boolean }
  | { t: "quick"; trackId: string }
  | { t: "leave" }
  | { t: "ready" }
  | { t: "state"; s: PlayerState }
  | { t: "finish"; totalMs: number }
  | { t: "submitLap"; trackId: string; ms: number }
  | { t: "board"; trackId: string };

export type ServerMsg =
  | { t: "welcome"; online: number }
  | { t: "error"; msg: string }
  | { t: "invited"; from: PlayerInfo; trackId: string }
  | { t: "inviteDeclined"; by: string }
  | { t: "queued" }
  | { t: "match"; room: string; trackId: string; slot: 0 | 1; opponent: PlayerInfo }
  | { t: "start" }
  | { t: "opp"; s: PlayerState }
  | { t: "oppFinished"; name: string; totalMs: number }
  | { t: "oppLeft"; name: string }
  | { t: "result"; standings: Standing[]; forfeit: boolean }
  | { t: "board"; trackId: string; entries: BoardEntry[] };

export const COLOUR_PATTERN = /^[a-z0-9-]{1,24}$/;
export const ID_PATTERN = /^[A-Za-z0-9]{4,16}$/;
export const MAX_NAME = 20;
export const POINTS_BY_PLACE = [25, 18] as const;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function cleanName(raw: string): string {
  return raw.replace(/[<>&"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

function isState(v: unknown): v is PlayerState {
  const s = v as PlayerState;
  return (
    !!s &&
    [s.x, s.y, s.z, s.qx, s.qy, s.qz, s.qw, s.speedKmh, s.progress, s.steer].every(num) &&
    Math.abs(s.x) < 1e5 &&
    Math.abs(s.z) < 1e5 &&
    Math.abs(s.y) < 1e3
  );
}

/** Validates one raw JSON message from the network. Returns null for anything unexpected. */
export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > 4096) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const m = v as Record<string, unknown>;
  if (!m || typeof m !== "object") return null;
  switch (m.t) {
    case "hello":
      return str(m.id, 16) && ID_PATTERN.test(m.id) && typeof m.name === "string" && cleanName(m.name)
        ? {
            t: "hello",
            id: m.id,
            name: cleanName(m.name),
            ...(typeof m.colour === "string" && COLOUR_PATTERN.test(m.colour) ? { colour: m.colour } : {}),
            ...(typeof m.token === "string" && m.token.length >= 16 && m.token.length <= 128 ? { token: m.token } : {}),
          }
        : null;
    case "colour":
      return typeof m.colour === "string" && COLOUR_PATTERN.test(m.colour) ? { t: "colour", colour: m.colour } : null;
    case "invite":
      return str(m.to, 16) && str(m.trackId, 40) ? { t: "invite", to: m.to, trackId: m.trackId } : null;
    case "inviteReply":
      return str(m.from, 16) && typeof m.accept === "boolean" ? { t: "inviteReply", from: m.from, accept: m.accept } : null;
    case "quick":
      return str(m.trackId, 40) ? { t: "quick", trackId: m.trackId } : null;
    case "leave":
      return { t: "leave" };
    case "ready":
      return { t: "ready" };
    case "state":
      return isState(m.s) ? { t: "state", s: m.s } : null;
    case "finish":
      return num(m.totalMs) && m.totalMs >= 1000 && m.totalMs <= 3_600_000 ? { t: "finish", totalMs: Math.round(m.totalMs) } : null;
    case "submitLap":
      return str(m.trackId, 40) && num(m.ms) && m.ms >= 5000 && m.ms <= 1_000_000 ? { t: "submitLap", trackId: m.trackId, ms: Math.round(m.ms) } : null;
    case "board":
      return str(m.trackId, 40) ? { t: "board", trackId: m.trackId } : null;
    default:
      return null;
  }
}
