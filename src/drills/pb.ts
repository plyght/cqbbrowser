import { isBetter, type Medal, type Method } from './scoring';

export interface PersonalBest {
  final: number;
  time: number;
  medal: Medal | null;
  date: string;
}

const KEY = 'shortbarrel.pb.v1';

/** Personal bests per drill in localStorage (works without storage: falls back to memory). */
export class PBStore {
  private data: Record<string, PersonalBest> = {};

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    try {
      this.data = JSON.parse(this.storage?.getItem(KEY) ?? '{}') ?? {};
    } catch {
      this.data = {};
    }
  }

  get(id: string): PersonalBest | undefined {
    return this.data[id];
  }

  /** Record a result; returns true if it's a new personal best. */
  submit(id: string, method: Method, pb: PersonalBest): boolean {
    if (method === 'none') return false;
    if (!isBetter(method, pb.final, this.data[id]?.final)) return false;
    this.data[id] = pb;
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage blocked / full — keep in memory */
    }
    return true;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
