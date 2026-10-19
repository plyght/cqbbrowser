/**
 * Saved loadouts: unlimited, local (PRD §2.5), plus the active one. Persisted under its own localStorage key
 * (loadouts are data, not settings). Every read is sanitized so stale/removed parts can't break boot.
 */
import { LOADOUT_PRESETS, NAME_MAX, sanitizeLoadout, type Loadout } from './model';

export const LOADOUT_KEY = 'shortbarrel.loadouts.v1';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

interface Saved {
  active: string;
  list: Loadout[];
}

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* blocked storage */
  }
  return memory();
}

let counter = 0;
const newId = () => `lo-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class LoadoutStore {
  private data: Saved;
  private listeners = new Set<() => void>();

  constructor(
    private storage: StorageLike = defaultStorage(),
    private key = LOADOUT_KEY,
  ) {
    this.data = this.load();
  }

  private load(): Saved {
    let raw: Partial<Saved> | null = null;
    try {
      raw = JSON.parse(this.storage.getItem(this.key) ?? 'null');
    } catch {
      raw = null;
    }
    const list = (Array.isArray(raw?.list) ? raw.list : [])
      .map(sanitizeLoadout)
      .filter((l): l is Loadout => !!l);
    const seen = new Set<string>();
    const unique = list.filter((l) => !seen.has(l.id) && seen.add(l.id));
    const out: Saved = {
      active: '',
      list: unique.length ? unique : LOADOUT_PRESETS.map((p) => structuredClone(p)),
    };
    out.active = out.list.some((l) => l.id === raw?.active) ? raw!.active! : out.list[0].id;
    return out;
  }

  private save() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* private mode / quota: loadouts stay in memory */
    }
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): readonly Loadout[] {
    return this.data.list;
  }

  get(id: string): Loadout | undefined {
    return this.data.list.find((l) => l.id === id);
  }

  get activeId() {
    return this.data.active;
  }

  active(): Loadout {
    return this.get(this.data.active) ?? this.data.list[0];
  }

  setActive(id: string) {
    if (!this.get(id) || id === this.data.active) return;
    this.data.active = id;
    this.save();
  }

  /** Replace a loadout's contents (sanitized; id is kept). */
  update(id: string, next: Omit<Loadout, 'id'>) {
    const i = this.data.list.findIndex((l) => l.id === id);
    if (i < 0) return;
    const clean = sanitizeLoadout({ ...structuredClone(next), id });
    if (!clean) return;
    this.data.list[i] = clean;
    this.save();
  }

  /** New loadout copied from a template (default: the first built-in preset). */
  create(from: Omit<Loadout, 'id'> = LOADOUT_PRESETS[0], name?: string): Loadout {
    const l = sanitizeLoadout({
      ...structuredClone(from),
      id: newId(),
      name: name ?? this.uniqueName(from.name),
    })!;
    this.data.list.push(l);
    this.save();
    return l;
  }

  duplicate(id: string): Loadout | undefined {
    const src = this.get(id);
    if (!src) return undefined;
    const l = sanitizeLoadout({ ...structuredClone(src), id: newId(), name: this.uniqueName(src.name) })!;
    this.data.list.splice(this.data.list.indexOf(src) + 1, 0, l);
    this.save();
    return l;
  }

  rename(id: string, name: string) {
    const l = this.get(id);
    const n = name.trim().slice(0, NAME_MAX);
    if (!l || !n || n === l.name) return;
    l.name = n;
    this.save();
  }

  /** Delete; the list never becomes empty (the last one resets to the standard preset). Returns the next id. */
  remove(id: string): string {
    const i = this.data.list.findIndex((l) => l.id === id);
    if (i < 0) return this.data.active;
    this.data.list.splice(i, 1);
    if (!this.data.list.length) this.data.list.push(structuredClone(LOADOUT_PRESETS[0]));
    const next = this.data.list[Math.min(i, this.data.list.length - 1)].id;
    if (this.data.active === id) this.data.active = next;
    this.save();
    return next;
  }

  /** Bring back any built-in preset that was deleted (and reset ones that were edited). */
  restorePresets() {
    for (const p of LOADOUT_PRESETS) {
      const i = this.data.list.findIndex((l) => l.id === p.id);
      if (i >= 0) this.data.list[i] = structuredClone(p);
      else this.data.list.push(structuredClone(p));
    }
    this.save();
  }

  private uniqueName(base: string) {
    const root = base.replace(/ \(\d+\)$/, '').slice(0, NAME_MAX - 4);
    const names = new Set(this.data.list.map((l) => l.name));
    if (!names.has(root)) return root;
    for (let n = 2; ; n++) if (!names.has(`${root} (${n})`)) return `${root} (${n})`;
  }
}

let shared: LoadoutStore | null = null;
/** The app-wide store (menu + game share it). */
export function loadouts(): LoadoutStore {
  return (shared ??= new LoadoutStore());
}
