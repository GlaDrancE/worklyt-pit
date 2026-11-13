<div align="center">

# TrackRush Pro

**A free, browser-based 3D racing game with rivals, damage, race control and live multiplayer rooms.**

[![CI](https://github.com/vishal-kushwaha-9912/trackrush-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/vishal-kushwaha-9912/trackrush-pro/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-3c873a)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)

[**Play in the browser**](https://vishal-kushwaha-9912.github.io/trackrush-pro/) · [Documentation](#documentation) · [Report a bug](https://github.com/vishal-kushwaha-9912/trackrush-pro/issues/new?template=bug_report.md)

![Neon Street at dusk, the start grid](docs/images/neon-street.png)

</div>

TrackRush Pro is a racing game that runs entirely in the browser on desktop and phones. It has an original open-wheel car, seven circuits, computer-driven rivals, crash damage, safety cars and red flags, and live multiplayer rooms for up to 32 drivers. The read-only race spectator and live leaderboard are at `admin.html`. It is built with Three.js and Rapier, and it costs nothing to run: no accounts, no API keys, no AI services, no paid hosting.

> TrackRush Pro is an original game. The circuits and branding are not based on any real circuit, team or product, and it is not an official motorsport game.

<table>
  <tr>
    <td><img src="docs/images/night-rain.png" alt="A night race in the rain with lit street lamps"></td>
    <td><img src="docs/images/replay.png" alt="Best-lap replay from the TV camera"></td>
  </tr>
  <tr>
    <td align="center">Night racing with real lamp light</td>
    <td align="center">Best-lap replay, four cameras</td>
  </tr>
</table>

## Features

| Area | What you get |
| --- | --- |
| **Driving** | Raycast-vehicle physics tuned for a single-seater: about 2.3 s to 100 km/h, around 320 km/h top speed, downforce, brake bias and grass that slows you down. Race and drift handling. |
| **Circuits** | Four full-length circuits (2.6 to 4.2 km) and three training grounds under 2 km that drill straights, turns and corners. Day, dusk and night, dry or wet. |
| **Racing** | 3-2-1 start, three sectors, validated laps, 1, 2 or 5 rivals at three difficulties, tyre wear and pit stops. |
| **Race control** | Crash damage in ten zones, yellow flags, virtual safety car, safety car with a recovery truck, and red flags. |
| **Night lighting** | Street lamps give real light at dusk and night, and can be switched off for a harder race. |
| **Ghost and replay** | Your best lap races you as a ghost. Rewatch it from four cameras and export a lap image coloured by speed. |
| **Online multiplayer** | Join a live room with up to 32 drivers through a relay server you can host for free. |
| **Progression** | Points, car colours, daily challenge, championship seasons and achievements. |
| **Phones** | Portrait and landscape layouts, touch buttons or drag wheel, tilt steering and an easy-drive mode. |
| **Your data** | Stored on your device by default, with an optional free Cloudflare backup. Telemetry exports to CSV or JSON. |

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/vishal-kushwaha-9912/trackrush-pro.git
cd trackrush-pro
npm install
npm run dev
```

Open the address Vite prints, usually http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the full test suite |
| `npm run server` | Start the multiplayer relay (port 8787, or set `PORT`) |

## Controls

| Action | Keyboard |
| --- | --- |
| Gas / brake and reverse | W or ↑ / S or ↓ |
| Steer | A D or ← → |
| Handbrake | Space |
| Reset to track | R |
| Camera | C |
| Street lights on or off | L |
| Mute | M |
| Pause | P or Esc |

Gamepads and touch screens are supported too. See [Controls and handling](docs/controls.md).

## Documentation

| Guide | What's in it |
| --- | --- |
| [Controls and handling](docs/controls.md) | Keyboard, gamepad, touch, steering, drifting, settings |
| [Gameplay guide](docs/gameplay.md) | Modes, circuits, training grounds, tyres, damage, race control, progression |
| [Online 1v1](docs/multiplayer.md) | Running and hosting the relay, secure connections, anti-cheat |
| [Deploying for free](docs/deployment.md) | Cloudflare Pages, Oracle VM with Docker, and Render fallback |
| [Player data](docs/data-storage.md) | What is stored where, and the Cloudflare D1 setup |
| [Architecture](docs/architecture.md) | Project layout, car model pipeline, tuning files, tests |
| [Contributing](CONTRIBUTING.md) | Setup, checks before a pull request, conventions |
| [Security policy](SECURITY.md) | How to report a vulnerability, and what the game stores |

## Tech stack

Three.js for rendering, Rapier (WebAssembly) for physics, the Web Audio API for synthesised engine sound, Vite and strict TypeScript for the build, and Vitest for tests. The optional relay uses Node and `ws`. The optional data store runs on Cloudflare Workers and D1. No audio files are shipped: all sound is generated live.

## Project status

The driving game is feature-complete for its current scope. Planned but not built: a motorsport data centre (OpenF1 and Jolpica results, standings, telemetry charts, lap comparison) and heatmaps.

Known limits:

- Nothing is hosted for you. Online play needs someone to run the relay, see [Online 1v1](docs/multiplayer.md).
- Lap times are reported by each game. The relay rejects impossible times and ties a driver ID to one device, but no browser game can be made fully cheat-proof.
- The Docker image builds and serves the game and relay; the Render Blueprint has not been run end to end.
- Phone sensors and screen locking vary by browser.

## Privacy

The game needs no keys or accounts, so the repository holds nothing secret. Race history, settings and ghosts stay in your browser. Nothing is uploaded unless you connect to a relay or data store yourself, and non-local connections must use TLS. Details are in [Player data](docs/data-storage.md) and [SECURITY.md](SECURITY.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: run `npm run typecheck`, `npm test` and `npm run build` before you open a pull request.

## License

The source code is released under the [MIT License](LICENSE).

The 3D car model in `src/assets/f1-car.glb` is built by `tools/build-car-model.mjs` from a scan supplied by the project author (`tools/f1-car-source.glb`). It is an unbranded design with no team livery or logos. The MIT licence covers the code. If you reuse the car model, check that you have the right to do so first.

If a motorsport data centre is added later, note that OpenF1 and Jolpica each have their own terms (historical data, rate limits, non-commercial use for Jolpica), so check them before redistributing their data.