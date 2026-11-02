import { NetClient } from "./NetClient";
import { isSafeAddress, playerToken } from "./playerSync";
import type { BoardEntry, PlayerInfo, PlayerState, ServerMsg, Standing } from "./protocol";

export type MpPhase = "offline" | "connecting" | "online" | "queued" | "matched" | "racing";

export interface MatchInfo {
  room: string;
  trackId: string;
  slot: 0 | 1;
  opponent: PlayerInfo;
}

export interface MpEvents {
  status?: (text: string) => void;
  phase?: (p: MpPhase) => void;
  invite?: (from: PlayerInfo | null, trackId: string) => void;
  match?: (m: MatchInfo) => void;
  start?: (m: MatchInfo) => void;
  opponent?: (s: PlayerState) => void;
  oppFinished?: (name: string, totalMs: number) => void;
  oppLeft?: (name: string) => void;
  result?: (standings: Standing[], forfeit: boolean) => void;
  board?: (trackId: string, entries: BoardEntry[]) => void;
}

/** Client-side state machine for 1v1 matches: invites by ID, quick match and race sync. */
export class Multiplayer {
  phase: MpPhase = "offline";
  match: MatchInfo | null = null;
  readonly board = new Map<string, BoardEntry[]>();
  events: MpEvents = {};
  private readonly net = new NetClient();
  private readyTimer = 0;
  private pendingInvite: PlayerInfo | null = null;

  constructor(private readonly me: PlayerInfo) {
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onClose = (why) => {
      this.match = null;
      this.pendingInvite = null;
      this.setPhase("offline");
      this.events.status?.(why);
    };
  }

  get connected(): boolean {
    return this.phase !== "offline" && this.phase !== "connecting";
  }

  /** Pick the paint scheme the opponent will see. Takes effect for the next match. */
  setColour(colour: string): void {
    this.me.colour = colour;
    this.net.send({ t: "colour", colour });
  }

  updateName(name: string): void {
    this.me.name = name;
  }

  async connect(url: string): Promise<void> {
    if (!isSafeAddress(url)) {
      this.setPhase("offline");
      this.events.status?.("Use a secure address (wss://) for a server on the internet. Plain ws:// works only on this computer or your home network.");
      return;
    }
    this.setPhase("connecting");
    this.events.status?.("Connecting…");
    try {
      await this.net.connect(url);
    } catch (e) {
      this.setPhase("offline");
      this.events.status?.(e instanceof Error ? e.message : "Couldn't connect.");
      return;
    }
    this.net.send({ t: "hello", id: this.me.id, name: this.me.name, token: playerToken(), ...(this.me.colour ? { colour: this.me.colour } : {}) });
  }

  disconnect(): void {
    window.clearTimeout(this.readyTimer);
    this.net.close();
    this.match = null;
    this.setPhase("offline");
    this.events.status?.("Disconnected.");
  }

  invite(toId: string, trackId: string): void {
    this.net.send({ t: "invite", to: toId.trim(), trackId });
    this.events.status?.(`Invite sent to ${toId.trim()}. Waiting for them to accept…`);
  }

  respond(accept: boolean): void {
    const from = this.pendingInvite;
    if (!from) return;
    this.pendingInvite = null;
    this.events.invite?.(null, "");
    this.net.send({ t: "inviteReply", from: from.id, accept });
    if (!accept) this.events.status?.("Invite declined.");
  }

  quick(trackId: string): void {
    this.net.send({ t: "quick", trackId });
  }

  /** Leave the queue or the current match. */
  leave(): void {
    window.clearTimeout(this.readyTimer);
    if (!this.connected) return;
    this.net.send({ t: "leave" });
    this.match = null;
    this.setPhase("online");
  }

  sendState(s: PlayerState): void {
    if (this.phase === "racing") this.net.send({ t: "state", s });
  }

  sendFinish(totalMs: number): void {
    if (this.phase === "racing") this.net.send({ t: "finish", totalMs });
  }

  submitLap(trackId: string, ms: number): void {
    if (this.connected) this.net.send({ t: "submitLap", trackId, ms });
  }

  requestBoard(trackId: string): void {
    if (this.connected) this.net.send({ t: "board", trackId });
  }

  private setPhase(p: MpPhase): void {
    this.phase = p;
    this.events.phase?.(p);
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.setPhase("online");
        this.events.status?.(`Connected. ${m.online} driver${m.online === 1 ? "" : "s"} online.`);
        break;
      case "error":
        this.events.status?.(m.msg);
        if (this.phase === "connecting") this.setPhase("offline");
        break;
      case "invited":
        this.pendingInvite = m.from;
        this.events.invite?.(m.from, m.trackId);
        break;
      case "inviteDeclined":
        this.events.status?.(`${m.by} declined your invite.`);
        break;
      case "queued":
        this.setPhase("queued");
        this.events.status?.("Looking for an opponent… you'll be matched as soon as someone else searches.");
        break;
      case "match": {
        this.match = { room: m.room, trackId: m.trackId, slot: m.slot, opponent: m.opponent };
        this.setPhase("matched");
        this.events.match?.(this.match);
        // Give the screen a moment to update, then tell the server we're ready.
        window.clearTimeout(this.readyTimer);
        this.readyTimer = window.setTimeout(() => this.net.send({ t: "ready" }), 1500);
        break;
      }
      case "start":
        if (this.match) {
          this.setPhase("racing");
          this.events.start?.(this.match);
        }
        break;
      case "opp":
        this.events.opponent?.(m.s);
        break;
      case "oppFinished":
        this.events.oppFinished?.(m.name, m.totalMs);
        break;
      case "oppLeft":
        this.events.oppLeft?.(m.name);
        break;
      case "result":
        this.match = null;
        this.setPhase("online");
        this.events.result?.(m.standings, m.forfeit);
        break;
      case "board":
        this.board.set(m.trackId, m.entries);
        this.events.board?.(m.trackId, m.entries);
        break;
    }
  }
}
