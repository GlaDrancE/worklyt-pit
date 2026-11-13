# Online multiplayer

Players on the same circuit and conditions join a shared live race room. Each sees the other drivers as coloured cars (cars don't collide). The relay passes car positions to everyone in the room and supports up to 32 connected racers per room.

## Running a race

1. Start a relay (below). For local play, it listens on port 8787.
2. Set `VITE_RELAY_URL` to the relay's `wss://` address before building the web app. Locally served games use `ws://<page-host>:8787` automatically.
3. Open the same game link in each browser. The game connects automatically and joins the active room for the same circuit and conditions. Late arrivals join the race in progress. A room accepts up to 32 drivers; the relay rejects further joins while it is full.
4. Each driver sees all connected racers and the in-game position updates as they overtake. The public, read-only spectator and live leaderboard page is `admin.html`; it cycles a third-person camera through racers every five seconds.
5. Race times are local to each driver's start. Because late arrivals join mid-race, the live leaderboard ranks racers by current progress until they finish, then by finish time.

The spectator page is intentionally public and displays live driver names, positions, and race progress to anyone who can open its URL.

The relay runs the race room and standings; the game clients simulate the cars and send their positions. Online cars do not collide. The relay's room limit is configured in `server/lobby.ts`.

## Running the relay locally

```bash
npm run server
```

It listens on port 8787 (set `PORT` to change it). Players on the same Wi-Fi connect to `ws://<your PC's IP>:8787`. For friends elsewhere, host it somewhere reachable, or use a tunnel and set its `wss://` address as `VITE_RELAY_URL` when building the web app.

## Hosting the relay for free

1. Push the project to GitHub.
2. On [Render](https://render.com) choose New → Blueprint and pick the repo. `render.yaml` and the `Dockerfile` do the rest.
3. Set `VITE_RELAY_URL=wss://your-service.onrender.com` in the web app's build environment and rebuild it. An https page can only connect to `wss://` addresses.

Free Render services sleep when idle, so the first connection after a break can take about a minute. Any host that runs Docker works the same way (Fly.io, Railway, a home server). The Docker image builds and serves both the game and relay; it has been built and smoke-tested. The Render Blueprint has not been run end to end.

## Secure connections

Plain `ws://` and `http://` send your device key and race history unencrypted. The game therefore accepts them only for this computer and private networks (`localhost`, `10.x`, `172.16-31.x`, `192.168.x`, `*.local`), so Wi-Fi play at home still works. Any server on the public internet must use `wss://` (relay) or `https://` (data store). Render and Cloudflare give you those automatically.

## Anti-cheat

Times are reported by each game, so no client can be made fully cheat-proof. The relay adds two safeguards:

- **Device key:** the first device to save a driver ID claims it with a random secret kept on that device. Nobody else can read or overwrite that history.
- **Plausibility check:** lap and race times faster than the physics could allow for that circuit are rejected. The minimum is based on the circuit's ideal speed profile with a safety margin.

The relay also rate-limits requests and caps the size of leaderboards.
