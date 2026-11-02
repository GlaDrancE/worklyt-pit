# Contributing

Thanks for taking a look. TrackRush Pro is small enough that the setup is quick.

## Setup

```bash
npm install
npm run dev
```

You need Node.js 20 or newer.

## Before you open a pull request

Run these and make sure they pass:

```bash
npm run typecheck
npm test
npm run build
```

If your change affects how things look or feel, also try it in a real browser, on a phone if it touches controls or layout. The automated tests can't judge that.

## Conventions

- **Strict TypeScript.** The build fails on unused variables and parameters. Avoid `any`.
- **Keep rules separate from rendering.** Track geometry, race rules and scoring shouldn't import Three.js, so they stay testable.
- **Tuning numbers live in one place.** Steering goes in `src/vehicle/steeringConfig.ts`. Add a test when you change behaviour.
- **No secrets, accounts or paid services.** The game must keep running with none of them. Don't commit `.env` files or keys.
- **Original content only.** No real teams, liveries, logos, circuits or recordings.
- **Don't edit `src/assets/f1-car.glb` by hand.** Change `tools/build-car-model.mjs` and re-run it.
- **Commit messages** should say what changed and why, in the present tense (for example "Fade the ghost near the player").

## Reporting a problem

Please include your device and browser, the circuit, conditions and mode, and what you expected to happen. For physics or steering reports, say whether you were using keyboard, gamepad or touch.
