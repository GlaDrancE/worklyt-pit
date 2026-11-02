import { createHash, timingSafeEqual } from "node:crypto";

/** One saved race, as the game stores it. The server keeps them as plain JSON and checks only their shape. */
export interface StoredRecord {
  id: string;
  startedAt: string;
  [key: string]: unknown;
}

export interface StoredPlayer {
  id: string;
  name: string;
  /** SHA-256 of the secret that only this player's device knows (the first save claims the ID). */
  tokenHash: string;
  updatedAt: number;
  records: StoredRecord[];
}

export const MAX_STORED_RECORDS = 200;
export const MAX_PLAYERS = 50_000;
const ID = /^[A-Za-z0-9]{4,16}$/;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function cleanRecord(r: unknown): StoredRecord | null {
  const o = r as StoredRecord;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || o.id.length > 40 || typeof o.startedAt !== "string") return null;
  if (JSON.stringify(o).length > 6000) return null;
  return o;
}

export type SaveResult = "saved" | "forbidden" | "invalid";

/** Every player's name and race history, held in memory and saved to one JSON file by the server. */
export class PlayerStore {
  private readonly players = new Map<string, StoredPlayer>();
  onChange: (() => void) | null = null;

  get count(): number {
    return this.players.size;
  }

  private allowed(p: StoredPlayer | undefined, token: string): boolean {
    if (!p) return true;
    const a = Buffer.from(p.tokenHash);
    const b = Buffer.from(hash(token));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The player's saved data, or null if the ID is unknown or the token is wrong. */
  get(id: string, token: string): { name: string; records: StoredRecord[] } | "forbidden" | null {
    const p = this.players.get(id);
    if (!p) return null;
    if (!this.allowed(p, token)) return "forbidden";
    return { name: p.name, records: p.records };
  }

  /**
   * Is this device allowed to be driver `id`? The first device to ask claims the ID; after that only the same
   * secret is accepted. Used by the relay so nobody can race, or post lap times, under someone else's ID.
   */
  authorize(id: string, token: string | undefined): boolean {
    if (!ID.test(id) || !token || token.length < 16 || token.length > 128) return false;
    const cur = this.players.get(id);
    if (cur) return this.allowed(cur, token);
    if (this.players.size >= MAX_PLAYERS) return false;
    this.players.set(id, { id, name: "Driver", tokenHash: hash(token), updatedAt: Date.now(), records: [] });
    this.onChange?.();
    return true;
  }

  /** Merge records into a player's history (by record id). The first save for an ID claims it. */
  save(id: string, token: string, name: string, records: unknown[]): SaveResult {
    if (!ID.test(id) || token.length < 16 || token.length > 128 || typeof name !== "string") return "invalid";
    const cur = this.players.get(id);
    if (!cur && this.players.size >= MAX_PLAYERS) return "invalid";
    if (!this.allowed(cur, token)) return "forbidden";
    const byId = new Map<string, StoredRecord>((cur?.records ?? []).map((r) => [r.id, r]));
    for (const raw of records.slice(0, MAX_STORED_RECORDS)) {
      const r = cleanRecord(raw);
      if (r) byId.set(r.id, r);
    }
    const merged = [...byId.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, MAX_STORED_RECORDS);
    this.players.set(id, { id, name: name.replace(/[<>&"'`]/g, "").trim().slice(0, 20) || "Driver", tokenHash: cur?.tokenHash ?? hash(token), updatedAt: Date.now(), records: merged });
    this.onChange?.();
    return "saved";
  }

  toJSON(): StoredPlayer[] {
    return [...this.players.values()];
  }

  load(json: unknown): void {
    if (!Array.isArray(json)) return;
    for (const p of json as StoredPlayer[]) {
      if (p && ID.test(p.id) && typeof p.tokenHash === "string" && Array.isArray(p.records)) this.players.set(p.id, p);
    }
  }
}
