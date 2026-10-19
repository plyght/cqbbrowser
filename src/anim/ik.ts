import { type Matrix4, Vector3 } from 'three';

const _dir = new Vector3();
const _pole = new Vector3();

/**
 * Analytic two-bone IK (shoulder → elbow → wrist, hip → knee → ankle).
 * Writes the joint (`outMid`) and end effector (`outEnd`) positions; bone lengths are always preserved.
 * The joint bends toward `pole`. When the target is out of reach the chain points straight at it.
 * Returns true when the target was reachable. Allocation-free; outputs must not alias the inputs.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  pole: Vector3,
  l1: number,
  l2: number,
  outMid: Vector3,
  outEnd: Vector3,
): boolean {
  _dir.subVectors(target, root);
  let dist = _dir.length();
  const reach = l1 + l2;
  const minD = Math.abs(l1 - l2) + 1e-4;
  const reached = dist <= reach + 1e-6 && dist >= minD;
  if (dist < 1e-6) {
    _dir.set(0, 0, -1);
    dist = 1e-6;
  } else _dir.divideScalar(dist);
  dist = Math.min(Math.max(dist, minD), reach * 0.99999);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Bend plane: pole direction made orthogonal to the root→target axis.
  _pole.subVectors(pole, root);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-10) {
    _pole.set(0, -1, 0).addScaledVector(_dir, _dir.y);
    if (_pole.lengthSq() < 1e-10) _pole.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
  }
  _pole.normalize();
  outMid.copy(root).addScaledVector(_dir, a).addScaledVector(_pole, h);
  outEnd.copy(root).addScaledVector(_dir, dist);
  return reached;
}

const _hz = new Vector3();
const _nat = new Vector3();
/**
 * Elbow pole for an arm reaching a hand frame: the swivel that lines the forearm up with the hand (+z of the hand
 * frame = toward the wrist/forearm) keeps the wrist near neutral; blended with the natural "down and out" pole
 * (`natural`, a direction from the shoulder) so elbows never flip up. Writes and returns `out` (a world point).
 */
export function armPole(
  shoulder: Vector3,
  wrist: Vector3,
  hand: Matrix4,
  natural: Vector3,
  out: Vector3,
  k = 0.9,
) {
  _hz.set(0, 0, 1).transformDirection(hand);
  _nat.copy(natural).normalize();
  out
    .copy(_hz)
    .multiplyScalar(k)
    .addScaledVector(_nat, 1 - k);
  return out.multiplyScalar(0.5).add(k > 0.5 ? wrist : shoulder);
}
