import { describe, expect, it } from "vitest";
import { Lobby, type Conn } from "../server/lobby";
import { parseClientMessage, type ServerMsg } from "../src/net/protocol";
import { CAR_COLOURS, colourName, opponentLivery } from "../src/race/unlocks";
import { RIVAL_BOX_OFFSET_M, insideBox, pitBoxFor, rivalPitBoxFor } from "../src/race/pit";
import { TrackModel } from "../src/track/TrackModel";
import { TRACKS } from "../src/track/tracks";
import { GHOST_FADE_FAR, GHOST_FADE_NEAR, ghostVisibility } from "../src/game/ghostFade";

describe("best-lap ghost fade", () => {
  it("is invisible in the pits and right on top of the player", () => {
    expect(ghostVisibility(100, true)).toBe(0);
    expect(ghostVisibility(0, false)).toBe(0);
    expect(ghostVisibility(GHOST_FADE_NEAR, false)).toBe(0);
  });
  it("eases in with distance and is fully there when far", () => {
    const mid = ghostVisibility((GHOST_FADE_NEAR + GHOST_FADE_FAR) / 2, false);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(ghostVisibility(GHOST_FADE_FAR + 50, false)).toBe(1);
  });
});

describe.each(TRACKS.map((d) => [d.id, d] as const))("rival pit box on %s", (_id, def) => {
  const m = new TrackModel(def);
  const mine = pitBoxFor(m);
  const theirs = rivalPitBoxFor(m);
  it("is a separate box that never overlaps yours and stays on the tarmac", () => {
    expect(Math.hypot(mine.x - theirs.x, mine.z - theirs.z)).toBeGreaterThan(mine.halfLength * 2);
    expect(insideBox(mine, theirs.x, theirs.z)).toBe(false);
    expect(insideBox(theirs, mine.x, mine.z)).toBe(false);
    const n = m.nearest(theirs.x, theirs.z);
    expect(Math.abs(n.lateral) + theirs.halfWidth).toBeLessThanOrEqual(m.halfWidth);
    expect(RIVAL_BOX_OFFSET_M).toBeGreaterThan(mine.halfLength * 2);
  });
});

describe("opponent car colour", () => {
  const red = CAR_COLOURS[0]!.livery;
  it("uses the opponent's pick when it differs from yours", () => {
    expect(opponentLivery("papaya", red).body).toBe(CAR_COLOURS.find((c) => c.id === "papaya")!.livery.body);
  });
  it("shows a clearly different colour when both picked the same, or the pick is unknown", () => {
    expect(opponentLivery("signal-red", red).body).not.toBe(red.body);
    expect(opponentLivery(undefined, red).body).not.toBe(red.body);
    expect(opponentLivery("bogus", red).body).not.toBe(red.body);
  });
  it("never returns your own colour for any combination", () => {
    for (const mine of CAR_COLOURS) for (const t of [...CAR_COLOURS.map((c) => c.id), undefined]) expect(opponentLivery(t, mine.livery).body).not.toBe(mine.livery.body);
  });
  it("names known colours only", () => {
    expect(colourName("midnight")).toBe("Midnight blue");
    expect(colourName("nope")).toBeNull();
  });
});

describe("colour over the relay", () => {
  const client = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { send: (m) => void got.push(m) };
    return { conn, got };
  };
  it("validates colour ids", () => {
    expect(parseClientMessage('{"t":"colour","colour":"papaya"}')).toEqual({ t: "colour", colour: "papaya" });
    expect(parseClientMessage('{"t":"colour","colour":"<script>"}')).toBeNull();
    expect(parseClientMessage('{"t":"hello","id":"aaaa1111","name":"Ann","colour":"bad colour!"}')).toEqual({ t: "hello", id: "aaaa1111", name: "Ann" });
  });
  it("tells each driver which colour the other chose", () => {
    const l = new Lobby({ setTimer: () => 1, clearTimer: () => {} });
    const a = client();
    const b = client();
    l.handle(a.conn, { t: "hello", id: "aaaa1111", name: "Ann", colour: "papaya" });
    l.handle(b.conn, { t: "hello", id: "bbbb2222", name: "Ben" });
    l.handle(b.conn, { t: "colour", colour: "forest" });
    l.handle(a.conn, { t: "quick", trackId: "apex-park" });
    l.handle(b.conn, { t: "quick", trackId: "apex-park" });
    const ma = a.got.find((m) => m.t === "match");
    const mb = b.got.find((m) => m.t === "match");
    expect(ma && ma.t === "match" && ma.opponent.colour).toBe("forest");
    expect(mb && mb.t === "match" && mb.opponent.colour).toBe("papaya");
  });
});
