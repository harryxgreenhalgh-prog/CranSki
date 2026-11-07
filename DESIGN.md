# CranSki — Game Design Brief

Nov 7, 2026

CranSki is a free 3D freeski game that runs in the browser from GitHub Pages: drop into a terrain park, chain spins, flips, grabs and rails into scoring lines, and chase your best run. This brief says what to build and in what order; every number is a starting value to tune.

## The pitch

CranSki is a park-skiing trick game: you ride down one of seven terrain parks, pop off kickers and rails, and land spins, corks, flips and grabs that the game names and scores from what you actually did. A run takes 30 seconds to a few minutes, then you go again for a better line.

**Design pillars**

1. **Open a link, ride in seconds.** No install and no account for solo. Runs on a school Chromebook.
2. **One button to jump, endless tricks.** Pop is one key; the depth comes from combining spin, flip, roll and grab at the lip, and the game reads the result.
3. **Style pays.** Scoring rewards rotation, grab time, variety, clean landings and long lines; repeats pay less.
4. **Ride together (later).** A shared mountain where you see other riders' lines, then duels and seasons.

**Who it's for:** browser players on laptops, desktops and school Chromebooks, with keyboard, Xbox or PlayStation controller, or touch.

**Tone:** a sunny or floodlit modern terrain park, chill synthwave soundtrack, bold brush-lettered UI, baggy park outfits. Fun first, realistic enough that tricks look right.

**Where the idea comes from:** CranSki is inspired by the browser game Cork7. It borrows the genre and the feature list, but every line of code, model, texture, sound and name must be made fresh for CranSki (see Legal and originality).

## Platform and tech

CranSki ships as static files on GitHub Pages (username.github.io), so the whole solo game must run in the browser with no server; anything shared between players needs a separate backend service.

**GitHub Pages rules that shape the build** ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits))

- Static files only: GitHub Pages runs no server-side code.
- Published site no larger than 1 GB; soft bandwidth limit of 100 GB a month; deploys time out after 10 minutes.
- Not allowed as hosting for an e-commerce site or anything mainly for commercial transactions, and not for sending passwords or card numbers. So: no real-money purchases, and sign-in should go through a hosted provider (email link or Discord/Google), never a password form on the Pages site.

**Recommended stack** (designer's call)

| Need | Suggestion |
| --- | --- |
| 3D rendering | Three.js on WebGL 2 |
| Build and deploy | Vite, published by a GitHub Actions workflow |
| Physics | Custom fixed-timestep rider controller; a light collision library (e.g. Rapier) for terrain and rails |
| UI | React or plain DOM over the canvas |
| Local saves | localStorage for settings and bests; IndexedDB for replays and the best-run ghost |
| Input | Keyboard, the browser Gamepad API, touch events |
| Accounts, boards, friends (later) | Supabase or Firebase |
| Live rooms (later) | WebSocket rooms on Cloudflare Durable Objects, PartyKit or Colyseus |
| Clip export | MediaRecorder or WebCodecs to MP4/WebM, rendered on the player's device |

**Technical targets**

- 60 fps on a mid-range laptop; 30 fps on a school Chromebook in Performance mode.
- Small first download, then stream park assets as each park is picked.
- **Deterministic simulation:** fixed timestep and recorded inputs, so replays play back exactly and a server can later re-ride a run to check its score.
- Works in current Chrome, Edge, Firefox and Safari; shows a clear message if WebGL 2 or GPU acceleration is missing.

## Build phases

Build solo first: phases 1 and 2 need no server. Each gate is the test to pass before starting the next phase.

1. **Phase 1 · Solo core** (first playable, no server): one park (BIG AIR) with skiing, pop, spins, flips, grabs and landings; scoring, results screen, keyboard and controller.
   - *Gate:* a full run feels good with placeholder art.
2. **Phase 2 · Full solo game** (no server): all seven parks, rails, butters, touch controls, settings; replays and clips, Locker, sound, music, loading scenes.
   - *Gate:* holds 30 fps on a school Chromebook in Performance mode.

*Everything below needs a backend: GitHub Pages only hosts static files.*

3. **Phase 3 · Online basics**: sign-in by email link or Discord, cloud saves, friends; per-park leaderboards where the server re-rides each run to check it.
   - *Gate:* the server re-rides a replay and gets the same score.
4. **Phase 4 · Multiplayer** (needs a realtime server): live rooms of up to 30 riders, chat with filter and reports; friendly 1v1 duels, parties of four, private rooms.
   - *Gate:* a full room stays smooth and reports reach a moderator.
5. **Phase 5 · Seasons**: ranked 1v1 and 2v2 on APEX, CRANSKI CUP, Season Pass; Item Shop priced in earned FROST, season boards and prizes.

Phases 1 and 2 are a complete, shippable game on GitHub Pages alone; phases 3 to 5 add a hosted backend for accounts, leaderboards and live rooms, so they can wait until the solo game is fun.

## Core loop and screens

The loop is: Basecamp lobby → pick a park → ride the lift up (or skip) → ride the park → finish screen → ride again. Getting from page load to the first drop should take under 30 seconds.

1. **Loading screen:** one of four illustrated scenes at random, a progress bar, a different music track each visit, and a Reload game button if loading stalls. Warm up shaders here so the first run never hitches.
2. **Basecamp (lobby):** your rider stands in their outfit next to a lift-pass card with their name.
3. **Park map:** pick a park; shows its length, features and rider counts; YOU ARE HERE on the current park.
4. **Lift:** gondola, ropeway or T-bar ride to the top; F skips straight to the start gate.
5. **The run:** ride from the start gate to the blue finish line.
6. **Finish:** the rider stands facing cameras beside the run summary; then the results screen.
7. **Again:** ride again, change park, or watch the replay.

**Basecamp layout**

| Element | Spec |
| --- | --- |
| Top tabs | Ride · Locker · Shop · Pass · Leaderboard · Replays · Updates |
| Top right | CranSki logo, FROST balance, Friends, music player button, gear icon (Settings) |
| Left column | News card (latest update), event card (e.g. "Race for the top 10 · ends 17 Nov"), Season Pass tier, season podium |
| Centre | Your rider, full size, with the lift-pass name card (and party members beside you, later) |
| Mode picker | Solo / Multiplayer, chosen one marked PICKED; party modes listed below them (later) |
| RIDE button | Big, bottom left, shows the Enter key hint; opens the park map |
| Footer | About · How to play · Privacy · Credits · Updates |

**Settings** (gear icon in Basecamp and in the pause menu)

| Tab | Options |
| --- | --- |
| Controls | Rebind every keyboard key and controller button; controller picture lights up as you press; touch layout editor |
| Graphics | Ultra / High / Performance; frame cap uncapped or 30 fps |
| Camera | Speed FOV on/off, FOV, stiffness, tilt, distance, height, angle, first person |
| Sound | Music and effects volume |
| Stats | Off / FPS and ping / detailed panel (frame time, 1% lows, network, draw calls, GPU) |
| Account (later) | Gamertag, sign-in, sign out, gift opt-out, delete account |

**Pause menu** (Esc or P, controller Menu): resume, reset position, restart run, change park, Settings, back to Basecamp. Esc steps back one menu level.

**Results screen:** total score with a breakdown (tricks and airtime, grabs and variety, rails and clean landings), top speed in km/h, total airtime, best trick; buttons for Watch replay, Save replay, Clip, Ride again, Map.

## Controls

The same keys mean different things on snow, in the air and on a rail; these are the defaults, and every input must be rebindable.

| Action | Keyboard | Controller (Xbox labels) |
| --- | --- | --- |
| Carve on snow / spin in the air | A / D | Left stick |
| Tuck for speed / frontflip in the air | W | RT or RB |
| Brake / backflip in the air | S | LT |
| Air roll: sideflip alone, flatspin with a spin | ← / → | Right stick |
| Rodeo (+ S) or misty (+ W), with a spin | ↑ | B |
| Hold to load pop, release to jump; on a rail, hop or press | Space | A |
| Grab slot 1 (Mute) | Shift | LB |
| Grab slot 2 (Tail) | Q | X |
| Grab slot 3 (Japan) | E | Y |
| Nose butter (tail butter with S) | B | Left stick click |
| Skip lift | F | Assignable |
| Restart from the top (hold 2 s, ring fills) | R | View (hold) |
| Chat (later) / show all riders | T / hold Tab | — |
| Look around | Hold right mouse | Right stick on snow |
| Pause | Esc or P | Menu |
| Replay: play / seek / switch camera | Space / arrows / C | — |

**Rules the controls must follow**

- Spin and flip inputs that start within 0.25 s of leaving the lip combine into corks, bios, rodeos and mistys. A spin added later only tilts the flip.
- Tricks are named from the completed movement, never from the key held.
- A quick tap scores nothing; small hops on flat snow score nothing.
- Release everything before touchdown to land straight.

**Touch layout (phones and tablets)**

- Left thumb: floating stick for carve, tuck, spin and flip.
- Right thumb: POP (hold to load), GRAB, TAIL, JAPAN, BUTTER, RODEO, MISTY, ROLL.
- Sliding from one button to another without lifting counts as pressing the new one.
- Haptic tick on every pop and landing; three button sizes.
- Layout editor: drag, resize, set opacity, hide buttons, fixed or follow-thumb stick, three saved layouts, left-handed mirror.

**Controllers:** detect on first button press (browser rule); show the pad picture in Settings; support USB and Bluetooth Xbox and PlayStation pads.

## Riding and physics

Aim for arcade-leaning realism: speed from gravity and tucking, airtime from speed plus pop, and landings judged by ski angle. Exact constants are yours to tune; the values below are targets from the reference game.

**On snow**

- Carving (A/D) leans the rider into the turn from the edges; lean and camera swing grow with speed.
- Tuck (W) cuts drag; on flats it becomes poling for a small push. Tuck plus steer = low carve.
- Brake (S) scrubs speed; powerslides can steer freely.
- Target top speed: about 190 km/h on the BIG AIR inrun when tucked.
- No speed or points from hopping uphill; block poling uphill to repeat a jump.

**Pop and take-off**

- Hold Space to load (rider crouches), release to pop. Kickers launch you anyway if you don't press.
- Wind-up: while loading, A/D twists the chest against the turn; releasing throws the spin, arms first.
- Popping early must still contact the ramp, never pass through the lip.

**In the air**

- A/D spins around the vertical axis; W/S flips forward/back; arrows roll around the skis' long axis.
- Spin + flip started within 0.25 s of take-off = an off-axis trick (cork, bio, rodeo, misty).
- Holding a grab speeds up the spin a little. Reversing a flip key slows the current flip.
- Off steep, angled lips (~35°), flat spins stay flat instead of leaning with the lip.
- Skis drift and pitch slightly on their own in the air, then line up before touchdown.
- BIG AIR should give about 5 s of airtime at full speed.

**Landing rules**

| Landing | Result |
| --- | --- |
| Skis straight down the slope | Clean: +450 and +15% of the line |
| Tips or tails first, up to 45° | Still clean (stomped) |
| Sideways | Ride away, keep 50–100% of the trick, rider straightens quickly |
| Skis crossed against your direction | Ride away, shown as SAVED IT |
| Holding inputs into the snow, over-rotated, or head first | Crash: lose the whole unbanked line, shown as BAIL LOST |

Switch landings and corks get the same landing help as straight spins.

**Crashes:** the body stays connected and slides to rest (on its back after a switch landing, on its front after a forward one), then a short get-up. Hard crashes can throw goggles and helmet. Brushing a pole or rail edge at speed shouldn't throw you.

**Rails**

- Rails stand about 1.7 m high; lips are painted with blue edge lines like the kickers.
- If lined up, the lip guides you onto the bar; aim away and you pass by.
- Rails keep your speed; downhill rails add speed.
- A/D on the bar locks a quarter-turn swap, two per rail.
- Space = small hop that lands back on the same rail; near the end it pops you off.
- Hold Space = press: skis cross into an X, leading tip up, rider folds over the bar.
- Spin carries off the end; W/S held off a kick-up starts a flip.
- No butters on rails or boxes.

**Butters (on snow)**

- B arms a nose butter, B + S a tail butter. A ski-end impact loads the press: too soft gives nothing, too hard releases it.
- A/D turns the press up to a half turn; it lasts up to 1.5 s and slows you; release early to rebound; 1 s cooldown.
- Butter landing: press B in the air and hold through touchdown to land into a butter that keeps your spin. Big jumps risk a faceplant.
- Deep butters: tip back (S) or forward (W) in the air and land holding B, up to about 40°; too far and you fall.

**Terrain types**

- Powder: the rider sinks in and slows; crests and edges launch you like real snow.
- Superpipe: wall landings keep speed, so good hits climb higher.
- Stairs: ride like a slope.

## Tricks

There is no button per trick: the game tracks rotation on three axes from take-off to landing (counting the final turn into the landing) and names the result, so a trick recogniser is the core system to build.

**Air tricks to recognise**

| Trick | How it's made | Name shown |
| --- | --- | --- |
| Spin | A or D, any amount | 180, 360, 540, 720, 900, 1080, 1260, 1440 |
| Frontflip / backflip | W / S | FRONTFLIP, DOUBLE FRONTFLIP, BACKFLIP 180 (flip + half spin) |
| Sideflip | ← or → alone | SIDEFLIP |
| Flatspin | Spin + arrow | FLATSPIN 540 etc. |
| Cork | Spin + S from the lip | CORK 720; DOUBLE / TRIPLE / QUAD CORK 1080+ |
| Bio | Spin + W from the lip | BIO 540 etc. |
| Rodeo | ↑ + spin + S | RODEO 720 etc. |
| Misty | ↑ + spin + W | MISTY 540 etc. |
| Switch | Take off riding backwards | SWITCH + any of the above |

Ranking at equal rotation: double cork > cork > flat spin. Count each flip once (a fast tumble must not read as "5X MISTY 3600"). On a snowboard the same tricks add direction: FS, BS, Cab.

**Grabs** (three grab buttons; the player picks which grab sits on each in the Locker; every grab mirrors with spin direction)

| Grab | Pose |
| --- | --- |
| Mute | Front hand crosses to the opposite ski, skis cross in an X |
| Tail | Hand holds the same-side ski tail at the hip, skis crossed, eyes down |
| Japan | Stand tall, one knee bent with its ski forward, hand holds the other ski behind the boot |
| Safety | Hand grabs the ski under the boot on the same side; smooth in and out |
| Blunt | Reach back and cap the ski tail |
| Rocket Air | Both hands cap both ski tips |
| True Nose | One hand caps one ski tip |
| Backscratcher | Both knees bend back, hands hold the raised tails |

A grab counts after 0.25 s held; if two are pressed, the last one pressed wins. Grabs follow the rider through spins and corks. Landing a low grab in powder releases it on touch.

**Rail tricks:** slide (A/D rotates it), quarter-turn swap (max two per rail), hop (lands back on the rail), press (hold Space), spin or flip off the end.

**Butters:** nose, tail, butter 180, butter 360, butter landings, deep butters.

## Scoring

A trick scores when it lands, from its rotation squared, and a run's total is the sum of banked lines; points grow fast with rotation so big clean spins dominate, while variety and grabs separate good runs from great ones.

```
base  = 1500 × turns²        (360 = 1 turn → 1,500; 720 → 6,000; 1080 → 13,500)
trick = base × grab × flip × switch × repeat + airtime
```

| Rule | Value |
| --- | --- |
| Straight flips | Each flip counts as one turn |
| Corks, bios, rodeos, mistys | Only the spin counts as turns; the flip bonus applies on top |
| Upside down (flip bonus) | ×1.15 per flip |
| Grab | Counts after 0.25 s; rises to ×1.25 at 1 s held |
| Different grabs in one air | ×1.30 for two, ×1.35 for three |
| Grab with no spin | 300 |
| Switch | ×1.25 on spin points |
| Repeat (same trick within your last 3 airs) | 75%, then 55%, then 40%; opposite direction, switch or another flip resets it |
| Airtime | +135 per second, +36 per metre of height |
| Line multiplier | +0.25 for every jump or rail after the first (3 features = ×1.5) |
| Banking | Landing on snow banks the line into the run total |
| Clean landing | +450 plus 15% of the line |
| Sideways landing | Keeps 50–100% |
| Crash | Lose the whole unbanked line |
| Rails | 750 per second on the bar, +450 per swap or hop |
| Butters | 150 for a held press (0.25 s+), 300 for a 180, 600 for a 360; only the first 4 per run |
| No score | Quick taps, small hops on flat snow, uphill hops |

**Worked example:** a 720 with two different grabs = 6,000 × 1.3 = 7,800, plus 450 for a clean landing. A cork 720 = 6,000 × 1.15 = 6,900, or 8,625 with a full one-second grab.

**Readout:** each landed trick shows big on screen with its name, points and the bonuses that applied (e.g. grab ×1.23, inverted ×1.15). A crash shows BAIL LOST and the points lost.

**Anti-cheat (when leaderboards arrive):** submit the run's recorded inputs; the server re-simulates them and only the re-simulated score counts.

## Parks

Seven parks sit on one mountain, each built for a different skill; build BIG AIR first because one kicker is enough to prove the whole trick and scoring system.

| Park | Purpose | Length | Must contain | Way up | Leaderboard |
| --- | --- | --- | --- | --- | --- |
| BIG AIR | Learn big spins | ~0.7 km | One mega kicker | Gondola | Yes |
| THE YARD | Default all-rounder | ~4 km | 15 jumps, 5 rail zones | Gondola | Yes |
| APEX | Competitive, ranked home | ~1.6 km | 4 big kickers, 2 rail zones, stair set | Gondola | Yes |
| FOREST LINE | Rails and gaps | ~3.8 km | 15 jumps, 8 rail zones | Gondola | Yes |
| SHIRAKUMO | Freeride powder | ~3.2 km | Groomed piste, powder, trails, cliffs | Ropeway | No (ghosts only) |
| ASPEN PIPE | Pipe riding | 600 m pipe | Superpipe, 10.5 m walls | T-bar | Yes |
| BELLEVUE | Street-style village | ~3 km | Kickers, hips, rails on snow decks, gaps | T-bar | Yes |

**BIG AIR:** steep forest inrun, a sharp ~35° lip, a wide knuckle and a long landing. Full tuck gives ~190 km/h and ~5 s of air.

**THE YARD:** open-session park with a day-night cycle; at night, warm floodlights. Gondola up top, start gate on a small flat platform. Five pop-on rails: a low kicker throws you over a gap onto a raised bar.

**APEX:** pro-level slopestyle line in permanent daylight with a sunrise sky. Four big named kickers, two rail zones, a long stair set that rides like a slope.

**FOREST LINE:** a rail park through pines. Top: rails off gentle ramps, snake rails into doubles, a stair handrail, a giant black ball you can hit (it rings), a stepped start with a rail on each step. Bottom: a big hit off a knoll, two side-by-side gaps, three twin jumps, three blue pipes, and a 38 m gap onto a rainbow rail on a tall snow block.

**SHIRAKUMO:** a groomed piste zigzagging down at APEX speed, deep powder both sides, black rock walls, three steep chutes off the turns, eight narrow forest trails with powder kickers, pillows and cliff drops. Sunrise sky.

**ASPEN PIPE:** a 600 m superpipe in the forest; wall landings keep speed so riders climb higher each hit.

**BELLEVUE:** a 3 km street through an alpine village, with kickers and hips between houses, rails on snow decks, gaps onto rails; sky runs from sunrise to northern lights.

**Every park needs**

- A start gate, a blue finish line with tall side markers and netting, and a lift back up.
- Kicker and rail lips painted with blue edge lines so they read at speed.
- Steel rails about 1.7 m high.
- Random weather lasting a few minutes (flurries, steady snow, heavy snow, rare blizzards, fog and flat light), the same for everyone in the park.
- Groomed corduroy with ski tracks that fade after ~4 minutes (Ultra only).

Build each layout from these descriptions; don't trace another game's maps.

## HUD, camera and replays

Keep the HUD to four things (minimap, speed, trick readout, chat) and let the camera and replays sell the tricks.

**HUD**

| Position | Element |
| --- | --- |
| Bottom left | Minimap of the park, other riders as dots |
| Bottom right | Speed in km/h |
| Centre, on landing | Trick name, points and bonuses, large brush lettering |
| Top left | Latest chat lines, fading when quiet (multiplayer) |
| Centre, while holding R | Restart ring filling over 2 s |

Messages: BAIL LOST [points], SAVED IT, RECORD (someone beat the season best), YOU ARE HERE (park map), 3-2-1 before a duel drop, plus connection cards for duels (RECONNECTING, NOT RESPONDING, PAUSED with seconds left). A small crown floats above the season leader.

**Camera**

- Default: low and close behind the rider so kickers fill the screen; smooth follow through jumps and turns.
- Pulls back on big airs to show the whole landing; widens FOV with speed (toggle).
- Trees and masts between camera and rider turn see-through.
- Right mouse to look around; first-person helmet option where flips turn the whole view.
- Every camera value adjustable in Settings → Camera.

**Replays**

- Auto-save the last 5 runs; Save replay keeps favourites; keep a best-run ghost per park. Store locally (IndexedDB).
- Controls: Space play/pause, arrows seek, C switch camera.

| Replay camera | Behaviour |
| --- | --- |
| Broadcast | A fixed camera beside each big jump frames the whole trick against the sky; cuts follow the line |
| Cinematic | Smooth moves between angles, slow motion at the apex; freeze mode stops on your best air and orbits the rider |
| Follow | Always behind the rider |
| Action cam | Chases close at human height, swapping sides |
| Helmet | First person |
| Drone | Chases at the rider's speed |
| Free | Fly with W A S D and Q/E, or track the rider |

**Clips:** CLIP opens an auto edit that cuts in before every jump and rail; the player can trim to a section or keep the whole run. Export vertical or wide, with or without trick text, 30 fps MP4, rendered on the device (about 11 MB for 16 s).

## Rider and Locker

One rigged freeskier model in baggy park clothes, with swappable parts; cosmetics change looks only, never speed or handling.

**Default rider:** baggy park jacket and trousers, stiff ski boots, mittens, matte black park helmet, oversized mirror goggles on a white CRANSKI strap, twin-tip skis, poles with chunky grips. Body type Man or Woman, with free skin tones, hair colours and styles (short, front strands, braid) that fit under beanies and helmets.

**Animation set the rider needs**

- Carve left/right (lean scales with speed), tuck, low carve, poling push, brake, powerslide.
- Switch stance: hips open, head looking back over the shoulder; edge changes swap shoulders.
- Load (crouch), pop, wind-up twist, spin pose (arms open, then relaxed), flips, rolls.
- One pose per grab (8), mirrored for each spin direction; hand stays on the ski through rotation.
- Landings: clean absorb, hard absorb with slow recovery, sideways scrub, diagonal catch, switch landing.
- Rail: slide stance (wide, on inside edges), press (skis in an X), swap, hop.
- Butter press nose and tail, deep butter.
- Crash: ragdoll-style slide to rest on back or front, equipment can fly off, get-up.
- Finish pose facing camera with skis and poles beside the score.

**Locker (customisation)**

| Slot | Examples |
| --- | --- |
| Body | Man / Woman, skin tone, hair style and colour |
| Head | Helmet colours, beanie, balaclava, no helmet |
| Goggles | Lens colours, logo on or off |
| Jacket / top | Shells, hoodies, tees, long sleeves |
| Pants | Baggy park pants |
| Gloves | Mittens |
| Ride | Skis or snowboard (board boots auto-equip) |
| Bindings, boots | Colours |
| Poles | Colours, or no poles (empty mittens) |
| Grabs | Pick which grab sits on each of the 3 grab buttons |

The Locker opens one slot at a time with a close-up preview and saves in one tap. Your look shows in replays and to other riders.

**Unlock ideas (all earned in play):** helmets for single runs over 75,000 / 100,000 / 150,000 points; a beanie for 200,000; unique helmets for each season's top three. Name and design every item yourself.

## Modes and multiplayer

Solo ships first; everything else in this section needs the backend from Phase 3 onwards.

| Mode | Phase | Rules |
| --- | --- | --- |
| Solo | 1 | Ride any park; race your best-run ghost; never timed out; no account |
| Live rooms | 4 | Up to 30 riders on one park; open a new numbered room at 20 (14 on BIG AIR, 20 max on SHIRAKUMO and BELLEVUE); see riders live, with roster and chat |
| Friendly 1v1 | 4 | Challenge from a room (V key or 1V1 button) on APEX, BIG AIR, FOREST LINE, ASPEN PIPE or BELLEVUE; 3-2-1, alternate drops, the other watches live; 2 runs each, best run wins; rematch or change map; ends with a side-by-side highlight reel |
| Parties | 4 | Up to 4 friends via INVITE / JOIN; leader picks the park, others get a GO / STAY prompt; private-room switch; party chat |
| Ranked 1v1 | 5 | APEX only; matchmaking by rating; opponent hidden until start; 5 placement matches into Bronze, Silver, Gold, Platinum, Diamond; top 25 board |
| Ranked 2v2 | 5 | APEX; queue as a pair or solo; one run each, best team total; teammates within 500 rating |
| Private 2v2 / free-for-all | 5 | Party of 3–4; map choice; 1, 3 or 5 runs; best run or round wins |
| CRANSKI CUP | 5 | Party event over up to 5 maps; teams 2v2 or free-for-all; total score or round wins |

**Fair-play rules**

- Leaving a found ranked match: cooldowns of 1, 5, then 15 min; never penalise the rider left waiting. Leaving ranked 2v2 counts as a loss plus 5, 15, 30 min.
- 1v1 pausing or standing still is capped at 30 s in total, then the run ends; the server decides who disconnected.
- Idle in a room: 1 min paused, 2 min with no input, or 10 min in an untouched replay sends you back to Basecamp after a countdown. Solo is never timed.

**Friends:** search, requests, online status and where they are (Basecamp, which park, in a duel); join, watch or challenge.

**Safety (required before any chat ships)**

- Chat reaches only your room or party and isn't stored.
- Filter crude words, links, contact details and disguised hate words; a message with a hate word reaches nobody; repeat offenders lose chat for 15 min.
- Mute or report any rider; a report keeps the last 10 min of that room's messages for moderator review.
- Chat settings: full, quick phrases only (a wheel of preset lines), or off.
- Names: letters, spaces and dashes; one rider per name ignoring case and symbols; offensive names blocked.
- Friends see your location only once you've accepted them.

## Progression and economy

FROST is CranSki's only currency and is earned only by riding: no real-money packs, both because GitHub Pages isn't meant for selling things or handling card details and because it keeps the game simple and safe for younger players.

**Earning FROST** (starting values to balance)

- Finishing a run: 10 FROST plus 1 per 10,000 points, capped at 100 a day.
- Season Pass tiles: 25 FROST on some levels of each track.
- Season leaderboard top 10 per prize park: 2,500 / 1,500 / 750, then 250 for 4th–10th. Accounts must be 7+ days old with 20+ runs to win.

**Item Shop** (priced in FROST)

| Item type | Rare | Epic | Legendary |
| --- | --- | --- | --- |
| Jacket | 800 | 1,000 | 1,200 |
| Pants, skis, snowboard, helmet | 600 | 800 | 1,000 |
| Bindings, poles, gloves, boots, goggles | 200 | 400 | 600 |

- A daily section that rotates every 24 h, plus themed sets for a limited time (e.g. a Halloween set, a park-baggy set at about 1,400 FROST).
- Tap an item to preview it on your rider. Returns within 24 h, up to 3 per account.
- Gift to a friend (later): 5 a day, friends of 2+ days, sender account a week old with 20 runs; opt-out in Settings.

**Season Pass**

- Seasons last about a month; a new season resets the leaderboards and ghosts, not the player's items.
- 100 levels, 500 XP each. Each run gives 25 XP plus 1 XP per 3,000 points.
- Full XP for 3 levels a day (1,500 XP); missed days roll over; beyond that, runs give 1/5 XP so daily players can reach level 100.
- Free track and premium track. Premium costs 1,500 FROST and pays back 1,500 FROST across its levels.
- Rewards: clothing, boards, poles, FROST tiles. Show a reward strip with the next unlock.

**Leaderboards (Phase 3)**

- One board per park; prize boards for THE YARD, APEX and BIG AIR.
- A run counts only after the server re-simulates it.
- The season leader wears a crown in-game; RECORD flashes for everyone when the season best falls.

## Look, sound and settings

Clean stylised realism that scales from Ultra on a gaming PC down to a Chromebook, with real-sounding snow and a chill synthwave soundtrack.

**Visual style**

- Bright mountain light: sunrise skies, floodlit night sessions, northern lights on the village park.
- Bold brush-style typeface for all UI text and trick callouts.
- Lips and rail edges in a single bright blue so features read at speed.
- Four loading illustrations of riders in big scenes (above the clouds, at night, with friends), each with an original name.

**Graphics levels**

| Level | Includes |
| --- | --- |
| Ultra | Corduroy snow with fading tracks, fine snow spray and puffs on take-off and landing, goggle and outfit reflections, shadows, up to 20 nearby riders in full detail |
| High | Grooming lines, reflections, shadows, 12 full-detail riders |
| Performance | No shadows or reflections, closer tree draw distance, dynamic resolution, 8 full-detail riders; default on phones and weak machines, with an Undo prompt |

Also: 30 fps cap option; the stats overlay; distant riders drawn with a cheap model.

**Sound**

- Snow under skis changing with speed and surface, wind that rises with speed, steel rail grind that scales with speed, landing thuds (flat landings smack), butter scrapes, crashes, lift machinery.
- Feature sounds: the giant ball on FOREST LINE rings when hit.
- Separate music and effects volume.

**Music**

- 8–10 synthwave and chillwave tracks, one main theme; each visit opens on a different track; lobby music in Basecamp.
- A small in-game music player (play, skip, now playing).
- Use original music or tracks under a licence that allows it (e.g. Creative Commons Attribution), and credit every artist on a Credits page.

## Legal and originality

CranSki may share Cork7's genre and gameplay ideas, but everything players see and hear, and every line of code, must be made new, and the game must say plainly that it's an independent project inspired by Cork7. This is general guidance, not legal advice.

**Disclaimer to show** (footer of every page, the About/Credits screen, and the GitHub README)

> CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.

| Fine to reuse as ideas | Must be original or properly licensed |
| --- | --- |
| The genre: browser freeski with parks, tricks and runs | All code: write it from scratch, never copy or decompile another game's scripts |
| Mechanics and rules: pop, spin + flip at the lip, landing checks | 3D models, textures, animations, UI art, icons, logos |
| Scoring formulas and numbers | Sounds and music (use your own or properly licensed tracks, with credits) |
| Real ski terms: cork, misty, rodeo, mute, japan, butter | Loading illustrations and screenshots |
| Generic UI ideas: lobby, map, locker, shop, season pass | Names of items, sets, songs, features and the game itself |
| Parks built from these written descriptions | Exact level layouts copied from another game |

**Also do**

- Never use the Cork7 name, logo or screenshots in CranSki's title, store pages, thumbnails or marketing beyond the disclaimer line.
- Keep a Credits page listing every library (e.g. Three.js's MIT licence) and every licensed asset and artist.
- Don't collect personal data in the solo version; if accounts arrive later, add a privacy page saying what's stored and where.
- The park names currently match Cork7's; they're generic words, but unique names would make CranSki more clearly its own (see Open decisions).

## Open decisions for the designer

These are left open on purpose; settle them before or during Phase 1.

- [ ] Physics constants: gravity, drag, edge grip, spin and flip rates, pop strength, jump heights.
- [ ] Skis only at launch, or skis and snowboard together?
- [ ] Backend for Phases 3–5: Supabase, Firebase, or another service (rooms need a realtime server outside GitHub Pages).
- [ ] Room size: a flat 30, or split at 20 as described.
- [ ] Season length and exact Season Pass reward list.
- [ ] Full Item Shop catalogue: item names, art and rarity.
- [ ] Original names for the four loading scenes, the soundtrack and every cosmetic.
- [ ] Whether to give the seven parks unique CranSki names.
- [ ] Art direction sheet: rider proportions, colour palette, typeface choice.
- [ ] Asset budget for the first download on school networks.
