# CranSki

A free 3D freeski game that runs in the browser from GitHub Pages. Drop into a terrain park, pop off kickers and rails, chain spins, flips, grabs and butters, and chase your best run.

> CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.

This is **Phase 4 (multiplayer)** from [DESIGN.md](DESIGN.md), on top of Phase 3's accounts and leaderboards. The game is still static files on GitHub Pages and solo play needs no account. Signing in is optional: an email sign-in link (no passwords) unlocks cloud saves, friends and server-checked leaderboards, backed by [Supabase](https://supabase.com).

## What's in it

- **Seven parks**, each loaded only when picked: BIG AIR, THE YARD (day-night cycle with floodlights), APEX, FOREST LINE, SHIRAKUMO (powder, cliffs, forest trails), ASPEN PIPE (600 m superpipe) and BELLEVUE (village street, sunrise to northern lights). Each has a gondola, ropeway or T-bar ride up (F skips), a start gate, a blue finish line and blue-painted lips.
- **Tricks**: spins, flips, corks, bios, rodeos, mistys, flatspins, sideflips, 8 grabs; rails (slides, swaps, hops, presses, spins off the end); butters (nose, tail, butter landings, deep butters).
- **Basecamp** lobby, park map, pause menu, finish moment and results screen; FROST earned by riding.
- **Settings**: rebind keys and controller buttons, Ultra / High / Performance graphics, 30 fps cap, camera, sound, stats overlay.
- **Touch controls** for phones and tablets, with a layout editor.
- **Replays**: last 5 runs auto-saved, keep favourites, best-run ghost per park, 7 replay cameras, clip export (MP4 or WebM, rendered on the device).
- **Locker**: body, helmets (some earned), beanies, goggles, tops, pants, mittens, skis or snowboard, bindings, boots, poles, and which grab sits on each button.
- **Loading scenes, sound effects and music**: four original illustrations; all sound effects and nine synthwave tracks are synthesised in the browser.

### Online (Phase 3, optional)

- **Sign in by email link**: no password, anywhere. Pick a gamertag: letters, spaces and dashes, one rider per name (ignoring case, accents, spaces and dashes), offensive names blocked.
- **Cloud saves**: settings, personal bests and Locker choices follow you to any device. Signed out, local saves work exactly as before.
- **Friends**: search by gamertag, send and accept requests, see who's online and where they're riding. Only friends you've both accepted see your location.
- **Leaderboards** for every park except SHIRAKUMO. A finished run is sent as its recorded inputs. The `submit-run` Edge Function re-rides them through the same deterministic simulation and saves only the score it calculates itself. If the result doesn't match, the run is rejected.
- **Privacy page**: what's stored and where, and account deletion.

### Multiplayer (Phase 4, needs a gamertag)

- **Live rooms** on Supabase Realtime: up to 30 riders per park in numbered rooms, with smoothed movement, full or cheap rider models by distance, a Tab roster and minimap dots.
- **Idle rules** for rooms (solo never times out).
- **Chat** filtered by the `chat` Edge Function before anyone sees it, with mutes, strikes, reports and a quick-phrases-only setting. Chat is never stored.
- **Friendly 1v1 duels** with alternate drops, live spectating, re-checked scores and a side-by-side highlight reel.
- **Parties** of up to 4 with GO / STAY, private rooms and party chat.

Try rooms without a server by opening the game with `?localnet` in two tabs.

Setting up the Supabase side (SQL, sign-in settings, Realtime, deploying the Edge Functions) is a few clicks and a few commands: see **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)**.

## Play

```bash
npm install
npm run dev
```

Open the URL Vite prints, press any key on the loading screen, then RIDE (or Enter) to open the park map.

| Action | Keyboard | Controller (Xbox labels) |
| --- | --- | --- |
| Carve on snow / spin in the air | A / D | Left stick |
| Tuck for speed / frontflip in the air | W | RT or RB |
| Brake / backflip in the air | S | LT |
| Sideflip, or flatspin with a spin | ← / → | Right stick |
| Rodeo (+ S) or misty (+ W), with a spin | ↑ | B |
| Hold to load pop, release to jump; on a rail: tap to hop, hold to press | Space | A |
| Grab slots 1 / 2 / 3 (Mute / Tail / Japan by default; change them in the Locker) | Shift / Q / E | LB / X / Y |
| Nose butter (tail butter with S); hold through a landing for a butter landing | B | Left stick click |
| Skip lift | F | Assignable |
| Restart from the top (hold 2 s) | R | View |
| Pause / back | Esc or P | Menu |
| Replay: play / seek / switch camera / freeze | Space / arrows / C / F | — |

Every key and button can be rebound in Settings → Controls.

## Build, test, deploy

```bash
npm test
npm run build
```

`npm run build` writes static files to `dist/`. `npm run build:functions` bundles the simulation for the leaderboard Edge Function (`supabase/functions/submit-run/sim.js`) and copies the chat filter into the chat function; `npm run build:sql` joins the migrations into `supabase/setup.sql`. `npm test` fails if any of those copies are out of date. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main` (repository **Settings → Pages → Source: GitHub Actions**).

## Project layout

```
src/sim/       deterministic simulation: terrain, rider, rails, butters, tricks, scoring, run,
               its own bit-exact maths (dmath.js) and the leaderboard referee (verify.js)
src/parks/     the seven park layouts (each its own chunk) and the park registry
src/render/    Three.js scenes: world, sky, lifts, rider model, cameras, ski tracks
src/replay/    input recording, IndexedDB storage, re-riding, replay cameras, clip export
src/audio/     synthesised sound effects and music
src/ui/        Basecamp, map, HUD, settings, touch controls, Locker, replays, loading screen,
               Account, Friends and Leaderboard panels
src/online/    Supabase config (publishable key only), sign-in, cloud saves, friends, leaderboards
supabase/      database tables and Row Level Security (migrations/), Edge Functions (functions/)
tools/         Blender model builders and the simulation bundler for the Edge Function
tests/         node:test suites (scoring, tricks, physics, every park, rails, powder/pipe, replays,
               determinism, the leaderboard referee, gamertag rules, privacy)
```

The simulation runs on a fixed 120 Hz step with no randomness, so a replay is just the inputs and re-rides exactly. It never calls the browser's `Math.sin`, `Math.exp` and friends, which can differ in the last digit between Chrome, Firefox, Safari and the server: it uses its own versions built from exact arithmetic (`src/sim/dmath.js`). That's what lets the server re-ride a leaderboard run and get the identical score.

## Credits

- [Three.js](https://threejs.org) (MIT licence)
- [Vite](https://vite.dev) (MIT licence), build tool
- [supabase-js](https://github.com/supabase/supabase-js) (MIT licence), online features; loaded only when you sign in or open a leaderboard
- Music: nine original tracks composed for CranSki and played by an in-browser synthesiser. Sound effects are synthesised in the browser too.
- 3D models used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (resized for the web; see `public/models/CREDITS.md`):
  - [“Snowy Wooden Hut”](https://sketchfab.com/3d-models/snowy-wooden-hut-857c02ab61834df8a8d125ccce6fec2a) by [gecko0307](https://sketchfab.com/gecko0307)
  - [“Finish Line”](https://sketchfab.com/3d-models/finish-line-70aecb6bac234266bdebd22322396caa) by [Kemal Çolak](https://sketchfab.com/kemalcolak)
  - [“Snowy Mountain - Terrain”](https://sketchfab.com/3d-models/snowy-mountain-terrain-9fa3c56fd32746bcb0e06cd2c4229ca0) by [artfromheath](https://sketchfab.com/artfromheath)
- The rider, trees, lifts and arches are built by `tools/blender/build_assets.py`.

Apart from the CC BY models above, all code, models, illustrations, sounds and music in this repository were made for CranSki.
