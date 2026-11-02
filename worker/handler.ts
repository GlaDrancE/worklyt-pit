/**
 * Player data API for Cloudflare Workers + D1 (free tier, no server to keep awake).
 * Same two calls as the relay: GET and PUT /player/<driver id>, with the device's secret in x-player-token.
 * Pure function over a tiny D1-shaped interface so it can be tested without Cloudflare.
 */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> } };
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-player-token", "access-control-allow-methods": "GET, PUT, OPTIONS" };
const ID = /^[A-Za-z0-9]{4,16}$/;
export const MAX_RECORDS = 200;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Rec {
  id: string;
  startedAt: string;
  [k: string]: unknown;
}

function clean(r: unknown): Rec | null {
  const o = r as Rec;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || o.id.length > 40 || typeof o.startedAt !== "string") return null;
  return JSON.stringify(o).length > 6000 ? null : o;
}

const reply = (code: number, body: unknown): Response => new Response(JSON.stringify(body), { status: code, headers: { ...CORS, "content-type": "application/json" } });

export async function handle(req: Request, db: D1Like): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = /^\/player\/([A-Za-z0-9]{4,16})$/.exec(new URL(req.url).pathname);
  if (!m || !ID.test(m[1]!)) return new Response("TrackRush player data store is running.\n", { headers: { ...CORS, "content-type": "text/plain" } });
  const id = m[1]!;
  const token = req.headers.get("x-player-token") ?? "";
  const row = await db.prepare("SELECT name, token_hash, records FROM players WHERE id = ?").bind(id).first<{ name: string; token_hash: string; records: string }>();

  if (req.method === "GET") {
    if (!row) return reply(200, { name: "", records: [] });
    if (row.token_hash !== (await sha256(token))) return reply(403, { error: "forbidden" });
    return reply(200, { name: row.name, records: JSON.parse(row.records) as unknown[] });
  }
  if (req.method === "PUT") {
    if (token.length < 16 || token.length > 128) return reply(400, { result: "invalid" });
    const hash = await sha256(token);
    if (row && row.token_hash !== hash) return reply(403, { result: "forbidden" });
    let body: { name?: unknown; records?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return reply(400, { result: "invalid" });
    }
    const byId = new Map<string, Rec>((row ? (JSON.parse(row.records) as Rec[]) : []).map((r) => [r.id, r]));
    for (const raw of (Array.isArray(body.records) ? body.records : []).slice(0, MAX_RECORDS)) {
      const r = clean(raw);
      if (r) byId.set(r.id, r);
    }
    const merged = [...byId.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, MAX_RECORDS);
    const name = String(body.name ?? "").replace(/[<>&"'`]/g, "").trim().slice(0, 20) || "Driver";
    await db
      .prepare("INSERT INTO players (id, name, token_hash, updated_at, records) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, records = excluded.records")
      .bind(id, name, hash, Date.now(), JSON.stringify(merged))
      .run();
    return reply(200, { result: "saved" });
  }
  return reply(405, { error: "method" });
}
