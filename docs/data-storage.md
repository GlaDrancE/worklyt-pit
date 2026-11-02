# Player data

## Where it lives

By default everything stays in the player's own browser (`localStorage`, keys starting `trackrush.`): profile and ID, race history and points, best laps and ghosts, settings, colour, daily challenge, season and achievements. Nothing is uploaded unless you connect to a relay or data store yourself.

## Relay backup

When a player connects to a relay, their name and race history (the last 100 races: laps, points, wins, 1v1 results) are also backed up on the relay and merged back in on any device that uses the same driver ID. The relay writes to `server/data/players.json` (or the file named by `PLAYERS_FILE`) next to the lap ranking in `board.json`. Both are in `.gitignore`.

Access is protected by the device key described in [multiplayer.md](multiplayer.md#anti-cheat).

A file only survives if the host keeps its disk. Your own PC does. Free cloud plans such as Render's free tier wipe it on every restart, which is why there is a second option.

## Free permanent store: Cloudflare Workers + D1

The `worker/` folder is a small API (the same two calls as the relay) that keeps players in a Cloudflare D1 database. The free plan needs no card, doesn't sleep, and there's no AI or API key anywhere in it.

1. Create a free Cloudflare account, then in the project folder run `npx wrangler login`.
2. `npx wrangler d1 create trackrush`, then copy the `database_id` it prints into `worker/wrangler.toml`.
3. `npx wrangler d1 execute trackrush --remote --file=worker/schema.sql --config worker/wrangler.toml`
4. `npx wrangler deploy --config worker/wrangler.toml`. It prints an address like `https://trackrush-data.<you>.workers.dev`.
5. In the game, open the 1 vs 1 panel and paste that address into **Data store address**.

From then on every race is backed up there, even when no relay is running, and any device with the same driver ID gets its history back. The relay and the data store are independent, so the relay can sleep or restart without anyone losing history.

## Configuration

`.env.example` lists the only optional settings: `PORT`, `BOARD_FILE` and `PLAYERS_FILE`. None are secrets.
