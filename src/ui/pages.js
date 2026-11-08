// Text pages shown in the modal: About, How to play, Privacy, Credits, Updates,
// and the tabs that need online play.
import { CONTROLS_HTML } from './hud.js';
import { TRACKS } from '../audio/music.js';
import { SCENES } from './loading.js';

export const DISCLAIMER =
  'CranSki is an independent fan-made game inspired by Cork7. It is not affiliated with, endorsed by, or connected to Cork7 or its developers. Not affiliated with SSX, EA, X Games or Red Bull.';

export const UPDATES = [
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
      <p>Solo CranSki needs no account and sends nothing to any server. The game is static files hosted on GitHub Pages.</p>
      <h3>WHAT IS STORED, AND WHERE</h3>
      <p>In this browser, on this device: your rider name, Locker choices, settings, personal bests, FROST balance, recent run summaries, and saved replays and ghosts. Clearing your browser's site data removes all of it, or use the button below.</p>
      <p>If you sign in (optional): your email address and sign-in records are held by Supabase Auth, the hosted service that sends your sign-in link, and your gamertag is stored in CranSki's Supabase database where other riders can see it. Your email is never shown to other riders.</p>
      <p><button class="btn" id="wipe-data">Delete my CranSki data on this device</button></p>
      <p class="muted">GitHub, which hosts the site, may keep standard web server logs. See GitHub's privacy statement.</p>`,
  },
  credits: {
    title: 'Credits',
    html: `
      <h3>LIBRARIES</h3>
      <p><a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a>, MIT licence, for 3D rendering.<br>
      <a href="https://vite.dev" target="_blank" rel="noopener">Vite</a>, MIT licence, for building the site.</p>
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
    title: 'Coming with online play',
    html: `
      <p>The Item Shop, Season Pass, leaderboards, friends and multiplayer need a server, and CranSki is currently static files on GitHub Pages with no server at all.</p>
      <p>They're planned for later phases: sign-in by email link, cloud saves and leaderboards where the server re-rides each run to check the score, then live rooms, duels and seasons.</p>
      <p>Until then, everything you earn (FROST, bests, Locker picks) stays on this device.</p>`,
  },
};

export function pageHtml(id) {
  const p = PAGES[id];
  return typeof p.html === 'function' ? p.html() : p.html;
}
