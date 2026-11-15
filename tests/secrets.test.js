// No secret keys anywhere in the repository: every tracked text file is scanned
// for the shapes of real secrets (Supabase secret and service_role keys,
// personal access tokens, cloud keys, private keys). The publishable key in
// src/online/config.js is public by design and is allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BINARY = /\.(glb|gltf|bin|png|jpe?g|webp|gif|ico|mp3|ogg|wav|mp4|webm|woff2?|ttf|whl|zip|gz)$/i;

// A JWT whose payload says role service_role (the old-style secret key).
function serviceRoleJwt(text) {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') return m[0].slice(0, 20) + '…';
    } catch {
      /* not a JWT after all */
    }
  }
  return null;
}

const PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Supabase personal access token', /sbp_[a-f0-9]{30,}/],
  ['GitHub token', /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Stripe secret key', /\bsk_(live|test)_[A-Za-z0-9]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

test('no secret keys in any tracked file', () => {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && !BINARY.test(f));
  assert.ok(files.length > 50, 'git ls-files found the repository');
  const found = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue; // listed but not on disk (deleted in the working tree)
    }
    for (const [what, re] of PATTERNS) if (re.test(text)) found.push(`${f}: ${what}`);
    const jwt = serviceRoleJwt(text);
    if (jwt) found.push(`${f}: service_role key ${jwt}`);
  }
  assert.deepEqual(found, []);
});

test('no stray build or tool files are tracked (Python wheels, .env files, archives)', () => {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const stray = files.filter((f) => /\.(whl|zip|tar|tgz|pem|key|p12)$/i.test(f) || /(^|\/)\.env(\.|$)/.test(f));
  assert.deepEqual(stray, []);
});
