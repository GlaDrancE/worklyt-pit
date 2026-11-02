import type { ClientMsg, ServerMsg } from "./protocol";

/** Thin WebSocket wrapper that speaks the relay protocol. */
export class NetClient {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string, timeoutMs = 6000): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error("That server address doesn't look right. It should start with ws:// or wss://"));
        return;
      }
      this.ws = ws;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error("The server didn't answer. Is it running, and is the address right?"));
      }, timeoutMs);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error("Couldn't reach the server. Check that it is running and the address is right."));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data)) as ServerMsg;
          if (m && typeof m.t === "string") this.onMessage(m);
        } catch {
          /* ignore garbage */
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        window.clearTimeout(timer);
        if (settled) this.onClose("The connection to the server closed.");
      };
    });
  }

  send(m: ClientMsg): void {
    if (this.isOpen) this.ws!.send(JSON.stringify(m));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
