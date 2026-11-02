# Online 1v1

Two players race the same circuit at the same time. Each sees the other as a coloured car (cars don't collide). A small relay server passes messages between the two games.

## Running a race

1. Start a relay (below).
2. Everyone opens the game, chooses the **1 vs 1** tab and enters the relay address, then presses **Connect**.
3. **Invite by ID:** send your driver ID to a friend (the panel has a Copy button) and have them press *Invite*. **Race a stranger:** press *Race a stranger* and you're paired with the next person searching on the same relay who picked the same conditions.
4. Pick your car colour before connecting or searching. You can use any colour you've unlocked. If you both choose the same one, your rival's car is drawn in a clearly different colour on your screen.
5. After the lights go out, first to finish wins: **25 points** for 1st and **18** for 2nd. If the other driver quits you win by forfeit. A second driver gets 90 seconds to finish after the winner crosses the line.
6. Winners get confetti. Solo races also pop confetti and give 10 points per valid lap (+10 for a personal best).

Both drivers use race handling, no crash damage and the same steering feel, so the cars are equal. Time of day and weather are agreed in the lobby.

The fastest-lap ranking appears on the menu and before the start, with driver names. It merges this device's history with the relay's board.

## Running the relay locally

```bash
npm run server
```

It listens on port 8787 (set `PORT` to change it). Players on the same Wi-Fi connect to `ws://<your PC's IP>:8787`. For friends elsewhere, host it somewhere reachable, or use a tunnel and share its `wss://` address.

## Hosting the relay for free

1. Push the project to GitHub.
2. On [Render](https://render.com) choose New → Blueprint and pick the repo. `render.yaml` and the `Dockerfile` do the rest.
3. In the game enter `wss://your-service.onrender.com` as the server address. An https page can only connect to `wss://` addresses.

Free Render services sleep when idle, so the first connection after a break can take about a minute. Any host that runs Docker works the same way (Fly.io, Railway, a home server). The Docker setup hasn't been run end to end here, so if it fails, the error message will say which step.

## Secure connections

Plain `ws://` and `http://` send your device key and race history unencrypted. The game therefore accepts them only for this computer and private networks (`localhost`, `10.x`, `172.16-31.x`, `192.168.x`, `*.local`), so Wi-Fi play at home still works. Any server on the public internet must use `wss://` (relay) or `https://` (data store). Render and Cloudflare give you those automatically.

## Anti-cheat

Times are reported by each game, so no client can be made fully cheat-proof. The relay adds two safeguards:

- **Device key:** the first device to save a driver ID claims it with a random secret kept on that device. Nobody else can read or overwrite that history.
- **Plausibility check:** lap and race times faster than the physics could allow for that circuit are rejected. The minimum is based on the circuit's ideal speed profile with a safety margin.

The relay also rate-limits requests and caps the size of leaderboards.
