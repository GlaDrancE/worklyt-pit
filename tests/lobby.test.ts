import { describe, expect, it } from "vitest";
import { Lobby, type Conn } from "../server/lobby";
import { parseClientMessage, type ServerMsg } from "../src/net/protocol";

function client() {
  const got: ServerMsg[] = [];
  const conn: Conn = { send: (m) => void got.push(m) };
  return { conn, got, last: (t: ServerMsg["t"]) => [...got].reverse().find((m) => m.t === t) };
}

const state = (progress = 0) => ({ x: 1, y: 0.6, z: 2, qx: 0, qy: 0, qz: 0, qw: 1, speedKmh: 100, progress, steer: 0 });

function hello(l: Lobby, c: ReturnType<typeof client>, id: string, name: string) {
  l.handle(c.conn, { t: "hello", id, name });
}

function matched() {
  const l = new Lobby({ setTimer: () => 1, clearTimer: () => {} });
  const a = client();
  const b = client();
  hello(l, a, "aaaa1111", "Ann");
  hello(l, b, "bbbb2222", "Ben");
  l.handle(a.conn, { t: "invite", to: "bbbb2222", trackId: "apex-park" });
  l.handle(b.conn, { t: "inviteReply", from: "aaaa1111", accept: true });
  l.handle(a.conn, { t: "ready" });
  l.handle(b.conn, { t: "ready" });
  return { l, a, b };
}

describe("lobby: invites by driver ID", () => {
  it("delivers an invite and starts a match when it is accepted", () => {
    const { a, b } = matched();
    expect(b.got.find((m) => m.t === "invited")).toMatchObject({ from: { id: "aaaa1111", name: "Ann" }, trackId: "apex-park" });
    expect(a.last("match")).toMatchObject({ slot: 0, trackId: "apex-park", opponent: { name: "Ben" } });
    expect(b.last("match")).toMatchObject({ slot: 1, opponent: { name: "Ann" } });
    expect(a.last("start")).toBeTruthy();
    expect(b.last("start")).toBeTruthy();
  });

  it("tells the inviter when the invite is declined, and rejects unknown IDs", () => {
    const l = new Lobby();
    const a = client();
    const b = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    l.handle(a.conn, { t: "invite", to: "nobody99", trackId: "t" });
    expect(a.last("error")).toBeTruthy();
    l.handle(a.conn, { t: "invite", to: "bbbb2222", trackId: "t" });
    l.handle(b.conn, { t: "inviteReply", from: "aaaa1111", accept: false });
    expect(a.last("inviteDeclined")).toMatchObject({ by: "Ben" });
    expect(a.last("match")).toBeUndefined();
  });

  it("refuses a second window using the same driver ID", () => {
    const l = new Lobby();
    const a = client();
    const dup = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, dup, "aaaa1111", "Ann again");
    expect(dup.last("error")).toBeTruthy();
    expect(l.online).toBe(1);
  });
});

describe("lobby: open race rooms", () => {
  it("joins racers to the same live room only when circuit and conditions match", () => {
    const l = new Lobby();
    const a = client();
    const b = client();
    const c = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    hello(l, c, "cccc3333", "Cy");
    const apex = "apex-park|day|clear";
    l.handle(a.conn, { t: "quick", trackId: apex });
    const first = a.last("roomJoined");
    if (first?.t !== "roomJoined") throw new Error("first racer did not join a room");
    l.handle(b.conn, { t: "quick", trackId: "harbour-loop|day|clear" });
    const otherTrack = b.last("roomJoined");
    if (otherTrack?.t !== "roomJoined") throw new Error("second racer did not join a room");
    l.handle(c.conn, { t: "quick", trackId: apex });
    const third = c.last("roomJoined");
    if (third?.t !== "roomJoined") throw new Error("third racer did not join a room");
    expect(first.room.id).toBe(third.room.id);
    expect(otherTrack.room.id).not.toBe(first.room.id);
    expect(third.room.racers.map((r) => r.name)).toEqual(["Ann", "Cy"]);
    expect(a.last("playerJoined")).toMatchObject({ roomId: first.room.id, player: { name: "Cy" } });
  });

  it("rejects joining the same live room twice with one driver ID", () => {
    const l = new Lobby();
    const a = client();
    hello(l, a, "aaaa1111", "Ann");
    l.handle(a.conn, { t: "quick", trackId: "t" });
    l.handle(a.conn, { t: "quick", trackId: "t" });
    expect(a.last("error")).toBeTruthy();
  });

  it("enforces the configured room limit and ranks up to that limit", () => {
    const l = new Lobby({ maxPlayers: 3 });
    const racers = [client(), client(), client(), client()];
    racers.forEach((c, i) => hello(l, c, `player${i}1`, `Driver ${i + 1}`));
    racers.slice(0, 3).forEach((c) => l.handle(c.conn, { t: "quick", trackId: "t|day|clear" }));
    const room = racers[0]!.last("roomJoined");
    if (room?.t !== "roomJoined") throw new Error("room did not start");
    const fullRoom = racers[2]!.last("roomJoined");
    if (fullRoom?.t !== "roomJoined") throw new Error("third racer did not join");
    expect(fullRoom.room.racers).toHaveLength(3);
    expect(fullRoom.room.racers.map((r) => r.name)).toContain("Driver 3");
    l.handle(racers[3]!.conn, { t: "quick", trackId: "t|day|clear" });
    expect(racers[3]!.last("error")).toMatchObject({ t: "error", msg: "This race is full (3 drivers)." });

    l.handle(racers[0]!.conn, { t: "finish", totalMs: 120_000 });
    l.handle(racers[1]!.conn, { t: "finish", totalMs: 118_000 });
    l.handle(racers[2]!.conn, { t: "finish", totalMs: 125_000 });
    const result = racers[0]!.last("result");
    if (result?.t !== "result") throw new Error("no multi-player result");
    expect(result.standings.map((standing) => [standing.name, standing.place, standing.points])).toEqual([
      ["Driver 2", 1, 25],
      ["Driver 1", 2, 18],
      ["Driver 3", 3, 15],
    ]);
  });

  it("provides public live snapshots and broadcasts every racer's state", () => {
    const timers: Array<() => void> = [];
    const l = new Lobby({ setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
    const a = client();
    const b = client();
    const watcher = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    l.handle(watcher.conn, { t: "watch" });
    expect(watcher.last("watchSnapshot")).toMatchObject({ t: "watchSnapshot", rooms: [] });
    l.handle(a.conn, { t: "quick", trackId: "t|day|clear" });
    l.handle(b.conn, { t: "quick", trackId: "t|day|clear" });
    l.handle(a.conn, { t: "state", s: state(0.5) });
    expect(b.last("opp")).toMatchObject({ id: "aaaa1111", s: { progress: 0.5 } });
    timers.forEach((flush) => flush());
    const snapshot = watcher.last("watchSnapshot");
    if (snapshot?.t !== "watchSnapshot") throw new Error("no live snapshot");
    expect(snapshot.rooms[0]!.racers[0]!.state?.progress).toBe(0.5);
  });
});

describe("lobby: racing", () => {
  it("relays positions only to the opponent, and only once the race has started", () => {
    const l = new Lobby();
    const a = client();
    const b = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    l.handle(a.conn, { t: "invite", to: "bbbb2222", trackId: "t" });
    l.handle(b.conn, { t: "inviteReply", from: "aaaa1111", accept: true });
    l.handle(a.conn, { t: "state", s: state() });
    expect(b.last("opp")).toBeUndefined();
    l.handle(a.conn, { t: "ready" });
    l.handle(b.conn, { t: "ready" });
    l.handle(a.conn, { t: "state", s: state(0.5) });
    expect(b.last("opp")).toMatchObject({ s: { progress: 0.5 } });
    expect(a.last("opp")).toBeUndefined();
  });

  it("ranks by finishing time and awards 25 / 18 points", () => {
    const { l, a, b } = matched();
    l.handle(b.conn, { t: "finish", totalMs: 150_000 });
    expect(a.last("oppFinished")).toMatchObject({ name: "Ben", totalMs: 150_000 });
    l.handle(a.conn, { t: "finish", totalMs: 152_500 });
    const r = a.last("result");
    expect(r).toMatchObject({ forfeit: false });
    if (r?.t !== "result") throw new Error("no result");
    expect(r.standings.map((s) => [s.name, s.place, s.points])).toEqual([["Ben", 1, 25], ["Ann", 2, 18]]);
    expect(b.last("result")).toBeTruthy();
  });

  it("gives the second driver a DNF if they don't finish in time", () => {
    const timers: Array<() => void> = [];
    const l = new Lobby({ setTimer: (fn) => timers.push(fn), clearTimer: () => {} });
    const a = client();
    const b = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    l.handle(a.conn, { t: "quick", trackId: "t" });
    l.handle(b.conn, { t: "quick", trackId: "t" });
    l.handle(a.conn, { t: "ready" });
    l.handle(b.conn, { t: "ready" });
    l.handle(a.conn, { t: "finish", totalMs: 100_000 });
    expect(b.last("result")).toBeUndefined();
    timers[0]!();
    const r = b.last("result");
    if (r?.t !== "result") throw new Error("no result");
    expect(r.standings[0]).toMatchObject({ name: "Ann", points: 25 });
    expect(r.standings[1]).toMatchObject({ name: "Ben", totalMs: null, points: 0 });
  });

  it("awards the win to the driver who stays when the other disconnects mid-race", () => {
    const { l, a, b } = matched();
    l.disconnect(b.conn);
    expect(a.last("oppLeft")).toMatchObject({ name: "Ben" });
    const r = a.last("result");
    if (r?.t !== "result") throw new Error("no result");
    expect(r.forfeit).toBe(true);
    expect(r.standings[0]).toMatchObject({ name: "Ann", place: 1, points: 25 });
    expect(r.standings[1]).toMatchObject({ name: "Ben", points: 0 });
  });

  it("frees both players for another race afterwards", () => {
    const { l, a, b } = matched();
    l.handle(a.conn, { t: "finish", totalMs: 100_000 });
    l.handle(b.conn, { t: "finish", totalMs: 101_000 });
    l.handle(a.conn, { t: "quick", trackId: "t" });
    l.handle(b.conn, { t: "quick", trackId: "t" });
    expect(a.got.filter((m) => m.t === "roomJoined").length).toBe(1);
  });
});

describe("lobby: ranking board", () => {
  it("keeps each driver's best lap and returns the fastest first", () => {
    const l = new Lobby();
    const a = client();
    const b = client();
    hello(l, a, "aaaa1111", "Ann");
    hello(l, b, "bbbb2222", "Ben");
    l.handle(a.conn, { t: "submitLap", trackId: "t", ms: 50_000 });
    l.handle(a.conn, { t: "submitLap", trackId: "t", ms: 55_000 });
    l.handle(b.conn, { t: "submitLap", trackId: "t", ms: 49_000 });
    l.handle(a.conn, { t: "board", trackId: "t" });
    const r = a.last("board");
    if (r?.t !== "board") throw new Error("no board");
    expect(r.entries.map((e) => [e.name, e.bestMs])).toEqual([["Ben", 49_000], ["Ann", 50_000]]);
  });
});

describe("protocol validation", () => {
  it("accepts good messages and rejects junk", () => {
    expect(parseClientMessage(JSON.stringify({ t: "hello", id: "abcd1234", name: "  Cat <b> " }))).toEqual({ t: "hello", id: "abcd1234", name: "Cat b" });
    expect(parseClientMessage("nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "hello", id: "x", name: "A" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "finish", totalMs: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "submitLap", trackId: "t", ms: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "state", s: { x: "1" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "bogus" }))).toBeNull();
    expect(parseClientMessage("x".repeat(5000))).toBeNull();
  });
});
