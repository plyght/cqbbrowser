import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HAND_POSES, POSE_SIZE } from '../anim/handPoses';
import { solveTwoBone } from '../anim/ik';
import { rigTextures } from './textures';

/** Arm segment lengths (m): shoulder→elbow, elbow→wrist. */
export const ARM = { upper: 0.31, fore: 0.29 };

/**
 * Hand frame (both sides): origin at the grasp centre (the axis the curled fingers wrap around), fingers along
 * -z, back of the hand +y, palm -y. Right hand's thumb is on -x, left hand's on +x (mirrored).
 */
export const WRIST = new Vector3(0, 0.034, 0.072);
const KNUCKLE_Y = 0.035;
const KNUCKLE_Z = -0.034;
const FINGERS = [
  { x: -0.029, len: [0.044, 0.026, 0.021], r: 0.0098, splay: 0.06 },
  { x: -0.0095, len: [0.048, 0.029, 0.023], r: 0.0102, splay: 0.015 },
  { x: 0.0095, len: [0.045, 0.027, 0.022], r: 0.0097, splay: -0.03 },
  { x: 0.028, len: [0.036, 0.021, 0.019], r: 0.0086, splay: -0.08 },
];
const THUMB = { x: -0.034, y: 0.022, z: 0.026, len: [0.04, 0.032, 0.026], r: 0.0112 };

/** Colours (sRGB hex). Glove: dark coyote synthetic back, darker suede palm, black TPR knuckles. */
export const PALETTE = {
  glove: 0x6e5c46,
  palm: 0x4d4234,
  knuckle: 0x1c1b19,
  cuff: 0x2e2a24,
  velcro: 0x24221e,
  sleeve: 0xffffff,
};

// Bones.
const B_UPPER = 0,
  B_FORE = 1,
  B_TWIST = 2,
  B_HAND = 3,
  B_THUMB = 16,
  NB = 19;
const fingerBone = (f: number, j: number) => 4 + f * 3 + j;

const L1 = ARM.upper,
  L2 = ARM.fore;

// ------------------------------------------------------------------ geometry building

interface Acc {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  si: number[];
  sw: number[];
  idx: number[];
}

type Skin = [number, number, number, number];

const _p = new Vector3();
const _n = new Vector3();
const _c = new Color();

/** Append a geometry already in arm (bind) space. `skin(p)` returns [bone0, w0, bone1, w1]. */
function append(
  a: Acc,
  g: BufferGeometry,
  skin: (p: Vector3) => Skin,
  paint: (p: Vector3, n: Vector3) => number,
  uvf?: (p: Vector3, n: Vector3) => [number, number],
) {
  const P = g.getAttribute('position'),
    N = g.getAttribute('normal');
  const U = g.getAttribute('uv');
  const base = a.pos.length / 3;
  for (let i = 0; i < P.count; i++) {
    _p.fromBufferAttribute(P, i);
    _n.fromBufferAttribute(N, i);
    a.pos.push(_p.x, _p.y, _p.z);
    a.nor.push(_n.x, _n.y, _n.z);
    if (uvf) a.uv.push(...uvf(_p, _n));
    else if (U) a.uv.push(U.getX(i), U.getY(i));
    else a.uv.push(0.75, 0.5);
    _c.setHex(paint(_p, _n));
    a.col.push(_c.r, _c.g, _c.b);
    const [b0, w0, b1, w1] = skin(_p);
    a.si.push(b0, b1, 0, 0);
    a.sw.push(w0, w1, 0, 0);
  }
  const index = g.getIndex();
  if (index) for (let i = 0; i < index.count; i++) a.idx.push(base + index.getX(i));
  else for (let i = 0; i < P.count; i++) a.idx.push(base + i);
  g.dispose();
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Smooth rounded box: subdivided box pushed out from an inner core (soft normals after merge). */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 4): BufferGeometry {
  let g: BufferGeometry = new BoxGeometry(w, h, d, seg, seg, seg);
  const P = g.getAttribute('position');
  const hx = w / 2 - r,
    hy = h / 2 - r,
    hz = d / 2 - r;
  for (let i = 0; i < P.count; i++) {
    _p.fromBufferAttribute(P, i);
    const cx = Math.max(-hx, Math.min(hx, _p.x)),
      cy = Math.max(-hy, Math.min(hy, _p.y)),
      cz = Math.max(-hz, Math.min(hz, _p.z));
    _n.set(_p.x - cx, _p.y - cy, _p.z - cz);
    if (_n.lengthSq() < 1e-12) _n.set(0, 1, 0);
    _n.normalize().multiplyScalar(r);
    P.setXYZ(i, cx + _n.x, cy + _n.y, cz + _n.z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

/** Capsule from 0 to -len along z (caps overlap neighbours so knuckles never gap). */
function phalanx(r: number, len: number, flat = 0.88): BufferGeometry {
  const g = new CapsuleGeometry(r, len, 4, 10);
  g.rotateX(-Math.PI / 2);
  g.scale(1, flat, 1);
  g.translate(0, 0, -len / 2);
  return g;
}

/**
 * The sleeved arm as one continuous lathe: radius profile (deltoid, biceps, elbow, forearm belly, wrist),
 * elliptical cross-section, cylindrical UVs into the sleeve half of the atlas.
 */
const PROFILE: [number, number, number][] = [
  // z (bind, arm along -z), radius, y-squash
  [0.05, 0.05, 0.9],
  [0.03, 0.062, 0.92],
  [0.0, 0.066, 0.92],
  [-0.06, 0.06, 0.92],
  [-0.14, 0.056, 0.93],
  [-0.22, 0.052, 0.92],
  [-L1 + 0.03, 0.049, 0.9],
  [-L1, 0.05, 0.9],
  [-L1 - 0.03, 0.05, 0.86],
  [-L1 - 0.07, 0.052, 0.82],
  [-L1 - 0.13, 0.047, 0.8],
  [-L1 - 0.19, 0.041, 0.78],
  [-L1 - L2 + 0.05, 0.037, 0.78],
  [-L1 - L2 + 0.025, 0.04, 0.8], // loose cuff lip
  [-L1 - L2 + 0.012, 0.0405, 0.8],
  [-L1 - L2 + 0.008, 0.033, 0.8], // fold under the cuff
];

function sleeve(): BufferGeometry {
  const RAD = 20;
  const rings: [number, number, number][] = [];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [z0, r0, s0] = PROFILE[i],
      [z1, r1, s1] = PROFILE[i + 1];
    const n = Math.max(1, Math.round(Math.abs(z1 - z0) / 0.02));
    for (let k = 0; k < n; k++) {
      const t = k / n,
        e = t * t * (3 - 2 * t);
      rings.push([z0 + (z1 - z0) * t, r0 + (r1 - r0) * e, s0 + (s1 - s0) * e]);
    }
  }
  rings.push(PROFILE[PROFILE.length - 1]);
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const circ = 2 * Math.PI * 0.055;
  for (let r = 0; r < rings.length; r++) {
    const [z, rad, sq] = rings[r];
    for (let k = 0; k <= RAD; k++) {
      const a = (k / RAD) * Math.PI * 2;
      // Seam on the inside of the arm (-x).
      pos.push(Math.cos(a + Math.PI) * rad, Math.sin(a + Math.PI) * rad * sq, z);
      uv.push((k / RAD) * 0.5, -z / circ);
    }
  }
  for (let r = 0; r < rings.length - 1; r++)
    for (let k = 0; k < RAD; k++) {
      const a = r * (RAD + 1) + k,
        b = a + RAD + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Box-projected UVs into the glove half of the atlas (constant texel density). */
const gloveUV = (p: Vector3, n: Vector3): [number, number] => {
  const ax = Math.abs(n.x),
    ay = Math.abs(n.y),
    az = Math.abs(n.z);
  const s = 2.4;
  if (ay >= ax && ay >= az) return [0.75 + p.x * s, 0.5 + p.z * s];
  if (ax >= az) return [0.75 + p.z * s * 0.5, 0.5 + p.y * s];
  return [0.75 + p.x * s, 0.5 + p.y * s];
};

const ZERO_POSE = new Float32Array(POSE_SIZE);
const _m = new Matrix4();
const _l = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'ZYX');
const _v = new Vector3();
const _one = new Vector3(1, 1, 1);

/** m = m * T(x,y,z) * R(e). */
function mulTR(m: Matrix4, x: number, y: number, z: number, e: Euler) {
  _q.setFromEuler(e);
  _l.compose(_v.set(x, y, z), _q, _one);
  m.multiply(_l);
}

/** Finger/thumb forward kinematics from a hand matrix; writes bone matrices into `out`. */
function fingerFK(hand: Matrix4, s: number, c: Float32Array, out: Matrix4[]) {
  for (let f = 0; f < 4; f++) {
    const fd = FINGERS[f];
    _m.copy(hand);
    _e.set(c[f * 3], s * fd.splay, 0);
    mulTR(_m, s * fd.x, KNUCKLE_Y, KNUCKLE_Z, _e);
    out[fingerBone(f, 0)].copy(_m);
    for (let j = 1; j < 3; j++) {
      _e.set(c[f * 3 + j], 0, 0);
      mulTR(_m, 0, 0, -fd.len[j - 1], _e);
      out[fingerBone(f, j)].copy(_m);
    }
  }
  _m.copy(hand);
  _e.set(-0.3 + c[13] * 0.3, s * 0.75, s * (0.35 + c[12]));
  mulTR(_m, s * THUMB.x, THUMB.y, THUMB.z, _e);
  out[B_THUMB].copy(_m);
  for (let j = 1; j < 3; j++) {
    _e.set(c[12 + j], 0, 0);
    mulTR(_m, 0, 0, -THUMB.len[j - 1], _e);
    out[B_THUMB + j].copy(_m);
  }
}

/** Bind pose: arm straight along -z, palm down. Bone bind matrices (arm space). */
function bindPose(s: 1 | -1): Matrix4[] {
  const binds = Array.from({ length: NB }, () => new Matrix4());
  binds[B_FORE].makeTranslation(0, 0, -L1);
  binds[B_TWIST].makeTranslation(0, 0, -L1);
  binds[B_HAND].makeTranslation(-WRIST.x, -WRIST.y, -L1 - L2 - WRIST.z);
  fingerFK(binds[B_HAND], s, ZERO_POSE, binds);
  return binds;
}

function buildArm(s: 1 | -1, binds: Matrix4[]): BufferGeometry {
  const a: Acc = { pos: [], nor: [], uv: [], col: [], si: [], sw: [], idx: [] };
  // Sleeve: smooth weights across the elbow; the forearm twists progressively toward the hand's roll.
  append(
    a,
    sleeve(),
    (p): Skin => {
      const z = -p.z;
      const toFore = smooth(L1 - 0.045, L1 + 0.045, z);
      if (toFore <= 0) return [B_UPPER, 1, 0, 0];
      if (toFore < 1) return [B_UPPER, 1 - toFore, B_FORE, toFore];
      const tw = smooth(L1 + 0.06, L1 + L2 - 0.05, z);
      return [B_FORE, 1 - tw, B_TWIST, tw];
    },
    () => PALETTE.sleeve,
  );
  const rigid = (b: number) => (): Skin => [b, 1, 0, 0];
  const add = (g: BufferGeometry, b: number, paint: (p: Vector3, n: Vector3) => number) => {
    g.applyMatrix4(binds[b]);
    append(a, g, rigid(b), paint, gloveUV);
  };
  const flat = (hex: number) => () => hex;
  // Glove cuff tucked under the sleeve, with a velcro tab.
  {
    const g = new CapsuleGeometry(0.036, 0.06, 4, 18);
    g.rotateX(-Math.PI / 2);
    g.scale(1, 0.82, 1);
    g.translate(0, WRIST.y, WRIST.z + 0.025);
    add(g, B_HAND, flat(PALETTE.cuff));
    const t = roundedBox(0.034, 0.008, 0.05, 0.003, 2);
    t.translate(s * 0.006, WRIST.y + 0.03, WRIST.z + 0.01);
    add(t, B_HAND, flat(PALETTE.velcro));
  }
  // Palm + back of the hand: soft rounded block, suede underside, thenar pad, hard knuckle bridge.
  {
    const g = roundedBox(0.088, 0.032, 0.104, 0.013, 5);
    g.translate(0, 0.036, 0.016);
    add(g, B_HAND, (_p, n) => (n.y < -0.35 ? PALETTE.palm : PALETTE.glove));
    const thenar = roundedBox(0.036, 0.022, 0.05, 0.01, 3);
    thenar.translate(s * -0.026, 0.024, 0.04);
    add(thenar, B_HAND, flat(PALETTE.palm));
    const k = roundedBox(0.082, 0.012, 0.03, 0.005, 3);
    k.translate(0, 0.055, -0.022);
    add(k, B_HAND, flat(PALETTE.knuckle));
    const back = roundedBox(0.06, 0.007, 0.05, 0.003, 2);
    back.translate(s * 0.004, 0.052, 0.025);
    add(back, B_HAND, flat(PALETTE.knuckle));
  }
  // Fingers: capsules per phalanx (overlapping joints), TPR armour on the proximal segment.
  FINGERS.forEach((fd, f) => {
    for (let j = 0; j < 3; j++) {
      const r = fd.r * (1 - j * 0.07);
      add(phalanx(r, fd.len[j]), fingerBone(f, j), flat(PALETTE.glove));
      if (j === 0) {
        const pad = roundedBox(r * 1.9, 0.006, fd.len[0] * 0.6, 0.0025, 2);
        pad.translate(0, r * 0.82, -fd.len[0] * 0.5);
        add(pad, fingerBone(f, 0), flat(PALETTE.knuckle));
      }
    }
  });
  for (let j = 0; j < 3; j++)
    add(
      phalanx(THUMB.r * (1 - j * 0.08), THUMB.len[j], 0.9),
      B_THUMB + j,
      flat(j === 0 ? PALETTE.palm : PALETTE.glove),
    );

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(a.nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(a.uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(a.col, 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(a.si, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(a.sw, 4));
  g.setIndex(a.idx);
  return g;
}

let sharedMat: MeshStandardMaterial | null = null;
function armMaterial() {
  if (sharedMat) return sharedMat;
  const t = rigTextures();
  sharedMat = new MeshStandardMaterial({
    vertexColors: true,
    map: t.map,
    normalMap: t.normal,
    roughnessMap: t.rough,
    roughness: 1,
    metalness: 0,
  });
  sharedMat.normalScale.set(0.9, 0.9);
  return sharedMat;
}

// ------------------------------------------------------------------ runtime

const _wrist = new Vector3();
const _elbow = new Vector3();
const _end = new Vector3();
const _d1 = new Vector3();
const _d2 = new Vector3();
const _sw = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _hy = new Vector3();
const _mats: Matrix4[] = Array.from({ length: NB }, () => new Matrix4());

/**
 * Procedural sleeved arm + tactical glove as one skinned mesh (1 draw call): lathe-profiled sleeve with
 * smooth elbow weights and a progressive forearm twist, rounded glove with articulated capsule fingers.
 * Driven by two-bone IK (elbow toward the pole: down and out).
 */
export class ArmRig {
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  /** World inputs set by the caller each frame. */
  readonly shoulder = new Vector3();
  readonly pole = new Vector3();
  readonly handPos = new Vector3();
  readonly handQuat = new Quaternion();
  readonly curls = new Float32Array(POSE_SIZE);
  readonly elbow = new Vector3();
  reached = true;

  constructor(readonly side: 1 | -1) {
    const binds = bindPose(side);
    const geo = buildArm(side, binds);
    this.bones = Array.from({ length: NB }, () => new Bone());
    const skeleton = new Skeleton(
      this.bones,
      binds.map((m) => m.clone().invert()),
    );
    this.mesh = new SkinnedMesh(geo, armMaterial());
    this.mesh.bind(skeleton, new Matrix4());
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.curls.set(HAND_POSES.relaxed);
  }

  update() {
    const B = this.bones;
    _wrist.copy(WRIST).applyQuaternion(this.handQuat).add(this.handPos);
    this.reached = solveTwoBone(this.shoulder, _wrist, this.pole, ARM.upper, ARM.fore, _elbow, _end);
    // Out of reach: the hand stays on the forearm rather than detaching from it.
    if (!this.reached) this.handPos.add(_end).sub(_wrist);
    this.elbow.copy(_elbow);

    // Shared hinge axis for upper arm and forearm so the elbow bends cleanly (no candy-wrapping).
    _d1.subVectors(_elbow, this.shoulder).normalize();
    _d2.subVectors(_end, _elbow).normalize();
    _sw.subVectors(_end, this.shoulder).normalize();
    // Bend side: the elbow's offset from the shoulder→wrist line (toward the pole).
    _y.subVectors(_elbow, this.shoulder);
    _y.addScaledVector(_sw, -_y.dot(_sw));
    if (_y.lengthSq() < 1e-8) {
      _y.subVectors(this.pole, this.shoulder);
      _y.addScaledVector(_d1, -_y.dot(_d1));
    }
    // Bind +y is the inside of the elbow; the elbow point (-y) faces the pole.
    _y.normalize().negate();
    _z.copy(_d1).negate();
    _x.crossVectors(_y, _z).normalize();
    _y.crossVectors(_z, _x);
    B[B_UPPER].matrixWorld.makeBasis(_x, _y, _z).setPosition(this.shoulder);
    _z.copy(_d2).negate();
    _y.crossVectors(_z, _x).normalize();
    B[B_FORE].matrixWorld.makeBasis(_x, _y, _z).setPosition(_elbow);
    // Twist bone: forearm roll toward the hand's back (clamped so skinning never collapses).
    _hy.set(0, 1, 0).applyQuaternion(this.handQuat);
    _hy.addScaledVector(_z, -_hy.dot(_z));
    if (_hy.lengthSq() > 1e-8) {
      _hy.normalize();
      let ang = Math.atan2(_v.crossVectors(_y, _hy).dot(_z), _y.dot(_hy));
      ang = Math.max(-1.3, Math.min(1.3, ang));
      _q.setFromAxisAngle(_z, ang);
      _x.applyQuaternion(_q);
      _y.applyQuaternion(_q);
    }
    B[B_TWIST].matrixWorld.makeBasis(_x, _y, _z).setPosition(_elbow);

    const hand = B[B_HAND].matrixWorld;
    hand.compose(this.handPos, this.handQuat, _one);
    fingerFK(hand, this.side, this.curls, _mats);
    for (let i = 4; i < NB; i++) B[i].matrixWorld.copy(_mats[i]);
  }
}

/** Bone at `a` with -z pointing to `b`; +y as close to `up` as possible. */
export function setSegment(bone: Bone, a: Vector3, b: Vector3, up: Vector3) {
  _z.subVectors(a, b).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).cross(_z);
  _x.normalize();
  _y.crossVectors(_z, _x);
  const m = bone.matrixWorld;
  m.makeBasis(_x, _y, _z);
  m.setPosition(a);
}
