import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../server/server";
import type { ClientMsg, ServerMsg } from "../src/net/protocol";

let server: RunningServer;
beforeAll(async () => {
  server = await startServer(0, { strict: false });
});
afterAll(async () => {
  await server.close();
});

function connect(id: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const inbox: ServerMsg[] = [];
  const waiters: Array<{ t: string; res: (m: ServerMsg) => void }> = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    const i = waiters.findIndex((w) => w.t === m.t);
    if (i >= 0) waiters.splice(i, 1)[0]!.res(m);
    else inbox.push(m);
  });
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  const next = <T extends ServerMsg["t"]>(t: T) =>
    new Promise<Extract<ServerMsg, { t: T }>>((res, rej) => {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return res(inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>);
      const timer = setTimeout(() => rej(new Error(`timed out waiting for ${t}`)), 3000);
      waiters.push({ t, res: (m) => (clearTimeout(timer), res(m as Extract<ServerMsg, { t: T }>)) });
    });
  return new Promise<{ send: typeof send; next: typeof next; ws: WebSocket }>((res) => {
    ws.on("open", () => {
      send({ t: "hello", id, name });
      void next("welcome").then(() => res({ send, next, ws }));
    });
  });
}

describe("relay over real WebSockets", () => {
  it("matches two strangers, relays positions and reports the result", async () => {
    const a = await connect("aaaa0001", "Ann");
    const b = await connect("bbbb0002", "Ben");
    a.send({ t: "quick", trackId: "apex-park" });
    await a.next("queued");
    b.send({ t: "quick", trackId: "apex-park" });
    const [ma, mb] = await Promise.all([a.next("match"), b.next("match")]);
    expect(ma.opponent.name).toBe("Ben");
    expect(mb.opponent.name).toBe("Ann");
    a.send({ t: "ready" });
    b.send({ t: "ready" });
    await Promise.all([a.next("start"), b.next("start")]);

    a.send({ t: "state", s: { x: 5, y: 0.6, z: 9, qx: 0, qy: 0, qz: 0, qw: 1, speedKmh: 200, progress: 0.4, steer: 0.1 } });
    const opp = await b.next("opp");
    expect(opp.s.progress).toBeCloseTo(0.4);

    a.send({ t: "finish", totalMs: 90_000 });
    b.send({ t: "finish", totalMs: 91_000 });
    const result = await a.next("result");
    expect(result.standings[0]).toMatchObject({ name: "Ann", points: 25 });
    expect(result.standings[1]).toMatchObject({ name: "Ben", points: 18 });
    a.ws.close();
    b.ws.close();
  });

  it("ignores malformed messages without crashing", async () => {
    const a = await connect("aaaa0003", "Ann");
    a.ws.send("{broken");
    a.ws.send(JSON.stringify({ t: "state", s: "nope" }));
    a.send({ t: "board", trackId: "apex-park" });
    const board = await a.next("board");
    expect(board.entries).toEqual([]);
    a.ws.close();
  });
});
