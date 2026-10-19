import type { ClipEvent } from '../rig/clipData';

/**
 * Event detection and timeline splitting from per-frame part tracks. Pure functions over plain arrays, used by
 * the offline baker (tools/anim/build.ts) and unit-tested with synthetic tracks.
 */

export interface MagSeries {
  /** Distance (m) of the mag from its seated pose in the weapon frame, per frame. */
  dist: ArrayLike<number>;
  /** 1 when the mag exists/visible near the weapon or hand. */
  vis?: ArrayLike<number>;
}

export interface DetectInput {
  fps: number;
  mags: MagSeries[];
  /** Bolt/slide travel, 0 forward .. 1 locked back (may overshoot when racked). */
  bolt?: ArrayLike<number>;
  trigger?: ArrayLike<number>;
  /** Which hand racks/releases (affects naming only). */
  platform: 'rifle' | 'pistol';
}

const SEATED = 0.004;
const OUT = 0.05;

/** Contact events of a reload/shoot clip, in seconds. */
export function detectEvents(inp: DetectInput): ClipEvent[] {
  const ev: ClipEvent[] = [];
  const T = (f: number) => +(f / inp.fps).toFixed(4);
  // Mag leaving: the first mag that starts seated and moves out.
  for (const m of inp.mags) {
    const d = m.dist;
    if (!(d.length && d[0] < SEATED)) continue;
    let rel = -1;
    for (let f = 1; f < d.length; f++)
      if (d[f] > SEATED && d[f - 1] <= SEATED) {
        rel = f - 1;
        break;
      }
    if (rel < 0) continue;
    ev.push({ name: 'magRelease', t: T(rel) });
    for (let f = rel; f < d.length; f++)
      if (d[f] > OUT) {
        ev.push({ name: 'magOut', t: T(f) });
        break;
      }
    break;
  }
  // Mag arriving: the last approach from outside to inside OUT, then seat.
  let inF = -1;
  let inMag = -1;
  inp.mags.forEach((m, mi) => {
    const d = m.dist;
    for (let f = 1; f < d.length; f++) {
      const visible = !m.vis || m.vis[f] > 0.5;
      // Approach from close by (not a teleport of a parked mag).
      if (visible && d[f] <= OUT && d[f - 1] > OUT && d[f - 1] < 0.25 && f > inF) {
        inF = f;
        inMag = mi;
      }
    }
  });
  if (inF >= 0) {
    ev.push({ name: 'magIn', t: T(inF) });
    const d = inp.mags[inMag].dist;
    for (let f = inF; f < d.length; f++)
      if (d[f] <= SEATED) {
        ev.push({ name: 'magSeat', t: T(f) });
        break;
      }
  }
  // Bolt / slide: racks (pull from forward past 0.6) and releases (from back to forward).
  const b = inp.bolt;
  if (b && b.length) {
    const trig = inp.trigger;
    const firedNear = (f: number) => {
      if (!trig) return false;
      for (let k = Math.max(0, f - 3); k <= Math.min(trig.length - 1, f + 1); k++)
        if (trig[k] > 0.4) return true;
      return false;
    };
    for (let f = 1; f < b.length; f++) {
      if (b[f] >= 0.6 && b[f - 1] < 0.6 && !firedNear(f)) {
        let s = f - 1;
        while (s > 0 && b[s - 1] < b[s] && b[s] > 0.02) s--;
        ev.push({ name: 'chargingHandle', t: T(s) });
      }
      if (b[f] <= 0.3 && b[f - 1] > 0.3 && !firedNear(f)) {
        // Released from locked-back (no hand pulling the whole time): slide/bolt release.
        ev.push({ name: inp.platform === 'pistol' ? 'slideRelease' : 'boltRelease', t: T(f) });
      }
    }
  }
  if (inp.trigger) {
    const t = inp.trigger;
    for (let f = 1; f < t.length; f++) if (t[f] >= 0.5 && t[f - 1] < 0.5) ev.push({ name: 'fire', t: T(f) });
  }
  return ev.sort((a, b) => a.t - b.t);
}

export interface Segment {
  label: string;
  f0: number;
  f1: number;
}

export interface SplitInput {
  /** Per-frame distance (m) of the hands from the timeline's rest (idle) pose: max of both wrists. */
  restDist: ArrayLike<number>;
  trigger: ArrayLike<number>;
  bolt: ArrayLike<number>;
  magDist: ArrayLike<number>;
  /** Rest threshold (m) and the shortest run that counts as idle (frames). */
  restEps?: number;
  minRest?: number;
}

/**
 * Split a back-to-back action timeline (the Beretta pack's single "Scene" clip) into named clips:
 * rest runs become `idle`, the first active block `draw`, the last `holster`, blocks with a mag out/in
 * `reloadEmpty` (bolt locked back at the start) or `reloadTactical`, trigger pulses `shoot` (`shootLast` when
 * the slide stays locked), anything else `inspect`.
 */
export function splitTimeline(inp: SplitInput): Segment[] {
  const n = inp.restDist.length;
  const eps = inp.restEps ?? 0.012;
  const minRest = inp.minRest ?? 6;
  // Shots: trigger pulses become their own segments (they happen at rest, hands barely move).
  const shots: [number, number][] = [];
  for (let f = 1; f < n; f++)
    if (inp.trigger[f] >= 0.5 && inp.trigger[f - 1] < 0.5) {
      const a = Math.max(0, f - 2);
      let b = f + 1;
      while (b < n - 1 && b - f < 12 && (inp.trigger[b] > 0.05 || inp.bolt[b] > 0.05)) b++;
      // A locked-back slide never returns: end the shot shortly after the pulse.
      if (inp.bolt[b] > 0.5) b = Math.min(n - 1, f + 6);
      shots.push([a, b]);
    }
  const inShot = (f: number) => shots.some(([a, b]) => f >= a && f <= b);
  const rest: boolean[] = [];
  for (let f = 0; f < n; f++) rest.push(inp.restDist[f] < eps && inp.magDist[f] < 0.004 && !inShot(f));
  // Rest runs ≥ minRest frames.
  const runs: [number, number][] = [];
  for (let f = 0; f < n;) {
    if (!rest[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g + 1 < n && rest[g + 1]) g++;
    if (g - f + 1 >= minRest) runs.push([f, g]);
    f = g + 1;
  }
  const segs: Segment[] = [];
  // Active blocks between rest runs (a block that is just a shot window is the shot itself).
  const blocks: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of runs) {
    if (a > cur) blocks.push([cur, a]);
    cur = b;
  }
  if (cur < n - 1) blocks.push([cur, n - 1]);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const [a, b] = blocks[i];
    let active = false;
    for (let f = a + 1; f < b; f++) if (!inShot(f)) active = true;
    if (!active) blocks.splice(i, 1);
  }
  const lockedAt = (f: number) => inp.bolt[Math.min(n - 1, Math.max(0, f))] > 0.5;
  for (const [a, b] of blocks) {
    let magMoves = false;
    let firstMove = -1;
    for (let f = a; f <= b; f++) {
      if (inp.magDist[f] > 0.05) magMoves = true;
      if (firstMove < 0 && inp.magDist[f] > 0.004) firstMove = f;
    }
    // A short recoil settle right after a shot belongs to the shot.
    if (!magMoves && b - a < 24 && shots.some(([sa, sb]) => sa <= b && sb >= a)) continue;
    let label: string;
    if (a === 0) label = 'draw';
    else if (b === n - 1) label = 'holster';
    else if (magMoves) label = lockedAt(firstMove) ? 'reloadEmpty' : 'reloadTactical';
    else label = 'inspect';
    segs.push({ label, f0: a, f1: b });
  }
  for (const [a, b] of shots) segs.push({ label: lockedAt(b) ? 'shootLast' : 'shoot', f0: a, f1: b });
  // Longest rest run → idle.
  let best: [number, number] | undefined;
  for (const r of runs) if (!best || r[1] - r[0] > best[1] - best[0]) best = r;
  if (best) segs.push({ label: 'idle', f0: best[0], f1: best[1] });
  return segs.sort((x, y) => x.f0 - y.f0);
}

/** Moving-average smoothing (window 2r+1), for weight channels. */
export function smooth(a: ArrayLike<number>, r: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= a.length) continue;
      s += a[j];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}
