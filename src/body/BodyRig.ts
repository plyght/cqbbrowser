import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  Euler,
  type Bone,
  type SkinnedMesh,
} from 'three';
import { solveTwoBone } from '../anim/ik';
import type { Player } from '../player/Player';
import { ArmRig, setSegment } from './ArmRig';
import { C, SkinBuilder, ball, box, camo, cloth, makeSkinned, tube } from './skin';

/**
 * The visible body under the chest cam: plate carrier (plate bag, straps, camera housing), a hanging placard
 * with rifle mag pouches, belt with pistol pouches / dump pouch / holster, legs and boots — one skinned mesh —
 * plus two IK arms. ~4 draw calls total (body, 2 arms, invisible shadow-only head).
 */
const LEG = { thigh: 0.46, shin: 0.46 };
const HIP_X = 0.1;
const ANKLE_Y = 0.085;

const COL = {
  carrier: 0x6f6149,
  carrierDark: 0x544a38,
  webbing: 0x5b4f3b,
  polymer: 0x1d1e1f,
  belt: 0x3d3a31,
  pants: [0x7d7458, 0x5f5a40, 0x948a6a, 0x4a3f2f],
  boot: 0x6b5843,
  sole: 0x262320,
  knee: 0x232320,
  camera: 0x141516,
};

// Bone indices.
const SPINE = 0,
  PLACARD = 1,
  HIPS = 2,
  THIGH_L = 3,
  SHIN_L = 4,
  FOOT_L = 5,
  THIGH_R = 6,
  SHIN_R = 7,
  FOOT_R = 8,
  RMAG0 = 9, // 3 rifle mags (placard)
  PMAG0 = 12, // 2 pistol mags (belt)
  HOLSTERED = 14,
  NBONES = 15;

/** Placard hinge under the plate bag (spine frame) and pouch slots (placard frame, mag-top centre). */
const HINGE = new Vector3(0, -0.235, -0.108);
const RIFLE_SLOTS = [
  new Vector3(-0.08, -0.02, -0.042),
  new Vector3(0, -0.02, -0.042),
  new Vector3(0.08, -0.02, -0.042),
];
/** Pistol pouches on the left front of the belt and the dump pouch on the left hip (hips frame). */
const PISTOL_SLOTS = [new Vector3(-0.11, 0.115, -0.15), new Vector3(-0.155, 0.115, -0.125)];
const DUMP = new Vector3(-0.205, 0.02, -0.02);
const HOLSTER = new Vector3(0.2, -0.04, 0.0);

function buildBody() {
  const b = new SkinBuilder();
  const carrier = cloth(COL.carrier, 0.06, 1);
  const dark = cloth(COL.carrierDark, 0.05, 2);
  const web = cloth(COL.webbing, 0.05, 3);
  const pants = camo(COL.pants, 9, 5);
  const shirt = camo(COL.pants, 12, 11);
  // --- Spine: torso, plate bag, straps, cummerbund, camera housing ---
  b.add(box(0.33, 0.44, 0.2, 0, -0.06, 0.02), SPINE, shirt);
  b.add(box(0.29, 0.3, 0.055, 0, -0.075, -0.085), SPINE, carrier); // front plate bag
  b.add(box(0.29, 0.31, 0.05, 0, -0.08, 0.13), SPINE, carrier); // back plate bag
  for (const sx of [-1, 1]) {
    b.add(box(0.065, 0.05, 0.27, sx * 0.105, 0.105, 0.02), SPINE, dark); // shoulder straps
    b.add(box(0.035, 0.24, 0.23, sx * 0.165, -0.12, 0.02), SPINE, web); // cummerbund
  }
  for (let i = 0; i < 4; i++) b.add(box(0.27, 0.008, 0.004, 0, -0.03 - i * 0.045, -0.1135), SPINE, dark); // MOLLE rows
  b.add(box(0.06, 0.08, 0.022, -0.075, -0.012, -0.127), SPINE, C(COL.camera)); // camera housing (behind lens)
  b.add(box(0.07, 0.03, 0.01, -0.075, -0.06, -0.118), SPINE, C(0x2a2b2b)); // mount clip
  // --- Placard: triple rifle mag shingle ---
  b.add(box(0.27, 0.15, 0.028, 0, -0.075, -0.016), PLACARD, carrier);
  for (const s of RIFLE_SLOTS) {
    b.add(box(0.072, 0.11, 0.036, s.x, -0.075, s.z + 0.002), PLACARD, dark);
    b.add(box(0.074, 0.01, 0.038, s.x, -0.04, s.z + 0.002), PLACARD, web); // elastic band
  }
  // --- Hips: pants, belt, buckle, dump pouch, holster ---
  b.add(box(0.33, 0.22, 0.2, 0, 0.02, 0.01), HIPS, pants);
  b.add(box(0.36, 0.055, 0.245, 0, 0.12, 0.0), HIPS, cloth(COL.belt, 0.05, 4));
  b.add(box(0.06, 0.04, 0.01, 0, 0.12, -0.127), HIPS, C(0x1b1b1b));
  b.add(box(0.085, 0.14, 0.11, DUMP.x, DUMP.y - 0.03, DUMP.z), HIPS, dark);
  b.add(box(0.095, 0.03, 0.12, DUMP.x, DUMP.y + 0.045, DUMP.z), HIPS, web);
  for (const s of PISTOL_SLOTS) b.add(box(0.034, 0.085, 0.04, s.x, s.y - 0.045, s.z + 0.005), HIPS, dark);
  b.add(box(0.05, 0.19, 0.1, HOLSTER.x, HOLSTER.y - 0.06, HOLSTER.z), HIPS, C(COL.polymer));
  b.add(box(0.07, 0.04, 0.12, HOLSTER.x - 0.01, HOLSTER.y + 0.06, HOLSTER.z), HIPS, C(0x2b2b2b)); // belt drop
  // --- Legs (segments along -z, +y = front) ---
  for (const [thigh, shin, foot, seed] of [
    [THIGH_L, SHIN_L, FOOT_L, 1],
    [THIGH_R, SHIN_R, FOOT_R, 2],
  ]) {
    b.add(tube(0.082, 0.062, 0.03, -LEG.thigh, 12, 3), thigh, camo(COL.pants, 9, seed * 7));
    b.add(ball(0.062, 0, 0, -LEG.thigh, 10), thigh, pants);
    b.add(tube(0.06, 0.05, 0.0, -LEG.shin + 0.1, 12, 2), shin, camo(COL.pants, 9, seed * 13));
    b.add(box(0.095, 0.035, 0.11, 0, 0.055, -0.05), shin, C(COL.knee)); // knee pad
    b.add(tube(0.058, 0.056, -LEG.shin + 0.13, -LEG.shin - 0.01, 12, 1), shin, cloth(COL.boot, 0.06, seed));
    b.add(box(0.105, 0.1, 0.25, 0, -0.03, -0.06), foot, cloth(COL.boot, 0.06, seed + 3));
    b.add(box(0.112, 0.026, 0.27, 0, -0.085, -0.065), foot, C(COL.sole));
    b.add(box(0.1, 0.06, 0.07, 0, -0.045, -0.17, 0.4), foot, cloth(COL.boot, 0.08, seed + 5)); // toe
  }
  // --- Mags in pouches (separate bones so they can be hidden when drawn) ---
  for (let i = 0; i < 3; i++) {
    b.add(box(0.06, 0.03, 0.026, 0, -0.012, 0), RMAG0 + i, C(COL.polymer));
    b.add(box(0.066, 0.008, 0.03, 0, 0.004, 0), RMAG0 + i, C(0x2c2c2c)); // baseplate (stowed upside-down)
    b.add(box(0.016, 0.014, 0.006, 0, 0.012, -0.012), RMAG0 + i, C(0x6e2a1e)); // pull tab
  }
  for (let i = 0; i < 2; i++) b.add(box(0.024, 0.03, 0.036, 0, -0.005, 0), PMAG0 + i, C(COL.polymer));
  b.add(box(0.03, 0.09, 0.05, 0, 0.0, 0.015, -0.25), HOLSTERED, C(0x202122)); // pistol grip in holster
  return b.build();
}

const _v = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _one = new Vector3(1, 1, 1);
const _zero = new Vector3(0, 0, 0);
const _hip = new Vector3();
const _knee = new Vector3();
const _ankle = new Vector3();
const _target = new Vector3();
const _pole = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();

export class BodyRig {
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  readonly left = new ArmRig(-1);
  readonly right = new ArmRig(1);
  /** Shadow-only head + helmet so the body's shadow isn't headless. */
  readonly head: Mesh;
  /** Visible counts (driven by the magazine inventory). */
  rifleMags = 3;
  pistolMags = 2;
  pistolHolstered = true;
  readonly placard = new Matrix4();

  constructor() {
    const r = makeSkinned(buildBody(), NBONES, 0.9);
    this.mesh = r.mesh;
    this.bones = r.bones;
    const g = new SkinBuilder()
      .add(ball(0.11, 0, 0, 0, 10, 1.15), 0, C(0))
      .add(ball(0.125, 0, 0.04, 0, 10, 0.75), 0, C(0))
      .build();
    this.head = new Mesh(g, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.head.castShadow = true;
    this.head.matrixAutoUpdate = false;
    for (const m of [this.mesh, this.left.mesh, this.right.mesh]) {
      m.castShadow = true;
      m.receiveShadow = false;
    }
  }

  get objects() {
    return [this.mesh, this.left.mesh, this.right.mesh, this.head];
  }

  /** World position + orientation of the next rifle mag to draw. */
  rifleSlot(out: Vector3, outQ: Quaternion): void {
    const i = Math.max(0, 3 - this.rifleMags);
    out.copy(RIFLE_SLOTS[Math.min(2, i)]).applyMatrix4(this.placard);
    outQ.setFromRotationMatrix(this.placard);
  }

  pistolSlot(p: Player, out: Vector3, outQ: Quaternion): void {
    const i = Math.max(0, 2 - this.pistolMags);
    out.copy(PISTOL_SLOTS[Math.min(1, i)]).applyMatrix4(p.hips.matrixWorld);
    outQ.copy(p.hips.quaternion);
  }

  dump(p: Player, out: Vector3, outQ: Quaternion): void {
    out.copy(DUMP).applyMatrix4(p.hips.matrixWorld);
    outQ.copy(p.hips.quaternion);
  }

  update(p: Player) {
    const B = this.bones;
    // Spine (plate carrier).
    B[SPINE].matrixWorld.copy(p.spine.matrixWorld);
    // Placard hangs from the plate bag; it stays nearer vertical than the spine and swings with the carrier.
    _v.copy(HINGE).applyMatrix4(p.spine.matrixWorld);
    const spinePitch = p.pitch < 0 ? p.pitch * 0.3 : p.pitch * 0.08;
    _e.set(spinePitch * 0.95 + p.carrier.value * 1.6, p.yaw, -p.lean * p.tuning.leanAngle * 0.8, 'YXZ');
    _q.setFromEuler(_e);
    this.placard.compose(_v, _q, _one);
    B[PLACARD].matrixWorld.copy(this.placard);
    for (let i = 0; i < 3; i++) {
      // Slots empty from the left (the support hand draws the nearest first).
      const show = i >= 3 - this.rifleMags;
      _v.copy(RIFLE_SLOTS[i]).applyMatrix4(this.placard);
      B[RMAG0 + i].matrixWorld.compose(_v, _q, show ? _one : _zero);
    }
    // Hips, belt kit.
    const hips = p.hips.matrixWorld;
    B[HIPS].matrixWorld.copy(hips);
    for (let i = 0; i < 2; i++) {
      const show = i >= 2 - this.pistolMags;
      _v.copy(PISTOL_SLOTS[i]).applyMatrix4(hips);
      B[PMAG0 + i].matrixWorld.compose(_v, p.hips.quaternion, show ? _one : _zero);
    }
    _v.copy(HOLSTER).applyMatrix4(hips);
    _v.y += 0.07;
    B[HOLSTERED].matrixWorld.compose(_v, p.hips.quaternion, this.pistolHolstered ? _one : _zero);

    this.updateLegs(p);

    // Shadow head above the neck.
    _v.set(0, 0.32, 0.02).applyMatrix4(p.spine.matrixWorld);
    _e.set(p.pitch * 0.6, p.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    this.head.matrix.compose(_v, _q, _one);
    this.head.matrixWorld.copy(this.head.matrix);
  }

  private updateLegs(p: Player) {
    const B = this.bones;
    _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const ground = p.feet.y;
    const g = p.gaitAmount;
    const stride = (p.sprinting ? 0.42 : 0.3) * g;
    const lift = (p.sprinting ? 0.14 : 0.08) * g;
    for (let leg = 0; leg < 2; leg++) {
      const side = leg === 0 ? -1 : 1;
      const thigh = leg === 0 ? THIGH_L : THIGH_R,
        shin = leg === 0 ? SHIN_L : SHIN_R,
        foot = leg === 0 ? FOOT_L : FOOT_R;
      _hip.copy(p.hips.position).addScaledVector(_right, side * HIP_X);
      // Stance: foot planted, sweeping back; swing: lifted, forward.
      const u = (((p.gaitPhase + (leg === 0 ? 0 : Math.PI)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const stance = u < Math.PI;
      const along = stance ? 1 - (2 * u) / Math.PI : -1 + (2 * (u - Math.PI)) / Math.PI;
      const up = stance ? 0 : Math.sin(u - Math.PI) * lift;
      _target
        .set(p.feet.x, ground + ANKLE_Y + up, p.feet.z)
        .addScaledVector(_right, side * (HIP_X + 0.02) + p.lean * 0.05)
        .addScaledVector(p.moveDir, along * stride)
        .addScaledVector(_fwd, 0.04 + p.crouch * 0.12 * (leg === 0 ? 1.6 : -0.6));
      _pole
        .copy(_hip)
        .addScaledVector(_fwd, 0.6)
        .addScaledVector(_right, side * 0.1);
      _pole.y -= 0.2;
      solveTwoBone(_hip, _target, _pole, LEG.thigh, LEG.shin, _knee, _ankle);
      _up.copy(_fwd);
      setSegment(B[thigh], _hip, _knee, _up);
      setSegment(B[shin], _knee, _ankle, _up);
      // Boot: flat on the ground, toe slightly out; toe-off pitch during swing.
      _e.set(stance ? 0 : -0.25 * Math.sin(u - Math.PI) * g, p.yaw - side * 0.12, 0, 'YXZ');
      _q.setFromEuler(_e);
      B[foot].matrixWorld.compose(_ankle, _q, _one);
    }
  }
}
