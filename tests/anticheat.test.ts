import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Lobby, MemoryBoard, type Conn } from "../server/lobby";
import { PlayerStore } from "../server/players";
import { lapPlausible, minLapMs, raceTimePlausible } from "../server/plausibility";
import { startServer } from "../server/server";
import { parseClientMessage, type ServerMsg } from "../src/net/protocol";
import { TRACKS } from "../src/track/tracks";

const A = "aaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbb";
const client = () => {
  const got: ServerMsg[] = [];
  const conn: Conn = { send: (m) => void got.push(m) };
  return { conn, got };
};

describe("device key on the relay", () => {
  it("accepts the first device for an ID and refuses anyone else", () => {
    const s = new PlayerStore();
    expect(s.authorize("aaaa1111", A)).toBe(true);
    expect(s.authorize("aaaa1111", A)).toBe(true);
    expect(s.authorize("aaaa1111", B)).toBe(false);
    expect(s.authorize("aaaa1111", undefined)).toBe(false);
    expect(s.authorize("aaaa1111", "short")).toBe(false);
  });
  it("lets the same key keep using the REST save after being claimed over the relay", () => {
    const s = new PlayerStore();
    s.authorize("aaaa1111", A);
    expect(s.save("aaaa1111", A, "Ann", [{ id: "r1", startedAt: "2026-01-01" }])).toBe("saved");
    expect(s.save("aaaa1111", B, "Eve", [])).toBe("forbidden");
  });
  it("hello carries the token through validation", () => {
    expect(parseClientMessage(`{"t":"hello","id":"aaaa1111","name":"Ann","token":"${A}"}`)).toMatchObject({ token: A });
    expect(parseClientMessage('{"t":"hello","id":"aaaa1111","name":"Ann","token":"x"}')).not.toHaveProperty("token");
  });
  it("the lobby rejects a hello from the wrong device", () => {
    const store = new PlayerStore();
    const l = new Lobby({ rules: { authorize: (id, t) => store.authorize(id, t) } });
    const owner = client();
    const thief = client();
    l.handle(owner.conn, { t: "hello", id: "aaaa1111", name: "Ann", token: A });
    l.handle(thief.conn, { t: "hello", id: "aaaa1111", name: "Not Ann", token: B });
    expect(owner.got.some((m) => m.t === "welcome")).toBe(true);
    expect(thief.got.some((m) => m.t === "welcome")).toBe(false);
    expect(thief.got.find((m) => m.t === "error")).toBeTruthy();
    expect(l.online).toBe(1);
  });
});

describe("lap and race time plausibility", () => {
  it.each(TRACKS.map((t) => [t.id, t] as const))("%s: minimum is real, an honest lap passes, a teleport lap fails", (id, def) => {
    const min = minLapMs(id)!;
    expect(min).toBeGreaterThan(8_000);
    expect(min).toBeLessThan(60_000);
    expect(lapPlausible(id, min + 1)).toBe(true);
    expect(lapPlausible(id, 5_000)).toBe(false);
    expect(lapPlausible(`${id}|night|rain`, min + 1)).toBe(true);
    expect(raceTimePlausible(id, min * def.laps + 1)).toBe(true);
    expect(raceTimePlausible(id, min * def.laps - 5000)).toBe(false);
  });
  it("rejects unknown circuits", () => {
    expect(lapPlausible("made-up-track", 90_000)).toBe(false);
    expect(minLapMs("nope")).toBeNull();
  });
  it("the lobby ignores impossible lap times and race times", () => {
    const board = new MemoryBoard();
    const l = new Lobby({ board, rules: { lapPlausible, raceTimePlausible } });
    const a = client();
    l.handle(a.conn, { t: "hello", id: "aaaa1111", name: "Ann" });
    l.handle(a.conn, { t: "submitLap", trackId: "apex-park", ms: 6000 });
    expect(board.top("apex-park", 5)).toHaveLength(0);
    l.handle(a.conn, { t: "submitLap", trackId: "apex-park", ms: 80_000 });
    expect(board.top("apex-park", 5)).toHaveLength(1);
  });
});

describe("strict relay over real WebSockets", () => {
  let close: (() => Promise<void>) | null = null;
  afterAll(async () => void (await close?.()));
  it("welcomes the owner, refuses the impostor", async () => {
    const s = await startServer(0);
    close = s.close;
    const talk = (token: string) =>
      new Promise<ServerMsg["t"]>((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
        ws.on("open", () => ws.send(JSON.stringify({ t: "hello", id: "aaaa1111", name: "Ann", token })));
        ws.on("message", (d) => {
          res((JSON.parse(d.toString()) as ServerMsg).t);
          ws.close();
        });
      });
    expect(await talk(A)).toBe("welcome");
    expect(await talk(B)).toBe("error");
  });
});
