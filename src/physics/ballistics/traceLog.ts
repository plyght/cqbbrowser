/**
 * Ring buffer of the last N trajectories (polylines + terminal events) for the `?ballistics` debug view and
 * tests. Preallocated typed arrays: recording costs no allocation.
 */

export type TraceEvent = 'exit' | 'ricochet' | 'stop' | 'steel' | 'spall';
const KINDS: TraceEvent[] = ['exit', 'ricochet', 'stop', 'steel', 'spall'];

export const TRACES = 24;
const MAX_PTS = 64;
const MAX_EV = 24;

export class TraceLog {
  /** Bumps on every change (debug view rebuilds lazily). */
  version = 0;
  readonly pts = new Float32Array(TRACES * MAX_PTS * 3);
  readonly npts = new Int32Array(TRACES);
  /** Per event: kind, x, y, z, dx, dy, dz, index of the last polyline point before it. */
  readonly ev = new Float32Array(TRACES * MAX_EV * 8);
  readonly nev = new Int32Array(TRACES);
  readonly ammo: string[] = new Array(TRACES).fill('');
  readonly v0 = new Float32Array(TRACES);
  readonly done = new Uint8Array(TRACES);
  private head = 0;
  count = 0;

  begin(x: number, y: number, z: number, ammo: string, v0: number): number {
    const i = this.head;
    this.head = (this.head + 1) % TRACES;
    this.count = Math.min(TRACES, this.count + 1);
    this.npts[i] = 0;
    this.nev[i] = 0;
    this.ammo[i] = ammo;
    this.v0[i] = v0;
    this.done[i] = 0;
    this.point(i, x, y, z);
    return i;
  }

  point(i: number, x: number, y: number, z: number) {
    if (i < 0) return;
    const n = this.npts[i];
    if (n >= MAX_PTS) return;
    const o = (i * MAX_PTS + n) * 3;
    this.pts[o] = x;
    this.pts[o + 1] = y;
    this.pts[o + 2] = z;
    this.npts[i] = n + 1;
    this.version++;
  }

  event(
    i: number,
    kind: TraceEvent,
    p: { x: number; y: number; z: number },
    d?: { x: number; y: number; z: number },
  ) {
    if (i < 0) return;
    const n = this.nev[i];
    if (n >= MAX_EV) return;
    const o = (i * MAX_EV + n) * 8;
    this.ev[o] = KINDS.indexOf(kind);
    this.ev[o + 1] = p.x;
    this.ev[o + 2] = p.y;
    this.ev[o + 3] = p.z;
    this.ev[o + 4] = d?.x ?? 0;
    this.ev[o + 5] = d?.y ?? 0;
    this.ev[o + 6] = d?.z ?? 0;
    this.ev[o + 7] = this.npts[i] - 1;
    this.nev[i] = n + 1;
    this.version++;
  }

  end(i: number) {
    if (i >= 0) this.done[i] = 1;
  }

  /** Oldest → newest trace indices. */
  order(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.count; k++) out.push((this.head - this.count + k + TRACES) % TRACES);
    return out;
  }

  pointAt(i: number, k: number): [number, number, number] {
    const o = (i * MAX_PTS + k) * 3;
    return [this.pts[o], this.pts[o + 1], this.pts[o + 2]];
  }

  eventAt(i: number, k: number) {
    const o = (i * MAX_EV + k) * 8;
    const e = this.ev;
    return {
      kind: KINDS[e[o]],
      at: [e[o + 1], e[o + 2], e[o + 3]] as [number, number, number],
      dir: [e[o + 4], e[o + 5], e[o + 6]] as [number, number, number],
      after: e[o + 7],
    };
  }

  /** JSON-friendly summary (tests / console). */
  summary() {
    return this.order().map((i) => ({
      ammo: this.ammo[i],
      v0: this.v0[i],
      done: !!this.done[i],
      points: Array.from({ length: this.npts[i] }, (_, k) => this.pointAt(i, k)),
      events: Array.from({ length: this.nev[i] }, (_, k) => this.eventAt(i, k)),
    }));
  }

  clear() {
    this.count = 0;
    this.version++;
  }
}
