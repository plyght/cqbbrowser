/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Pistol ADS recoil recorder (owner report: "huge jolt, separate from the recoil"). Holds ADS on a P-17 / P-92,
 * fires single shots and strings, and records per frame: camera yaw/pitch/roll and position, every recoil
 * component feeding the camera, the sight line against the camera's centre ray, where the bore lands at 7 m / 15 m,
 * both wrists (gun frame) and the gun's pose in the camera frame, the playing clip and the hand-contact back-off.
 * Output JSON goes to $PISTOL_ADS_OUT (default the scratchpad progress dir).
 */
export const OUT =
  process.env.PISTOL_ADS_OUT ??
  '/tmp/claude-0/-home-user-cqbbrowser/5a21a369-8f5c-58f3-a403-1f3dec329f38/scratchpad/progress';

export interface Frame {
  i: number;
  fire: number;
  // Camera (world, YXZ), deg
  cyaw: number;
  cpitch: number;
  croll: number;
  cpos: number[];
  fov: number;
  // Camera components
  pYaw: number;
  pPitch: number;
  jolt: number;
  lag: number;
  roll: number;
  carrier: number;
  back: number;
  vrPend: number;
  vrDebt: number;
  climb: number;
  // ADS / rig
  ads: number;
  idleLock: number;
  action: string;
  shooting: number;
  // Sight vs camera centre ray (deg, mm)
  sightAng: number;
  sightOffMm: number[];
  dotAng: number[];
  land7: number[];
  land15: number[];
  // Gun in the camera frame (pos m, euler deg), wrists in the gun frame (m)
  gunPos: number[];
  gunEul: number[];
  wL: number[];
  wR: number[];
  wSep: number;
  backoffL: number;
  gunOff: number;
  pushL: number;
  /** Handling sim (view) pitch/yaw relative to the player look, deg. */
  simPitch: number;
  simYaw: number;
  /** Clip layer: gun relative to the handling view (pitch, yaw, roll deg). */
  clipEul: number[];
}

export async function bootPistol(page: Page, weapon: string, q = '') {
  await page.setViewportSize({ width: 320, height: 180 });
  const errors = await boot(page, `/${q}`);
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 90_000 });
  await page.evaluate((weapon) => {
    const g = (window as any).__sb;
    if (weapon !== 'p17')
      g.applyLoadout(
        {
          id: 't',
          name: 't',
          primary: { v: 1, weapon: 'sb16', parts: {} },
          sidearm: { v: 1, weapon, parts: {} },
          gear: { carrier: 'plate', rifleMags: 4, pistolMags: 4, dumpPouch: true, flashbangs: 0, nvg: false },
        },
        true,
      );
    g.weapons.equipNow(1);
    for (let i = 0; i < 60; i++) g.step(1 / 60, i >= 57);
  }, weapon);
  return errors;
}

/** Fire `shots` at `every` frames; each press held 2 frames. render: draw every frame (slow). */
export function record(page: Page, shots: number, every: number, pre = 40, post = 70, render = false) {
  return page.evaluate(
    ([shots, every, pre, post, render]) => {
      const g = (window as any).__sb;
      const w = g.weapons;
      const p = g.player;
      const cam = g.renderer.camera;
      const V = cam.position.constructor as any;
      const Q = cam.quaternion.constructor as any;
      const E = cam.rotation.constructor as any;
      const eul = new E();
      const v = new V();
      const v2 = new V();
      const camInv = new Q();
      const q2 = new Q();
      const D = 180 / Math.PI;
      const out: any[] = [];
      const total = pre + shots * every + post;
      for (let i = 0; i < total; i++) {
        const k = i - pre;
        const fire = k >= 0 && k < shots * every && k % every < 2;
        g.test.next = { down: fire ? ['aim', 'fire'] : ['aim'] };
        g.step(1 / 60, render);
        if (render) g.renderer.render(0);
        cam.updateMatrixWorld();
        eul.setFromQuaternion(cam.quaternion, 'YXZ');
        camInv.copy(cam.quaternion).invert();
        const rig = w.rig;
        const e = w.equipped;
        const gm = e.model.root.matrixWorld;
        const gq = e.model.root.getWorldQuaternion(new Q());
        // Gun in camera frame.
        v.setFromMatrixPosition(gm).sub(cam.position).applyQuaternion(camInv);
        q2.copy(camInv).multiply(gq);
        eul.setFromQuaternion(q2, 'YXZ');
        const gunEul = [eul.x * D, eul.y * D, eul.z * D];
        const gunPos = [v.x, v.y, v.z];
        eul.setFromQuaternion(cam.quaternion, 'YXZ');
        const cyaw = eul.y * D,
          cpitch = eul.x * D,
          croll = eul.z * D;
        // Sight axis (gun forward) vs camera forward.
        const gf = new V(0, 0, -1).applyQuaternion(gq);
        const cf = new V(0, 0, -1).applyQuaternion(cam.quaternion);
        const sightAng = Math.acos(Math.min(1, gf.dot(cf))) * D;
        // Sight point (rear of the sight line) offset from the camera ray, in camera frame at its depth.
        const sl = e.sightLocal[Math.min(w.aimIndex, e.sightLocal.length - 1)];
        const sp = new V().copy(sl).applyMatrix4(gm).sub(cam.position).applyQuaternion(camInv);
        const sightOffMm = [sp.x * 1000, sp.y * 1000];
        const dotAng = [Math.atan2(sp.x, -sp.z) * D, Math.atan2(sp.y, -sp.z) * D];
        // Where the bore lands at 7 m / 15 m relative to the camera centre ray (cm, camera frame).
        const sr = w.shotRay();
        const land = (d: number) => {
          v.copy(sr.origin).addScaledVector(sr.dir, d).sub(cam.position).applyQuaternion(camInv);
          return [v.x * 100 * (d / -v.z), v.y * 100 * (d / -v.z)];
        };
        // Wrists in the gun frame.
        const gInv = gm.clone().invert();
        v.setFromMatrixPosition(rig.bones.handL.matrixWorld).applyMatrix4(gInv);
        const wL = [v.x, v.y, v.z];
        v2.setFromMatrixPosition(rig.bones.handR.matrixWorld).applyMatrix4(gInv);
        const wR = [v2.x, v2.y, v2.z];
        const c = w.contact;
        eul.setFromQuaternion(w.view.quaternion, 'YXZ');
        const simPitch = eul.x * D - p.pitch * D;
        const simYaw = eul.y * D - p.yaw * D;
        q2.copy(w.view.quaternion).invert().multiply(gq);
        eul.setFromQuaternion(q2, 'YXZ');
        const clipEul = [eul.x * D, eul.y * D, eul.z * D];
        out.push({
          i,
          fire: fire ? 1 : 0,
          cyaw,
          cpitch,
          croll,
          cpos: [cam.position.x, cam.position.y, cam.position.z],
          fov: cam.fov,
          pYaw: p.yaw * D,
          pPitch: p.pitch * D,
          jolt: p.camPitchJolt.value * D,
          lag: p.camYawLag.value * D,
          roll: p.camRoll.value * D,
          carrier: p.carrier.value,
          back: p.camBack.value,
          vrPend: p.vrPending.p * D,
          vrDebt: p.vrDebt.p * D,
          climb: w.climbPitch * D,
          ads: w.adsBlend,
          idleLock: w.idleLock,
          action: rig.action,
          shooting: rig.shooting ? 1 : 0,
          sightAng,
          sightOffMm,
          dotAng,
          land7: land(7),
          land15: land(15),
          gunPos,
          gunEul,
          wL,
          wR,
          wSep: Math.hypot(wL[0] - wR[0], wL[1] - wR[1], wL[2] - wR[2]),
          backoffL: c?.resOff?.L ? c.resOff.L.length() : 0,
          gunOff: c?.stats?.gunOffset ?? 0,
          pushL: c?.stats?.push?.L ?? 0,
          simPitch,
          simYaw,
          clipEul,
        });
      }
      g.test.next = {};
      return out;
    },
    [shots, every, pre, post, render] as const,
  ) as Promise<Frame[]>;
}
