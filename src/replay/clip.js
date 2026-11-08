// Clips: an auto edit that cuts in before every jump and rail, exported as a
// 30 fps video rendered on this device (MP4 where the browser can, else WebM).

export function autoEdit(replay) {
  const raw = [];
  for (const a of replay.airs) if (a.time > 0.6) raw.push({ t0: a.t0 - 1.5, t1: a.t1 + 1.0, label: a.name || 'Air' });
  for (const r of replay.rails) raw.push({ t0: r.t0 - 1.5, t1: r.t1 + 1.0, label: 'Rail' });
  raw.sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const s of raw) {
    s.t0 = Math.max(0, s.t0);
    s.t1 = Math.min(replay.duration, s.t1);
    const last = out[out.length - 1];
    if (last && s.t0 <= last.t1 + 0.3) {
      last.t1 = Math.max(last.t1, s.t1);
      if (s.label !== 'Air' && !last.label.includes(s.label)) last.label += ' + ' + s.label;
    } else out.push({ ...s, on: true });
  }
  return out;
}

export function pickMime() {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

// Records `segments` of the replay. render(t, w, h) draws the 3D frame for replay
// time t into the game canvas at w x h; text(t) returns trick text to burn in.
export class ClipExporter {
  constructor({ glCanvas, segments, vertical, withText, render, text, onProgress, onDone }) {
    this.gl = glCanvas;
    this.segments = segments;
    this.w = vertical ? 720 : 1280;
    this.h = vertical ? 1280 : 720;
    this.withText = withText;
    this.render = render;
    this.text = text;
    this.onProgress = onProgress;
    this.onDone = onDone;
    this.total = segments.reduce((a, s) => a + (s.t1 - s.t0), 0);
    this.elapsed = 0;
    this.seg = 0;
    this.t = segments.length ? segments[0].t0 : 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.mime = pickMime();
    this.chunks = [];
    this.done = false;
  }

  start() {
    if (!this.mime || !this.canvas.captureStream) {
      this.onDone({ error: 'This browser can’t record video from the game canvas.' });
      this.done = true;
      return;
    }
    const stream = this.canvas.captureStream(30);
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 5500000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
      this.onDone({ blob, ext: this.mime.startsWith('video/mp4') ? 'mp4' : 'webm' });
    };
    this.rec.start(250);
    this.acc = 1 / 30;
  }

  // Called once per display frame; draws at 30 fps.
  tick(dt) {
    if (this.done) return;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const seg = this.segments[this.seg];
    this.render(this.t, this.w, this.h);
    const c = this.ctx;
    c.drawImage(this.gl, 0, 0, this.w, this.h);
    if (this.withText) {
      const txt = this.text(this.t);
      if (txt) {
        c.save();
        c.textAlign = 'center';
        c.font = `italic 900 ${Math.round(this.w * 0.065)}px Impact, "Arial Black", sans-serif`;
        c.lineWidth = 8;
        c.strokeStyle = 'rgba(11,61,145,0.9)';
        c.fillStyle = '#fff';
        const y = this.h * 0.2;
        c.strokeText(txt.name, this.w / 2, y);
        c.fillText(txt.name, this.w / 2, y);
        if (txt.points) {
          c.font = `italic 900 ${Math.round(this.w * 0.045)}px Impact, sans-serif`;
          c.fillStyle = '#fff6a8';
          c.strokeText(txt.points, this.w / 2, y + this.w * 0.06);
          c.fillText(txt.points, this.w / 2, y + this.w * 0.06);
        }
        c.restore();
      }
    }
    c.font = `italic 900 ${Math.round(this.w * 0.03)}px Impact, sans-serif`;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.textAlign = 'right';
    c.fillText('CRANSKI', this.w - 16, this.h - 18);
    this.t += 1 / 30;
    this.elapsed += 1 / 30;
    this.onProgress(Math.min(1, this.elapsed / Math.max(0.01, this.total)));
    if (this.t >= seg.t1) {
      this.seg++;
      if (this.seg >= this.segments.length) {
        this.done = true;
        this.rec.stop();
        return;
      }
      this.t = this.segments[this.seg].t0;
    }
  }

  cancel() {
    this.cancelled = true;
    this.done = true;
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }
}
