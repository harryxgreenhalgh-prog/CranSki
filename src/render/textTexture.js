// Canvas text on a texture (signs, banners, the goggle strap).
import * as THREE from 'three';

export function textTexture(text, { w = 1024, h = 128, bg = '#1e7bff', fg = '#ffffff', font = 'italic 900 88px Impact, "Arial Black", sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
