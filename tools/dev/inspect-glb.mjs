import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const buf = readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
new GLTFLoader().parse(ab, '', (g) => {
  const lines = [];
  g.scene.traverse((o) => {
    let d = 0, p = o; while (p.parent) { d++; p = p.parent; }
    lines.push(`${'  '.repeat(d)}${o.type} ${o.name}${o.isMesh ? ` mat=${[].concat(o.material).map((m) => m.name)} verts=${o.geometry.attributes.position.count}` : ''}${o.isBone ? ` pos=${o.position.toArray().map((v) => v.toFixed(3))} q=${o.quaternion.toArray().map((v) => v.toFixed(2))}` : ''}`);
  });
  console.log(lines.slice(0, 60).join('\n'));
}, (e) => console.error(e));
