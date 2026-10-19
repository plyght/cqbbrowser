import { describe, expect, test } from 'bun:test';
import { defaultBuild, PLATFORMS, validateBuild, type WeaponId } from '../weapons/attachments';
import { WEAPONS } from '../weapons/defs';
import {
  ammoOptions,
  buildStats,
  CARRIERS,
  deltaSign,
  fitGear,
  kitStats,
  LOADOUT_PRESETS,
  loadoutDefs,
  loadoutKey,
  LoadoutStore,
  PRIMARY_WEAPONS,
  randomBuild,
  sanitizeLoadout,
  slotOptions,
  STATS,
  tryPart,
  validateLoadout,
  type StorageLike,
} from '.';

const mem = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('loadout model', () => {
  test('every preset validates', () => {
    for (const p of LOADOUT_PRESETS) expect(validateLoadout(p)).toEqual([]);
    const names = LOADOUT_PRESETS.map((p) => p.name);
    for (const n of ['CQB SBR', 'Quiet PDW', 'Krink', 'Pistol only']) expect(names).toContain(n);
  });

  test('standard preset equips exactly the default defs', () => {
    const defs = loadoutDefs(LOADOUT_PRESETS[0]);
    expect(defs.map((d) => d.id)).toEqual(['sb16', 'p17']);
    expect(defs[0].model).toBe(WEAPONS.sb16.model);
    expect(defs[0].spareMags).toBe(4);
    expect(defs[1].spareMags).toBe(2);
  });

  test('pouch counts drive spare mags; ammo carries into the def', () => {
    const quiet = LOADOUT_PRESETS.find((p) => p.id === 'quiet-pdw')!;
    const [pdw, pistol] = loadoutDefs(quiet);
    expect(pdw.spareMags).toBe(3);
    expect(pdw.build?.params?.ammo).toBe('blk220');
    expect(pdw.velocity).toBeLessThan(340); // subsonic
    expect(pistol.slot).toBe('sidearm');
    const only = LOADOUT_PRESETS.find((p) => p.id === 'pistol-only')!;
    expect(loadoutDefs(only).map((d) => d.slot)).toEqual(['sidearm']);
  });

  test('validation catches bad weapons, empty kit and over-full pouches', () => {
    const base = structuredClone(LOADOUT_PRESETS[0]);
    expect(validateLoadout({ ...base, primary: defaultBuild('p17') })[0].where).toBe('primary');
    expect(validateLoadout({ ...base, primary: null, sidearm: null }).length).toBeGreaterThan(0);
    const full = validateLoadout({ ...base, gear: { ...base.gear, carrier: 'slick', rifleMags: 5 } });
    expect(full[0].where).toBe('gear');
    const bad = { ...base, primary: { ...defaultBuild('sb16'), parts: { barrel: 'nope' } } };
    expect(validateLoadout(bad).some((e) => e.where === 'primary' && /unknown part/.test(e.message))).toBe(
      true,
    );
  });

  test('sanitize repairs persisted junk', () => {
    expect(sanitizeLoadout(null)).toBeNull();
    expect(sanitizeLoadout({ name: 'x' })).toBeNull();
    const l = sanitizeLoadout({
      id: 'a',
      name: '  ',
      primary: { v: 1, weapon: 'sb16', parts: { barrel: 'removed_part' } },
      sidearm: { v: 1, weapon: 'sb16', parts: {} },
      gear: { carrier: 'slick', rifleMags: 9, flashbangs: -2 },
    })!;
    expect(l.name).toBe('Loadout');
    expect(l.primary).toEqual(defaultBuild('sb16'));
    expect(l.sidearm?.weapon).toBe('p17');
    expect(l.gear.rifleMags).toBe(CARRIERS.slick.rifleSlots);
    expect(l.gear.flashbangs).toBe(0);
    expect(validateLoadout(l)).toEqual([]);
    expect(fitGear({ ...l.gear, carrier: 'chest', rifleMags: 6 }).rifleMags).toBe(6);
  });

  test('loadoutKey ignores the name', () => {
    const a = LOADOUT_PRESETS[1];
    expect(loadoutKey({ ...a, name: 'other' })).toBe(loadoutKey(a));
    expect(loadoutKey(LOADOUT_PRESETS[2])).not.toBe(loadoutKey(a));
  });
});

describe('store', () => {
  test('seeds presets, persists edits, keeps an active id', () => {
    const s = mem();
    const st = new LoadoutStore(s, 'k');
    expect(st.list().length).toBe(LOADOUT_PRESETS.length);
    expect(st.active().id).toBe('standard');
    const n = st.create(LOADOUT_PRESETS[1]);
    expect(n.name).toBe('CQB SBR (2)');
    st.rename(n.id, '  Room clearer  ');
    st.setActive(n.id);
    st.update(n.id, { ...st.get(n.id)!, gear: { ...n.gear, rifleMags: 2 } });
    const again = new LoadoutStore(s, 'k');
    expect(again.active().name).toBe('Room clearer');
    expect(again.active().gear.rifleMags).toBe(2);
    const d = again.duplicate(n.id)!;
    expect(again.list().indexOf(again.get(d.id)!)).toBe(again.list().indexOf(again.get(n.id)!) + 1);
    expect(d.name).toBe('Room clearer (2)');
  });

  test('delete never empties the list and moves the active id', () => {
    const st = new LoadoutStore(mem(), 'k');
    for (const l of [...st.list()]) st.remove(l.id);
    expect(st.list().length).toBe(1);
    expect(st.active().id).toBe(st.list()[0].id);
    st.restorePresets();
    expect(st.list().length).toBe(LOADOUT_PRESETS.length);
  });

  test('corrupt storage falls back to presets; throwing storage is tolerated', () => {
    const s = mem();
    s.setItem('k', '{not json');
    expect(new LoadoutStore(s, 'k').list().length).toBe(LOADOUT_PRESETS.length);
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const st = new LoadoutStore(boom, 'k');
    expect(() => st.setActive('krink')).not.toThrow();
    expect(st.activeId).toBe('krink');
  });
});

describe('options', () => {
  test('a shorter barrel auto-swaps a too-long handguard', () => {
    const d = defaultBuild('sb16');
    const b = { ...d, parts: { ...d.parts, barrel: 'ar_b145', handguard: 'ar_hg_mlok13' } };
    expect(validateBuild(b)).toEqual([]);
    const r = tryPart(b, 'barrel', 'ar_b103');
    expect(r.ok).toBe(true);
    expect(r.changes.map((c) => c.slot)).toEqual(['handguard']);
    expect(validateBuild(r.build)).toEqual([]);
  });

  test('missing dependencies stay disabled with the validator reason', () => {
    const ak = defaultBuild('k47s');
    const lpvo = slotOptions(ak, 'optic').find((o) => o.part.id === 'opt_lpvo')!;
    expect(lpvo.result.ok).toBe(false);
    expect(lpvo.result.reason).toBeTruthy();
    expect(slotOptions(ak, 'optic').filter((o) => o.current).length).toBe(1);
  });

  test('ammo options show per-barrel velocity', () => {
    const o = ammoOptions(defaultBuild('hb300'));
    expect(o.map((x) => x.id).sort()).toEqual(['blk110', 'blk220']);
    expect(o.find((x) => x.id === 'blk220')!.subsonic).toBe(true);
  });

  test('random builds are valid and seeded', () => {
    for (const w of Object.keys(PLATFORMS) as WeaponId[])
      for (let s = 1; s < 12; s++) expect(validateBuild(randomBuild(w, s * 7919))).toEqual([]);
    expect(randomBuild('sb16', 42)).toEqual(randomBuild('sb16', 42));
  });
});

describe('stats', () => {
  test('stats are finite and inside their bar ranges for presets', () => {
    for (const p of LOADOUT_PRESETS)
      for (const b of [p.primary, p.sidearm]) {
        if (!b) continue;
        const v = buildStats(b)!;
        for (const d of STATS) {
          expect(Number.isFinite(v[d.id])).toBe(true);
          expect(v[d.id]).toBeGreaterThanOrEqual(d.range[0] * 0.9);
          expect(v[d.id]).toBeLessThanOrEqual(d.range[1] * 1.1);
        }
      }
  });

  test('suppressor: heavier (worse) and longer', () => {
    const base = defaultBuild('sb16');
    const supp = tryPart(base, 'muzzle', 'ar_supp').build;
    const a = buildStats(base)!,
      b = buildStats(supp)!;
    const mass = STATS.find((s) => s.id === 'mass')!;
    expect(deltaSign(mass, a.mass, b.mass)).toBe(-1);
    expect(b.length).toBeGreaterThan(a.length);
  });

  test('kit totals', () => {
    const k = kitStats(LOADOUT_PRESETS[0]);
    expect(k.rifleRounds).toBe(30 * 5 + 1);
    expect(k.pistolRounds).toBe(17 * 3 + 1);
    expect(k.mass).toBeGreaterThan(10);
    expect(PRIMARY_WEAPONS).not.toContain('p17');
  });
});
