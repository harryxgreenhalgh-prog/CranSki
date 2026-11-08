# CranSki

A free 3D freeski game that runs in the browser from GitHub Pages. Drop into a terrain park, pop off the kicker, chain spins, flips and grabs, and chase your best run.

> CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.

This is **Phase 1 (solo core)** from [DESIGN.md](DESIGN.md): the BIG AIR park, the rider controller, pop, spins, flips, off-axis tricks, grabs, landing checks, the scoring rules and the results screen. Rider and terrain are simple placeholder shapes.

## Play

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). Press **Enter** (or click RIDE) to drop in.

### Controls

| Action | Keyboard | Controller (Xbox labels) |
| --- | --- | --- |
| Carve on snow / spin in the air | A / D | Left stick |
| Tuck for speed / frontflip in the air | W | RT or RB |
| Brake / backflip in the air | S | LT |
| Sideflip, or flatspin with a spin | ← / → | Right stick |
| Rodeo (+ S) or misty (+ W), with a spin | ↑ | B |
| Hold to load pop, release to jump | Space | A |
| Grab: Mute / Tail / Japan | Shift / Q / E | LB / X / Y |
| Restart from the top (hold 2 s) | R | View |
| Pause | Esc or P | Menu |

Spin + flip pressed within 0.25 s of leaving the lip makes a cork, bio, rodeo or misty; keep holding the flip key for doubles and triples. Release everything before touchdown so the skis line up; holding keys into the snow is a bail.

## Scoring

`trick = 1500 × turns² × grab × flip × switch × repeat + airtime`, with clean landings worth +450 plus 15% of the line, sideways landings keeping 50–100%, and bails losing the unbanked line. The full rules are in the Scoring section of [DESIGN.md](DESIGN.md); the code is in `src/sim/scoring.js`.

Phase 1 choices where the brief left room:

- A landed line banks after 1.5 s of riding away on snow, so a quick second hit keeps the line multiplier going.
- Grab multiplier rises linearly from ×1.0 to ×1.25 over the first second held; two or three different grabs use the variety multiplier (×1.30 / ×1.35) instead.
- Flatspins get half the inverted bonus (×1.075 per flip) so a cork outranks a flatspin at equal rotation.
- Gravity is 13 m/s² (a little arcade-heavy) and the BIG AIR deck is long, so a full tuck gives ~190 km/h at the lip and ~5 s of air.

## Project layout

```
src/sim/       deterministic simulation (no rendering): terrain, rider, tricks, scoring, run
src/render/    Three.js scene, placeholder rider model, chase camera, snow spray
src/ui/        HUD and results screen (plain DOM)
src/input.js   keyboard + Gamepad API, all bindings in one table
tests/         node:test suites for scoring, trick naming and physics
```

The simulation runs on a fixed 120 Hz step with no randomness, so the same inputs always give the same run (the base for replays and server re-rides later).

## Build, test, deploy

```bash
npm test
npm run build
```

`npm run build` writes static files to `dist/`. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. To turn it on, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**.

## Credits

- [Three.js](https://threejs.org) (MIT licence)
- [Vite](https://vite.dev) (MIT licence), build tool

All code, shapes and textures in this repository were made for CranSki.
