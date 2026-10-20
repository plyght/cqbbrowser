import { describe, expect, test } from 'bun:test';
import { Matrix4, Vector3 } from 'three';
import { AUDIT_WEAPONS, auditWeapon, formatTable, loadHeadlessRig, measureHand, type ClipRow } from './audit';

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
