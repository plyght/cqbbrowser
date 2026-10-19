import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { BORE_Y, PLATFORMS, layoutBuild, resolveBuild } from '../../weapons/attachments';
import type { WeaponModel } from '../../weapons/models';
import { ShapeSet, box, type Shape } from './sdf';

/**
 * Grip surfaces of a weapon as analytic SDFs (weapon frame), derived from the model's sockets/parts plus a small
 * per-platform dimension table: pistol grip (rounded box along the grip axis, backstrap + beavertail), frame /
 * receiver, trigger (+ face), trigger guard, handguard (rounded box along the bore) and magazine.
 */
export interface GripShapes {
  platform: string;
  pistol: boolean;
  set: ShapeSet;
  /** Grip frame: centre, down-the-grip axis, front→back axis (weapon frame). */
  gripCenter: Vector3;
  gripDown: Vector3;
  gripBack: Vector3;
  gripHalf: Vector3;
  /** Top of the backstrap under the beavertail: where the web of the firing hand sits. */
  beavertail: Vector3;
  /** Trigger face contact point and the direction the pad pushes from (in front of the face). */
  triggerFace: Vector3;
  triggerNormal: Vector3;
  /** Support-hand point (socket) and the support surface name in `set`. */
  support: Vector3;
  supportShape: string;
  /** Magazine box name. */
  mag: string;
}

interface Dims {
  grip: [number, number, number, number]; // half width, half length, half depth, radius
  frame: { c: [number, number, number]; h: [number, number, number] };
  trigger: [number, number, number]; // face offset from the trigger pivot
  guard: { c: [number, number, number]; h: [number, number, number] } | null;
  hg: [number, number, number]; // half width, half height, centre y below bore
  mag: [number, number, number]; // half width, half length, half depth
  /** Beavertail above the grip box top (along the grip axis). */
  bt?: number;
}

const DIMS: Record<string, Dims> = {
  ar: {
    grip: [0.0135, 0.05, 0.021, 0.009],
    frame: { c: [0, 0.012, -0.035], h: [0.0125, 0.03, 0.13] },
    trigger: [0, -0.021, -0.004],
    guard: { c: [0, -0.045, -0.014], h: [0.009, 0.004, 0.034] },
    hg: [0.024, 0.024, 0.002],
    mag: [0.012, 0.075, 0.031],
  },
  ak: {
    grip: [0.0135, 0.048, 0.02, 0.009],
    frame: { c: [0, 0.014, -0.03], h: [0.0135, 0.03, 0.12] },
    trigger: [0, -0.02, -0.004],
    guard: { c: [0, -0.04, -0.018], h: [0.008, 0.004, 0.036] },
    hg: [0.025, 0.024, 0.004],
    mag: [0.012, 0.085, 0.032],
  },
  mp5: {
    grip: [0.014, 0.048, 0.021, 0.009],
    frame: { c: [0, 0.016, -0.02], h: [0.017, 0.033, 0.1] },
    trigger: [0, -0.019, -0.004],
    guard: { c: [0, -0.042, -0.014], h: [0.009, 0.004, 0.03] },
    hg: [0.023, 0.022, 0.0],
    mag: [0.011, 0.075, 0.018],
  },
  glock: {
    grip: [0.015, 0.038, 0.024, 0.01],
    bt: 0.026,
    frame: { c: [0, 0.018, -0.055], h: [0.0135, 0.02, 0.1] },
    trigger: [0, -0.017, -0.004],
    guard: { c: [0, -0.032, -0.036], h: [0.008, 0.004, 0.03] },
    hg: [0.02, 0.02, 0.02],
    mag: [0.0125, 0.055, 0.017],
  },
};

const _m = new Matrix4();
const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
const _s = new Vector3(1, 1, 1);

function worldPos(o: Object3D | undefined, root: Object3D, fallback: [number, number, number]): Vector3 {
  if (!o) return new Vector3(...fallback);
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  return new Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
}

export function gripShapes(model: WeaponModel): GripShapes {
  const platform = PLATFORMS[model.build.weapon]?.platform ?? 'ar';
  const pistol = platform === 'glock';
  const D = DIMS[platform] ?? DIMS.ar;
  const boreY = model.boreY ?? BORE_Y;
  const root = model.root;
  const gr = model.sockets.gripRight;
  const angle = gr ? Math.abs(gr.rotation.x) : 0.33;
  const gripCenter = worldPos(gr, root, [0, -0.06, 0.06]);
  const gripDown = new Vector3(0, -Math.cos(angle), Math.sin(angle));
  const gripBack = new Vector3(0, Math.sin(angle), Math.cos(angle));
  const [gw, gl, gd, gradius] = D.grip;
  const shapes: Shape[] = [];
  // Grip box frame: x = weapon x, y = -down (up the grip), z = back.
  const up = gripDown.clone().negate();
  _m.makeBasis(_x, up, gripBack).setPosition(gripCenter);
  shapes.push(box('grip', _m, new Vector3(gw, gl, gd), gradius));
  const beavertail = gripCenter
    .clone()
    .addScaledVector(gripBack, gd - 0.003)
    .addScaledVector(up, gl - 0.004 + (D.bt ?? 0));
  // Frame / receiver above the grip, trigger guard, trigger blade.
  _m.identity().setPosition(...D.frame.c);
  shapes.push(box('frame', _m, new Vector3(...D.frame.h), 0.006));
  if (D.guard) {
    _m.identity().setPosition(...D.guard.c);
    shapes.push(box('guard', _m, new Vector3(...D.guard.h), 0.003));
  }
  const trig = worldPos(model.parts.trigger, root, [0, -0.012, 0.004]);
  const triggerFace = trig.clone().add(new Vector3(...D.trigger));
  _m.identity().setPosition(trig.x, trig.y + D.trigger[1] * 0.6, trig.z + D.trigger[2] + 0.003);
  shapes.push(box('trigger', _m, new Vector3(0.0035, Math.abs(D.trigger[1]) * 0.75, 0.003), 0.0015));
  // Magazine: down from the magwell mouth.
  const well = worldPos(model.sockets.magwell, root, [0, -0.06, -0.06]);
  if (pistol) {
    // Pistol mag sits inside the grip; its baseplate is the magwell socket.
    _q.setFromUnitVectors(new Vector3(0, 1, 0), up);
    _m.compose(well.clone().addScaledVector(up, D.mag[1]), _q, _s);
  } else _m.identity().setPosition(well.x, well.y - D.mag[1], well.z);
  shapes.push(box('mag', _m, new Vector3(...D.mag), 0.004));
  // Support surface.
  const support = worldPos(model.sockets.gripLeft, root, [0, boreY - 0.02, -0.22]);
  let supportShape = 'handguard';
  if (pistol) {
    // The support hand wraps the firing hand's fingers: grip inflated by a finger's thickness on the front/left.
    const wc = gripCenter
      .clone()
      .add(new Vector3(-0.006, 0, 0))
      .addScaledVector(gripBack, -0.012)
      .addScaledVector(up, 0.004);
    _m.makeBasis(_x, up, gripBack).setPosition(wc);
    shapes.push(box('supportWrap', _m, new Vector3(gw + 0.016, gl + 0.014, gd + 0.016), gradius + 0.012));
    supportShape = 'supportWrap';
  } else {
    let z0 = support.z - 0.1,
      z1 = support.z + 0.12;
    try {
      const l = layoutBuild(resolveBuild(model.build));
      if (l.handguard) {
        z0 = Math.min(l.handguard.z0, l.handguard.z1);
        z1 = Math.max(l.handguard.z0, l.handguard.z1);
      }
    } catch {
      /* keep the socket-centred span */
    }
    const [hw, hh, dy] = D.hg;
    _m.identity().setPosition(0, boreY - dy, (z0 + z1) / 2);
    shapes.push(box('handguard', _m, new Vector3(hw, hh, (z1 - z0) / 2), 0.011));
  }
  return {
    platform,
    pistol,
    set: new ShapeSet(shapes),
    gripCenter,
    gripDown,
    gripBack,
    gripHalf: new Vector3(gw, gl, gd),
    beavertail,
    triggerFace,
    triggerNormal: new Vector3(0, 0, -1),
    support,
    supportShape,
    mag: 'mag',
  };
}
