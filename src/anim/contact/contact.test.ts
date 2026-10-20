import { describe, expect, test } from 'bun:test';
import { Matrix4, Vector3 } from 'three';
import { formatSpikes, runScenario, scenarios, type SpikeRow } from '../rig/poseAudit';
import { setKitWeapons } from '../../weapons/models/kit';
import { AUDIT_WEAPONS, auditWeapon, formatTable, loadHeadlessRig, measureHand, type ClipRow } from './audit';
import {
  GRIP_SHIPPED,
  GRIP_WEAPONS,
  GripTruth,
  faceOf,
  loadHeadlessKit,
  runState,
  wrapFailures,
  type HandTruth,
  type Pad,
} from './gripAudit';

/**
 * Hand–weapon contact, headless: every clip of every weapon at 60 Hz on the real ArmsRig.
 *
 * What ships is `safe` mode (README): the guarantee here is that it is never worse than the raw clip — no
 * weapon × clip gets deeper or more often penetrating, no intended contact lifts off — and it removes what it
 * can (support hand, fingers). The `full` grip solve is audited and printed, not asserted (not shipped).
 */
const rig = await loadHeadlessRig();
const { buildModel } = await import('../../weapons/models');
const { HandContact } = await import('./HandContact');
const { collect } = await import('./weaponCollision');
const contact = new HandContact(rig);

const raw: ClipRow[] = [];
const safe: ClipRow[] = [];
const key = (r: ClipRow) => `${r.weapon}.${r.clip}`;

describe('hand-weapon contact (safe mode)', () => {
  test('audit raw and safe: every clip of every weapon', () => {
    contact.mode = 'safe';
    for (const w of AUDIT_WEAPONS) {
      raw.push(...auditWeapon(rig, contact, w, buildModel(w, { detailParts: true }), false));
      safe.push(...auditWeapon(rig, contact, w, buildModel(w, { detailParts: true }), true));
    }
    console.log(formatTable(raw, 'BEFORE (raw rig)'));
    console.log(formatTable(safe, 'AFTER (contact, safe mode)'));
    expect(safe.length).toBe(AUDIT_WEAPONS.length * 9);
  }, 300_000);

  test('never worse than raw: max penetration and frames > 2 mm, per weapon × clip', () => {
    const r = new Map(raw.map((x) => [key(x), x]));
    const bad: string[] = [];
    for (const s of safe) {
      const b = r.get(key(s))!;
      if (s.max > b.max + 0.0005 || s.over2 > b.over2 + 0.005)
        bad.push(`${key(s)} ${(b.max * 1000).toFixed(1)}→${(s.max * 1000).toFixed(1)} mm`);
    }
    if (bad.length) console.log('WORSE', bad.join(' | '));
    expect(bad).toEqual([]);
  });

  test('removes penetration: total depth over all clips drops', () => {
    const sum = (a: ClipRow[]) => a.reduce((t, x) => t + x.max, 0);
    console.log(
      'sum of max penetration mm raw',
      (sum(raw) * 1000).toFixed(0),
      'safe',
      (sum(safe) * 1000).toFixed(0),
    );
    // The firing hand is left as the clip in safe mode, so only the support hand and fingers contribute.
    expect(sum(safe)).toBeLessThan(sum(raw));
  });

  test('no intended contact lifts off at idle (palm, fingers, palm ≤ raw + 3 mm; a finger opened or a hand backed off to clear its deepest point ≤ raw + 5 mm)', () => {
    const r = new Map(raw.map((x) => [key(x), x]));
    for (const s of safe.filter((x) => x.clip === 'idle')) {
      const b = r.get(key(s))!;
      expect(s.palmGap!).toBeLessThanOrEqual(Math.max(0, b.palmGap!) + 0.003);
      s.fingerGaps!.forEach((g, i) => expect(g).toBeLessThanOrEqual(Math.max(0, b.fingerGaps![i]) + 0.005));
      if (s.supportGap !== undefined)
        expect(s.supportGap).toBeLessThanOrEqual(Math.max(0, b.supportGap!) + 0.005);
    }
  });

  test('ADS transition (hip → ADS → hip, 10 steps): never worse than raw', () => {
    // ADS moves only the rig root (the handling layer): sample the transition as root motion over the idle hold.
    const hip = new Vector3(0.02, -0.03, 0.02),
      ads = new Vector3(-0.09, 0.05, 0.06);
    for (const w of AUDIT_WEAPONS) {
      rig.attachWeapon(buildModel(w, { detailParts: true }), w);
      rig.play('idle', { fade: 0 });
      for (let i = 0; i <= 10; i++) {
        const k = i <= 5 ? i / 5 : (10 - i) / 5;
        rig.root.position.lerpVectors(hip, ads, k * k * (3 - 2 * k));
        rig.root.rotation.set(0.02 * k, -0.03 * k, 0.05 * k);
        rig.root.updateMatrixWorld(true);
        rig.update(1 / 60);
        contact.sync();
        const before = ['R', 'L'].map((s) => measureHand(contact, contact.hands[s as 'R'].proxy).pen);
        contact.apply(1 / 60);
        contact.sync();
        ['R', 'L'].forEach((s, j) =>
          expect(measureHand(contact, contact.hands[s as 'R'].proxy).pen).toBeLessThanOrEqual(
            Math.max(0, before[j]) + 0.0005,
          ),
        );
      }
      rig.root.position.set(0, 0, 0);
      rig.root.rotation.set(0, 0, 0);
    }
  });

  test('pistol under fire: support hand steady (no back-off flicking), jitter < 10 mm/frame²', () => {
    // 30 P17 shots, 12 frames apart, the support hand in the weapon frame. Before the eased back-off the
    // finger-residual push was re-solved from scratch per frame: 58.6 mm/frame² (the hand flicked ~3 cm).
    const run = (on: boolean) => {
      const m = buildModel('p17', { detailParts: true });
      contact.mode = 'safe';
      contact.autoEnable = () => on;
      rig.attachWeapon(m, 'p17');
      rig.play('idle', { fade: 0 });
      const inv = new Matrix4();
      const v = new Vector3();
      const tr: Vector3[] = [];
      for (let i = 0; i < 400; i++) {
        if (i >= 30 && (i - 30) % 12 === 0 && i < 30 + 12 * 30) rig.play('shoot');
        rig.update(1 / 60);
        if (contact.enabled) contact.apply(1 / 60);
        inv.copy(m.root.matrixWorld).invert();
        tr.push(rig.bones.handL.getWorldPosition(v).applyMatrix4(inv).clone());
      }
      let mx = 0;
      for (let i = 30; i < tr.length - 1; i++)
        mx = Math.max(
          mx,
          tr[i + 1]
            .clone()
            .addScaledVector(tr[i], -2)
            .add(tr[i - 1])
            .length() * 1000,
        );
      return mx;
    };
    const raw = run(false);
    const on = run(true);
    contact.autoEnable = undefined;
    contact.enabled = true;
    console.log('pistol support-hand jitter mm/frame² raw', raw.toFixed(2), 'contact', on.toFixed(2));
    expect(on).toBeLessThan(10);
  });

  test('perf: mean solver cost per frame (headless bun) stays bounded', () => {
    const ms = safe.reduce((a, r) => a + (r.ms ?? 0), 0) / safe.length;
    console.log('mean contact ms/frame (safe)', ms.toFixed(3));
    expect(ms).toBeLessThan(2);
  });

  test('full grip solve (not shipped): audited and printed', () => {
    contact.mode = 'full';
    const full: ClipRow[] = [];
    for (const w of AUDIT_WEAPONS)
      full.push(...auditWeapon(rig, contact, w, buildModel(w, { detailParts: true }), true));
    console.log(formatTable(full, 'AFTER (contact, full mode — not shipped)'));
    contact.mode = 'safe';
    expect(full.length).toBe(AUDIT_WEAPONS.length * 9);
  }, 300_000);

  test('weapon proxies hug the meshes: ≤ 0.5 % of surface samples outside by > 2 mm', () => {
    for (const w of AUDIT_WEAPONS) {
      const m = buildModel(w, { detailParts: true });
      rig.attachWeapon(m, w);
      rig.update(0);
      contact.sync();
      const pts = { p: [] as number[] };
      collect(m.root, new Matrix4().copy(m.root.matrixWorld).invert(), () => false, pts, 0.01);
      const v = new Vector3();
      let out = 0;
      for (let i = 0; i < pts.p.length; i += 3)
        if (contact.col!.sdf(v.set(pts.p[i], pts.p[i + 1], pts.p[i + 2])) > 0.002) out++;
      expect(out / (pts.p.length / 3)).toBeLessThan(0.005);
    }
  }, 120_000);
});

/**
 * The shipped hold on the Blender kit weapons, judged on the TRUE meshes (glove skin vs the weapon's render
 * triangles, `truth.ts`) rather than proxies: the baked grip (gripData.json) vs the raw clip at idle, ADS and
 * under fire, the side-aware wrap of both hands, and pose continuity with the grip blended in.
 */
describe('grip truth on the kit weapons (baked grip)', () => {
  const gripRows: { w: string; state: string; raw: number[]; grip: number[]; fails: string[] }[] = [];

  test('side-aware wrap metric: a pad counts only on its own face, facing it, within 3 mm', () => {
    const n = new Vector3();
    const mk = (region: string, d: number, face: string, facing = -0.9) =>
      ({ region, d, face, facing, near: true }) as Pad;
    const h = (pads: Pad[]): HandTruth => ({ side: 'R', pads, pen: 0 });
    expect(wrapFailures(h([mk('Ring3', 0.001, 'left')]))).toEqual([]);
    expect(wrapFailures(h([mk('Ring3', 0.001, 'front')]))).toEqual([]);
    // Touching, but on the near panel (the hand slid round the grip), or not facing it, or floating / sunk.
    expect(wrapFailures(h([mk('Ring3', 0.001, 'right')]))).toEqual(['R.Ring3 on right']);
    expect(wrapFailures(h([mk('Ring3', 0.001, 'left', 0.2)]))[0]).toContain('not facing');
    expect(wrapFailures(h([mk('Ring3', 0.0045, 'left')]))[0]).toContain('gap');
    expect(wrapFailures(h([mk('Ring3', -0.003, 'left')]))[0]).toContain('pen');
    expect(faceOf(n.set(-1, 0, 0), 0.3)).toBe('left');
    expect(faceOf(n.set(0, -0.3, -1).normalize(), 0.3)).toBe('front');
  });

  test('audit raw vs baked grip at idle / ADS / fire (true mesh)', async () => {
    await loadHeadlessKit();
    setKitWeapons(GRIP_WEAPONS);
    const truth = new GripTruth(rig);
    for (const w of GRIP_WEAPONS)
      for (const on of [false, true]) {
        const model = buildModel(w, { detailParts: true });
        contact.autoEnable = () => on;
        rig.attachWeapon(model, w);
        expect(!!contact.grip).toBe(on);
        truth.refresh(model);
        for (const state of ['idle', 'ads', 'fire'] as const) {
          let pR = 0,
            pL = 0;
          runState(rig, contact, state, (i) => {
            if (i % 4) return;
            pR = Math.max(pR, truth.measure(model, 'R').pen);
            pL = Math.max(pL, truth.measure(model, 'L').pen);
          });
          const fails = [
            ...wrapFailures(truth.measure(model, 'R')),
            ...(model.parts.slide ? [] : wrapFailures(truth.measure(model, 'L'))),
          ];
          let row = gripRows.find((r) => r.w === w && r.state === state);
          if (!row) gripRows.push((row = { w, state, raw: [], grip: [], fails: [] }));
          if (on) {
            row.grip = [pR, pL];
            row.fails = fails;
          } else row.raw = [pR, pL];
        }
        rig.setGripSeat(null);
      }
    contact.autoEnable = undefined;
    console.log(
      'TRUE-MESH PENETRATION mm (firing / support), raw → baked grip\n' +
        gripRows
          .map(
            (r) =>
              `${r.w.padEnd(6)} ${r.state.padEnd(5)} R ${(r.raw[0] * 1000).toFixed(1)} → ${(r.grip[0] * 1000).toFixed(1)}  L ${(r.raw[1] * 1000).toFixed(1)} → ${(r.grip[1] * 1000).toFixed(1)}  wrap fails: ${r.fails.join('; ') || 'none'}`,
          )
          .join('\n'),
    );
    expect(gripRows.length).toBe(GRIP_WEAPONS.length * 3);
  }, 600_000);

  test('never worse than raw: true-mesh penetration per hand, weapon × state', () => {
    const bad = gripRows.flatMap((r) =>
      [0, 1]
        .filter((k) => r.grip[k] > r.raw[k] + 0.0005)
        .map(
          (k) =>
            `${r.w}.${r.state}.${'RL'[k]} ${(r.raw[k] * 1000).toFixed(1)}→${(r.grip[k] * 1000).toFixed(1)}`,
        ),
    );
    expect(bad).toEqual([]);
  });

  test('shipped weapons hold: side-aware wrap of both hands at idle / ADS / fire', () => {
    const bad = gripRows
      .filter((r) => GRIP_SHIPPED.includes(r.w))
      .flatMap((r) => r.fails.map((f) => `${r.w}.${r.state} ${f}`));
    expect(bad).toEqual([]);
  });

  test('pose continuity with the baked grip blended in (no snaps)', () => {
    const rows: SpikeRow[] = [];
    contact.autoEnable = () => true;
    for (const w of GRIP_SHIPPED) {
      const mk = () => buildModel(w, { detailParts: true });
      for (const sc of scenarios(rig, w, mk))
        rows.push(runScenario(rig, w, mk(), sc, (dt) => contact.enabled && contact.apply(dt)));
    }
    contact.autoEnable = undefined;
    console.log(formatSpikes(rows, 'POSE CONTINUITY (baked grip)'));
    const lim = (s: string) =>
      s.startsWith('swap')
        ? { deg: 12, mm: 25 }
        : /^(idle|shoot|shootLast|shot string|rapid string)/.test(s)
          ? { deg: 10, mm: 12 }
          : { deg: 24, mm: 50 };
    const bad = rows
      .filter((r) => r.pop > lim(r.scenario).deg || r.popMm > lim(r.scenario).mm)
      .map(
        (r) =>
          `${r.weapon}.${r.scenario} ${r.pop.toFixed(1)}° ${r.popAt}@${r.popFrame} ${r.popMm.toFixed(1)} mm`,
      );
    expect(bad).toEqual([]);
  }, 600_000);

  test('perf: the baked grip costs ≤ 0.6 ms/frame (headless)', () => {
    contact.autoEnable = () => true;
    let ms = 0,
      n = 0;
    for (const w of GRIP_SHIPPED) {
      rig.attachWeapon(buildModel(w, { detailParts: true }), w);
      runState(rig, contact, 'fire', () => {
        ms += contact.stats.ms;
        n++;
      });
    }
    contact.autoEnable = undefined;
    console.log('baked grip ms/frame', (ms / n).toFixed(3));
    expect(ms / n).toBeLessThan(0.6);
  }, 120_000);

  test('restore the procedural guns for later test files', () => {
    rig.setGripSeat(null);
    setKitWeapons([]);
    expect(buildModel('sb16').root.userData.kit).toBeFalsy();
  });
});
