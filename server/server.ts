import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientMessage, type ServerMsg } from "../src/net/protocol";
import { Lobby, MemoryBoard, type Conn } from "./lobby";
import { PlayerStore } from "./players";
import { RateLimiter } from "./rateLimit";
import { lapPlausible, raceTimePlausible } from "./plausibility";

export interface RunningServer {
  port: number;
  lobby: Lobby;
  close(): Promise<void>;
}

const MAX_MSGS_PER_SECOND = 120;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** Starts the relay. Pass port 0 to let the OS pick one (used by tests). */
export async function startServer(port = 8787, opts: { dataFile?: string; playersFile?: string; staticDir?: string; dnfTimeoutMs?: number; strict?: boolean } = {}): Promise<RunningServer> {
  const staticDir = opts.staticDir ? resolve(opts.staticDir) : undefined;
  if (staticDir && (!existsSync(staticDir) || !statSync(staticDir).isDirectory())) {
    throw new Error(`Static directory does not exist: ${staticDir}`);
  }

  const board = new MemoryBoard();
  if (opts.dataFile && existsSync(opts.dataFile)) {
    try {
      board.load(JSON.parse(readFileSync(opts.dataFile, "utf8")));
    } catch {
      console.warn("Couldn't read the saved leaderboard; starting empty.");
    }
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.dataFile) {
    const file = opts.dataFile;
    board.onChange = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(board));
        } catch (e) {
          console.warn("Couldn't save the leaderboard:", e);
        }
      }, 2000);
    };
  }

  const players = new PlayerStore();
  if (opts.playersFile && existsSync(opts.playersFile)) {
    try {
      players.load(JSON.parse(readFileSync(opts.playersFile, "utf8")));
    } catch {
      console.warn("Couldn't read the saved player data; starting empty.");
    }
  }
  if (opts.playersFile) {
    const file = opts.playersFile;
    let timer: ReturnType<typeof setTimeout> | null = null;
    players.onChange = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(players));
        } catch (e) {
          console.warn("Couldn't save player data:", e);
        }
      }, 2000);
    };
  }

  const limiter = new RateLimiter(60, 60_000);
  // Strict mode (the default for a real relay): device keys and possible-time checks. Tests can switch it off.
  const strict = opts.strict ?? true;
  const lobby = new Lobby({
    board,
    dnfTimeoutMs: opts.dnfTimeoutMs,
    ...(strict ? { rules: { authorize: (id: string, token: string | undefined) => players.authorize(id, token), lapPlausible, raceTimePlausible } } : {}),
  });
  const http: Server = createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-player-token", "access-control-allow-methods": "GET, PUT, OPTIONS" };
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
    const m = /^\/player\/([A-Za-z0-9]{4,16})$/.exec(url.pathname);
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
    if (m) {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
      if (!limiter.allow(forwarded || req.socket.remoteAddress || "?")) return void res.writeHead(429, { ...cors, "content-type": "application/json" }).end('{"error":"slow down"}');
      const id = m[1]!;
      const token = String(req.headers["x-player-token"] ?? "");
      const json = (code: number, body: unknown) => res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "GET") {
        const got = players.get(id, token);
        return got === "forbidden" ? json(403, { error: "forbidden" }) : json(200, got ?? { name: "", records: [] });
      }
      if (req.method === "PUT") {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c;
          if (body.length > 400_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const v = JSON.parse(body) as { name?: string; records?: unknown[] };
            const r = players.save(id, token, String(v.name ?? ""), Array.isArray(v.records) ? v.records : []);
            json(r === "saved" ? 200 : r === "forbidden" ? 403 : 400, { result: r });
          } catch {
            json(400, { result: "invalid" });
          }
        });
        return;
      }
    }
    if (staticDir && (req.method === "GET" || req.method === "HEAD")) {
      let filePath: string;
      try {
        filePath = resolve(staticDir, `.${decodeURIComponent(url.pathname)}`);
      } catch {
        return void res.writeHead(400).end();
      }
      const relativePath = relative(staticDir, filePath);
      if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        return void res.writeHead(403).end();
      }
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, "index.html");
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
      if (req.method === "HEAD") return void res.end();
      const stream = createReadStream(filePath);
      stream.on("error", (e) => {
        console.error("Couldn't serve a static file:", e);
        if (res.headersSent) res.destroy(e);
        else res.writeHead(500).end();
      });
      return void stream.pipe(res);
    }
    if (staticDir) return void res.writeHead(404).end();
    res.writeHead(200, { ...cors, "content-type": "text/plain" });
    res.end(`TrackRush relay is running. ${lobby.online} driver(s) online, ${players.count} player(s) saved.\n`);
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

  wss.on("connection", (ws: WebSocket) => {
    const conn: Conn = {
      send: (m: ServerMsg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
    };
    let alive = true;
    let windowStart = Date.now();
    let count = 0;
    ws.on("pong", () => (alive = true));
    ws.on("message", (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_MSGS_PER_SECOND) return void ws.close(1008, "Too many messages");
      const msg = parseClientMessage(data.toString());
      if (msg) lobby.handle(conn, msg);
    });
    ws.on("close", () => lobby.disconnect(conn));
    ws.on("error", () => ws.terminate());
    const beat = setInterval(() => {
      if (!alive) return void ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on("close", () => clearInterval(beat));
  });

  await new Promise<void>((res) => http.listen(port, res));
  const actual = (http.address() as { port: number }).port;
  return {
    port: actual,
    lobby,
    close: () =>
      new Promise<void>((res) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => res()));
      }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  startServer(port, { dataFile: process.env.BOARD_FILE ?? resolve("server/data/board.json"), playersFile: process.env.PLAYERS_FILE ?? resolve("server/data/players.json"), staticDir: process.env.STATIC_DIR }).then((s) => {
    console.log(`TrackRush relay listening on port ${s.port}`);
    console.log(`In the game, connect to ws://localhost:${s.port} (or ws://<this PC's IP>:${s.port} from another device).`);
  });
}
