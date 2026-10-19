/** Real magazine inventory: every mag tracks its own count. */
export interface Mag {
  id: number;
  rounds: number;
  capacity: number;
}

export class Magazines {
  inGun: Mag | null;
  pouches: Mag[] = [];
  /** Partial mags retained in the dump pouch. */
  dump: Mag[] = [];
  chambered = false;
  private nextId = 1;

  constructor(
    public capacity: number,
    spare: number,
  ) {
    this.inGun = this.make(capacity);
    this.chambered = true;
    for (let i = 0; i < spare; i++) this.pouches.push(this.make(capacity));
  }

  private make(rounds: number): Mag {
    return { id: this.nextId++, rounds, capacity: this.capacity };
  }

  get rounds(): number {
    return (this.inGun?.rounds ?? 0) + (this.chambered ? 1 : 0);
  }

  /** Consume one round; returns false on empty (dry fire). Chamber is fed from the mag. */
  fire(): boolean {
    if (!this.chambered) return false;
    this.chambered = false;
    if (this.inGun && this.inGun.rounds > 0) {
      this.inGun.rounds--;
      this.chambered = true;
    }
    return true;
  }

  get empty(): boolean {
    return !this.chambered;
  }

  /** All mags not in the gun, fullest first. */
  spares(): Mag[] {
    return [...this.pouches, ...this.dump].filter((m) => m.rounds > 0).sort((a, b) => b.rounds - a.rounds);
  }

  hasSpare(): boolean {
    return this.spares().length > 0;
  }

  /**
   * Swap mags. `retain` keeps the outgoing mag (tactical); otherwise it is dropped and returned.
   * Returns the dropped mag (for the floor), or null.
   */
  swap(retain: boolean, pickFullest = true): Mag | null {
    const pool = pickFullest ? this.spares() : [...this.pouches, ...this.dump].filter((m) => m.rounds > 0);
    const fresh = pool[0];
    if (!fresh) return null;
    this.pouches = this.pouches.filter((m) => m !== fresh);
    this.dump = this.dump.filter((m) => m !== fresh);
    const out = this.inGun;
    this.inGun = fresh;
    let dropped: Mag | null = null;
    if (out) {
      if (retain && out.rounds > 0) this.dump.push(out);
      else dropped = out;
    }
    return dropped;
  }

  /** Bolt/slide release after an empty reload. */
  chamber() {
    if (!this.chambered && this.inGun && this.inGun.rounds > 0) {
      this.inGun.rounds--;
      this.chambered = true;
    }
  }
}
