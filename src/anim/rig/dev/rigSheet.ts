import { PerspectiveCamera, Vector3 } from 'three';
import { buildModel, setWeaponEnvMap, type WeaponModel } from '../../../weapons/models';
import type { ArmsAction } from '../../library/library';
import { ArmsRig } from '../ArmsRig';
import { Sheet, type Tile } from './sheet';

/**
 * Canonical-arms contact sheets: anim.html?mode=rig&weapons=k47s,sb16&actions=idle@0,reloadEmpty@0.55
 * Each action spec is `action@u` with u in 0..1 of the clip (or `action@1.2s` for seconds); `+hold` keeps a mag
 * check in its hold loop. `view=side` renders a debug camera from the right.
 */
export async function rigSheet(q: URLSearchParams, hook: Record<string, unknown>) {
  const weapons = (q.get('weapons') ?? 'k47s').split(',');
  const actions = (q.get('actions') ?? 'idle@0').split(',');
  const cols = Number(q.get('cols') ?? actions.length);
  const tiles = weapons.length * actions.length;
  const rows = Math.ceil(tiles / cols);
  const sheet = new Sheet(cols, rows, Number(q.get('tw') ?? 320), Number(q.get('th') ?? 240));
  setWeaponEnvMap(sheet.scene.environment);
  ArmsRig.debug.noIK = q.get('noik') === '1';
  ArmsRig.debug.noMerge = q.get('nomerge') === '1';
  const rig = await ArmsRig.load();
  sheet.scene.add(rig.root);
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
  const beats: string[] = [];
  rig.onBeat = (b, a) => beats.push(`${a}:${b}`);
  const list: Tile[] = [];
  for (const w of weapons)
    for (const spec of actions) {
      const [a, rawT = '0'] = spec.split('@');
      const hold = rawT.endsWith('+hold');
      const tStr = rawT.replace('+hold', '');
      const action = a as ArmsAction;
      list.push({
        label: `${w} ${action} ${tStr}`,
        camera: side,
        pose: () => {
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
          while (left > 1e-6) {
            const d = Math.min(1 / 30, left);
            rig.update(d);
            left -= d;
          }
        },
      });
    }
  sheet.render(list);
  hook.beats = beats;
  hook.drawCalls = rig.drawCalls;
  hook.durations = Object.fromEntries(
    weapons.map((w) => [
      w,
      Object.fromEntries(actions.map((s) => [s, rig.duration(s.split('@')[0] as ArmsAction, w)])),
    ]),
  );
}
