/**
 * Finger curl poses. Layout (15 floats): index, middle, ring, pinky as [knuckle, mid, tip] curl in radians
 * (negative = toward the palm), then thumb as [oppose, base, tip].
 */
export type HandPoseName =
  'relaxed' | 'grip' | 'trigger' | 'support' | 'cclamp' | 'magGrab' | 'pinch' | 'flat' | 'fist' | 'cam';

export const POSE_SIZE = 15;

const f = (a: number, b: number, c: number) => [a, b, c];

function pose(index: number[], middle: number[], ring: number[], pinky: number[], thumb: number[]) {
  return Float32Array.from([...index, ...middle, ...ring, ...pinky, ...thumb]);
}

const wrap = f(-1.3, -1.45, -1.0);

export const HAND_POSES: Record<HandPoseName, Float32Array> = {
  relaxed: pose(
    f(-0.4, -0.5, -0.3),
    f(-0.5, -0.6, -0.35),
    f(-0.55, -0.65, -0.4),
    f(-0.6, -0.7, -0.45),
    f(0.4, -0.2, -0.2),
  ),
  // Trigger finger indexed straight along the receiver (trigger discipline).
  grip: pose(f(-0.12, -0.08, -0.05), wrap, wrap, wrap, f(0.9, -0.45, -0.35)),
  trigger: pose(f(-0.75, -0.95, -0.5), wrap, wrap, wrap, f(0.9, -0.45, -0.35)),
  support: pose(
    f(-0.85, -1.0, -0.7),
    f(-0.95, -1.1, -0.75),
    f(-1.0, -1.15, -0.8),
    f(-1.05, -1.2, -0.8),
    f(0.55, -0.25, -0.15),
  ),
  // Thumb over the top of the handguard, fingers wrapped beneath.
  cclamp: pose(
    f(-0.95, -1.05, -0.7),
    f(-1.05, -1.15, -0.8),
    f(-1.1, -1.2, -0.85),
    f(-1.15, -1.25, -0.85),
    f(0.1, -0.1, -0.05),
  ),
  magGrab: pose(
    f(-0.85, -0.85, -0.55),
    f(-0.95, -0.95, -0.6),
    f(-1.0, -1.0, -0.6),
    f(-1.05, -1.05, -0.65),
    f(0.85, -0.35, -0.3),
  ),
  pinch: pose(
    f(-1.2, -1.3, -0.9),
    f(-1.25, -1.35, -0.9),
    f(-1.45, -1.5, -1.0),
    f(-1.45, -1.5, -1.0),
    f(0.5, -0.6, -0.5),
  ),
  flat: pose(
    f(-0.08, -0.08, -0.04),
    f(-0.08, -0.08, -0.04),
    f(-0.1, -0.1, -0.05),
    f(-0.12, -0.1, -0.05),
    f(0.2, 0, 0),
  ),
  fist: pose(
    f(-1.5, -1.6, -1.1),
    f(-1.5, -1.6, -1.1),
    f(-1.5, -1.6, -1.1),
    f(-1.5, -1.6, -1.1),
    f(1.0, -0.6, -0.5),
  ),
  cam: pose(
    f(-0.55, -0.4, -0.2),
    f(-0.6, -0.45, -0.25),
    f(-0.7, -0.5, -0.3),
    f(-0.8, -0.55, -0.3),
    f(0.6, -0.4, -0.2),
  ),
};

export function blendPose(a: Float32Array, b: Float32Array, k: number, out: Float32Array): Float32Array {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}
