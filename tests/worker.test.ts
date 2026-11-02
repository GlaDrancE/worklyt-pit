import { describe, expect, it } from "vitest";
import { handle, type D1Like } from "../worker/handler";

/** A tiny in-memory stand-in for D1 that understands just the two statements the handler uses. */
function fakeDb(): D1Like {
  const rows = new Map<string, { name: string; token_hash: string; records: string }>();
  return {
    prepare(sql: string) {
      return {
        bind(...v: unknown[]) {
          return {
            async first<T>() {
              return (rows.get(String(v[0])) as T | undefined) ?? null;
            },
            async run() {
              if (sql.startsWith("INSERT")) rows.set(String(v[0]), { name: String(v[1]), token_hash: String(v[2]), records: String(v[4]) });
            },
          };
        },
      };
    },
  };
}

const T = "0123456789abcdef0123";
const call = (db: D1Like, method: string, id: string, token: string, body?: unknown) =>
  handle(new Request(`https://x.dev/player/${id}`, { method, headers: { "x-player-token": token }, body: body ? JSON.stringify(body) : undefined }), db);

describe("Cloudflare data worker", () => {
  it("saves, merges and returns a player's history", async () => {
    const db = fakeDb();
    expect((await call(db, "PUT", "aaaa1111", T, { name: "Ann", records: [{ id: "r1", startedAt: "2026-01-01" }] })).status).toBe(200);
    await call(db, "PUT", "aaaa1111", T, { name: "Ann", records: [{ id: "r2", startedAt: "2026-01-02" }, { bad: 1 }] });
    const got = (await (await call(db, "GET", "aaaa1111", T)).json()) as { name: string; records: Array<{ id: string }> };
    expect(got.name).toBe("Ann");
    expect(got.records.map((r) => r.id)).toEqual(["r2", "r1"]);
  });
  it("keeps an ID private to the device that claimed it", async () => {
    const db = fakeDb();
    await call(db, "PUT", "aaaa1111", T, { name: "Ann", records: [] });
    expect((await call(db, "GET", "aaaa1111", "ffffffffffffffffffff")).status).toBe(403);
    expect((await call(db, "PUT", "aaaa1111", "ffffffffffffffffffff", { records: [] })).status).toBe(403);
  });
  it("answers unknown IDs with an empty history and weak tokens with an error", async () => {
    const db = fakeDb();
    expect(await (await call(db, "GET", "zzzz9999", T)).json()).toEqual({ name: "", records: [] });
    expect((await call(db, "PUT", "aaaa1111", "short", { records: [] })).status).toBe(400);
  });
});
