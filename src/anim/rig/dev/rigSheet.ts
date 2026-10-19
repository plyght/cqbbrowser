import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { buildModel, setWeaponEnvMap, type WeaponModel } from '../../../weapons/models';
import { ContactOverlay } from '../../contact/ContactOverlay';
import { HandContact } from '../../contact/HandContact';
import type { ArmsAction } from '../../library/library';
import { ArmsRig } from '../ArmsRig';
import { Sheet, type Tile } from './sheet';

/**
 * Canonical-arms contact sheets: anim.html?mode=rig&weapons=k47s,sb16&actions=idle@0,reloadEmpty@0.55
 * Each action spec is `action@u` with u in 0..1 of the clip (or `action@1.2s` for seconds); `+hold` keeps a mag
 * check in its hold loop. `view=side` renders a debug camera from the right.
 *
 * Hand contact (src/anim/contact): `contact=1` runs the hard-contact layer, `contact=both` renders each tile
 * raw then resolved, `overlay=1` draws the proxies. Close-up turntable camera: `at=grip|well|mag|support|hand`
 * (`az`, `el` degrees about the gun, `dist` m) — e.g. `at=mag&az=-70&el=10&dist=0.28`.
 */
export async function rigSheet(q: URLSearchParams, hook: Record<string, unknown>) {
  const weapons = (q.get('weapons') ?? 'k47s').split(',');
  const actions = (q.get('actions') ?? 'idle@0').split(',');
  const cmode = q.get('contact') ?? '0';
  const modes = cmode === 'both' ? [false, true] : [cmode === '1'];
  const cols = Number(q.get('cols') ?? actions.length * modes.length);
  const tiles = weapons.length * actions.length * modes.length;
  const rows = Math.ceil(tiles / cols);
  const sheet = new Sheet(cols, rows, Number(q.get('tw') ?? 320), Number(q.get('th') ?? 240));
  setWeaponEnvMap(sheet.scene.environment);
  ArmsRig.debug.noIK = q.get('noik') === '1';
  ArmsRig.debug.noMerge = q.get('nomerge') === '1';
  const rig = await ArmsRig.load();
  sheet.scene.add(rig.root);
  const contact = new HandContact(rig);
  const overlay = q.get('overlay') === '1' ? new ContactOverlay(sheet.scene) : null;
  const models: Record<string, WeaponModel> = {};
  for (const w of weapons) models[w] = buildModel(w, { detailParts: true });
  const fov = Number(q.get('fov') ?? 62);
  sheet.camera.fov = fov;
  const cam = (q.get('cam') ?? '0,0,0').split(',').map(Number);
  const pitch = Number(q.get('pitch') ?? 0);
  sheet.camera.position.set(cam[0], cam[1], cam[2]);
  sheet.camera.lookAt(cam[0], cam[1] + Math.tan(pitch), cam[2] - 1);
  if (q.has('look'))
    sheet.camera.lookAt(...(q.get('look')!.split(',').map(Number) as [number, number, number]));
  let side: PerspectiveCamera | undefined;
  if (q.get('view') === 'side') {
    side = new PerspectiveCamera(40, 1, 0.01, 10);
    side.position.set(0.75, 0.05, -0.25);
    side.lookAt(new Vector3(0.05, -0.12, -0.28));
  }
  // Close-up turntable around a weapon point.
  const at = q.get('at');
  const close = at ? new PerspectiveCamera(Number(q.get('cfov') ?? 35), 1, 0.005, 10) : undefined;
  const aim = () => {
    if (!close || !rig.weaponModel) return;
    const m = rig.weaponModel;
    const tgt = new Vector3();
    if (at === 'mag' && m.parts.mag) {
      m.parts.mag.updateMatrixWorld(true);
      tgt.set(0, -0.05, -0.08).applyMatrix4(m.parts.mag.matrixWorld);
    } else if (at === 'support' || at === 'hand') rig.bones.handL.getWorldPosition(tgt);
    else if (at === 'well') rig.socketWorld('magwell', tgt);
    else rig.socketWorld('gripRight', tgt);
    const az = (Number(q.get('az') ?? -90) * Math.PI) / 180,
      el = (Number(q.get('el') ?? 0) * Math.PI) / 180;
    const dist = Number(q.get('dist') ?? 0.3);
    const gq = m.root.getWorldQuaternion(new Quaternion());
    // Gun frame: +x right, -z muzzle. az = 0 looks from the muzzle side, -90 from the right, +90 from the left.
    const off = new Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
      .multiplyScalar(dist)
      .applyQuaternion(gq);
    close.position.copy(tgt).add(off);
    close.up.set(0, 1, 0).applyQuaternion(gq);
    close.lookAt(tgt);
    close.updateMatrixWorld(true);
  };
  const beats: string[] = [];
  rig.onBeat = (b, a) => beats.push(`${a}:${b}`);
  const list: Tile[] = [];
  const worst: Record<string, number> = {};
  for (const w of weapons)
    for (const spec of actions)
      for (const resolve of modes) {
        const [a, rawT = '0'] = spec.split('@');
        const hold = rawT.endsWith('+hold');
        const tStr = rawT.replace('+hold', '');
        const action = a as ArmsAction;
        const label = `${w} ${action} ${tStr}${modes.length > 1 || resolve ? (resolve ? ' contact' : ' raw') : ''}`;
        list.push({
          label,
          camera: close ?? side,
          pose: () => {
            contact.enabled = resolve;
            contact.seats = resolve;
            if (rig.weaponModel === models[w]) rig.detachWeapon();
            rig.attachWeapon(models[w], w);
            const dur = rig.duration(action);
            const t = tStr.endsWith('s') ? parseFloat(tStr) : parseFloat(tStr) * dur;
            if (action === 'shoot' || action === 'shootLast') {
              rig.play('idle', { fade: 0 });
              rig.update(0);
              rig.play(action);
            } else rig.play(action, { fade: 0, hold });
            let left = t;
            rig.update(0);
            contact.apply(1 / 60);
            while (left > 1e-6) {
              const d = Math.min(1 / 60, left);
              rig.update(d);
              contact.apply(d);
              left -= d;
            }
            aim();
            if (overlay) {
              overlay.update(contact);
              worst[label] = overlay.worst;
            }
          },
        });
      }
  sheet.render(list);
  hook.beats = beats;
  hook.worst = worst;
  hook.drawCalls = rig.drawCalls;
  hook.durations = Object.fromEntries(
    weapons.map((w) => [
      w,
      Object.fromEntries(actions.map((s) => [s, rig.duration(s.split('@')[0] as ArmsAction, w)])),
    ]),
  );
}
