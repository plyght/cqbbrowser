/**
 * Clip-data audit (no rig playback): for every weapon × composed clip, at the clip's own 30 fps — the largest
 * per-frame bone rotation step and its second difference, loop seams (last vs first frame), and jumps of the
 * blend channels (anchor weights, gunW, mag weights). `bun tools/clip-audit.ts [weapon]`.
 */
import { AUDIT_WEAPONS, loadHeadlessRig } from '../src/anim/contact/audit';
import { ACTIONS } from '../src/anim/library/library';

const rig = await loadHeadlessRig();
const DEG = 180 / Math.PI;
const weapons = process.argv[2] ? [process.argv[2]] : AUDIT_WEAPONS;
const ang = (d: Float32Array, a: number, b: number) => {
  const dot = Math.abs(d[a] * d[b] + d[a + 1] * d[b + 1] + d[a + 2] * d[b + 2] + d[a + 3] * d[b + 3]);
  return 2 * Math.acos(Math.min(1, dot)) * DEG;
};
for (const w of weapons) {
  const clips = rig.clipsFor(w);
  for (const a of ACTIONS) {
    const c = clips[a];
    const L = c.layout;
    const S = L.stride;
    let maxStep = 0,
      stepAt = '',
      maxAcc = 0,
      accAt = '';
    for (let bi = 0; bi < L.bones.length; bi++) {
      const o = L.rot + bi * 4;
      let prev = -1;
      for (let f = 1; f < c.frames; f++) {
        const s = ang(c.data, (f - 1) * S + o, f * S + o);
        if (s > maxStep) {
          maxStep = s;
          stepAt = `${L.bones[bi]}@${f}`;
        }
        if (prev >= 0 && Math.abs(s - prev) > maxAcc) {
          maxAcc = Math.abs(s - prev);
          accAt = `${L.bones[bi]}@${f}`;
        }
        prev = s;
      }
    }
    let seam = 0,
      seamAt = '';
    if (c.loop)
      for (let bi = 0; bi < L.bones.length; bi++) {
        const s = ang(c.data, L.rot + bi * 4, (c.frames - 1) * S + L.rot + bi * 4);
        if (s > seam) {
          seam = s;
          seamAt = L.bones[bi];
        }
      }
    const chans: [string, number][] = [
      ['gunW', L.gunW],
      ['wL.grip', L.wL.grip],
      ['wL.well', L.wL.well],
      ['wL.charge', L.wL.charge],
      ['wR.grip', L.wR.grip],
      ['mag0.w', L.mag[0].w],
    ];
    const jumps: string[] = [];
    for (const [n, o] of chans) {
      let m = 0,
        at = 0;
      for (let f = 1; f < c.frames; f++) {
        const d = Math.abs(c.data[f * S + o] - c.data[(f - 1) * S + o]);
        if (d > m) {
          m = d;
          at = f;
        }
      }
      if (m > 0.2) jumps.push(`${n} ${m.toFixed(2)}@${at}`);
    }
    // Additive clips: how far the last frame is from the first (the layer drops when the clip ends).
    let addEnd = 0;
    if (c.additive)
      for (let bi = 0; bi < L.bones.length; bi++)
        addEnd = Math.max(addEnd, ang(c.data, L.rot + bi * 4, (c.frames - 1) * S + L.rot + bi * 4));
    console.log(
      `${w.padEnd(6)} ${a.padEnd(15)} n=${String(c.frames).padStart(3)} ${c.loop ? 'loop' : c.additive ? 'add ' : c.holdLast ? 'hold' : '    '} step ${maxStep.toFixed(1).padStart(5)}° ${stepAt.padEnd(22)} Δstep ${maxAcc.toFixed(1).padStart(5)}° ${accAt.padEnd(22)}${c.loop ? ` seam ${seam.toFixed(2)}° ${seamAt}` : ''}${c.additive ? ` end≠start ${addEnd.toFixed(2)}°` : ''} ${jumps.join(' ')}`,
    );
  }
}
