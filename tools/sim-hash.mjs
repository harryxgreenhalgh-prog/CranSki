// A fingerprint of everything the leaderboard referee runs: the simulation,
// the park layouts, the input format and the Three.js version. The bundled
// copy in supabase/functions/submit-run/sim.js carries it, and a test fails if
// the source has changed since the bundle was built.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function simSourceHash(root = '.') {
  const files = [
    ...readdirSync(join(root, 'src/sim')).map((f) => `src/sim/${f}`),
    ...readdirSync(join(root, 'src/parks')).map((f) => `src/parks/${f}`),
    'src/replay/record.js',
  ].sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(readFileSync(join(root, f))).update('\0');
  h.update(JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version);
  return h.digest('hex').slice(0, 16);
}
