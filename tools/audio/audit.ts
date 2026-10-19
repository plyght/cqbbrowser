/**
 * Audit the open set's Freesound sources: prints title, tags and description of every source and flags any that
 * mention words that don't belong in a category (water/splash/etc.). Run: bun tools/audio/audit.ts
 */
import { SOURCES } from './sources';

const SUSPECT = /water|liquid|splash|drip|pour|wet|rain|squelch|slosh|bubble|mud|snow|swamp/i;
const UA = { 'User-Agent': 'Mozilla/5.0 (shortbarrel asset tool)' };

const seen = new Map<number, string[]>();
for (const s of SOURCES) {
  const o = s.origin;
  const key = o.kind === 'freesound' ? o.id : -1;
  if (o.kind === 'kenney') {
    if (SUSPECT.test(o.file)) console.log(`FLAG kenney ${o.file} → ${s.key}`);
    continue;
  }
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key)!.push(s.key);
}

for (const s of SOURCES) {
  const o = s.origin;
  if (o.kind !== 'freesound' || !seen.has(o.id)) continue;
  const keys = [...new Set(seen.get(o.id))];
  seen.delete(o.id);
  const page = await (
    await fetch(`https://freesound.org/people/${encodeURIComponent(o.user)}/sounds/${o.id}/`, { headers: UA })
  ).text();
  const tags = [...page.matchAll(/href="\/browse\/tags\/([^/"]+)\//g)].map((m) => decodeURIComponent(m[1]));
  const desc = (page.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '').slice(0, 300);
  const text = `${o.title} ${tags.join(' ')} ${desc}`;
  const flag = SUSPECT.test(text) ? 'FLAG' : 'ok  ';
  console.log(
    `${flag} ${o.id} [${keys.join(', ')}] "${o.title}"\n     tags: ${[...new Set(tags)].join(', ')}\n     desc: ${desc}`,
  );
}
