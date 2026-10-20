import { describe, expect, test } from 'bun:test';
import { AUDIT_WEAPONS, loadHeadlessRig } from '../contact/audit';
import { ACTIONS } from '../library/library';
import { formatSpikes, runScenario, scenarios, type SpikeRow } from './poseAudit';
import { quatAngle } from './pose';

/**
 * Pose continuity on the real ArmsRig (headless, 60 Hz): every weapon × scenario (each clip, loop wraps, shot
 * strings, shots cutting into shots, fire out of an inspect / reload, mag-check hold, swaps and a reversed swap),
 * with the contact layer as shipped (pistols). A pop is a frame that moves faster than the motion two frames
 * either side (see poseAudit.ts). Measured before the fixes: 145–355°/frame and 0.6–1 m/frame at swaps (one
 * frame of the idle hold), 39–51° at every shot's end (additive layer dropped off a non-zero delta), 45–90° on
 * the pistol support fingers (contact opening snapped), a 10.8° pistol idle loop seam.
 */
const rig = await loadHeadlessRig();
const { buildModel } = await import('../../weapons/models');
const { HandContact } = await import('../contact/HandContact');
const { weaponAnims } = await import('../library/library');
const contact = new HandContact(rig);
contact.autoEnable = (id) => weaponAnims(id).family === 'pistol';

/** Holds and shots: nothing may jump. Authored recoil is an impulse on the gun (~10 mm on its frame). */
const REST = { deg: 10, mm: 12 };
/** Reloads, mag checks, inspects and cancels: the source packs' fast hand moves, but no discontinuity. */
const ACTION = { deg: 24, mm: 50 };
const REST_SCENARIOS = /^(idle|shoot|shootLast|shot string|rapid string)/;
/** Swaps: the holster / draw clips are fast, but the weapon change itself must not jump (was 145–355°). */
const SWAP = { deg: 12, mm: 25 };

const rows: SpikeRow[] = [];

describe('rig pose continuity (no pops)', () => {
  test('audit every weapon × scenario', () => {
    for (const w of AUDIT_WEAPONS) {
      const mk = () => buildModel(w, { detailParts: true });
      for (const sc of scenarios(rig, w, mk))
        rows.push(
          runScenario(rig, w, mk(), sc, (dt) => {
            if (contact.enabled) contact.apply(dt);
          }),
        );
    }
    console.log(formatSpikes(rows, 'POSE CONTINUITY (contact as shipped)'));
    expect(rows.length).toBe(AUDIT_WEAPONS.length * 13);
  }, 300_000);

  test(`swaps: pop ≤ ${SWAP.deg}°/frame and ≤ ${SWAP.mm} mm/frame`, () => {
    const bad = rows
      .filter((r) => r.scenario.startsWith('swap'))
      .filter((r) => r.pop > SWAP.deg || r.popMm > SWAP.mm)
      .map(
        (r) =>
          `${r.weapon}.${r.scenario} ${r.pop.toFixed(1)}° ${r.popAt}@${r.popFrame} ${r.popMm.toFixed(1)} mm`,
      );
    expect(bad).toEqual([]);
  });

  test(`holds / shots: pop ≤ ${REST.deg}°/frame and ≤ ${REST.mm} mm/frame`, () => {
    const bad = rows
      .filter((r) => REST_SCENARIOS.test(r.scenario))
      .filter((r) => r.pop > REST.deg || r.popMm > REST.mm)
      .map(
        (r) =>
          `${r.weapon}.${r.scenario} ${r.pop.toFixed(1)}° ${r.popAt}@${r.popFrame} ${r.popMm.toFixed(1)} mm`,
      );
    expect(bad).toEqual([]);
  });

  test(`actions: pop ≤ ${ACTION.deg}°/frame and ≤ ${ACTION.mm} mm/frame`, () => {
    const bad = rows
      .filter((r) => r.pop > ACTION.deg || r.popMm > ACTION.mm)
      .map(
        (r) =>
          `${r.weapon}.${r.scenario} ${r.pop.toFixed(1)}° ${r.popAt}@${r.popFrame} ${r.popMm.toFixed(1)} mm`,
      );
    expect(bad).toEqual([]);
  });
});

describe('clip data', () => {
  test('loops have no seam and additive layers return to their reference (≤ 0.5°)', () => {
    const bad: string[] = [];
    for (const w of AUDIT_WEAPONS) {
      const clips = rig.clipsFor(w);
      for (const a of ACTIONS) {
        const c = clips[a];
        if (!c.loop && !c.additive) continue;
        const L = c.layout;
        const last = (c.frames - 1) * L.stride;
        for (let b = 0; b < L.bones.length; b++) {
          const d = (quatAngle(c.data, L.rot + b * 4, c.data, last + L.rot + b * 4) * 180) / Math.PI;
          if (d > 0.5) bad.push(`${w}.${a} ${L.bones[b]} ${d.toFixed(2)}°`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('no single-frame bone flips left in any clip (≤ 60° per 30 fps frame)', () => {
    const bad: string[] = [];
    for (const w of AUDIT_WEAPONS) {
      const clips = rig.clipsFor(w);
      for (const a of ACTIONS) {
        const c = clips[a];
        const L = c.layout;
        for (let b = 0; b < L.bones.length; b++)
          for (let f = 1; f < c.frames; f++) {
            const o = L.rot + b * 4;
            const d = (quatAngle(c.data, (f - 1) * L.stride + o, c.data, f * L.stride + o) * 180) / Math.PI;
            if (d > 60) bad.push(`${w}.${a} ${L.bones[b]}@${f} ${d.toFixed(1)}°`);
          }
      }
    }
    expect(bad).toEqual([]);
  });

  test('the mag-check hold loop lies on a static stretch (no pose jump at the wrap)', () => {
    for (const w of AUDIT_WEAPONS) {
      const c = rig.clipsFor(w).magCheck;
      const [h0, h1] = c.hold!;
      const S = c.layout.stride;
      const f0 = Math.round(h0 * c.fps) * S;
      const f1 = Math.round(h1 * c.fps) * S;
      let m = 0;
      for (const q of c.layout.quats) m = Math.max(m, quatAngle(c.data, f0 + q, c.data, f1 + q));
      for (let i = 0; i < S; i++)
        if (!c.layout.quats.some((q) => i >= q && i < q + 4))
          m = Math.max(m, Math.abs(c.data[f0 + i] - c.data[f1 + i]));
      expect(m).toBeLessThan(0.02);
    }
  });
});

describe('events', () => {
  test('each marker fires once (also at t = 0)', () => {
    for (const w of ['k47s', 'p17']) {
      rig.attachWeapon(buildModel(w, { detailParts: true }), w);
      rig.play('idle', { fade: 0 });
      rig.update(0);
      const clip = rig.clipsFor(w).reloadEmpty;
      const got: string[] = [];
      rig.play('reloadEmpty', { onEvent: (b) => got.push(b) });
      for (let i = 0; i < Math.ceil(clip.duration * 60) + 5; i++) rig.update(1 / 60);
      expect(got).toEqual(clip.events.map((e) => e.name));
    }
  });
});
