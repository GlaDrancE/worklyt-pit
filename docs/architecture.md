# Architecture

## Layout

```
src/
  game/       Game loop, input, environment, quality, replay, settings
  vehicle/    Car physics (Rapier), car model, chase camera, steering config
  track/      Track geometry, meshes, billboards, barrier colliders, minimap
  race/       Lap timing, rivals, tyres, pit stops, ghost, history, unlocks
  audio/      Synthesised engine, pit-crew and crowd sound
  telemetry/  Recording and CSV/JSON export
  ui/         HUD, screen layout, share and lap cards
  net/        Client side of 1v1 and player sync
  assets/     Car model (built, do not edit by hand)
server/       Optional 1v1 relay and player store
worker/       Optional Cloudflare Worker + D1 data store
tools/        Car model build script and source scan
tests/        Vitest tests
```

Track geometry and race rules don't depend on rendering or physics, which keeps them easy to test.

`src/game/Game.ts` runs the session. Its helpers are split out: `sceneHelpers.ts` (liveries, fading, grid positions, labels, clean-up), `sessionTypes.ts` (the shape of a session) and `ReplayController.ts` (best-lap replay and lap image).

`track/Billboards.ts` places roadside signs and uses the supplied transparent logo image as their artwork.

## Tuning files

| File | What it controls |
| --- | --- |
| `src/vehicle/steeringConfig.ts` | Every steering number and the three high-speed feels |
| `src/vehicle/VehiclePhysics.ts` | Car physics, handling modes and drift tuning |
| `src/race/drift.ts` | Drift scoring |
| `src/vehicle/DriftFx.ts` | Smoke and skid marks |
| `src/game/replayCamera.ts` | Replay camera angles (pure maths) |
| `src/track/tracks.ts` | Circuits and training grounds (control points, laps, width) |
| `src/game/LampLights.ts` | Real light from the street lamps at night |

## The car model

The car is built from a supplied F1 scan (`tools/f1-car-source.glb`, an untextured single mesh). Running `node tools/build-car-model.mjs` paints regions (red body, dark wings, floor and halo), smooths the shading, removes the scan's rough front-suspension slabs and stray tyre fragments, and fits the result to the physics car. It writes two detail levels to `src/assets/f1-car.glb`: about 67,000 triangles for your car and about 13,000 for rivals, the ghost and Low graphics.

Wheels aren't taken from the scan. `CarView` builds them in code: a round tyre, yellow compound band, domed cover, hub nut and a brake drum that steers without spinning, slim at the front and wide at the rear. The detailed car also gets wishbones, a push-rod and a track rod to each front hub that follow the bump and steering. If the model fails to load the game falls back to a built-in car.

The model is loaded in the background while the game prepares its default race.

## Loading and performance

The game starts its default race as soon as the physics engine (WebAssembly) and car model are ready. Main-menu return buttons are removed from the HUD, pause screen, and results screen. Quality starts at Low on phones and weak machines, and an FPS monitor lowers it automatically if frame rate stays poor.

## Tests

`npm test` runs the whole suite (240 tests at the time of writing):

- **Race rules:** countdown, valid laps, sector splits, shortcuts, resets and jitter over the line
- **Car physics:** the real physics runs headlessly to check acceleration, braking, reversing, steering direction, handbrake drifts and resets
- **Full laps:** an autopilot drives every circuit through the real barriers and race manager, and a skipped stretch must produce an invalid lap
- **Systems:** damage, rivals, race control, tyres, ghost and replay, history, unlocks, steering presets, sound timing and graphics defaults
- **Server:** relay rules, player store, rate limits, plausibility checks, and the Cloudflare handler against a local D1

Tests don't judge how things look. Rendering, the HUD and touch controls need checking by eye in a real browser. CI (`.github/workflows/ci.yml`) runs the type-check, tests and build.
