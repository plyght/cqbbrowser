import { muzzleState, type AmmoId, type Cartridge } from '../../weapons/ammo';
import { ammoOf } from '../../weapons/ammo/forDef';
import {
  applyBuild,
  BORE_Y,
  layoutBuild,
  PLATFORMS,
  resolveBuild,
  type Platform,
  type WeaponBuild,
  type WeaponId,
} from '../../weapons/attachments';
import { BASE_WEAPONS, WEAPONS, type WeaponDef } from '../../weapons/defs';

/**
 * Physical recoil: free-recoil momentum and its time profile (what the hands/shoulder actually feel).
 *
 * Free recoil (conservation of momentum, SAAMI/Hatcher form):
 *
 *     I = m_b·v + m_c·v_gas,     v_gas ≈ (1.5–1.75)·v,       V_gun = I / M,   E = I² / 2M
 *
 * Split in time:
 *  - **bore** (0 → t_exit): bullet + the gas column moving with it (Lagrange: gas averages v/2).
 *  - **gas** (t_exit → +τ): the muzzle jet, m_c·(v_gas − v/2). Muzzle devices act on this term only:
 *    a brake turns it sideways/back (−65%) with a little downforce, a comp vents it up (downforce), a can
 *    adds mass and slightly *increases* rearward jet momentum (gas is retained and exits as a slower,
 *    longer jet; blast is gone) and raises bolt speed via back-pressure.
 *  - **action** (internal momentum exchange, nets to zero but shapes the feel): the operating parts
 *    (carrier, slide, bolt) take momentum from the receiver at unlock and give it back as the spring
 *    compresses, when they bottom out, as the spring returns them, and when they slam into battery:
 *       DI (AR):     unlock just after bullet exit; buffer spring + bottom ~15 ms; slam ~55 ms.
 *       Long-stroke (AK): heavy carrier+piston kicked while the bullet is still in the bore; hard steel-on-
 *                    steel bottoming on the trunnion (no buffer) → the AK's sharp secondary jolt.
 *       Roller-delayed (MP5): bolt carrier starts during bore time at ~4:1 lever; soft buffered bottom.
 *       Short recoil (pistol): slide + barrel carry almost all the impulse from t=0; the frame mostly feels
 *                    the recoil spring, the frame-stop hit (~5 ms) and the forward slam into battery.
 *       Manual (pump/revolver): one primary pulse.
 *
 * Packets are impulses in the weapon's model frame (-z forward, y up, origin at the grip):
 *   fx = rearward along the bore (N·s, + = toward the shooter), applied on the bore line (y = boreY);
 *   fy = vertical at the muzzle (N·s, + = up; brakes/comps push the muzzle down);
 *   torque = angular impulse about the grip origin's x axis (N·m·s, + = muzzle up).
 */

export type ActionKind = 'di' | 'longStroke' | 'rollerDelayed' | 'shortRecoil' | 'manual';

export interface RecoilPacket {
  /** Seconds after ignition. */
  t: number;
  fx: number;
  fy: number;
  torque: number;
  kind: 'bore' | 'gas' | 'unlock' | 'spring' | 'bottom' | 'return' | 'slam';
}

export interface RecoilProfile {
  weaponId: string;
  ammo: AmmoId;
  /** Total free-recoil impulse (rearward), N·s. Equals Σ fx. */
  impulseNs: number;
  /** Free recoil velocity (m/s) and energy (J) of the whole weapon. */
  velocity: number;
  energyJ: number;
  gunMassKg: number;
  muzzleVelocity: number;
  subsonic: boolean;
  components: { bullet: number; gas: number; jet: number; downforce: number };
  profile: RecoilPacket[];
  /** Bore axis height over the grip origin (model frame), m — the lever arm for muzzle rise. */
  boreOffset: number;
  /** Bore axis height over the butt-pad centre (shouldered), m. 0 for pistols. */
  boreOverShoulder: number;
  /** Rear of the butt (model z, + = behind the grip); undefined for pistols/folded stocks. */
  shoulderZ?: number;
  /** Muzzle tip z (model frame, negative = forward of the grip). */
  muzzleZ: number;
  action: ActionKind;
  /** Mass and peak relative speed of the operating parts. */
  movingMassKg: number;
  carrierVelocity: number;
  /** Time from ignition to back in battery (s). */
  cycleTime: number;
}

interface ActionSpec {
  kind: ActionKind;
  /** Operating mass (kg). */
  mass: number;
  /** Carrier speed relative to the receiver (m/s) for the reference load; scaled by the actual impulse. */
  speed: number;
  /** Reference impulse for `speed` (N·s). */
  refImpulse: number;
  /** Travel to bottom (m). */
  travel: number;
  /** Unlock time as a fraction of bore time (0 = at ignition, 1 = at bullet exit, >1 after). */
  unlockAt: number;
  /** Spring share of the stop during the rearward stroke, and rebound off the stop. */
  spring: number;
  rebound: number;
  /** Return speed as a fraction of the rearward speed. */
  ret: number;
  boreOverShoulder: number;
}

const ACTIONS: Record<Platform | 'pump' | 'revolver', ActionSpec> = {
  // AR-15 carbine: BCG 0.30 kg + H buffer 0.085 kg, ~5.5 m/s on a 14.5" M4 (refImpulse ≈ 5.6 N·s).
  ar: {
    kind: 'di',
    mass: 0.385,
    speed: 5.5,
    refImpulse: 5.6,
    travel: 0.088,
    unlockAt: 1.25,
    spring: 0.3,
    rebound: 0.2,
    ret: 0.7,
    boreOverShoulder: 0.015,
  },
  // AK: carrier+piston 0.43 kg, ~5.5 m/s, bottoms on the rear trunnion (no buffer → hard rebound).
  ak: {
    kind: 'longStroke',
    mass: 0.43,
    speed: 5.5,
    refImpulse: 6.7,
    travel: 0.12,
    unlockAt: 0.7,
    spring: 0.15,
    rebound: 0.35,
    ret: 0.75,
    boreOverShoulder: 0.045,
  },
  // MP5: bolt group ~0.4 kg, carrier ~7 m/s through the 4:1 roller lever, buffered.
  mp5: {
    kind: 'rollerDelayed',
    mass: 0.4,
    speed: 6.5,
    refImpulse: 3.6,
    travel: 0.075,
    unlockAt: 0.35,
    spring: 0.35,
    rebound: 0.15,
    ret: 0.7,
    boreOverShoulder: 0.03,
  },
  // Glock 17: slide + barrel ~0.27 kg carry most of the impulse (~6-7 m/s); ~40 mm of travel.
  glock: {
    kind: 'shortRecoil',
    mass: 0.27,
    speed: 10,
    refImpulse: 3.0,
    travel: 0.04,
    unlockAt: 0,
    spring: 0.35,
    rebound: 0.15,
    ret: 0.75,
    boreOverShoulder: 0,
  },
  pump: {
    kind: 'manual',
    mass: 0,
    speed: 0,
    refImpulse: 1,
    travel: 0,
    unlockAt: 0,
    spring: 0,
    rebound: 0,
    ret: 0,
    boreOverShoulder: 0.03,
  },
  revolver: {
    kind: 'manual',
    mass: 0,
    speed: 0,
    refImpulse: 1,
    travel: 0,
    unlockAt: 0,
    spring: 0,
    rebound: 0,
    ret: 0,
    boreOverShoulder: 0,
  },
};

/** Muzzle device action on the gas jet: rearward jet multiplier, downforce share of the jet, bolt-speed. */
const DEVICES: Record<string, { jet: number; down: number; bolt: number }> = {
  bare: { jet: 1, down: 0, bolt: 1 },
  flashHider: { jet: 0.97, down: 0.03, bolt: 1 }, // A2 birdcage: closed bottom
  booster: { jet: 0.95, down: 0, bolt: 1.05 },
  brake: { jet: 0.35, down: 0.1, bolt: 1 },
  comp: { jet: 0.75, down: 0.3, bolt: 1 },
  suppressor: { jet: 1.08, down: 0, bolt: 1.2 },
  integral: { jet: 1.05, down: 0, bolt: 1.1 },
};

const IN = 0.0254;
const cache = new Map<string, RecoilProfile>();

function platformOf(def: WeaponDef): Platform | 'pump' | 'revolver' {
  const w = def.build?.weapon ?? (def.id as WeaponId);
  const pd = PLATFORMS[w as WeaponId];
  if (pd) return pd.platform;
  if (def.caliber === '12ga') return 'pump';
  if (def.caliber === '.357') return 'revolver';
  return 'ar';
}

/**
 * Recoil profile for a weapon build or def (cached per configuration + load). The handling layer applies
 * these impulses to its rigid body; see `src/physics/ballistics/README.md`.
 */
export function recoilFor(x: WeaponDef | WeaponBuild): RecoilProfile {
  const def: WeaponDef = 'parts' in x ? applyBuild(BASE_WEAPONS[x.weapon], x) : (x as WeaponDef);
  const ammo = ammoOf(def);
  const key = `${def.model}|${ammo.id}|${def.mass}`;
  let r = cache.get(key);
  if (!r) cache.set(key, (r = compute(def, ammo)));
  return r;
}

/** Profile of the default build of `weaponId` (what the controller fires today). */
export const recoilForWeapon = (weaponId: string): RecoilProfile | undefined =>
  WEAPONS[weaponId] ? recoilFor(WEAPONS[weaponId]) : undefined;

function compute(def: WeaponDef, c: Cartridge): RecoilProfile {
  const plat = platformOf(def);
  const act = ACTIONS[plat];
  const inches = (def.barrelLength ?? 0.26) / IN;
  const ms = muzzleState(c, inches);
  const v = def.velocity || ms.velocity;
  const n = c.pellets ?? 1;
  const mb = ms.massKg * n + (c.wadGr ?? 0) * 6.479891e-5;
  const mg = ms.gasKg;
  const dev = DEVICES[def.muzzleDevice ?? 'bare'] ?? DEVICES.bare;

  const bore = mb * v + mg * v * 0.5;
  const jet0 = mg * (c.gasFactor * v - 0.5 * v);
  const jet = jet0 * dev.jet;
  const down = jet0 * dev.down;
  const I = bore + jet;
  const M = def.mass;

  // Geometry (model frame).
  let boreY = BORE_Y,
    muzzleZ = -(def.barrelLength ?? 0.3) - 0.05,
    shoulderZ: number | undefined;
  if (def.build) {
    const l = layoutBuild(resolveBuild(def.build));
    boreY = l.boreY;
    muzzleZ = l.muzzleTipZ;
    if (plat !== 'glock' && !l.stockFolded) shoulderZ = l.buttZ;
  }
  const arm = -muzzleZ; // grip → muzzle lever for vertical forces

  // Timing.
  const L = inches * IN;
  const tExit = (1.6 * L) / Math.max(50, v);
  const tau = plat === 'glock' || plat === 'revolver' ? 0.0008 : 0.0015;
  const packets: RecoilPacket[] = [];
  const push = (t: number, fx: number, fy: number, kind: RecoilPacket['kind']) =>
    packets.push({ t, fx, fy, torque: fx * boreY + fy * arm, kind });

  // Bore: pressure-time curve is front-loaded; three samples.
  push(tExit * 0.3, bore * 0.3, 0, 'bore');
  push(tExit * 0.65, bore * 0.4, 0, 'bore');
  push(tExit, bore * 0.3, 0, 'bore');
  // Muzzle jet (+ device downforce).
  push(tExit + tau * 0.3, jet * 0.65, -down * 0.65, 'gas');
  push(tExit + tau, jet * 0.35, -down * 0.35, 'gas');

  let cycle = tExit + tau;
  let vc = 0;
  if (act.kind !== 'manual') {
    // Carrier/slide momentum relative to the receiver. A pistol slide takes ~60% of the impulse; the rest
    // reaches the frame via the recoil spring and unlocking cam.
    const pc = act.kind === 'shortRecoil' ? 0.6 * I : act.mass * act.speed * (I / act.refImpulse) * dev.bolt;
    vc = pc / act.mass;
    const tU = act.unlockAt * tExit;
    const tB = tU + act.travel / (0.8 * vc);
    const pRet = act.ret * pc;
    // Return stroke is slower: spring-driven from rest, stripping the next round.
    const tR = tB + act.travel / (0.5 * act.ret * vc);
    const s = act.spring,
      e = act.rebound;
    push(tU, -pc, 0, 'unlock');
    push((tU + tB) / 2, s * pc, 0, 'spring');
    push(tB, (1 - s) * (1 + e) * pc, 0, 'bottom');
    push((tB + tR) / 2, pRet - e * (1 - s) * pc, 0, 'return');
    push(tR, -pRet, 0, 'slam');
    cycle = tR;
  }
  packets.sort((a, b) => a.t - b.t);

  return {
    weaponId: def.id,
    ammo: c.id,
    impulseNs: I,
    velocity: I / M,
    energyJ: (I * I) / (2 * M),
    gunMassKg: M,
    muzzleVelocity: v,
    subsonic: ms.subsonic && v < 340,
    components: { bullet: mb * v, gas: mg * v * 0.5 + jet, jet, downforce: down },
    profile: packets,
    boreOffset: boreY,
    boreOverShoulder: shoulderZ !== undefined ? act.boreOverShoulder : 0,
    shoulderZ,
    muzzleZ,
    action: act.kind,
    movingMassKg: act.mass,
    carrierVelocity: vc,
    cycleTime: cycle,
  };
}

export interface RecoilWindow {
  fx: number;
  fy: number;
  torque: number;
}

/**
 * Sum the packets with t ∈ [t0, t1) into `out` (no allocation). Call per physics sub-step with the time
 * since the shot; packets are fired exactly once if the windows tile time.
 */
export function sampleRecoil(p: RecoilProfile, t0: number, t1: number, out: RecoilWindow): RecoilWindow {
  out.fx = out.fy = out.torque = 0;
  for (const k of p.profile) {
    if (k.t >= t0 && k.t < t1) {
      out.fx += k.fx;
      out.fy += k.fy;
      out.torque += k.torque;
    }
  }
  return out;
}
