import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * Placeholder procedural weapon models built from primitives with named parts
 * (`mag`, `bolt`, `slide`, `chargingHandle`, `muzzle`, `optic`) so animation can address them.
 * Coordinates: -z is forward (muzzle), origin at the grip/trigger, y up. Metres.
 *
 * Hand/handling sockets (empty Object3Ds, position only — orientation is ignored by the hand rig):
 * - `gripRight`, `gripLeft`: grasp centres, i.e. the axis the closed hand wraps around (pistol grip centre,
 *   handguard centreline where the support hand sits; on pistols `gripLeft` is the support hand's wrap point).
 * - `magwell`: mouth of the well = top of the seated mag. `chargingHandle`: the T-handle. `boltCatch`: paddle.
 * - `slideRear`: rear of the slide (overhand rack). `muzzle` / `optic` as named parts.
 */
const mats = {
  black: new MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55, metalness: 0.45 }),
  polymer: new MeshStandardMaterial({ color: 0x222321, roughness: 0.8, metalness: 0.05 }),
  fde: new MeshStandardMaterial({ color: 0x8a7556, roughness: 0.75, metalness: 0.05 }),
  wood: new MeshStandardMaterial({ color: 0x5a3720, roughness: 0.6, metalness: 0 }),
  steel: new MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.35, metalness: 0.8 }),
  glass: new MeshStandardMaterial({
    color: 0x223040,
    roughness: 0.05,
    metalness: 0.9,
    transparent: true,
    opacity: 0.6,
  }),
};

function box(w: number, h: number, d: number, m: Material, x = 0, y = 0, z = 0, name?: string): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  return mesh;
}

function cyl(r: number, len: number, m: Material, x = 0, y = 0, z = 0, name?: string): Mesh {
  const g: BufferGeometry = new CylinderGeometry(r, r, len, 14);
  g.rotateX(Math.PI / 2);
  const mesh = new Mesh(g, m);
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  return mesh;
}

function socket(name: string, x: number, y: number, z: number): Object3D {
  const o = new Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

function group(name: string, ...children: Mesh[]): Group {
  const g = new Group();
  g.name = name;
  for (const c of children) g.add(c);
  return g;
}

export interface WeaponModel {
  root: Group;
  /** Local position of the muzzle tip. */
  muzzleZ: number;
  /** Sight line height above origin. */
  sightY: number;
}

function arBase(barrel: number, fde = false, suppressor = 0): WeaponModel {
  const root = new Group();
  const body = fde ? mats.fde : mats.black;
  root.add(box(0.05, 0.07, 0.26, mats.black, 0, 0.02, -0.03)); // upper/lower receiver
  root.add(box(0.03, 0.09, 0.04, mats.polymer, 0, -0.045, 0.04)); // grip
  root.add(box(0.052, 0.055, Math.max(0.18, barrel * 0.85), body, 0, 0.03, -0.16 - barrel * 0.42)); // handguard
  root.add(box(0.04, 0.06, 0.16, mats.polymer, 0, 0.0, 0.2)); // stock
  root.add(box(0.012, 0.012, 0.18, mats.steel, 0, 0.012, 0.12)); // buffer tube
  const muzzleZ = -0.16 - barrel - 0.02 - suppressor;
  root.add(cyl(0.009, barrel, mats.steel, 0, 0.03, -0.16 - barrel / 2));
  if (suppressor > 0)
    root.add(cyl(0.02, suppressor, mats.black, 0, 0.03, -0.16 - barrel - suppressor / 2, 'muzzle'));
  else root.add(cyl(0.012, 0.05, mats.black, 0, 0.03, -0.16 - barrel - 0.025, 'muzzle'));
  root.add(group('mag', box(0.026, 0.13, 0.065, mats.polymer, 0, -0.08, -0.06)));
  root.add(group('bolt', box(0.006, 0.012, 0.03, mats.steel, 0.028, 0.035, 0.0)));
  const ch = group(
    'chargingHandle',
    box(0.034, 0.008, 0.016, mats.black, 0, 0, 0),
    box(0.012, 0.01, 0.012, mats.black, -0.018, 0, 0.002),
  );
  ch.position.set(0, 0.052, 0.098);
  root.add(ch);
  root.add(
    socket('gripRight', 0, -0.04, 0.042),
    socket('gripLeft', 0, 0.03, -0.16 - barrel * 0.38),
    socket('magwell', 0, -0.015, -0.06),
    socket('boltCatch', -0.027, 0.005, -0.02),
  );
  // Red dot
  root.add(
    group(
      'optic',
      box(0.032, 0.022, 0.05, mats.black, 0, 0.075, -0.04),
      box(0.028, 0.03, 0.004, mats.glass, 0, 0.092, -0.06),
    ),
  );
  return { root, muzzleZ, sightY: 0.095 };
}

function ak(): WeaponModel {
  const root = new Group();
  root.add(box(0.05, 0.075, 0.3, mats.steel, 0, 0.02, -0.05));
  root.add(box(0.03, 0.09, 0.04, mats.polymer, 0, -0.045, 0.05));
  root.add(box(0.05, 0.055, 0.18, mats.wood, 0, 0.02, -0.3));
  root.add(box(0.035, 0.05, 0.2, mats.polymer, 0, 0.0, 0.2));
  root.add(cyl(0.01, 0.26, mats.steel, 0, 0.025, -0.36));
  root.add(cyl(0.016, 0.06, mats.black, 0, 0.025, -0.52, 'muzzle'));
  const mag = new Mesh(new BoxGeometry(0.026, 0.16, 0.06), mats.polymer);
  mag.position.set(0, -0.09, -0.08);
  mag.rotation.x = -0.35;
  root.add(group('mag', mag));
  root.add(group('bolt', box(0.012, 0.012, 0.03, mats.steel, 0.032, 0.04, -0.02)));
  root.add(group('optic', box(0.01, 0.025, 0.01, mats.steel, 0, 0.06, -0.48)));
  const ch = group('chargingHandle', box(0.02, 0.01, 0.01, mats.steel, 0.01, 0, 0));
  ch.position.set(0.03, 0.045, 0.0);
  root.add(ch);
  root.add(
    socket('gripRight', 0, -0.04, 0.052),
    socket('gripLeft', 0, 0.02, -0.3),
    socket('magwell', 0, -0.015, -0.07),
  );
  return { root, muzzleZ: -0.55, sightY: 0.07 };
}

function pistol(): WeaponModel {
  const root = new Group();
  root.add(group('slide', box(0.028, 0.032, 0.19, mats.black, 0, 0.03, -0.07)));
  root.add(box(0.03, 0.03, 0.15, mats.polymer, 0, 0.0, -0.06));
  const grip = new Mesh(new BoxGeometry(0.03, 0.11, 0.05), mats.polymer);
  grip.position.set(0, -0.05, 0.0);
  grip.rotation.x = 0.25;
  root.add(grip);
  root.add(group('mag', box(0.024, 0.1, 0.04, mats.polymer, 0, -0.055, 0.005)));
  root.add(box(0.004, 0.006, 0.004, mats.steel, 0, 0.05, -0.16)); // front sight
  root.add(box(0.012, 0.004, 0.0005, mats.black, 0, 0.0001, -0.165, 'muzzle'));
  root.add(
    socket('gripRight', 0, -0.04, 0.012),
    socket('gripLeft', -0.022, -0.052, 0.0),
    socket('magwell', 0, -0.105, 0.005),
    socket('slideRear', 0, 0.03, 0.022),
  );
  return { root, muzzleZ: -0.165, sightY: 0.052 };
}

export function buildModel(key: string): WeaponModel {
  let m: WeaponModel;
  switch (key) {
    case 'pdw':
      m = arBase(0.09, true, 0.16);
      break;
    case 'ak':
      m = ak();
      break;
    case 'pistol':
      m = pistol();
      break;
    default:
      m = arBase(0.26);
  }
  m.root.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
    }
  });
  return m;
}
