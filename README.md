# TrackRush Pro

A browser-based 3D racing game with an original open-wheel car, four circuits, computer-driven rivals, online 1v1 races and a full damage and race-control system. It's built with Three.js and Rapier, runs on desktop and phones, and costs nothing to run: no accounts, no API keys, no AI services, no paid hosting.

> TrackRush Pro is an original game. The circuits, car and branding are not based on any real circuit, team or product, and it is not an official motorsport game.

## Highlights

- **Driving model:** raycast-vehicle physics tuned for a single-seater (about 2.3 s to 100 km/h, around 320 km/h top speed, downforce, brake bias, grass that slows you down). Race and drift handling.
- **Four circuits:** Apex Park, Harbour Loop, Neon Street and Midnight Wet, with day, dusk and night lighting and dry or wet weather.
- **Racing:** 3-2-1 start, sectors, validated laps, 1, 3 or 5 rivals at three difficulties, tyre wear and pit stops, crash damage, yellow flags, virtual safety car, safety car and red flags.
- **Best-lap ghost and replay:** your fastest lap replays as a ghost, and you can rewatch it from four cameras and export a lap image.
- **Online 1v1:** invite by driver ID or race a stranger, with a small relay server you can host for free.
- **Progression:** points, car colours, daily challenge, championship seasons and achievements.
- **Works on phones:** portrait and landscape layouts, touch buttons or drag wheel, tilt steering, and an easy-drive mode.
- **Player data you own:** everything is stored on the device by default, with an optional free Cloudflare backup.
- **Telemetry:** every session records 10 samples per second and exports to CSV or JSON. It is always labelled as simulated data.

## Quick start

You need Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the address Vite prints. On Windows, PowerShell inside VS Code works fine.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the full test suite |
| `npm run server` | Start the 1v1 relay (port 8787, or set `PORT`) |

## Controls at a glance

| Action | Keyboard |
| --- | --- |
| Gas / brake and reverse | W or ↑ / S or ↓ |
| Steer | A D or ← → |
| Handbrake | Space |
| Reset to track | R |
| Camera | C |
| Mute | M |
| Pause | P or Esc |

Gamepads and touch screens are supported too. The full list is in [docs/controls.md](docs/controls.md).

## Documentation

| Guide | What's in it |
| --- | --- |
| [Controls and handling](docs/controls.md) | Keyboard, gamepad, touch, steering, drifting, settings |
| [Gameplay guide](docs/gameplay.md) | Menu modes, circuits and weather, tyres and pit stops, damage and race control, progression |
| [Online 1v1](docs/multiplayer.md) | Running and hosting the relay, how matches work, anti-cheat |
| [Player data](docs/data-storage.md) | What is stored where, and the free Cloudflare D1 setup |
| [Architecture](docs/architecture.md) | Project layout, car model pipeline, sound, tuning files, tests |
| [Contributing](CONTRIBUTING.md) | Setup, checks to run before a pull request, conventions |

## Tech stack

Three.js for rendering, Rapier (WebAssembly) for physics, the Web Audio API for synthesised engine sound, Vite and strict TypeScript for the build, Vitest for tests. The optional relay uses Node and `ws`; the optional data store runs on Cloudflare Workers and D1. No audio files are shipped: all sound is generated live.

## Project status

The driving game is feature-complete for its current scope. Planned but not built: the motorsport data centre (OpenF1 and Jolpica results, standings, telemetry charts, lap comparison) and heatmaps. Known limits:

- Nothing is hosted for you. Online play needs someone to run the relay, see [docs/multiplayer.md](docs/multiplayer.md).
- Lap times are reported by each game. The relay rejects impossible times and ties a driver ID to one device, but it can't make a client cheat-proof.
- The Docker and Render setup has not been run end to end. If a build fails, the error names the step.
- Phone sensors and screen locking vary by browser, see [docs/controls.md](docs/controls.md).

## Privacy and secrets

The game needs no keys or accounts, so the repo contains nothing secret. `.gitignore` blocks `.env` files, keys, certificates, `node_modules`, `dist`, logs and the relay's local data folder. `.env.example` lists the only optional settings. If you ever add a real key, keep it in a `.env` file, never in source. Nothing is uploaded unless you connect to a relay or a data store yourself.

## Licence and data

All code, tracks and car models here are original. The repository doesn't yet include a licence file, so add one (MIT is a common choice) before inviting outside contributions. If the data centre is added later, note that OpenF1 and Jolpica each have their own terms (historical data, rate limits, non-commercial use for Jolpica), so check them before relying on or redistributing their data.
