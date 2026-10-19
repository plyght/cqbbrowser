import { describe, expect, test } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { aimAxis, canonicalBoneName, localDelta, proximity, retargetWorld, solveArm } from './retarget';
import { blendPose, makeLayout, samplePose, type Clip } from './pose';
import { decodeF32, decodeQ16, encodeF32, encodeQ16 } from './clipData';

const q = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z));
const close = (a: Quaternion, b: Quaternion, eps = 1e-5) =>
  expect(Math.abs(a.dot(b))).toBeGreaterThan(1 - eps);

describe('retarget math', () => {
  test('canonical names strip the Mixamo prefix (with or without colon)', () => {
    expect(canonicalBoneName('mixamorig7LeftHand')).toBe('LeftHand');
    expect(canonicalBoneName('mixamorig2:RightHandIndex1')).toBe('RightHandIndex1');
    expect(canonicalBoneName('Bone')).toBe('Bone');
  });

  test('local delta: animation equal to the source bind gives the target bind', () => {
    const sb = q(0.3, -0.2, 0.9);
    const db = q(-0.1, 0.4, 0.2);
    close(localDelta(sb, sb, db), db);
  });

  test('local delta carries the source rotation away from bind onto the target bind', () => {
    const sb = q(0.3, -0.2, 0.9);
    const db = q(-0.1, 0.4, 0.2);
    const d = q(0.5, 0.1, -0.3);
    const anim = sb.clone().multiply(d);
    close(localDelta(sb, anim, db), db.clone().multiply(d));
  });

  test('world retarget keeps the bone frame offset of the bind poses', () => {
    const sBind = q(0.2, 0.1, 0);
    const dBind = q(0.25, 0.05, 0.02);
    const sWorld = q(1.1, -0.4, 0.3);
    const r = retargetWorld(sWorld, sBind, dBind);
    // At bind the target equals its own bind.
    close(retargetWorld(sBind, sBind, dBind), dBind);
    // The relative rotation between source and target frames is the bind offset.
    close(sWorld.clone().invert().multiply(r), sBind.clone().invert().multiply(dBind));
  });

  test('aimAxis swings the bone axis onto a direction', () => {
    const r = aimAxis(q(0.4, 0.2, -0.3), new Vector3(0, 1, 0), new Vector3(1, 1, 0));
    const y = new Vector3(0, 1, 0).applyQuaternion(r);
    expect(y.distanceTo(new Vector3(1, 1, 0).normalize())).toBeLessThan(1e-6);
  });

  test('two-bone arm solve puts the wrist on a reachable target with bone lengths kept', () => {
    const sh = new Vector3(0.2, -0.15, 0.05);
    const target = new Vector3(0.05, -0.1, -0.35);
    const s = solveArm(sh, 0.24, 0.23, target, new Vector3(0.4, -0.5, 0), new Quaternion(), new Quaternion());
    expect(s.reached).toBe(true);
    expect(s.wrist.distanceTo(target)).toBeLessThan(1e-5);
    expect(s.elbow.distanceTo(sh)).toBeCloseTo(0.24, 5);
    expect(s.elbow.distanceTo(s.wrist)).toBeCloseTo(0.23, 5);
    // Bones point along +Y from joint to joint.
    const yU = new Vector3(0, 1, 0).applyQuaternion(s.upper);
    expect(yU.distanceTo(s.elbow.clone().sub(sh).normalize())).toBeLessThan(1e-5);
    // Elbow bends toward the pole side (down).
    const mid = sh.clone().lerp(target, 0.5);
    expect(s.elbow.y).toBeLessThan(mid.y);
  });

  test('proximity weight', () => {
    expect(proximity(0.01, 0.02, 0.06)).toBe(1);
    expect(proximity(0.08, 0.02, 0.06)).toBe(0);
    expect(proximity(0.04, 0.02, 0.06)).toBeCloseTo(0.5, 5);
  });
});

describe('clip encoding and pose vectors', () => {
  test('f32 / q16 round trip', () => {
    const f = [0, 1.5, -2.25, 1e-3];
    expect(Array.from(decodeF32(encodeF32(f)))).toEqual(f.map((x) => Math.fround(x)));
    const qs = [0.5, -0.5, 0.5, -0.5, 0, 0, 0, 1];
    decodeQ16(encodeQ16(qs)).forEach((v, i) => expect(v).toBeCloseTo(qs[i], 4));
  });

  test('blendPose nlerps quaternion slots and lerps the rest', () => {
    const L = makeLayout(['A']);
    const a = new Float32Array(L.stride);
    const b = new Float32Array(L.stride);
    a.set([0, 0, 0, 1], L.rot);
    const qb = q(0, Math.PI / 2, 0);
    b.set([qb.x, qb.y, qb.z, qb.w], L.rot);
    a[L.gunW] = 0;
    b[L.gunW] = 1;
    const out = new Float32Array(L.stride);
    blendPose(L, out, a, 0, b, 0, 0.5);
    expect(out[L.gunW]).toBeCloseTo(0.5, 6);
    const mid = new Quaternion(out[0], out[1], out[2], out[3]);
    close(mid, q(0, Math.PI / 4, 0), 1e-4);
  });

  test('samplePose interpolates between frames', () => {
    const L = makeLayout(['A']);
    const data = new Float32Array(L.stride * 2);
    data[L.ch.bolt] = 0;
    data[L.stride + L.ch.bolt] = 1;
    data.set([0, 0, 0, 1], L.rot);
    data.set([0, 0, 0, 1], L.stride + L.rot);
    const clip = { fps: 10, frames: 2, layout: L, data } as unknown as Clip;
    const out = new Float32Array(L.stride);
    samplePose(clip, 0.025, out);
    expect(out[L.ch.bolt]).toBeCloseTo(0.25, 5);
  });
});
