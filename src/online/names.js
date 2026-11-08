// Gamertag rules (DESIGN.md, Safety): letters, spaces and dashes; one rider per
// name ignoring case and symbols; offensive names blocked.
// The database enforces the same rules (supabase/migrations/*_profiles.sql);
// this copy only gives instant feedback while typing.

export const TAG_MIN = 3;
export const TAG_MAX = 18;

// Latin letters, including accented ones (Latin-1), so names like "Søren" or
// "José" work but look-alike letters from other alphabets can't impersonate.
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿ';
const TAG_RE = new RegExp(`^[${LETTERS}]+(?:[ -][${LETTERS}]+)*$`);
const NOT_ALLOWED = new RegExp(`[^${LETTERS} -]`, 'g');

// While typing: drop anything that isn't a letter, space or dash.
export function tidyTag(s) {
  return String(s || '')
    .replace(NOT_ALLOWED, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ -]+/, '')
    .slice(0, TAG_MAX);
}

// Before saving: also no doubled or trailing spaces and dashes.
export function cleanTag(s) {
  return tidyTag(s)
    .replace(/([ -])[ -]+/g, '$1')
    .replace(/[ -]+$/, '');
}

const FOLD = { ß: 'ss', æ: 'ae', þ: 'th', ð: 'd', ø: 'o' };

// The uniqueness key: lower case, accents folded, letters a-z only.
// "Mad-Dog", "mad dog" and "MÁDDOG" all share the key "maddog".
export function tagKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ßæþðø]/g, (c) => FOLD[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

// Blocked words, ROT13-encoded so the source doesn't spell them out.
// "Anywhere" words are blocked inside any name; the others only as a whole
// word, so innocent names that happen to contain them still work.
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97));
const ANYWHERE = 'shpx avttre avttn snttbg ergneq jrgonpx enturnq gbjryurnq uvgyre crqbcuvyr cnrqbcuvyr cravf intvan qvpxurnq pbpxfhpxre ovgpu juber fyhg nffubyr nefrubyr onfgneq jnaxre cbea wvmm qvyqb zvys vaprfg ohyyfuvg fuvgurnq zbgureshpxre nqzva zbqrengbe penafxv'.split(' ');
const WHOLE = 'fuvg phag snt xvxr puvax fcvp genaal cnxv pbba tbbx ornare anmv urvy xxx encr encvfg crqb cnrqb qvpx pbpx chffl nff nefr jnax gjng frk phz gvgf nany ubeal xlf bssvpvny fgnss fhccbeg'.split(' ');

export function tagBlocked(tag) {
  const key = rot13(tagKey(tag));
  const words = String(tag || '')
    .split(/[ -]+/)
    .map((w) => rot13(tagKey(w)));
  return ANYWHERE.some((w) => key.includes(w)) || WHOLE.some((w) => w === key || words.includes(w));
}

// null when fine, else 'length' | 'chars' | 'blocked'.
export function tagProblem(tag) {
  const t = String(tag || '');
  if (t.length < TAG_MIN || t.length > TAG_MAX) return 'length';
  if (!TAG_RE.test(t)) return 'chars';
  if (tagKey(t).length < TAG_MIN) return 'length';
  if (tagBlocked(t)) return 'blocked';
  return null;
}

export const TAG_STATUS = {
  ok: 'Available',
  yours: 'That is already your gamertag',
  taken: 'Taken: another rider has this name (ignoring case, spaces and dashes)',
  length: `${TAG_MIN}–${TAG_MAX} characters, with at least ${TAG_MIN} letters`,
  chars: 'Letters with single spaces or dashes between them only',
  blocked: "That name isn't allowed",
};
