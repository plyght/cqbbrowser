import { describe, expect, test } from 'bun:test';
import {
  ADS_SWING,
  GaitMotion,
  STABLE_ROLL,
  StepSmoother,
  emptyGaitOut,
  stepCadence,
  type GaitFrame,
  type GaitOut,
  type GaitScales,
} from './gait';

const DT = 1 / 60;
const SC: GaitScales = { sway: 1, shake: 1, stable: false, inertia: 1 };

interface Run {
  t: number[];
  out: GaitOut[];
  strikes: number;
}

const frame = (o: Partial<GaitFrame> = {}): GaitFrame => ({
  phase: 0,
  speed: 0,
  amount: 0,
  accelFwd: 0,
  strafe: 0,
  yawRate: 0,
  yawAccel: 0,
  crouch: 0,
  stress: 0,
  ads: 0,
  grounded: true,
  ...o,
});

/** Drive the model like `Player` does: phase ∝ cadence(speed), a strike each time the phase crosses a multiple of π. */
function walk(
  speed: number | ((t: number) => number),
  seconds: number,
  o: { crouch?: number; ads?: number; sc?: Partial<GaitScales>; strafe?: number } = {},
): Run {
  const m = new GaitMotion();
  const sc = { ...SC, ...o.sc };
  let phase = 0;
  let amount = 0;
  let prevV = typeof speed === 'number' ? speed : speed(0);
  const run: Run = { t: [], out: [], strikes: 0 };
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const v = typeof speed === 'number' ? speed : speed(i * DT);
    const before = Math.floor(phase / Math.PI);
    phase += Math.PI * stepCadence(v, o.crouch ?? 0) * DT;
    amount += (Math.min(1, v / 1.2) - amount) * (1 - Math.pow(2, -DT / 0.12));
    if (Math.floor(phase / Math.PI) !== before && v > 0.25) {
      m.strike(Math.floor(phase / Math.PI) % 2 === 0 ? 'L' : 'R', v, o.crouch ?? 0);
      run.strikes++;
    }
    m.update(
      DT,
      frame({
        phase,
        speed: v,
        amount,
        accelFwd: (v - prevV) / DT,
        strafe: o.strafe ?? 0,
        crouch: o.crouch ?? 0,
        ads: o.ads ?? 0,
      }),
      sc,
    );
    prevV = v;
    run.t.push(i * DT);
    run.out.push({ ...m.out });
  }
  return run;
}

const tail = (r: Run, from = 3) => r.out.filter((_, i) => r.t[i] >= from);
const pp = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Zero crossings of the mean-removed signal per second, halved (dominant cycles per second). */
function cyclesPerSecond(xs: number[], seconds: number) {
  const m = mean(xs);
  let c = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] - m < 0 !== xs[i] - m < 0) c++;
  return c / 2 / seconds;
}

describe('gait cadence', () => {
  test('walk is 1.8–2.0 steps/s, sprint 2.6–3.0, crouch-walk slower', () => {
    expect(stepCadence(2.2)).toBeGreaterThanOrEqual(1.8);
    expect(stepCadence(2.2)).toBeLessThanOrEqual(2.0);
    expect(stepCadence(5.0)).toBeGreaterThanOrEqual(2.6);
    expect(stepCadence(5.0)).toBeLessThanOrEqual(3.0);
    expect(stepCadence(1.2, 1)).toBeLessThan(stepCadence(2.2));
    // Stress quickens it a little but stays inside the targets.
    expect(stepCadence(2.2, 0, 1)).toBeLessThanOrEqual(2.0);
    expect(stepCadence(5.0, 0, 1)).toBeLessThanOrEqual(3.0);
  });
  test('cadence rises monotonically with speed', () => {
    let prev = 0;
    for (let v = 0; v <= 5.5; v += 0.1) {
      const c = stepCadence(v);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
  test('measured vertical bob frequency equals the step rate (one dip per step)', () => {
    for (const v of [2.2, 5.0]) {
      const r = walk(v, 12);
      const ys = tail(r, 2).map((o) => o.y);
      const want = stepCadence(v);
      expect(Math.abs(cyclesPerSecond(ys, 10) - want)).toBeLessThan(0.2);
      expect(r.strikes / 12).toBeGreaterThan(want - 0.25);
    }
  });
});

describe('gait amplitudes', () => {
  test('walking chest bob is 2–4 cm peak to peak', () => {
    const y = tail(walk(2.2, 10)).map((o) => o.y);
    expect(pp(y)).toBeGreaterThan(0.02);
    expect(pp(y)).toBeLessThan(0.04);
  });
  test('sprinting chest bob is 5–8 cm peak to peak', () => {
    const y = tail(walk(5.0, 10)).map((o) => o.y);
    expect(pp(y)).toBeGreaterThan(0.05);
    expect(pp(y)).toBeLessThan(0.08);
  });
  test('lateral weight shift is 1–2 cm walking and alternates', () => {
    const x = tail(walk(2.2, 10)).map((o) => o.x);
    expect(pp(x)).toBeGreaterThan(0.01);
    expect(pp(x)).toBeLessThan(0.02);
    expect(Math.min(...x)).toBeLessThan(0);
    expect(Math.max(...x)).toBeGreaterThan(0);
    // One side-to-side cycle per stride = half the step rate.
    expect(Math.abs(cyclesPerSecond(x, 7) - stepCadence(2.2) / 2)).toBeLessThan(0.15);
  });
  test('torso yaw and roll counter-rotate and grow with speed', () => {
    const w = tail(walk(2.2, 10));
    const s = tail(walk(5, 10));
    expect(pp(s.map((o) => o.roll))).toBeGreaterThan(pp(w.map((o) => o.roll)));
    expect(pp(s.map((o) => o.yaw))).toBeGreaterThan(pp(w.map((o) => o.yaw)));
    expect(pp(w.map((o) => o.roll))).toBeGreaterThan(0.01);
    expect(pp(w.map((o) => o.roll))).toBeLessThan(0.06);
  });
  test('crouch-walk is smaller than the standing walk at the same speed', () => {
    const stand = pp(tail(walk(1.2, 10)).map((o) => o.y));
    const crouch = pp(tail(walk(1.2, 10, { crouch: 1 })).map((o) => o.y));
    expect(crouch).toBeLessThan(stand * 0.8);
  });
  test('standing still adds nothing', () => {
    for (const o of walk(0, 3).out) for (const v of Object.values(o)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
});

describe('gun swing', () => {
  test('hip swing is out of phase with the chest bob', () => {
    const o = tail(walk(2.2, 10));
    const dot = o.reduce((s, q) => s + q.y * q.gunY, 0);
    const norm = Math.sqrt(o.reduce((s, q) => s + q.y * q.y, 0) * o.reduce((s, q) => s + q.gunY * q.gunY, 0));
    // Shifted by ~0.9 rad of the step cycle: clearly not locked to the camera.
    expect(Math.abs(dot / norm)).toBeLessThan(0.8);
  });
  test('sprint swings bigger than walk', () => {
    const w = pp(tail(walk(2.2, 10)).map((o) => o.gunRoll));
    const s = pp(tail(walk(5, 10)).map((o) => o.gunRoll));
    expect(s).toBeGreaterThan(w * 2);
  });
  test('walking at the ready traces a figure-8 (x once per stride, y twice)', () => {
    const o = tail(walk(2.2, 10));
    const fx = cyclesPerSecond(
      o.map((q) => q.gunX),
      7,
    );
    const fy = cyclesPerSecond(
      o.map((q) => q.gunY),
      7,
    );
    expect(fy / fx).toBeGreaterThan(1.7);
    expect(fy / fx).toBeLessThan(2.3);
  });
  test('ADS is well below hip sway', () => {
    const hip = tail(walk(2.2, 10));
    const ads = tail(walk(2.2, 10, { ads: 1 }));
    for (const k of ['y', 'x', 'roll', 'pitch', 'gunY', 'gunX', 'gunRoll', 'gunPitch'] as const) {
      expect(rms(ads.map((o) => o[k]))).toBeLessThan(rms(hip.map((o) => o[k])) * 0.3);
    }
    expect(rms(ads.map((o) => o.gunY))).toBeLessThan(rms(hip.map((o) => o.gunY)) * (ADS_SWING + 0.05));
  });
  test("inertia 0 removes the hands' own swing", () => {
    const o = tail(walk(2.2, 6, { sc: { inertia: 0 } }));
    expect(Math.max(...o.map((q) => Math.abs(q.gunY)))).toBeLessThan(1e-9);
  });
});

describe('settings scale the motion', () => {
  const base = pp(tail(walk(2.2, 8)).map((o) => o.y));
  test('movement sway scales body, camera and gun linearly', () => {
    const r = (sway: number) => tail(walk(2.2, 8, { sc: { sway } }));
    expect(pp(r(0).map((o) => o.y))).toBeLessThan(1e-9);
    expect(pp(r(0).map((o) => o.gunY))).toBeLessThan(1e-9);
    expect(pp(r(0.5).map((o) => o.y)) / base).toBeCloseTo(0.5, 1);
    expect(pp(r(1.5).map((o) => o.y)) / base).toBeCloseTo(1.5, 1);
    expect(pp(r(1.5).map((o) => o.gunRoll)) / pp(r(1).map((o) => o.gunRoll))).toBeCloseTo(1.5, 1);
  });
  test('camera shake off removes the camera motion, reduced scales it', () => {
    const r = (shake: number) => tail(walk(2.2, 8, { sc: { shake } }));
    expect(pp(r(0).map((o) => o.y))).toBeLessThan(1e-9);
    expect(pp(r(0).map((o) => o.roll))).toBeLessThan(1e-9);
    expect(pp(r(0.5).map((o) => o.y)) / base).toBeCloseTo(0.5, 1);
    // The hands' swing is not "camera shake".
    expect(pp(r(0).map((o) => o.gunY))).toBeGreaterThan(0.005);
  });
  test('stable horizon damps roll strongly but not pitch', () => {
    const on = tail(walk(5, 8, { sc: { stable: true }, strafe: 2 }));
    const off = tail(walk(5, 8, { strafe: 2 }));
    expect(rms(on.map((o) => o.roll))).toBeLessThan(rms(off.map((o) => o.roll)) * (STABLE_ROLL + 0.02));
    expect(rms(on.map((o) => o.pitch))).toBeCloseTo(rms(off.map((o) => o.pitch)), 6);
  });
});

describe('camera responses', () => {
  test('strafing rolls into the direction of motion, and stays bounded', () => {
    const right = tail(walk(2.2, 6, { strafe: 2.2 }));
    const left = tail(walk(2.2, 6, { strafe: -2.2 }));
    // Moving right = tilt right = negative roll.
    expect(mean(right.map((o) => o.roll))).toBeLessThan(-0.01);
    expect(mean(left.map((o) => o.roll))).toBeGreaterThan(0.01);
    expect(mean(right.map((o) => o.roll))).toBeGreaterThan(-0.06);
  });
  test('accelerating leans in, stopping leans back, and both settle', () => {
    const r = walk((t) => (t < 1 ? 0 : t < 3 ? 2.2 : 0), 6);
    const between = (a: number, b: number) => r.out.filter((_, i) => r.t[i] > a && r.t[i] < b);
    expect(Math.min(...between(1, 1.4).map((o) => o.pitch))).toBeLessThan(-0.002);
    expect(Math.max(...between(3, 3.4).map((o) => o.pitch))).toBeGreaterThan(0.002);
    for (const o of between(5.5, 6)) {
      expect(Math.abs(o.pitch)).toBeLessThan(0.001);
      expect(Math.abs(o.roll)).toBeLessThan(0.001);
      expect(Math.abs(o.y)).toBeLessThan(0.001);
    }
  });
  test('landing dips the body and recovers', () => {
    const m = new GaitMotion();
    m.land(4.5);
    let min = 0;
    for (let i = 0; i < 240; i++) {
      m.update(DT, frame(), SC);
      min = Math.min(min, m.out.y);
    }
    expect(min).toBeLessThan(-0.03);
    expect(min).toBeGreaterThan(-0.14);
    expect(Math.abs(m.out.y)).toBeLessThan(0.001);
  });
  test('wall bump pushes the camera away from the wall', () => {
    const m = new GaitMotion();
    m.bump(1, 1); // wall on the right
    let minX = 0;
    for (let i = 0; i < 90; i++) {
      m.update(DT, frame(), SC);
      minX = Math.min(minX, m.out.x);
    }
    expect(minX).toBeLessThan(-0.003);
  });
});

describe('continuity', () => {
  /** Largest per-frame change of each channel over a run. */
  function maxStep(r: Run) {
    const mx = emptyGaitOut();
    for (let i = 1; i < r.out.length; i++)
      for (const k of Object.keys(mx) as (keyof GaitOut)[])
        mx[k] = Math.max(mx[k], Math.abs(r.out[i][k] - r.out[i - 1][k]));
    return mx;
  }
  /** Target speeds, reached at the game's accel limits (walk in 0.12 s, sprint builds slower, stop in 85 ms). */
  const want = (t: number) => (t < 1 ? 0 : t < 2.5 ? 2.2 : t < 5 ? 5 : t < 6 ? 1.2 : 0);
  const profile = (() => {
    let v = 0;
    let last = 0;
    return (t: number) => {
      const dt = t - last;
      last = t;
      const w = want(t);
      const a = w < v ? 2.2 / 0.085 : v > 2.2 ? 6.3 : 18;
      v += Math.max(-a * dt, Math.min(a * dt, w - v));
      return v;
    };
  })();
  test('no per-frame jumps through start, sprint, slow-down and stop', () => {
    const s = maxStep(walk(profile, 8));
    // Per 1/60 s frame (sprint heel strikes included): ~1 cm of body, < 0.7 deg of attitude, < 8 mm / 0.6 deg of the hands.
    expect(s.y).toBeLessThan(0.012);
    expect(s.x).toBeLessThan(0.004);
    for (const k of ['pitch', 'yaw', 'roll'] as const) expect(s[k]).toBeLessThan(0.012);
    expect(s.gunX).toBeLessThan(0.004);
    expect(s.gunY).toBeLessThan(0.008);
    for (const k of ['gunPitch', 'gunYaw', 'gunRoll'] as const) expect(s[k]).toBeLessThan(0.011);
  });
  test('walking never moves the chest more than 5 mm in a frame', () => {
    const w = maxStep(walk((t) => Math.min(2.2, t * 18), 8));
    expect(w.y).toBeLessThan(0.005);
    expect(w.x).toBeLessThan(0.002);
  });
  test('a wall hit that drops the speed in one tick does not collapse the bob in one frame', () => {
    const s = maxStep(walk((t) => (t < 3 ? 5 : 1.5), 5));
    expect(s.y).toBeLessThan(0.012);
    expect(s.gunY).toBeLessThan(0.008);
    // (the crash itself leans the view back: ~0.8 deg in the first frame at most)
    for (const k of ['pitch', 'roll'] as const) expect(s[k]).toBeLessThan(0.015);
  });
  test('no jumps at ADS in / out while walking', () => {
    const m = new GaitMotion();
    let phase = 0;
    let prev: GaitOut | null = null;
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      phase += Math.PI * stepCadence(2.2) * DT;
      m.update(DT, frame({ phase, speed: 2.2, amount: 1, ads: Math.min(1, i / 30) }), SC);
      if (prev) worst = Math.max(worst, Math.abs(m.out.y - prev.y), Math.abs(m.out.gunY - prev.gunY));
      prev = { ...m.out };
    }
    expect(worst).toBeLessThan(0.006);
  });
  test('step smoother eases a stair rise instead of popping the camera', () => {
    const s = new StepSmoother();
    expect(s.push(0.02)).toBe(0); // a ramp is not a step
    expect(s.offset).toBe(0);
    expect(s.push(0.17)).toBeGreaterThan(0.5);
    expect(s.offset).toBeCloseTo(-0.17, 5);
    let prev = s.offset;
    for (let i = 0; i < 60; i++) {
      s.update(DT);
      expect(s.offset).toBeGreaterThanOrEqual(prev);
      prev = s.offset;
    }
    expect(Math.abs(s.offset)).toBeLessThan(0.005);
  });
});
