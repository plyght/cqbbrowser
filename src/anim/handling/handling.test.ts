import { describe, expect, test } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { PRESETS, applyBuild } from '../../weapons/attachments';
import { BASE_WEAPONS } from '../../weapons/defs';
import { characterise, formatTable, type HandlingReport } from './characterise';
import { rigParams } from './params';
import { WeaponRigidBody, gainsFor } from './sim';

const defOf = (id: string) => applyBuild(BASE_WEAPONS[PRESETS[id].weapon], PRESETS[id]);
const rows = Object.keys(PRESETS).map((id) => characterise(id, defOf(id)));
const R: Record<string, HandlingReport> = Object.fromEntries(rows.map((r) => [r.id, r]));

describe('physically simulated handling', () => {
  test('characterisation table', () => {
    console.log(formatTable(rows));
    for (const r of rows) {
      expect(r.halfLife).toBeGreaterThanOrEqual(0.02);
      expect(r.halfLife).toBeLessThanOrEqual(0.065);
      expect(Number.isFinite(r.settle + r.overshoot + r.risePerShot)).toBe(true);
    }
  });

  test('compact builds settle a 90° flick in under 250 ms', () => {
    for (const id of ['sb16_cqb', 'hb300_int', 'hb300_sbr', 'kp9_std', 'p17_std', 'p17_dot'])
      expect(R[id].settle).toBeLessThan(0.25);
  });

  test('heavier / longer: more lag, slower settle, less muzzle rise', () => {
    for (const [light, heavy] of [
      ['sb16_cqb', 'sb16_lpvo'],
      ['sb16_cqb', 'sb16_supp'],
      ['kp9_std', 'kp9_rail'],
      ['k47s_wood', 'k47s_lpvo'],
    ]) {
      expect(R[heavy].halfLife).toBeGreaterThanOrEqual(R[light].halfLife);
      expect(R[heavy].settle).toBeGreaterThan(R[light].settle);
      expect(R[heavy].risePerShot).toBeLessThan(R[light].risePerShot);
    }
  });

  test('suppressor: front-heavy overshoot', () => {
    expect(R.sb16_supp.overshoot).toBeGreaterThan(R.sb16_cqb.overshoot * 1.5);
  });

  test('HB-300 is quicker than SB-16 14.5" + LPVO', () => {
    expect(R.hb300_sbr.settle).toBeLessThan(R.sb16_lpvo.settle);
    expect(R.hb300_int.peakLag).toBeLessThan(R.sb16_lpvo.peakLag);
  });

  test('recoil recovers to the original point of aim', () => {
    for (const r of rows) expect(r.recovery).toBeLessThan(0.2);
  });

  test('at full ADS the bore sits on the aim point within 0.1° at rest', () => {
    const b = new WeaponRigidBody(rigParams(defOf('sb16_lpvo')));
    b.gains = gainsFor({ ads: 1, fatigue: 0, inertia: 1, crouch: 0 });
    const q = new Quaternion().setFromEuler(new Euler(0.05, 0.3, 0, 'YXZ'));
    b.targetQ.copy(q);
    b.targetPos.set(0, -0.1, -0.3);
    b.reset();
    // Disturb, then let it settle.
    b.w.set(2, -3, 1);
    b.v.set(0.3, 0.2, 0);
    for (let i = 0; i < 120; i++) b.step(1 / 60);
    const d = new Vector3(0, 0, -1).applyQuaternion(b.q);
    const t = new Vector3(0, 0, -1).applyQuaternion(q);
    expect((Math.acos(Math.min(1, d.dot(t))) * 180) / Math.PI).toBeLessThan(0.1);
  });

  test('inertia master: 0 locks the gun, higher means more lag', () => {
    const lag = (inertia: number) => {
      const b = new WeaponRigidBody(rigParams(defOf('sb16_cqb')));
      b.gains = gainsFor({ ads: 0, fatigue: 0, inertia, crouch: 0 });
      b.locked = inertia === 0;
      b.reset();
      b.targetQ.setFromEuler(new Euler(0, -0.3, 0, 'YXZ'));
      b.step(1 / 60);
      return new Vector3(0, 0, -1)
        .applyQuaternion(b.q)
        .angleTo(new Vector3(0, 0, -1).applyQuaternion(b.targetQ));
    };
    expect(lag(0)).toBeLessThan(1e-6);
    expect(lag(1.5)).toBeGreaterThan(lag(1));
    expect(lag(1)).toBeGreaterThan(lag(0.5));
  });

  test('deterministic', () => {
    const a = characterise('x', defOf('sb16_supp'));
    const b = characterise('x', defOf('sb16_supp'));
    expect(a).toEqual(b);
  });
});
