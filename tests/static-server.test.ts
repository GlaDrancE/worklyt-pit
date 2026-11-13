import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../server/server";

let server: RunningServer;
const staticDir = mkdtempSync(join(tmpdir(), "trackrush-static-"));

beforeAll(async () => {
  writeFileSync(join(staticDir, "index.html"), "<h1>TrackRush</h1>");
  writeFileSync(join(staticDir, "admin.html"), "<h1>Spectator</h1>");
  server = await startServer(0, { staticDir });
});

afterAll(async () => {
  await server.close();
  rmSync(staticDir, { recursive: true, force: true });
});

describe("static app hosting", () => {
  it("serves the game and spectator pages", async () => {
    const game = await fetch(`http://127.0.0.1:${server.port}/`);
    const spectator = await fetch(`http://127.0.0.1:${server.port}/admin.html`);

    expect(game.status).toBe(200);
    expect(game.headers.get("content-type")).toContain("text/html");
    expect(await game.text()).toContain("TrackRush");
    expect(await spectator.text()).toContain("Spectator");
  });

  it("returns not found for missing assets", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/missing.js`);
    expect(response.status).toBe(404);
  });

  it("provides a health endpoint", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok\n");
  });
});
