// Launch checks: the disclaimer appears, word for word, in the footer, on the
// About and Credits pages and in the README.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISCLAIMER, PAGES, pageHtml } from '../src/ui/pages.js';

const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the disclaimer is in the footer, About, Credits and the README', () => {
  assert.match(DISCLAIMER, /independent fan-made game inspired by Cork7/);
  assert.match(DISCLAIMER, /Not affiliated with SSX, EA, X Games or Red Bull/);
  const footer = readFileSync('index.html', 'utf8').match(/<footer id="footer">([\s\S]*?)<\/footer>/);
  assert.ok(footer, 'index.html has the footer');
  assert.ok(flat(footer[1]).includes(DISCLAIMER), 'footer');
  assert.ok(flat(pageHtml('about')).includes(DISCLAIMER), 'About page');
  assert.ok(flat(pageHtml('credits')).includes(DISCLAIMER), 'Credits page');
  assert.ok(flat(readFileSync('README.md', 'utf8')).includes(DISCLAIMER), 'README');
});

test('About tells the truth about what was made for CranSki', () => {
  const about = flat(pageHtml('about'));
  assert.ok(!/Everything here .* was made for CranSki/.test(about), 'no "everything was made for CranSki" claim');
  assert.match(about, /Creative Commons Attribution/);
});

test('every page has a title and some text', () => {
  for (const id of Object.keys(PAGES)) {
    assert.ok(PAGES[id].title, `${id} title`);
    assert.ok(flat(pageHtml(id)).length > 200, `${id} text`);
  }
});
