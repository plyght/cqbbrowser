/**
 * Typed, persisted settings store. Systems register defaults under a namespace and subscribe to changes.
 * Example: const s = settings.ns('input.gamepad', { deadzone: 0.08 }); s.get().deadzone; s.set({ deadzone: 0.1 });
 */
type Listener<T> = (v: T) => void;

const KEY = 'shortbarrel.settings.v1';

class Store {
  private data: Record<string, Record<string, unknown>> = {};
  private listeners = new Map<string, Set<Listener<never>>>();

  constructor() {
    try {
      this.data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      this.data = {};
    }
  }

  ns<T extends Record<string, unknown>>(name: string, defaults: T) {
    const merged = { ...defaults, ...(this.data[name] as Partial<T> | undefined) } as T;
    this.data[name] = merged;
    return {
      get: () => this.data[name] as T,
      set: (patch: Partial<T>) => {
        this.data[name] = { ...(this.data[name] as T), ...patch };
        this.save();
        for (const fn of this.listeners.get(name) ?? []) (fn as Listener<T>)(this.data[name] as T);
      },
      reset: () => {
        this.data[name] = { ...defaults };
        this.save();
        for (const fn of this.listeners.get(name) ?? []) (fn as Listener<T>)(this.data[name] as T);
      },
      onChange: (fn: Listener<T>) => {
        let set = this.listeners.get(name);
        if (!set) this.listeners.set(name, (set = new Set()));
        set.add(fn as Listener<never>);
        return () => set!.delete(fn as Listener<never>);
      },
      defaults,
    };
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / blocked storage — settings stay in memory */
    }
  }
}

export const settings = new Store();
