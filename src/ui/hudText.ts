/** Pure text helpers for the minimal HUD (unit-tested). */

export type Pip = 'full' | 'half' | 'empty';

/** Spare-mag pips: filled = full, half = partial, outline = empty. */
export function pips(spares: { rounds: number; capacity: number }[]): Pip[] {
  return spares.map((s) => (s.rounds >= s.capacity ? 'full' : s.rounds > 0 ? 'half' : 'empty'));
}

/** Corner weapon toast, e.g. "HB-300 · AUTO". */
export function weaponLabel(name: string, mode: string): string {
  return `${name.split(' ')[0]} · ${mode.toUpperCase()}`;
}

export interface Posture {
  lean: number;
  crouch: number;
  ready: string;
}

/** Quantised posture key (changes trigger the bottom-left toast). */
export function postureKey(p: Posture): string {
  const lean = p.lean > 0.5 ? 'R' : p.lean < -0.5 ? 'L' : '';
  return `${lean}|${p.crouch > 0.5 ? 'C' : 'S'}|${p.ready}`;
}

/** e.g. "LEAN R · CROUCH · LOW READY". */
export function postureLabel(p: Posture): string {
  const parts: string[] = [];
  if (p.lean > 0.5) parts.push('LEAN R');
  else if (p.lean < -0.5) parts.push('LEAN L');
  parts.push(p.crouch > 0.5 ? 'CROUCH' : 'STAND');
  parts.push(`${p.ready.toUpperCase()} READY`);
  return parts.join(' · ');
}
