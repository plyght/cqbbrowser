import { readFileSync } from 'node:fs';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { ArmsAction } from '../library/library';
import type { ArmsRig } from '../rig/ArmsRig';
import type { ClipsFile } from '../rig/clipData';
import type { HandContact } from './HandContact';
import { FINGERS, PALM, WRIST, type HandProxy } from './handProxy';

/**
 * Headless hand–weapon contact audit (bun): plays every clip of every weapon at 60 Hz on the real ArmsRig and
 * measures the deepest penetration of any hand proxy into the weapon's collision set (dense sampling: 7 points
 * per phalanx, 9 × 7 palm grid, wrist), plus wrap gaps at idle. Used by tools/contact-audit.ts and the CI test.
 * Weapon-agnostic: the weapon's collision comes from `model.collision` or the mesh fit.
 */

export const AUDIT_WEAPONS = ['k47s', 'sb16', 'hb300', 'kp9', 'p17'];
export const AUDIT_CLIPS: ArmsAction[] = [
  'idle',
  'shoot',
  'shootLast',
  'reloadTactical',
  'reloadEmpty',
  'magCheck',
  'swapOut',
  'swapIn',
  'inspect',
];

export interface ClipRow {
  weapon: string;
  clip: string;
  frames: number;
  /** Max penetration (m) and the proxy / shape pair. */
  max: number;
  pair: string;
  /** Fractions of frames with penetration > 2 mm / > 1 mm. */
  over2: number;
  over1: number;
  /** Idle only: worst wrap gap of the firing hand's middle/ring/pinky on the grip, support hand gap (m). */
  gripGap?: number;
  /** Idle: firing palm to the grip (backstrap), and each firing finger's gap (T, I, M, R, P), m. */
  palmGap?: number;
  fingerGaps?: number[];
  supportGap?: number;
  /** Mean solver cost (ms/frame) when resolving. */
  ms?: number;
}

/** Load the rig from disk (clips.json + the AK glb), with plain materials. */
export async function loadHeadlessRig(): Promise<ArmsRig> {
  const { installHeadlessCanvas } = await import('../grip/headlessDom');
  installHeadlessCanvas();
  const { ArmsRig } = await import('../rig/ArmsRig');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const file = JSON.parse(readFileSync('public/assets/anims/clips.json', 'utf8')) as ClipsFile;
  const buf = readFileSync('public/assets/models/ak74u/ak74u.glb');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // The source glb references embedded textures we don't need headless: silence the loader's warnings.
  const warn = console.warn;
  console.warn = () => {};
  const gltf = await new Promise<{ scene: import('three').Object3D }>((res, rej) =>
    loader.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      '',
      res,
      rej,
    ),
  ).finally(() => (console.warn = warn));
  return ArmsRig.fromData(file, gltf.scene, {
    gloves: new MeshBasicMaterial(),
    sleeves: new MeshBasicMaterial(),
  });
}

const _p = new Vector3();

/** Dense measurement of one hand against the collision set (contact must be `sync()`ed). */
export function measureHand(
  c: HandContact,
  h: HandProxy,
): { pen: number; pair: string; gaps: number[]; palmGap: number } {
  let pen = -Infinity;
  let pair = '';
  const col = c.col!;
  // The firing hand is an obstacle only for the support hand (hand↔hand).
  const skip = h.side === 'R' ? (col.hand ?? null) : null;
  const consider = (d: number, name: string) => {
    if (d > pen) {
      pen = d;
      pair = `${name}/${col.hit?.name ?? '?'}`;
    }
  };
  const gaps = [Infinity, Infinity, Infinity, Infinity, Infinity];
  let palmGap = Infinity;
  for (const ph of h.phalanges) {
    for (let i = 0; i < 7; i++) {
      _p.lerpVectors(ph.a, ph.b, i / 6);
      const d = ph.r - col.sdf(_p, skip, null, 0.05);
      gaps[ph.finger] = Math.min(gaps[ph.finger], -d);
      consider(d, ph.name);
    }
  }
  const r = PALM.halfN;
  const hx = h.palmHalf.x - r,
    hz = h.palmHalf.z - r;
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 7; j++) {
      _p.set(-hx + (2 * hx * j) / 6, 0, -hz + (2 * hz * i) / 8).applyMatrix4(h.palm);
      const d = r - col.sdf(_p, skip, null, 0.05);
      palmGap = Math.min(palmGap, -d);
      consider(d, `${h.side}.palm`);
    }
  for (let i = 0; i < 5; i++) {
    _p.lerpVectors(h.wristA, h.wristB, i / 4);
    consider(WRIST.r - col.sdf(_p, skip, null, 0.05), `${h.side}.wrist`);
  }
  return { pen, pair, gaps, palmGap };
}

/** Play one action from rest at 60 Hz, calling `frame` after each update. */
export function playClip(rig: ArmsRig, action: ArmsAction, frame: () => void) {
  const dt = 1 / 60;
  rig.play('idle', { fade: 0 });
  rig.update(0);
  if (action === 'shoot' || action === 'shootLast') rig.play(action);
  else if (action !== 'idle') rig.play(action, { fade: 0, hold: action === 'magCheck' });
  const dur = rig.duration(action);
  let t = 0;
  const end = action === 'magCheck' ? dur + 1.2 : dur + (action === 'idle' ? 0 : 0.05);
  while (t < end) {
    if (action === 'magCheck' && t > dur * 0.6 + 0.6) rig.releaseHold();
    rig.update(dt);
    frame();
    t += dt;
  }
}

/** Audit one weapon: every clip, measured after the contact layer (`resolve`) or raw. */
export function auditWeapon(
  rig: ArmsRig,
  c: HandContact,
  weapon: string,
  model: import('../../weapons/models').WeaponModel,
  resolve: boolean,
  clips = AUDIT_CLIPS,
): ClipRow[] {
  c.seats = resolve;
  c.enabled = true;
  rig.attachWeapon(model, weapon);
  c.seats = true;
  const rows: ClipRow[] = [];
  const pistol = !!model.parts.slide;
  for (const clip of clips) {
    let fingerGaps: number[] = [];
    let n = 0,
      o2 = 0,
      o1 = 0,
      max = -Infinity,
      pair = '',
      ms = 0,
      gripGap = 0,
      palmGap = 0,
      supportGap = 0;
    c.enabled = resolve;
    playClip(rig, clip, () => {
      if (resolve) {
        c.apply(1 / 60);
        ms += c.stats.ms;
      }
      c.sync();
      let worst = -Infinity;
      for (const side of ['R', 'L'] as const) {
        const m = measureHand(c, c.hands[side].proxy);
        if (m.pen > worst) worst = m.pen;
        if (m.pen > max) {
          max = m.pen;
          pair = m.pair;
        }
        if (clip === 'idle') {
          if (side === 'R') {
            gripGap = Math.max(gripGap, m.gaps[2], m.gaps[3], m.gaps[4]);
            palmGap = Math.max(palmGap, m.palmGap);
            fingerGaps = m.gaps.slice();
          } else if (!pistol) supportGap = Math.max(supportGap, Math.min(...m.gaps, m.pen > -1 ? -m.pen : 1));
        }
      }
      n++;
      if (worst > 0.002) o2++;
      if (worst > 0.001) o1++;
    });
    rows.push({
      weapon,
      clip,
      frames: n,
      max: Math.max(0, max),
      pair: max > 0 ? pair : '',
      over2: o2 / n,
      over1: o1 / n,
      ...(clip === 'idle'
        ? { gripGap, palmGap, fingerGaps, supportGap: pistol ? undefined : supportGap }
        : {}),
      ...(resolve ? { ms: ms / n } : {}),
    });
  }
  c.enabled = true;
  return rows;
}

export function formatTable(rows: ClipRow[], title: string): string {
  const out = [
    `${title}`,
    '| weapon | clip | max pen mm | pair | % > 2 mm | % > 1 mm | ms/frame |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows)
    out.push(
      `| ${r.weapon} | ${r.clip} | ${(r.max * 1000).toFixed(1)} | ${r.pair} | ${(r.over2 * 100).toFixed(1)} | ${(r.over1 * 100).toFixed(1)} | ${r.ms !== undefined ? r.ms.toFixed(3) : ''} |`,
    );
  const idle = rows.filter((r) => r.clip === 'idle');
  if (idle.length) {
    out.push(
      '',
      '| weapon | idle firing palm gap mm | firing finger gaps T/I/M/R/P mm | support-hand gap mm |',
      '|---|---|---|---|',
    );
    for (const r of idle)
      out.push(
        `| ${r.weapon} | ${((r.palmGap ?? 0) * 1000).toFixed(1)} | ${(r.fingerGaps ?? []).map((g) => (g * 1000).toFixed(1)).join(' / ')} | ${r.supportGap !== undefined ? (r.supportGap * 1000).toFixed(1) : 'n/a (pistol)'} |`,
      );
  }
  return out.join('\n');
}

export { FINGERS };
