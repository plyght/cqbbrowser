/**
 * Freesound helper (no API key): searches CC0-only results and fetches HQ previews, re-checking the licence
 * on each sound's page before anything is saved. Raw downloads go to `tools/audio/.cache/` (gitignored);
 * `process.ts` turns them into the committed `open` set.
 *
 *   bun tools/audio/freesound.ts search "rifle gunshot" "pistol shot"
 *   bun tools/audio/freesound.ts fetch            # fetches every freesound entry in sources.ts
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCES } from './sources';

export const CACHE = join(import.meta.dir, '.cache');
const UA = { 'User-Agent': 'Mozilla/5.0 (shortbarrel asset tool)' };

const attr = (blk: string, name: string) => blk.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] ?? '';
const unescape = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<');

async function search(q: string) {
  const u = new URL('https://freesound.org/search/');
  u.searchParams.set('q', q);
  u.searchParams.set('f', 'license:"Creative Commons 0"');
  u.searchParams.set('s', 'Number of downloads (most first)');
  const h = await (await fetch(u, { headers: UA })).text();
  console.log(`== ${q}`);
  const seen = new Set<string>();
  for (const blk of h.split('class="bw-player"').slice(1)) {
    const id = attr(blk, 'sound-id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const dur = Number(attr(blk, 'duration')).toFixed(2);
    console.log(`${id}\t${dur}s\t${attr(blk, 'username')}\t${unescape(attr(blk, 'title'))}`);
  }
}

/** Fetch one sound: verify CC0 on its page, then download the HQ OGG preview. */
export async function fetchSound(id: number, user: string) {
  const out = join(CACHE, `fs-${id}.ogg`);
  if (existsSync(out)) return out;
  const page = await (
    await fetch(`https://freesound.org/people/${encodeURIComponent(user)}/sounds/${id}/`, { headers: UA })
  ).text();
  if (!page.includes('creativecommons.org/publicdomain/zero/1.0')) throw new Error(`fs ${id}: not CC0`);
  const base = page.match(/https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-[hl]q\.(?:mp3|ogg)/)?.[0];
  if (!base) throw new Error(`fs ${id}: no preview url`);
  const ogg = base.replace(/-[hl]q\.(mp3|ogg)$/, '-hq.ogg');
  const res = await fetch(ogg, { headers: UA });
  if (!res.ok) throw new Error(`fs ${id}: preview HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(out, buf);
  return out;
}

if (import.meta.main) {
  mkdirSync(CACHE, { recursive: true });
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'search') for (const q of args) await search(q);
  else if (cmd === 'fetch') {
    const seen = new Set<number>();
    for (const s of SOURCES) {
      if (s.origin.kind !== 'freesound' || seen.has(s.origin.id)) continue;
      seen.add(s.origin.id);
      try {
        console.log('ok', s.origin.id, await fetchSound(s.origin.id, s.origin.user));
      } catch (e) {
        console.error('FAIL', s.origin.id, String(e));
      }
    }
  } else console.log('usage: freesound.ts search <q...> | fetch');
}
