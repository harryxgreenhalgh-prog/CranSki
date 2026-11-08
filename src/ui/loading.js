// Loading screen: one of four illustrated scenes at random, a progress bar,
// the track that's about to play, and a Reload button if loading stalls.

const $ = (id) => document.getElementById(id);

const sky = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

// A rider silhouette: skis, legs, body, head, arms. (x, y) is the boots; r rotates.
const rider = (x, y, r = 0, s = 1, c = '#0d1b2a', grab = false) => `
  <g transform="translate(${x} ${y}) rotate(${r}) scale(${s})" fill="${c}" stroke="${c}">
    <rect x="-16" y="-1.5" width="32" height="3" rx="1.5"/>
    <path d="M-4 -2 L-2 -14 L3 -14 L4 -2 Z"/>
    <path d="M-3 -14 L-4 -28 L5 -28 L4 -14 Z"/>
    <circle cx="0.5" cy="-32" r="4"/>
    ${grab ? '<path d="M3 -24 L10 -10 L12 -3" stroke-width="2.4" fill="none" stroke-linecap="round"/>' : '<path d="M4 -25 L13 -18" stroke-width="2.4" stroke-linecap="round"/>'}
    <path d="M-3 -25 L-12 -20" stroke-width="2.4" stroke-linecap="round"/>
  </g>`;

export const SCENES = [
  {
    name: 'Above the Cloud Line',
    svg: `<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice"><defs>${sky('s1', [[0, '#3b5ea8'], [0.55, '#f2a6a0'], [1, '#ffe0a8']])}</defs>
      <rect width="400" height="225" fill="url(#s1)"/><circle cx="300" cy="150" r="40" fill="#fff3c4" opacity="0.9"/>
      <path d="M0 170 Q60 150 120 165 T240 160 T400 168 V225 H0Z" fill="#fff" opacity="0.9"/>
      <path d="M0 185 Q80 170 160 182 T320 178 T400 185 V225 H0Z" fill="#f4f0f6"/>
      <path d="M150 175 L215 70 L280 175 Z" fill="#dfe6f2"/><path d="M215 70 L232 98 L218 92 L205 104 L196 95 Z" fill="#fff"/>
      ${rider(215, 70, -8, 0.8)}</svg>`,
  },
  {
    name: 'Floodlight Session',
    svg: `<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice"><defs>${sky('s2', [[0, '#050a1c'], [1, '#1c2a52']])}
      <radialGradient id="l2"><stop offset="0" stop-color="#fff2c4" stop-opacity="0.7"/><stop offset="1" stop-color="#fff2c4" stop-opacity="0"/></radialGradient></defs>
      <rect width="400" height="225" fill="url(#s2)"/>
      ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 400}" cy="${(i * 53) % 110}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff"/>`).join('')}
      <path d="M40 40 L-40 225 H140 Z" fill="url(#l2)"/><path d="M360 40 L260 225 H440 Z" fill="url(#l2)"/>
      <rect x="38" y="40" width="4" height="185" fill="#3a3f46"/><rect x="358" y="40" width="4" height="185" fill="#3a3f46"/>
      <path d="M0 200 L120 190 Q170 188 180 168 L185 168 L190 200 L400 205 V225 H0Z" fill="#e8eef7"/>
      <path d="M178 168 L188 168" stroke="#1e7bff" stroke-width="3"/>
      ${rider(250, 110, 140, 0.9, '#0d1b2a', true)}</svg>`,
  },
  {
    name: 'First Chair Crew',
    svg: `<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice"><defs>${sky('s3', [[0, '#2f7fe0'], [1, '#bfe3ff']])}</defs>
      <rect width="400" height="225" fill="url(#s3)"/>
      <path d="M0 170 L70 90 L130 140 L210 60 L290 130 L350 95 L400 140 V225 H0Z" fill="#e6eef8"/>
      <path d="M0 200 Q200 170 400 195 V225 H0Z" fill="#fff"/>
      <path d="M-10 40 L410 110" stroke="#222" stroke-width="2"/>
      <path d="M200 74 L200 92" stroke="#222" stroke-width="2"/>
      <rect x="160" y="92" width="80" height="58" rx="10" fill="#ff5a36"/><rect x="168" y="100" width="64" height="26" rx="5" fill="#bfe3ff"/>
      <circle cx="182" cy="114" r="6" fill="#0d1b2a"/><circle cx="200" cy="112" r="6" fill="#0d1b2a"/><circle cx="218" cy="114" r="6" fill="#0d1b2a"/>
      <rect x="176" y="118" width="12" height="10" fill="#1e7bff"/><rect x="194" y="116" width="12" height="12" fill="#22b07d"/><rect x="212" y="118" width="12" height="10" fill="#ffd23f"/>
      </svg>`,
  },
  {
    name: 'Aurora Drop',
    svg: `<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice"><defs>${sky('s4', [[0, '#04081a'], [1, '#14244a']])}
      ${sky('a4', [[0, '#3dffa8'], [1, '#5ad6ff']])}</defs>
      <rect width="400" height="225" fill="url(#s4)"/>
      <path d="M0 70 Q80 20 160 60 T320 40 T400 60 L400 100 Q320 80 240 100 T80 90 T0 110Z" fill="url(#a4)" opacity="0.45"/>
      <path d="M0 110 Q100 60 200 95 T400 80 L400 105 Q300 110 200 120 T0 130Z" fill="#b46bff" opacity="0.25"/>
      <path d="M0 225 L0 150 L90 100 L170 150 L250 90 L330 140 L400 120 V225Z" fill="#1d2a40"/>
      <path d="M250 90 L400 225 H180 Z" fill="#dfe9f5"/>
      ${rider(292, 140, 42, 0.9, '#0d1b2a')}</svg>`,
  },
];

export class LoadingScreen {
  constructor() {
    this.el = $('loading');
    this.last = 0;
    this.lastChange = performance.now();
    this.watch = setInterval(() => {
      // Nothing for 12 seconds: offer a reload.
      if (!this.el.classList.contains('hidden') && !this.complete && performance.now() - this.lastChange > 12000) $('ld-reload').classList.remove('hidden');
    }, 1000);
    $('ld-reload').addEventListener('click', () => location.reload());
  }

  show(trackName) {
    const s = SCENES[Math.floor(Math.random() * SCENES.length)];
    $('ld-art').innerHTML = s.svg;
    $('ld-scene').textContent = s.name;
    $('ld-track').textContent = trackName ? `♪ ${trackName}` : '';
    $('ld-go').classList.add('hidden');
    $('ld-reload').classList.add('hidden');
    this.complete = false;
    this.set(0, 'Loading…');
    this.el.classList.remove('hidden');
  }

  set(p, status) {
    if (p !== this.last) this.lastChange = performance.now();
    this.last = p;
    $('ld-fill').style.width = `${Math.round(p * 100)}%`;
    if (status) $('ld-status').textContent = status;
  }

  // Ready: wait for a tap or key (browsers only allow sound after one).
  ready(onGo) {
    this.complete = true;
    this.set(1, 'Ready');
    const go = $('ld-go');
    go.classList.remove('hidden');
    const start = (e) => {
      if (e && e.type === 'keydown' && (e.code === 'Tab' || e.metaKey || e.ctrlKey)) return;
      if (e && e.type === 'keydown') {
        e.preventDefault();
        e.stopImmediatePropagation(); // this key only starts the game
      }
      window.removeEventListener('keydown', start, true);
      go.removeEventListener('click', start);
      this.hide();
      onGo();
    };
    window.addEventListener('keydown', start, true);
    go.addEventListener('click', start);
  }

  hide() {
    this.complete = true;
    this.el.classList.add('hidden');
  }
}
