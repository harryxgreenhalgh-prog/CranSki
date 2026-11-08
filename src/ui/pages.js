// Text pages shown in the modal: About, How to play, Privacy, Credits, Updates,
// and the tabs that need online play.
import { CONTROLS_HTML } from './hud.js';
import { TRACKS } from '../audio/music.js';
import { SCENES } from './loading.js';

export const DISCLAIMER =
  'CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.';

export const UPDATES = [
  {
    title: 'Phase 3 · Online basics',
    items: [
      'Sign in with an email link (no passwords) and pick a gamertag. Solo play still needs no account.',
      'Cloud saves: settings, personal bests and Locker choices follow you to any device.',
      'Friends: search by gamertag, send and accept requests, and see who is online and where they are riding.',
      "Leaderboards for every park except SHIRAKUMO. The server re-rides each run from its inputs and only posts the score if it comes out the same.",
      'A new Privacy page that says exactly what is stored and where, and lets you delete your account.',
    ],
  },
  {
    title: 'Phase 2 · Full solo game',
    items: [
      'All seven parks: BIG AIR, THE YARD, APEX, FOREST LINE, SHIRAKUMO, ASPEN PIPE and BELLEVUE, each with its own lift.',
      'Rails, boxes, pipes and the rainbow rail: slides, swaps, hops, presses and spins off the end.',
      'Butters: nose, tail, butter landings and deep butters.',
      'Deep powder on SHIRAKUMO and speed-keeping wall landings in ASPEN PIPE.',
      'Basecamp, the park map, a full pause menu and the finish line moment.',
      'Settings: rebind keys and controller buttons, graphics levels, camera, sound and a stats overlay.',
      'Touch controls for phones and tablets, with a layout editor.',
      'Replays with seven cameras, a best-run ghost per park, and clips you can export.',
      'The Locker: colours, helmets, beanies, tops, skis or snowboard, poles and your grab picks.',
      'Loading scenes, synthesised sound effects and nine original synthwave tracks with a music player.',
    ],
  },
  {
    title: 'Phase 1 · Solo core',
    items: ['BIG AIR, the rider controller, spins, flips, corks, grabs, landing checks, scoring and the results screen.'],
  },
];

export const PAGES = {
  about: {
    title: 'About CranSki',
    html: `
      <p>CranSki is a free park-skiing trick game that runs in your browser. Ride one of seven terrain parks, pop off kickers and rails, and land spins, corks, flips and grabs that the game names and scores from what you actually did.</p>
      <p>Everything here (code, shapes, sounds and music) was made for CranSki.</p>
      <h3>DISCLAIMER</h3>
      <p>${DISCLAIMER}</p>`,
  },
  howto: { title: 'How to play', html: `<div class="howto">${CONTROLS_HTML}</div>` },
  privacy: {
    title: 'Privacy',
    html: `
      <p>Playing solo needs no account and sends nothing to any server. The game is static files on GitHub Pages, and your progress stays in this browser. Signing in is optional; you only need it for cloud saves, friends and leaderboards.</p>

      <h3>ON THIS DEVICE</h3>
      <p>Kept in this browser (local storage and IndexedDB):</p>
      <ul>
        <li>Your rider name, settings, Locker choices, personal bests, FROST balance and recent run summaries.</li>
        <li>Replays and best-run ghosts. They stay here unless you press <b>Post</b> on one, which sends that run's inputs to the leaderboard (see below).</li>
        <li>If you sign in: your sign-in session (so you stay signed in), when your cloud save last synced, and your <b>Appear offline</b> choice.</li>
      </ul>
      <p><button class="btn" id="wipe-data">Delete my CranSki data on this device</button></p>

      <h3>ON CRANSKI'S SERVER (ONLY IF YOU SIGN IN)</h3>
      <p>CranSki's server is a <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a> project: Supabase hosts the sign-in service and the database. It keeps:</p>
      <table class="ptable">
        <thead><tr><th>What</th><th>Who can see it</th></tr></thead>
        <tbody>
          <tr><td>Your email address and sign-in history, used only to send your sign-in links. Supabase also keeps security logs of sign-ins, such as IP address and time.</td><td>Only you. Never shown to other riders.</td></tr>
          <tr><td>Your gamertag</td><td>Everyone (leaderboards, friend search)</td></tr>
          <tr><td>Your cloud save: settings (camera, sound, controls), personal bests and Locker choices</td><td>Only you</td></tr>
          <tr><td>Your friends and friend requests</td><td>You and that rider</td></tr>
          <tr><td>That you're online and where (Basecamp, a lift, which park, a replay), updated about every 45 seconds while the game is open</td><td>Only friends you've both accepted. <b>Appear offline</b> in Friends turns it off.</td></tr>
          <tr><td>Your best server-checked score on each park, with its best trick and date</td><td>Everyone</td></tr>
          <tr><td>The recorded inputs behind each leaderboard run: which buttons were held at each moment, nothing else</td><td>Nobody through the game; kept so runs can be re-checked</td></tr>
          <tr><td>When you last submitted runs, to stop spam</td><td>Nobody; deleted after a day</td></tr>
        </tbody>
      </table>
      <p>There are no ads, no analytics and no tracking cookies. Nothing is sold or shared, and CranSki never asks for payment details or passwords.</p>

      <h3>SIGNING OUT AND DELETING</h3>
      <ul>
        <li><b>Sign out:</b> Account → Sign out on this device.</li>
        <li><b>Delete your account:</b> Account → Delete account. This removes your sign-in, email, gamertag, cloud save, friends, online status and leaderboard scores from the server in one go.</li>
        <li><b>Clear this device:</b> the button above, or clear this site's data in your browser.</li>
      </ul>
      <p><button class="btn" id="privacy-account">Open Account</button></p>

      <h3>YOUNGER RIDERS</h3>
      <p>If you're under 13, ask a parent or guardian before signing in. Solo play needs no account at all.</p>

      <p class="muted">GitHub, which hosts the game's files, may keep standard web server logs (see GitHub's privacy statement). Supabase's own privacy policy covers how it runs its service.</p>`,
  },
  credits: {
    title: 'Credits',
    html: `
      <h3>LIBRARIES</h3>
      <p><a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a>, MIT licence, for 3D rendering.<br>
      <a href="https://vite.dev" target="_blank" rel="noopener">Vite</a>, MIT licence, for building the site.<br>
      <a href="https://github.com/supabase/supabase-js" target="_blank" rel="noopener">supabase-js</a>, MIT licence, for sign-in, cloud saves, friends and leaderboards (loaded only when you use them).</p>
      <h3>MUSIC</h3>
      <p>Original soundtrack composed for CranSki and played live by an in-browser synthesiser (no recordings, no samples). Artist: CranSki.</p>
      <ol>${TRACKS.map((t) => `<li>${t.name}</li>`).join('')}</ol>
      <h3>SOUND EFFECTS</h3>
      <p>Snow, wind, rail grind, landings, the lift and the ringing ball are all synthesised in the browser for CranSki.</p>
      <h3>3D MODELS (CC BY 4.0)</h3>
      <p>Used under the <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">Creative Commons Attribution 4.0</a> licence, resized for the web:</p>
      <ul>
        <li><a href="https://sketchfab.com/3d-models/snowy-wooden-hut-857c02ab61834df8a8d125ccce6fec2a" target="_blank" rel="noopener">“Snowy Wooden Hut”</a> by <a href="https://sketchfab.com/gecko0307" target="_blank" rel="noopener">gecko0307</a>: the Basecamp lodge and start huts</li>
        <li><a href="https://sketchfab.com/3d-models/finish-line-70aecb6bac234266bdebd22322396caa" target="_blank" rel="noopener">“Finish Line”</a> by <a href="https://sketchfab.com/kemalcolak" target="_blank" rel="noopener">Kemal Çolak</a>: the finish line</li>
        <li><a href="https://sketchfab.com/3d-models/snowy-mountain-terrain-9fa3c56fd32746bcb0e06cd2c4229ca0" target="_blank" rel="noopener">“Snowy Mountain - Terrain”</a> by <a href="https://sketchfab.com/artfromheath" target="_blank" rel="noopener">artfromheath</a>: the mountains around every park</li>
      </ul>
      <h3>ART</h3>
      <p>The rider, trees, lifts and other models are built in code and in Blender for CranSki. Loading scenes: ${SCENES.map((s) => s.name).join(', ')}.</p>
      <h3>DISCLAIMER</h3>
      <p>${DISCLAIMER}</p>`,
  },
  updates: {
    title: 'Updates',
    html: () =>
      UPDATES.map((u) => `<h3>${u.title.toUpperCase()}</h3><ul>${u.items.map((i) => `<li>${i}</li>`).join('')}</ul>`).join(''),
  },
  online: {
    title: 'Coming later',
    html: `
      <p>The Item Shop, the Season Pass and multiplayer (live rooms, duels and parties) arrive in later phases.</p>
      <p>Available now: sign in with an email link for cloud saves, friends and leaderboards where the server re-rides each run to check the score. Everything you earn still works on this device without an account.</p>`,
  },
};

export function pageHtml(id) {
  const p = PAGES[id];
  return typeof p.html === 'function' ? p.html() : p.html;
}
