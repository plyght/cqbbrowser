import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Material,
} from 'three';
import { buildModel, preloadWeaponAssets, setWeaponEnvMap, type WeaponModel } from '../../../weapons/models';
import { ArmsRig } from '../../rig/ArmsRig';
import { Sheet, type Tile } from '../../rig/dev/sheet';
import { ContactOverlay } from '../ContactOverlay';
import { HandContact } from '../HandContact';

/**
 * Grip evidence sheets on the Blender kit weapons (grip.html):
 *   grip.html?weapons=sb16,kp9&views=fp,right,left,below,support&modes=raw,contact&state=idle
 * Rows = weapon × mode, columns = views. `xray=1` draws the weapon see-through (fingers inside it show),
 * `overlay=1` the contact proxies, `state=idle|fire|ads`, `t=` seconds into it. Modes: raw (clip), contact
 * (shipping default for the weapon), safe, full. Section views: `gsec:<mm>` cuts across the grip `mm` up its axis from
 * the grip socket (looking down the grip), `fg=fg_vertical|fg_angled` builds with that foregrip, `bsec:<mm>` across the bore at the support wrist + `mm` (looking from the
 * muzzle); cut interiors show red (weapon) / yellow (glove). Hook: window.__grip { ready, stats }.
 */
const q = new URLSearchParams(location.search);
const W = ((window as unknown as { __grip: Record<string, unknown> }).__grip = {} as Record<string, unknown>);

type View =
  | 'fp'
  | 'right'
  | 'left'
  | 'leftfront'
  | 'below'
  | 'support'
  | 'top'
  | 'front'
  | `gsec:${string}`
  | `bsec:${string}`;
const VIEWS: Record<string, { at: 'grip' | 'support' | 'fg'; az: number; el: number; dist: number }> = {
  right: { at: 'grip', az: -90, el: 5, dist: 0.32 },
  left: { at: 'grip', az: 90, el: 5, dist: 0.28 },
  leftfront: { at: 'grip', az: 40, el: -5, dist: 0.28 },
  below: { at: 'grip', az: -20, el: -60, dist: 0.34 },
  support: { at: 'support', az: 20, el: -55, dist: 0.3 },
  top: { at: 'support', az: 0, el: 80, dist: 0.32 },
  front: { at: 'support', az: 10, el: -20, dist: 0.3 },
  sleft: { at: 'fg', az: 95, el: -10, dist: 0.3 },
  sright: { at: 'fg', az: -95, el: -10, dist: 0.3 },
  sbelow: { at: 'fg', az: -30, el: -60, dist: 0.3 },
};

async function main() {
  const weapons = (q.get('weapons') ?? 'sb16').split(',');
  const views = (q.get('views') ?? 'fp,right,left,below,support').split(',') as View[];
  const modes = (q.get('modes') ?? 'raw,contact').split(',');
  const state = q.get('state') ?? 'idle';
  const tw = Number(q.get('tw') ?? 360),
    th = Number(q.get('th') ?? 300);
  await preloadWeaponAssets();
  const sheet = new Sheet(views.length, weapons.length * modes.length, tw, th);
  setWeaponEnvMap(sheet.scene.environment);
  const rig = await ArmsRig.load();
  sheet.scene.add(rig.root);
  sheet.renderer.localClippingEnabled = true;
  const cut = new Plane(new Vector3(0, 1, 0), 1e3);
  const capGlove = new MeshBasicMaterial({ color: 0xe8c020, side: BackSide, clippingPlanes: [cut] });
  for (const m of rig.meshes) {
    for (const mat of [m.material].flat()) mat.clippingPlanes = [cut];
    const cap = new SkinnedMesh(m.geometry, capGlove);
    cap.bind(m.skeleton, m.bindMatrix);
    cap.frustumCulled = false;
    m.parent!.add(cap);
  }
  const contact = new HandContact(rig);
  const overlay = q.get('overlay') === '1' ? new ContactOverlay(sheet.scene) : null;
  const models: Record<string, WeaponModel> = {};
  for (const w of weapons) {
    const fg = q.get('fg');
    models[w] = fg
      ? buildModel(
          { v: 1, weapon: w as WeaponModel['weapon'], parts: { foregrip: fg } },
          { detailParts: true },
        )
      : buildModel(w, { detailParts: true });
    if (q.get('xray') === '1') xray(models[w]);
    const capGun = new MeshBasicMaterial({ color: 0xc02020, side: BackSide, clippingPlanes: [cut] });
    const meshes: Mesh[] = [];
    models[w].root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    for (const m of meshes) {
      for (const mat of [m.material].flat()) mat.clippingPlanes = [cut];
      m.add(new Mesh(m.geometry, capGun));
    }
  }
  sheet.camera.fov = Number(q.get('fov') ?? 62);
  sheet.camera.position.set(0, 0, 0);
  sheet.camera.lookAt(0, Math.tan(Number(q.get('pitch') ?? 0)), -1);
  const close = new PerspectiveCamera(35, 1, 0.005, 10);
  const aim = (v: Exclude<View, 'fp'>) => {
    const m = rig.weaponModel!;
    cut.set(new Vector3(0, 1, 0), 1e3);
    if (v.startsWith('gsec:') || v.startsWith('bsec:')) return section(v);
    const s = VIEWS[v];
    // Left of the grip: cut away everything more than 4 cm left of the bore (the support arm passes there).
    if (v === 'left' || v === 'leftfront') {
      const gq0 = m.root.getWorldQuaternion(new Quaternion());
      const nx = new Vector3(1, 0, 0).applyQuaternion(gq0);
      const p0 = new Vector3(-0.04, 0, 0).applyMatrix4(m.root.matrixWorld);
      cut.setFromNormalAndCoplanarPoint(nx, p0);
    }
    const tgt = new Vector3();
    if (s.at === 'support') rig.bones.handL.getWorldPosition(tgt);
    else if (s.at === 'fg')
      rig.bones.handL
        .getWorldPosition(tgt)
        .add(new Vector3(0, -0.02, -0.07).applyQuaternion(m.root.getWorldQuaternion(new Quaternion())));
    else rig.socketWorld('gripRight', tgt);
    const az = (s.az * Math.PI) / 180,
      el = (s.el * Math.PI) / 180;
    const gq = m.root.getWorldQuaternion(new Quaternion());
    const off = new Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
      .multiplyScalar(s.dist)
      .applyQuaternion(gq);
    close.position.copy(tgt).add(off);
    close.up.set(0, 1, 0).applyQuaternion(gq);
    close.lookAt(tgt);
    close.updateMatrixWorld(true);
  };
  const section = (v: string) => {
    const m = rig.weaponModel!;
    const k = Number(v.split(':')[1]) / 1000;
    const gq = m.root.getWorldQuaternion(new Quaternion());
    const p = new Vector3();
    const n = new Vector3();
    let camUp: Vector3;
    if (v.startsWith('gsec:')) {
      const a = Math.abs(m.sockets.gripRight?.rotation.x ?? 0.33);
      n.set(0, Math.cos(a), -Math.sin(a)).applyQuaternion(gq);
      rig.socketWorld('gripRight', p);
      p.addScaledVector(n, k);
      camUp = new Vector3(0, 0, -1).applyQuaternion(gq);
    } else {
      n.set(0, 0, -1).applyQuaternion(gq);
      rig.bones.handL.getWorldPosition(p);
      p.addScaledVector(n, k);
      camUp = new Vector3(0, 1, 0).applyQuaternion(gq);
    }
    // Keep the part below (behind) the cut; look at the cut face from the removed side.
    cut.setFromNormalAndCoplanarPoint(n.clone().negate(), p);
    close.position.copy(p).addScaledVector(n, 0.3);
    close.up.copy(camUp);
    close.lookAt(p);
    close.updateMatrixWorld(true);
  };
  const stats: Record<string, unknown> = {};
  const pose = (w: string, mode: string) => {
    const on = mode !== 'raw';
    contact.autoEnable = () => on;
    // `legacy`: the proxy layer as it shipped before the baked grip (safe mode, PISTOL_SUPPORT).
    contact.useGrip = mode !== 'legacy';
    contact.mode = mode === 'full' ? 'full' : 'safe';
    if (rig.weaponModel) rig.detachWeapon();
    rig.attachWeapon(models[w], w);
    rig.play('idle', { fade: 0 });
    rig.update(0);
    if (contact.enabled) contact.apply(1 / 60);
    const n = Math.round(Number(q.get('t') ?? (state === 'fire' ? 0.55 : 1)) * 60);
    for (let i = 0; i < n; i++) {
      if (state === 'fire' && i % 6 === 0) rig.play('shoot');
      if (state === 'ads') {
        const k = Math.min(1, i / 15);
        rig.root.position.set(-0.11 * k, 0.08 * k, 0.06 * k);
      }
      rig.root.updateMatrixWorld(true);
      rig.update(1 / 60);
      if (contact.enabled) contact.apply(1 / 60);
    }
    if (overlay) overlay.update(contact);
    stats[`${w}.${mode}`] = { ms: contact.stats.ms, gun: contact.stats.gunOffset };
  };
  const tiles: Tile[] = [];
  for (const w of weapons)
    for (const mode of modes)
      for (const v of views)
        tiles.push({
          label: `${w} ${state} ${mode} ${v}`,
          camera: v === 'fp' ? undefined : close,
          pose: () => {
            pose(w, mode);
            if (v !== 'fp') aim(v);
            else cut.set(new Vector3(0, 1, 0), 1e3);
          },
        });
  sheet.render(tiles);
  W.stats = stats;
}

function xray(m: WeaponModel) {
  const cache = new Map<Material, Material>();
  m.root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as Material;
    let x = cache.get(src);
    if (!x) {
      x = new MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.35, depthWrite: false });
      cache.set(src, x);
    }
    mesh.material = x;
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => {
    W.ready = true;
    document.body.dataset.ready = '1';
  });
