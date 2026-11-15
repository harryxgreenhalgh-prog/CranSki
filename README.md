# CranSki

**A free freeski trick game that runs in your web browser.** Drop into a terrain park, pop off kickers and rails, and land spins, corks, flips, grabs and butters. There's no button per trick: the game watches what you actually do in the air and names and scores it.

**Play it:** https://harryxgreenhalgh-prog.github.io/CranSki/ (no download and no account needed)

> **Disclaimer.** CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.

## How to play

**First time?** Basecamp offers a two-minute tutorial on BIG AIR that teaches the four basics one at a time: **pop, spin, grab and land clean**. You can start it again any time from **How to play**.

1. In **Basecamp**, press **RIDE** (or Enter) to open the park map and pick a park.
2. Ride the lift up, or press **F** to skip it.
3. Ride from the start gate to the blue finish line, landing tricks on the way.
4. See your score, watch the replay, make a clip, or ride again.

### The basics

- **Speed:** hold **W** to tuck.
- **Pop:** hold **Space** to crouch, then let go right at the lip of a kicker to jump higher.
- **Spin:** in the air, hold **A** or **D**. Let go after a full turn (360), or keep going for a 540, 720…
- **Flip:** in the air, **W** frontflips and **S** backflips. Spin and flip together right off the lip for corks and bios.
- **Grab:** hold **Shift**, **Q** or **E** in the air (Mute, Tail and Japan by default). Grabbing keeps you turning.
- **Land clean:** let go of everything before you touch down, with your skis pointing down the hill. Clean landings earn a bonus; holding a button into the snow, or landing head first, is a crash that loses your unbanked points.
- **Rails and boxes:** ride straight at them; the blue lip lines you up. Tap Space to hop, hold Space to press.
- **Butters:** press **B** on the snow (B + S for a tail butter).

### Controls

| Action | Keyboard | Controller (Xbox labels) | Touch |
| --- | --- | --- | --- |
| Carve on snow / spin in the air | A / D | Left stick | Stick left / right |
| Tuck for speed / frontflip in the air | W | RT or RB | Stick up |
| Brake / backflip in the air | S | LT | Stick down |
| Sideflip, or flatspin with a spin | ← / → | Right stick | ROLL |
| Rodeo (+ S) or misty (+ W), with a spin | ↑ | B | RODEO / MISTY |
| Hold to load your pop, let go to jump; on a rail: tap to hop, hold to press | Space | A | POP |
| Grabs 1 / 2 / 3 (pick which grab is on each in the Locker) | Shift / Q / E | LB / X / Y | GRAB / TAIL / JAPAN |
| Nose butter (tail butter with S) | B | Left stick click | BUTTER |
| Skip the lift | F or Enter | A | Tap the lift bar |
| Restart from the top (hold 2 s) | R | View | Pause menu |
| Pause | Esc or P | Menu | ❚❚ |
| Replays: play / seek / camera | Space / arrows / C | | On-screen buttons |

Every key and button can be changed in **Settings → Controls**, and the touch layout can be moved, resized and mirrored for left-handed play.

## What's in it

- **Seven parks**, each downloaded only when you pick it:
  - **BIG AIR**: one mega kicker, about 5 seconds of airtime. Learn big spins.
  - **THE YARD**: the all-rounder, with 15 jumps and 5 rail zones, day to floodlit night.
  - **APEX**: big kickers, rails and a stair set. Home of ranked matches.
  - **FOREST LINE**: rails and gaps through the trees, and a giant ball that rings when you hit it.
  - **SHIRAKUMO**: freeride powder, cliffs and forest trails.
  - **ASPEN PIPE**: a superpipe with 10.5 m walls.
  - **BELLEVUE**: a snowy village street with kickers, hips and rails, from sunrise to the northern lights.
- **Replays** of your last 5 runs, a ghost of your best run on each park, 7 replay cameras, and clips you can save as video.
- **The Locker**: body, hair, helmets and beanies, goggles, jackets, pants, mittens, skis or snowboard, boots, bindings, poles, and your choice of grabs.
- **Graphics for any computer**: Ultra, High, or Performance mode for school Chromebooks and phones (it picks Performance on weaker devices, and you can undo that). An optional 30 fps cap.
- **Original music and sound**: nine synthwave tracks and every sound effect are made in the browser.

### Online (optional, free)

Sign in with an email link (no passwords) to unlock:

- **Cloud saves** of your settings, personal bests and Locker.
- **Friends**: requests, who's online and where they're riding (only friends you've both accepted).
- **Leaderboards** for every park except SHIRAKUMO. The server re-rides every run from its recorded inputs and keeps only the score it works out itself.
- **Live rooms** of up to 30 riders, with filtered chat (or quick phrases only, or off), mute and report.
- **Friendly 1v1 duels**, **parties** of up to 4, **ranked 1v1 and 2v2** on APEX, private **2v2 / free-for-all** matches and the **CRANSKI CUP**.
- **FROST**, earned only by riding (there is no way to pay real money), the **Season Pass**, the **Item Shop**, and gifting to friends. Seasons last about a month.

## Privacy

Playing solo needs no account and sends nothing anywhere: your progress stays in your browser. If you sign in, your email address, gamertag, scores, friends and items are kept in the game's database. Chat isn't stored. You can delete your account and everything with it from **Account** at any time. The full details are on the **Privacy** page in the game.

## Credits

- 3D models made for CranSki (rider, props, trees, lifts) are built by the Blender scripts in `tools/blender/`.
- 3D models used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (simplified and compressed for the web):
  - [“Snowy Wooden Hut”](https://sketchfab.com/3d-models/snowy-wooden-hut-857c02ab61834df8a8d125ccce6fec2a) by [gecko0307](https://sketchfab.com/gecko0307): the start hut
  - [“Finish Line”](https://sketchfab.com/3d-models/finish-line-70aecb6bac234266bdebd22322396caa) by [Kemal Çolak](https://sketchfab.com/kemalcolak): the finish gantry
  - [“Snowy Mountain - Terrain”](https://sketchfab.com/3d-models/snowy-mountain-terrain-9fa3c56fd32746bcb0e06cd2c4229ca0) by [artfromheath](https://sketchfab.com/artfromheath): the mountains around every park
- [Three.js](https://threejs.org) (MIT), [Vite](https://vite.dev) (MIT), [supabase-js](https://github.com/supabase/supabase-js) (MIT), [glTF Transform](https://gltf-transform.dev) (MIT, used to compress the models).

Every asset and its licence is listed on the in-game **Credits** page and in [`public/models/CREDITS.md`](public/models/CREDITS.md). Apart from the CC BY models above, all code, models, sounds and music here were made for CranSki.

## For developers

```bash
npm install
npm run dev      # play locally at the address Vite prints
npm test         # all the test suites
npm run build    # static files in dist/
```

- **Hosting:** the game is static files. `.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main` (repository **Settings → Pages → Source: GitHub Actions**).
- **Online features:** see **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** for the database (`supabase/setup.sql`), sign-in settings and the Edge Functions, which deploy from `.github/workflows/deploy-functions.yml`. The game only ever holds Supabase's public (publishable) key. FROST, XP, ratings and items can only be changed by Edge Functions and database functions, and Row Level Security stops players editing their own.
- **Try rooms without a server:** open the game with `?localnet` in two tabs.
- **Models:** rebuild with the scripts in `tools/blender/`, then run `bash tools/optimize-models.sh` to compress them.

```
src/sim/       the deterministic simulation: terrain, rider, rails, butters, tricks, scoring,
               its own bit-exact maths (dmath.js) and the leaderboard referee (verify.js)
src/parks/     the seven park layouts (each its own download)
src/render/    Three.js scenes: world, props, sky, lifts, rider model, other riders, cameras
src/replay/    input recording, replay storage, replay cameras and clip export
src/audio/     synthesised sound effects and music
src/ui/        Basecamp, map, HUD, tutorial, settings, touch controls, Locker, Shop, Pass,
               replays, loading screen, account, friends and leaderboards
src/online/    Supabase config (publishable key only), sign-in, saves, rooms, chat, matches
supabase/      database tables and Row Level Security (migrations/, setup.sql), Edge Functions
tools/         Blender model builders, model compression, and the bundlers for the server copies
tests/         node:test suites
```

The simulation runs at a fixed 120 steps a second with no randomness and its own exact maths, so a replay is just the inputs and re-rides identically in any browser and on the server. That's what lets the leaderboard re-check every run.
