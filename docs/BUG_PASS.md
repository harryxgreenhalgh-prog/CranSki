# Launch bug pass

Every screen and button in [DESIGN.md](../DESIGN.md), checked in Chromium (Playwright,
software GPU) on 14–15 November 2026. Online features were checked against a mocked
Supabase and the in-browser `?localnet` room server, so nothing touched the real project.

✓ = checked and working · **Fixed** = was broken, fixed in this pass.

## Fixed in this pass

| Where | What was wrong | Fix |
| --- | --- | --- |
| Basecamp, laptops under 1,000 px wide | The tab bar was clipped after REPLAYS: UPDATES (and on some widths REPLAYS) couldn't be reached | Tabs shrink in steps, then scroll sideways (mouse wheel too) with a fade on the side that has more |
| Basecamp, phones | Friends was hidden; on a phone held upright only RIDE showed in the tab bar; the mode buttons covered the lift pass | Two-row top bar on narrow screens, mode buttons two by two on short screens, Friends always shown |
| Basecamp, 1,240–1,400 px | The CRANSKI logo was hidden on most laptops (it only showed above 1,400 px) | Shows down to 1,240 px, and in the top row on narrow screens |
| All screens, narrow windows | The disclaimer footer wraps to 2–3 lines and covered the page links, the minimap and the replay bar | Screens and the HUD sit above the footer's real height |
| Run, phones | The speed and score readout sat on top of the ROLL button | Moved beside the pause button |
| Pause menu, phones on their side | Settings, How to play and Back to Basecamp were below the fold | Two-column pause menu on short screens |
| Park map, phones on their side | Ride and Back were below the fold, and the map ran under the footer | Map beside a compact info panel |
| Locker, phones | Save look and Back were below the fold | They stay pinned at the bottom of the panel; side-by-side layout on short screens |
| Phones and tablets | Keyboard hints (Enter, Esc, "Arrow keys pick a park") showed on touch-only devices | Hidden when the main pointer is touch |
| Lift | The lift bar always said "F skip", even on touch screens and controllers | Says the key, controller A, or "Tap here to skip" |
| Run start | The hint always said "W tuck · Space pop" | Uses your device and your own key bindings |
| Clip | Closing the clip editor opened from the results screen left you in the replay viewer | Goes back to where it was opened |
| Item Shop | Stayed on "Loading…" for ever if the server sent nothing back | Says the Shop isn't open right now |
| Settings | DESIGN.md's Account tab was missing | Account tab (gamertag, sign in and out, delete account) |
| Tutorial offer | Stayed on screen during a run if a new player ignored it | Cleared when you leave Basecamp |
| Live rooms | Every graphics level showed 6 full-detail riders (DESIGN.md: 20 Ultra, 12 High, 8 Performance) | Per-level counts as designed |
| Pages | An old "Coming later" page still said the Shop, Pass and multiplayer were coming | Removed (nothing linked to it any more) |
| Replays | On smaller screens the control bar covered about a third of the picture, hiding the rider in some cameras | The bar fades out while a replay plays untouched and comes back on any mouse, key or touch |

## Checked, desktop (1280×720, keyboard and mouse)

**Loading screen**
- ✓ Progress bar, status line and now-playing track while loading
- ✓ Loading scene illustration
- ✓ Reload game button present (shown only if loading stalls)
- ✓ Space continues to Basecamp

**Basecamp**
- ✓ Top right: logo, FROST balance, Sign in, Friends, music player, gear
- ✓ Left column: latest update, challenge, Season Pass card, podium
- ✓ Rider and lift pass; renaming keeps letters, spaces and dashes only
- ✓ Mode picker: Solo marked PICKED; Live rooms (asks you to sign in), Ranked and Party match panels open; back to Solo
- ✓ Sign in opens the account panel: email link, no password field
- ✓ Friends panel opens
- ✓ Music player: open, pause and play, skip, volume, close
- ✓ Settings from the gear, every tab: Controls, Graphics, Camera, Sound, Stats, Chat & gifts, Account
- ✓ Graphics: Ultra / High / Performance and the 30 fps cap save
- ✓ Controls: rebind a key, then Reset keyboard; touch layout editor opens and closes
- ✓ Camera: every slider and toggle, reset
- ✓ Sound: music and effects volume
- ✓ Chat: full / quick phrases / off
- ✓ Stats: overlay on and off
- ✓ Locker: every slot has choices; Back without saving keeps the old look; Save look keeps the new one
- ✓ Shop (signed out): Daily, Limited sets, Purchases; close
- ✓ Tabs: Ride (opens the map), Locker, Shop, Pass, Leaderboard, Replays, Updates, each closes with Esc
- ✓ Season Pass card opens the Pass
- ✓ Footer: About, How to play (with the tutorial button), Privacy, Credits, Updates
- ✓ Disclaimer in the footer

**Park map**
- ✓ RIDE (Enter) opens it
- ✓ All seven parks: name, length, features, way up, riders here
- ✓ YOU ARE HERE tag
- ✓ Arrow keys move the selection
- ✓ Back returns to Basecamp

**Lift and run**
- ✓ Ride loads the park and boards the lift; F skips to the gate
- ✓ HUD: minimap, speed, score
- ✓ Hold R: the restart ring fills and you restart from the top

**Pause menu**
- ✓ Esc opens it; Resume; Reset position; Restart run
- ✓ How to play shows the controls and the tutorial button
- ✓ Music pause and skip
- ✓ Settings, and Esc steps back to the pause menu
- ✓ Change park opens the map; Back returns
- ✓ Esc resumes

**Finish and results**
- ✓ Riding to the finish: the rider turns to the cameras beside the run summary
- ✓ Results: total, breakdown, top speed, airtime, best trick
- ✓ Save replay
- ✓ Watch replay: play and pause, seek, all 7 cameras (Broadcast, Cinematic, Follow, Action cam, Helmet, Drone, Free), freeze, exit; the bar fades while playing untouched
- ✓ Clip: sections, format, camera, trick text; close returns to results
- ✓ Ride again goes back to the lift
- ✓ Replays tab lists the run

**Tutorial (keyboard, controller and touch)**
- ✓ Offered to new players in Basecamp; Not now remembers; not offered again
- ✓ Starts from How to play and from the pause menu's help; Skip works
- ✓ Each step ticks off; landing feedback; back to the top until all four are done; Tutorial complete card

## Checked, phone (740×360 landscape, touch)

- ✓ Tap to continue, RIDE, pick a park, Ride
- ✓ Lift bar says to tap it, and tapping skips the lift
- ✓ Touch controls: stick, 8 buttons, pause button
- ✓ HUD clear of the touch controls
- ✓ Holding POP loads the pop
- ✓ Pause button opens the pause menu (every button on screen); Resume
- ✓ Settings → Controls → Edit touch layout (layouts, sizes, opacity, left-handed, Reset, Done)
- ✓ Map, Locker and Settings fit without scrolling

## Screen sizes

Basecamp checked at 1366×768, 1280×720, 1024×768, 960×540, 800×600, 740×360 and 390×844:
every tab and button reachable, nothing overlapping.

## Online and multiplayer (re-run of the earlier end-to-end tests)

Each earlier end-to-end test was run again against this build: two to four riders in tabs of one
browser, signed in through a mocked Supabase, with the `?localnet` room server.

| Test | What it covers | Result |
| --- | --- | --- |
| Account | Email-link sign-in (no password), gamertag rules and availability, signing out | ✓ |
| Cloud saves | Settings, bests and Locker merge between devices; a change syncs | ✓ |
| Sign-in code | The one-time code as well as the link | ✓ |
| Friends | Search, request, accept, online status and where they are | ✓ |
| Privacy | The Privacy page; deleting your account (type DELETE to confirm) | ✓ |
| Idle rules | 1 min paused, 2 min with no input, then back to Basecamp after a countdown | ✓ |
| Live rooms | Two riders see each other, roster, room counts | ✓ |
| Chat | Filtering (crude words starred, hate words blocked), quick phrases, mute and report from the roster | ✓ (the test needed updating: it pressed Esc on the lift, which rightly takes you back to Basecamp) |
| Friendly 1v1 duel | Challenge, 3-2-1, alternate drops, live spectating, result, leaving mid-duel | ✓ |
| Party match | Private free-for-all on APEX for a party of 3 | ✓ |
| CRANSKI CUP | Free-for-all over APEX, THE YARD and BIG AIR, total score | ✓ |
| Gifting | Send a gift to a friend; turning gifts off stops them | ✓ |
| Item Shop | Daily items, buy an item and a set, wear it, return within 24 h | ✓ |
| Season Pass | Level and XP, buying premium with FROST, wearing a reward | ✓ |
| Seasons | A season change, prizes, last season's hall of fame, the RECORD alert | ✓ |
| Ranked 1v1 | Queue, match found, four alternate runs, result | ✓ |
| Ranked 2v2 | Two pairs, team scores while watching, four runs | ✓ |
| Leaderboard check | A run ridden in the browser, re-ridden by the real `submit-run` handler: identical score | ✓ |
| FROST | Reward for a finished run, paid once, checked by the server | ✓ |

**Replay cameras** (BIG AIR with a 360, paused at the best air): Broadcast, Cinematic, Follow,
Action cam, Drone and Free all have the rider in frame; Helmet is first person, so the rider's
own body is hidden, as it should be.

## Not checkable here

- The loading screen illustrations: still the placeholder scenes until the new illustrations arrive.
- The real Supabase project: its Phase 5 SQL (`supabase/setup.sql` from this branch) and the season cron job still need to be run before seasons, the Shop and the Pass work online.
- Real phones and a real school Chromebook: checked by emulation (touch events, CPU slowed 4×) rather than on the devices themselves.
