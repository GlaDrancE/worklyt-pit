import { POINTS_BY_PLACE, type BoardEntry, type ClientMsg, type LiveRoom, type PlayerInfo, type PlayerState, type ServerMsg, type Standing } from "../src/net/protocol";

/** One connected socket (or a test double). */
export interface Conn {
  send(msg: ServerMsg): void;
}

export interface BoardStore {
  submit(trackId: string, id: string, name: string, ms: number): void;
  top(trackId: string, n: number): BoardEntry[];
}

/** Limits so that strangers sending made-up track or driver ids cannot make the board grow without end. */
export const MAX_TRACKS = 300;
export const MAX_PER_TRACK = 5000;
export const MAX_ROOM_PLAYERS = 32;

/** Best lap per driver per track, held in memory. `onChange` lets the server persist it. */
export class MemoryBoard implements BoardStore {
  private readonly data = new Map<string, Map<string, BoardEntry>>();
  onChange: (() => void) | null = null;

  submit(trackId: string, id: string, name: string, ms: number): void {
    let t = this.data.get(trackId);
    if (!t) {
      if (this.data.size >= MAX_TRACKS) return; // arbitrary track ids from strangers must not grow memory forever
      this.data.set(trackId, (t = new Map()));
    }
    const cur = t.get(id);
    if (!cur && t.size >= MAX_PER_TRACK) return;
    if (!cur || ms < cur.bestMs) {
      t.set(id, { id, name, bestMs: ms });
      this.onChange?.();
    } else if (cur.name !== name) {
      cur.name = name;
    }
  }

  top(trackId: string, n: number): BoardEntry[] {
    return [...(this.data.get(trackId)?.values() ?? [])].sort((a, b) => a.bestMs - b.bestMs).slice(0, n);
  }

  toJSON(): Record<string, BoardEntry[]> {
    const out: Record<string, BoardEntry[]> = {};
    for (const [k, v] of this.data) out[k] = [...v.values()];
    return out;
  }

  load(json: unknown): void {
    if (!json || typeof json !== "object") return;
    for (const [track, list] of Object.entries(json as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const e of list as BoardEntry[]) {
        if (e && typeof e.id === "string" && typeof e.name === "string" && typeof e.bestMs === "number") {
          this.submit(track, e.id, e.name, e.bestMs);
        }
      }
    }
  }
}

/** What an opponent is allowed to see about a driver. */
const info = (p: PlayerInfo): PlayerInfo => ({ id: p.id, name: p.name, ...(p.colour ? { colour: p.colour } : {}) });

interface Player extends PlayerInfo {
  conn: Conn;
  roomId: string | null;
  queuedTrack: string | null;
  state: PlayerState | null;
  totalMs: number | null;
}

interface Room {
  id: string;
  trackId: string;
  kind: "invite" | "open";
  players: Player[];
  ready: Set<string>;
  started: boolean;
  finished: Map<string, number>;
  done: boolean;
  startedAt: number;
  timer: unknown;
}

export interface LobbyOptions {
  board?: BoardStore;
  /** Time the slower driver gets to finish once the other has crossed the line. */
  dnfTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  rules?: LobbyRules;
  maxPlayers?: number;
}

/**
 * Matchmaking and race relay. No sockets in here, so the whole thing can be
 * tested with plain objects. The relay never simulates the race: each game
 * client drives its own car and the server only forwards positions and works
 * out the finishing order from the times the clients report.
 */
/** Optional rules the host can switch on. Tests and local play run without them. */
export interface LobbyRules {
  /** May this device be this driver ID? */
  authorize?(id: string, token: string | undefined): boolean;
  lapPlausible?(trackKey: string, ms: number): boolean;
  raceTimePlausible?(trackKey: string, totalMs: number): boolean;
}

export class Lobby {
  private readonly players = new Map<Conn, Player>();
  private readonly watchers = new Set<Conn>();
  private readonly byId = new Map<string, Player>();
  private readonly queue: Player[] = [];
  private readonly invites = new Map<string, { from: string; trackId: string }>(); // keyed by target id
  private readonly rooms = new Map<string, Room>();
  private nextRoom = 1;
  readonly board: BoardStore;
  private readonly dnfTimeoutMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly rules: LobbyRules;
  private readonly maxPlayers: number;
  private watchTimer: unknown = null;

  constructor(opts: LobbyOptions = {}) {
    this.board = opts.board ?? new MemoryBoard();
    this.dnfTimeoutMs = opts.dnfTimeoutMs ?? 90_000;
    this.rules = opts.rules ?? {};
    this.maxPlayers = Math.min(MAX_ROOM_PLAYERS, Math.max(2, Math.floor(opts.maxPlayers ?? MAX_ROOM_PLAYERS)));
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get online(): number {
    return this.players.size;
  }

  handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === "watch") {
      this.watchers.add(conn);
      conn.send({ t: "watchSnapshot", rooms: this.liveRooms() });
      return;
    }
    if (msg.t === "hello") {
      if (this.rules.authorize && !this.rules.authorize(msg.id, msg.token)) {
        return conn.send({ t: "error", msg: "This driver ID belongs to another device. Use the device you first played on, or update your game." });
      }
      return this.hello(conn, msg.id, msg.name, msg.colour);
    }
    const p = this.players.get(conn);
    if (!p) return conn.send({ t: "error", msg: "Say hello first." });

    switch (msg.t) {
      case "colour":
        p.colour = msg.colour;
        return;
      case "invite":
        return this.invite(p, msg.to, msg.trackId);
      case "inviteReply":
        return this.inviteReply(p, msg.from, msg.accept);
      case "quick":
        return this.quick(p, msg.trackId);
      case "leave":
        this.dequeue(p);
        return this.leaveRoom(p);
      case "ready":
        return this.ready(p);
      case "state": {
        const room = this.roomOf(p);
        if (room?.started && !room.done) {
          p.state = msg.s;
          for (const other of room.players) {
            if (other !== p) other.conn.send({ t: "opp", id: p.id, s: msg.s });
          }
          if (room.kind === "open") this.scheduleWatchSnapshot();
        }
        return;
      }
      case "finish":
        return this.finish(p, msg.totalMs);
      case "submitLap":
        if (this.rules.lapPlausible && !this.rules.lapPlausible(msg.trackId, msg.ms)) return; // faster than physics allows: ignored
        this.board.submit(msg.trackId, p.id, p.name, msg.ms);
        return;
      case "board":
        p.conn.send({ t: "board", trackId: msg.trackId, entries: this.board.top(msg.trackId, 10) });
        return;
    }
  }

  disconnect(conn: Conn): void {
    this.watchers.delete(conn);
    const p = this.players.get(conn);
    if (!p) return;
    this.dequeue(p);
    this.leaveRoom(p);
    for (const [target, inv] of this.invites) {
      if (target === p.id || inv.from === p.id) this.invites.delete(target);
    }
    this.players.delete(conn);
    this.byId.delete(p.id);
  }

  // ---------------------------------------------------------------- steps

  private hello(conn: Conn, id: string, name: string, colour?: string): void {
    const existing = this.byId.get(id);
    if (existing && existing.conn !== conn) {
      conn.send({ t: "error", msg: "That driver ID is already online in another window." });
      return;
    }
    if (!this.players.has(conn)) {
      const p: Player = { id, name, conn, roomId: null, queuedTrack: null, state: null, totalMs: null, ...(colour ? { colour } : {}) };
      this.players.set(conn, p);
      this.byId.set(id, p);
    } else {
      const q = this.players.get(conn)!;
      q.name = name;
      if (colour) q.colour = colour;
    }
    conn.send({ t: "welcome", online: this.online });
  }

  private invite(p: Player, toId: string, trackId: string): void {
    if (toId === p.id) return p.conn.send({ t: "error", msg: "That's your own ID." });
    const target = this.byId.get(toId);
    if (!target) return p.conn.send({ t: "error", msg: "That driver isn't online right now." });
    if (target.roomId || p.roomId) return p.conn.send({ t: "error", msg: "One of you is already in a race." });
    this.dequeue(p);
    this.invites.set(toId, { from: p.id, trackId });
    target.conn.send({ t: "invited", from: info(p), trackId });
  }

  private inviteReply(p: Player, fromId: string, accept: boolean): void {
    const inv = this.invites.get(p.id);
    if (!inv || inv.from !== fromId) return;
    this.invites.delete(p.id);
    const inviter = this.byId.get(fromId);
    if (!inviter) return p.conn.send({ t: "error", msg: "The driver who invited you has gone." });
    if (!accept) return inviter.conn.send({ t: "inviteDeclined", by: p.name });
    if (inviter.roomId || p.roomId) return p.conn.send({ t: "error", msg: "One of you is already in a race." });
    this.dequeue(inviter);
    this.dequeue(p);
    this.makeRoom(inviter, p, inv.trackId);
  }

  private quick(p: Player, trackId: string): void {
    if (p.roomId) return p.conn.send({ t: "error", msg: "You're already in a race." });
    this.dequeue(p);
    const room = [...this.rooms.values()].find((r) => r.kind === "open" && !r.done && r.trackId === trackId);
    if (room) {
      if (room.players.length >= this.maxPlayers) return p.conn.send({ t: "error", msg: `This race is full (${this.maxPlayers} drivers).` });
      room.players.push(p);
      p.roomId = room.id;
      p.state = null;
      p.totalMs = null;
      p.conn.send({ t: "roomJoined", room: this.liveRoom(room), selfId: p.id });
      for (const other of room.players) {
        if (other !== p) other.conn.send({ t: "playerJoined", roomId: room.id, player: info(p) });
      }
      this.scheduleWatchSnapshot();
      return;
    }
    const created: Room = {
      id: `r${this.nextRoom++}`,
      trackId,
      kind: "open",
      players: [p],
      ready: new Set(),
      started: true,
      finished: new Map(),
      done: false,
      startedAt: Date.now(),
      timer: null,
    };
    p.roomId = created.id;
    p.state = null;
    p.totalMs = null;
    this.rooms.set(created.id, created);
    p.conn.send({ t: "roomJoined", room: this.liveRoom(created), selfId: p.id });
    this.scheduleWatchSnapshot();
  }

  private makeRoom(a: Player, b: Player, trackId: string): void {
    const room: Room = {
      id: `r${this.nextRoom++}`,
      trackId,
      kind: "invite",
      players: [a, b],
      ready: new Set(),
      started: false,
      finished: new Map(),
      done: false,
      startedAt: Date.now(),
      timer: null,
    };
    this.rooms.set(room.id, room);
    a.roomId = b.roomId = room.id;
    a.conn.send({ t: "match", room: room.id, trackId, slot: 0, opponent: info(b) });
    b.conn.send({ t: "match", room: room.id, trackId, slot: 1, opponent: info(a) });
  }

  private ready(p: Player): void {
    const room = this.roomOf(p);
    if (!room || room.started || room.done) return;
    room.ready.add(p.id);
    if (room.ready.size === 2) {
      room.started = true;
      for (const q of room.players) q.conn.send({ t: "start" });
    }
  }

  private finish(p: Player, totalMs: number): void {
    const room = this.roomOf(p);
    if (!room || !room.started || room.done || room.finished.has(p.id)) return;
    if (this.rules.raceTimePlausible && !this.rules.raceTimePlausible(room.trackId, totalMs)) {
      return p.conn.send({ t: "error", msg: "That race time isn't possible on this circuit, so it wasn't counted." });
    }
    room.finished.set(p.id, totalMs);
    p.totalMs = totalMs;
    if (room.kind === "open") {
      for (const other of room.players) {
        if (other !== p) other.conn.send({ t: "playerFinished", roomId: room.id, id: p.id, name: p.name, totalMs });
      }
      this.scheduleWatchSnapshot();
    } else {
      this.other(room, p).conn.send({ t: "oppFinished", name: p.name, totalMs });
    }
    if (room.finished.size === room.players.length) return this.sendResult(room, false);
    if (!room.timer) room.timer = this.setTimer(() => this.sendResult(room, false), this.dnfTimeoutMs);
  }

  private leaveRoom(p: Player): void {
    const room = this.roomOf(p);
    if (!room) return;
    if (room.kind === "open") {
      room.players = room.players.filter((player) => player !== p);
      p.roomId = null;
      p.state = null;
      for (const other of room.players) other.conn.send({ t: "playerLeft", roomId: room.id, id: p.id, name: p.name });
      if (room.players.length === 0) this.closeRoom(room);
      else if (room.finished.size >= room.players.length) this.sendResult(room, false);
      this.scheduleWatchSnapshot();
      return;
    }
    const other = this.other(room, p);
    p.roomId = null;
    if (room.done) return;
    if (room.started) {
      other.conn.send({ t: "oppLeft", name: p.name });
      room.finished.delete(p.id);
      this.sendResult(room, true, other);
    } else {
      other.conn.send({ t: "oppLeft", name: p.name });
      this.closeRoom(room);
    }
  }

  private sendResult(room: Room, forfeit: boolean, winner?: Player): void {
    if (room.done) return;
    room.done = true;
    if (room.timer) this.clearTimer(room.timer);
    const entries = room.players.map((pl) => ({ pl, ms: room.finished.get(pl.id) ?? null }));
    entries.sort((x, y) => {
      if (winner) return (x.pl === winner ? -1 : 0) - (y.pl === winner ? -1 : 0);
      if (x.ms === null && y.ms === null) return 0;
      if (x.ms === null) return 1;
      if (y.ms === null) return -1;
      return x.ms - y.ms;
    });
    const standings: Standing[] = entries.map((e, i) => ({
      id: e.pl.id,
      name: e.pl.name,
      totalMs: e.ms,
      place: i + 1,
      // Only a driver who finished (or won by forfeit) scores.
      points: e.ms !== null || (winner && e.pl === winner) ? (POINTS_BY_PLACE[i] ?? 0) : 0,
    }));
    for (const e of entries) e.pl.conn.send({ t: "result", standings, forfeit });
    this.closeRoom(room);
  }

  private closeRoom(room: Room): void {
    if (room.timer) this.clearTimer(room.timer);
    room.timer = null;
    for (const pl of room.players) if (pl.roomId === room.id) pl.roomId = null;
    this.rooms.delete(room.id);
    this.scheduleWatchSnapshot();
  }

  // -------------------------------------------------------------- helpers

  private roomOf(p: Player): Room | undefined {
    return p.roomId ? this.rooms.get(p.roomId) : undefined;
  }

  private other(room: Room, p: Player): Player {
    return room.players.find((player) => player !== p)!;
  }

  private liveRoom(room: Room): LiveRoom {
    return {
      id: room.id,
      trackId: room.trackId,
      startedAt: room.startedAt,
      maxPlayers: this.maxPlayers,
      racers: room.players.map((p) => ({
        ...info(p),
        state: p.state,
        totalMs: p.totalMs,
      })),
    };
  }

  private liveRooms(): LiveRoom[] {
    return [...this.rooms.values()].filter((room) => room.kind === "open" && !room.done).map((room) => this.liveRoom(room));
  }

  private scheduleWatchSnapshot(): void {
    if (this.watchers.size === 0 || this.watchTimer !== null) return;
    this.watchTimer = this.setTimer(() => {
      this.watchTimer = null;
      const message: ServerMsg = { t: "watchSnapshot", rooms: this.liveRooms() };
      for (const watcher of this.watchers) watcher.send(message);
    }, 100);
  }

  private dequeue(p: Player): void {
    const i = this.queue.indexOf(p);
    if (i >= 0) this.queue.splice(i, 1);
    p.queuedTrack = null;
  }
}
