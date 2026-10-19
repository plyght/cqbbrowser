import { muzzleState, resolveAmmo, type AmmoId } from '../ammo';
import { BORE_Y, PART_BY_ID, PLATFORMS, getPart } from './catalog';
import type {
  BarrelPart,
  BuildError,
  BuildParams,
  Feature,
  ForegripPart,
  HandguardPart,
  LightPart,
  MagazinePart,
  MountPart,
  MuzzlePart,
  OpticKind,
  OpticPart,
  PartDef,
  PlatformDef,
  ProfilePart,
  SlotId,
  StockPart,
  WeaponBuild,
  WeaponId,
} from './types';

export type ResolvedParts = Partial<Record<SlotId, PartDef>>;

export interface ResolvedBuild {
  build: WeaponBuild;
  platform: PlatformDef;
  parts: ResolvedParts;
  params: Required<BuildParams>;
  features: Set<Feature>;
}

export interface RailSeg {
  /** Rear z (more positive), front z, rail top-surface y. */
  z0: number;
  z1: number;
  y: number;
  kind: 'receiver' | 'forward';
}

/** A part placed on a rail: rear/front z of its mount and the optical axis height. */
export interface Placement {
  z0: number;
  z1: number;
  railY: number;
  axisY: number;
}

export type AimModeId = 'primary' | 'magnified' | 'offset' | 'irons';

export interface AimMode {
  id: AimModeId;
  optic: OpticKind;
  /** [min, max]; LPVOs are variable. */
  magnification: [number, number];
  /** Sight axis height over the bore (m). */
  sightHeight: number;
  /** Rear of the sight (rear lens / aperture) in model coords. Offset sights are rotated 45° about the bore. */
  point: [number, number, number];
  /** Roll of the weapon needed to use this sight (rad, + = cant right). */
  roll: number;
  eyeRelief: number;
}

export interface Layout {
  boreY: number;
  boltFaceZ: number;
  barrelLength: number;
  barrelMuzzleZ: number;
  muzzleTipZ: number;
  /** Integral can / shroud start (HB-300, KP-9 SD). */
  integralZ?: number;
  handguard?: { z0: number; z1: number };
  gasZ: number;
  buttZ: number;
  stockPosition: number;
  stockFolded: boolean;
  rails: RailSeg[];
  optic?: Placement;
  magnifier?: Placement;
  offset?: Placement & { side: 'left' | 'right' };
  buisRear?: Placement;
  buisFront?: Placement;
  light?: { zFront: number; side: 'left' | 'right' | 'bottom' };
  laser?: { zFront: number; side: 'left' | 'right' | 'top' };
  foregrip?: { z: number };
  /** Support-hand point (gripLeft socket). */
  supportHand: [number, number, number];
  aimModes: AimMode[];
  errors: BuildError[];
}

export interface Handling {
  /** Seconds from hip/ready to sight picture. */
  adsTime: number;
  swayMul: number;
  recoveryMul: number;
  /** COM forward of the grip (m). Front-heavy builds lag more on turns. */
  balance: number;
  /** Moment of inertia about the firing hand (kg·m²). */
  moment: number;
  /** Weapon-follow spring half-life (s), PRD §6.3: 25–60 ms. */
  lagHalfLife: number;
  /** 0..0.35: overshoot on stop for heavy/front-heavy builds. */
  overshoot: number;
  switchTime: number;
}

export interface BuildStats {
  mass: number;
  length: number;
  /** Collapsed/folded length (shortest configuration). */
  lengthMin: number;
  comZ: number;
  /** Muzzle velocity (m/s) from the cartridge's interior-ballistics model at this barrel length. */
  velocity: number;
  /** The load fired (build param or the caliber default). */
  ammo: AmmoId;
  /** Muzzle energy of the whole round (J). */
  muzzleEnergy: number;
  /** Projectile leaves below the speed of sound (no supersonic crack). */
  subsonic: boolean;
  recoilMul: { up: number; side: number; roll: number; back: number };
  handling: Handling;
  flash: number;
  report: number;
  suppressed: boolean;
  muzzle: MuzzlePart['kind'];
  barrelInches: number;
  capacity: number;
  soundTags: string[];
  /** Per-part mass breakdown (for the bench UI and tests). */
  masses: { what: string; mass: number; z: number }[];
}

const IN = 0.0254;

export function defaultBuild(weapon: WeaponId): WeaponBuild {
  const p = PLATFORMS[weapon];
  return { v: 1, weapon, parts: { ...p.defaults } };
}

/** Fill unspecified slots with defaults. Unknown ids are kept so validation can report them. */
export function resolveBuild(build: WeaponBuild): ResolvedBuild {
  const platform = PLATFORMS[build.weapon];
  if (!platform) throw new Error(`unknown weapon '${build.weapon}'`);
  const parts: ResolvedParts = {};
  for (const slot of platform.slots) {
    const id = build.parts[slot] ?? platform.defaults[slot];
    if (id && PART_BY_ID[id]) parts[slot] = PART_BY_ID[id];
  }
  const stock = parts.stock as StockPart | undefined;
  const positions = stock?.positions ?? 1;
  const params: Required<BuildParams> = {
    stockPosition: Math.max(
      0,
      Math.min(positions - 1, Math.round(build.params?.stockPosition ?? Math.floor((positions - 1) / 2))),
    ),
    stockFolded: !!(stock?.folds && build.params?.stockFolded),
    lightSide: build.params?.lightSide ?? 'right',
    offsetSide: build.params?.offsetSide ?? 'right',
    ammo: resolveAmmo(platform.caliber, build.params?.ammo).id,
  };
  const features = new Set<Feature>(platform.provides);
  for (const p of Object.values(parts)) for (const f of p.provides ?? []) features.add(f);
  return { build, platform, parts, params, features };
}

// ------------------------------------------------------------------ validation

/** Every problem with a build, each with a human-readable reason. Empty = valid. */
export function validateBuild(build: WeaponBuild): BuildError[] {
  const errors: BuildError[] = [];
  if (!build || build.v !== 1) return [{ code: 'version', message: 'unsupported build format' }];
  const platform = PLATFORMS[build.weapon];
  if (!platform) return [{ code: 'weapon', message: `unknown weapon '${build.weapon}'` }];
  for (const [slot, id] of Object.entries(build.parts) as [SlotId, string][]) {
    if (!platform.slots.includes(slot)) {
      errors.push({ slot, code: 'slot', message: `${platform.name} has no '${slot}' slot` });
      continue;
    }
    const part = PART_BY_ID[id];
    if (!part) errors.push({ slot, code: 'unknownPart', message: `unknown part '${id}'` });
    else if (part.slot !== slot)
      errors.push({ slot, code: 'wrongSlot', message: `${part.name} goes in '${part.slot}', not '${slot}'` });
    else if (!part.fits.includes(build.weapon))
      errors.push({ slot, code: 'fit', message: `${part.name} doesn't fit the ${platform.name}` });
  }
  if (errors.length) return errors;

  const r = resolveBuild(build);
  for (const slot of platform.slots) {
    const part = r.parts[slot];
    if (!part) continue;
    for (const req of part.requires ?? []) {
      let ok = true;
      if (req.kind === 'feature') ok = r.features.has(req.feature);
      else if (req.kind === 'anyFeature') ok = req.features.some((f) => r.features.has(f));
      else if (req.kind === 'notFeature') ok = !r.features.has(req.feature);
      else if (req.kind === 'notPart') ok = !req.parts.includes(r.parts[req.slot]?.id ?? '');
      if (!ok) errors.push({ slot, code: 'requires', message: `${part.name}: ${req.reason}` });
    }
  }

  // Numeric rules.
  const barrel = r.parts.barrel as BarrelPart | undefined;
  const hg = r.parts.handguard as HandguardPart | undefined;
  const muzzle = r.parts.muzzle as MuzzlePart | undefined;
  if (barrel && hg && platform.platform === 'ar' && !hg.integral) {
    const exposed = barrel.length - (platform.frame.boltFaceZ - platform.frame.receiverFrontZ);
    const overCan = muzzle?.kind === 'suppressor' ? 0.07 : 0;
    if (hg.length > exposed + 0.008 + overCan)
      errors.push({
        slot: 'handguard',
        code: 'handguardLength',
        message: `${hg.name} is longer than the ${barrel.name.replace(' barrel', '')} barrel (max ${((exposed + 0.008 + overCan) / IN).toFixed(1)}")`,
      });
  }
  const light = r.parts.light as LightPart | undefined;
  const laser = r.parts.laser as LightPart | undefined;
  if (light && laser && light.style !== 'none' && laser.style !== 'none' && r.params.lightSide === 'left')
    errors.push({ slot: 'laser', code: 'sideConflict', message: 'light and laser both on the left side' });
  const optic = r.parts.optic as OpticPart | undefined;
  if (optic?.kind === 'irons' && !r.features.has('irons'))
    errors.push({
      slot: 'optic',
      code: 'noSights',
      message: 'no sights: add an optic or back-up iron sights',
    });

  // Layout problems (rail space) only for slots that aren't already invalid for a clearer reason.
  const bad = new Set(errors.map((e) => e.slot));
  errors.push(...layoutBuild(r).errors.filter((e) => !bad.has(e.slot)));
  return errors;
}

export function isValid(build: WeaponBuild) {
  return validateBuild(build).length === 0;
}

// ------------------------------------------------------------------ layout

function place(rail: RailSeg, cursor: number, p: OpticPart, errors: BuildError[], slot: SlotId): Placement {
  const z0 = Math.min(cursor, p.preferredRear ?? cursor);
  const z1 = z0 - p.footprint;
  if (z1 < rail.z1 - 0.004)
    errors.push({ slot, code: 'railSpace', message: `not enough top rail for the ${p.name}` });
  return { z0, z1, railY: rail.y, axisY: rail.y + p.axisOverRail };
}

/** Positions of every part and socket for a resolved build (pure; shared by stats and the model). */
export function layoutBuild(r: ResolvedBuild): Layout {
  const { platform: pd, parts, params } = r;
  const f = pd.frame;
  const errors: BuildError[] = [];
  const barrel = parts.barrel as BarrelPart;
  const muzzle = parts.muzzle as MuzzlePart | undefined;
  const hgPart = parts.handguard as HandguardPart | undefined;
  const stock = parts.stock as StockPart | undefined;
  const mount = parts.mount as MountPart | undefined;
  const optic = parts.optic as OpticPart | undefined;
  const magnifier = parts.magnifier as OpticPart | undefined;
  const offset = parts.offsetOptic as OpticPart | undefined;
  const buis = parts.buis as OpticPart | undefined;
  const light = parts.light as LightPart | undefined;
  const laser = parts.laser as LightPart | undefined;
  const fg = parts.foregrip as ForegripPart | undefined;

  const barrelMuzzleZ = f.boltFaceZ - barrel.length;
  const integral = barrel.integralCan !== undefined;
  const muzzleTipZ = barrelMuzzleZ - (integral ? barrel.integralCan! : (muzzle?.length ?? 0));
  const gasZ =
    pd.platform === 'ak'
      ? barrelMuzzleZ + 0.045
      : pd.platform === 'ar'
        ? f.boltFaceZ - Math.min(barrel.length - 0.04, barrel.length > 0.33 ? 0.24 : 0.19)
        : barrelMuzzleZ;

  // AK handguards run from the trunnion to the gas block, whatever the barrel length.
  const handguard = hgPart
    ? {
        z0: f.receiverFrontZ - 0.001,
        z1: pd.platform === 'ak' ? gasZ + 0.026 : f.receiverFrontZ - hgPart.length,
      }
    : undefined;

  // Stock.
  let buttZ = f.receiverRearZ;
  if (stock) buttZ = stock.collapsedZ + params.stockPosition * stock.step;
  if (params.stockFolded) buttZ = f.receiverRearZ + 0.035;

  // Rails.
  const rails: RailSeg[] = [];
  if (f.receiverRail) {
    const rr: RailSeg = { ...f.receiverRail, kind: 'receiver' };
    if (hgPart?.topRail && handguard) rr.z1 = handguard.z1;
    rails.push(rr);
  }
  if (mount?.rail) rails.push({ ...mount.rail, kind: 'receiver' });
  if (r.features.has('topRailForward') && pd.platform === 'ak')
    rails.push({ z0: f.receiverFrontZ - 0.004, z1: f.receiverFrontZ - 0.1, y: f.railY, kind: 'forward' });
  const main = rails.find((s) => s.kind === 'receiver') ?? rails[0];

  const out: Layout = {
    boreY: BORE_Y,
    boltFaceZ: f.boltFaceZ,
    barrelLength: barrel.length,
    barrelMuzzleZ,
    muzzleTipZ,
    integralZ: integral ? barrelMuzzleZ + 0.11 : undefined,
    handguard,
    gasZ,
    buttZ,
    stockPosition: params.stockPosition,
    stockFolded: params.stockFolded,
    rails,
    supportHand: [0, BORE_Y - 0.01, -0.2],
    aimModes: [],
    errors,
  };

  // Top-rail stack, rear to front: rear BUIS, magnifier, optic, offset dot.
  if (main) {
    let cursor = main.z0 - 0.002;
    const stackOn = (p: OpticPart | undefined, slot: SlotId) => {
      if (!p || p.footprint <= 0) return undefined;
      const pl = place(main, cursor, p, errors, slot);
      cursor = pl.z1 - 0.004;
      return pl;
    };
    if (buis && buis.footprint > 0 && main.kind === 'receiver')
      out.buisRear = stackOn({ ...buis, preferredRear: main.z0 - 0.002 }, 'buis');
    out.magnifier = stackOn(magnifier, 'magnifier');
    if (optic && optic.footprint > 0) {
      out.optic = stackOn(optic, 'optic');
    }
    if (offset && offset.footprint > 0) {
      const pl = stackOn(offset, 'offsetOptic');
      if (pl) out.offset = { ...pl, side: params.offsetSide };
    }
    if (buis && buis.footprint > 0 && hgPart?.topRail && handguard) {
      const z0 = handguard.z1 + buis.footprint + 0.002;
      if (z0 < cursor) out.buisFront = { z0, z1: z0 - buis.footprint, railY: main.y, axisY: main.y + 0.035 };
      else errors.push({ slot: 'buis', code: 'railSpace', message: 'no room for the front BUIS' });
    }
  }

  // Accessories at the front of the handguard.
  const hgFront = handguard?.z1 ?? f.receiverFrontZ;
  const hgLen = handguard ? handguard.z0 - handguard.z1 : 0.15;
  if (light && light.style !== 'none') {
    if (pd.platform === 'glock') out.light = { zFront: f.receiverFrontZ + 0.012, side: 'bottom' };
    else out.light = { zFront: hgFront + 0.004, side: params.lightSide };
  }
  if (laser && laser.style !== 'none') out.laser = { zFront: hgFront + 0.006, side: 'left' };
  if (fg && fg.style !== 'none') {
    const k = fg.style === 'vertical' ? 0.34 : fg.style === 'angled' ? 0.45 : 0.12;
    out.foregrip = { z: hgFront + Math.max(0.03, hgLen * k) };
  }

  // Support hand (gripLeft socket).
  if (pd.platform === 'glock') out.supportHand = [-0.018, BORE_Y - 0.06, 0.012];
  else if (out.foregrip && fg?.style === 'vertical') out.supportHand = [0, BORE_Y - 0.085, out.foregrip.z];
  else if (out.foregrip && fg?.style === 'angled') out.supportHand = [-0.004, BORE_Y - 0.04, out.foregrip.z];
  else if (out.foregrip) out.supportHand = [-0.008, BORE_Y - 0.022, out.foregrip.z + 0.05];
  else {
    const z = pd.platform === 'ar' ? hgFront + Math.min(0.08, hgLen * 0.35) : hgFront + hgLen * 0.5;
    out.supportHand = [-0.008, BORE_Y - 0.022, z];
  }

  // Aim modes: primary optic → magnified → offset → irons.
  const modes: AimMode[] = [];
  const opticMode = (id: AimModeId, p: OpticPart, pl: Placement, roll = 0): AimMode => ({
    id,
    optic: p.kind,
    magnification: p.magnification,
    sightHeight: pl.axisY - BORE_Y,
    point: [0, pl.axisY, p.kind === 'lpvo' ? pl.z0 + 0.06 : pl.z0],
    roll,
    eyeRelief: p.eyeRelief,
  });
  if (optic && out.optic) modes.push(opticMode('primary', optic, out.optic));
  if (optic?.kind === 'rmr') {
    const axisY = pd.frame.railY + optic.axisOverRail;
    modes.push({
      id: 'primary',
      optic: 'rmr',
      magnification: [1, 1],
      sightHeight: axisY - BORE_Y,
      point: [0, axisY, 0.004],
      roll: 0,
      eyeRelief: optic.eyeRelief,
    });
  }
  if (magnifier && out.magnifier && out.optic)
    modes.push({
      ...opticMode('magnified', magnifier, out.magnifier),
      point: [0, out.magnifier.axisY, out.magnifier.z0],
    });
  if (offset && out.offset) {
    // 45° mount on the top rail: axis sits d out from the rail centre along the 45° line.
    const s = out.offset.side === 'right' ? 1 : -1;
    const d = offset.axisOverRail + 0.012;
    const x = s * d * Math.SQRT1_2;
    const y = out.offset.railY - 0.005 + d * Math.SQRT1_2;
    modes.push({
      ...opticMode('offset', offset, out.offset, (-s * Math.PI) / 4),
      point: [x, y, out.offset.z0],
      sightHeight: Math.hypot(x, y - BORE_Y),
    });
  }
  // Irons.
  let ironsOk = r.features.has('irons') && optic?.kind !== 'lpvo';
  if (pd.platform === 'ak' && mount?.style === 'topCover') ironsOk = false;
  if (pd.platform === 'glock' && optic?.kind === 'rmr') ironsOk = false;
  if (ironsOk) {
    let point: [number, number, number] | undefined;
    if (out.buisRear) point = [0, out.buisRear.axisY, out.buisRear.z1 + 0.01];
    else if (pd.platform !== 'ar' && f.ironRear) point = [0, f.ironRear.y, f.ironRear.z];
    if (point)
      modes.push({
        id: 'irons',
        optic: 'irons',
        magnification: [1, 1],
        sightHeight: point[1] - BORE_Y,
        point,
        roll: 0,
        eyeRelief: pd.platform === 'glock' ? 0.55 : 0.075,
      });
  }
  out.aimModes = modes;
  return out;
}

// ------------------------------------------------------------------ stats

function barrelMass(r: ResolvedBuild): number {
  const b = r.parts.barrel as BarrelPart;
  if (b.mass > 0) return b.mass;
  const prof = (r.parts.barrelProfile as ProfilePart | undefined) ?? getPart<ProfilePart>('ar_prof_govt');
  return prof.kgPerM * b.length;
}

const refMassCache = new Map<WeaponId, number>();
function refMass(weapon: WeaponId): number {
  let m = refMassCache.get(weapon);
  if (m === undefined) {
    m = massBreakdown(resolveBuild(defaultBuild(weapon))).reduce((a, b) => a + b.mass, 0);
    refMassCache.set(weapon, m);
  }
  return m;
}

function massBreakdown(r: ResolvedBuild, l = layoutBuild(r)) {
  const out: { what: string; mass: number; z: number }[] = [];
  const pd = r.platform;
  out.push({ what: 'receiver', mass: pd.baseMass, z: pd.baseComZ });
  out.push({ what: 'barrel', mass: barrelMass(r), z: l.boltFaceZ - l.barrelLength / 2 });
  const zOf = (slot: SlotId): number => {
    const part = r.parts[slot]!;
    switch (slot) {
      case 'muzzle':
        return l.barrelMuzzleZ - (part as MuzzlePart).length / 2;
      case 'handguard':
        return l.handguard ? (l.handguard.z0 + l.handguard.z1) / 2 : pd.frame.receiverFrontZ - 0.07;
      case 'stock':
        return l.stockFolded ? -0.03 : l.buttZ - 0.07;
      case 'grip':
        return 0.04;
      case 'foregrip':
        return l.foregrip?.z ?? 0;
      case 'optic':
        return l.optic
          ? (part as OpticPart).kind === 'lpvo'
            ? l.optic.z0 - 0.06
            : (l.optic.z0 + l.optic.z1) / 2
          : 0;
      case 'magnifier':
        return l.magnifier ? l.magnifier.z0 - 0.04 : 0;
      case 'offsetOptic':
        return l.offset ? (l.offset.z0 + l.offset.z1) / 2 : 0;
      case 'buis':
        return l.buisRear && l.buisFront ? (l.buisRear.z0 + l.buisFront.z1) / 2 : 0;
      case 'light':
        return (l.light?.zFront ?? 0) + 0.05;
      case 'laser':
        return (l.laser?.zFront ?? 0) + 0.04;
      case 'magazine':
        return pd.frame.magwellZ - (pd.platform === 'ak' || pd.platform === 'mp5' ? 0.03 : 0);
      case 'sling':
        return l.buttZ - 0.1;
      case 'mount':
        return 0;
      default:
        return 0;
    }
  };
  for (const slot of pd.slots) {
    const part = r.parts[slot];
    if (!part || slot === 'barrel' || slot === 'barrelProfile' || slot === 'finish') continue;
    let mass = part.mass;
    if (slot === 'magazine') mass += (part as MagazinePart).capacity * pd.roundMass;
    if (mass === 0) continue;
    out.push({ what: slot, mass, z: zOf(slot) });
  }
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function computeStats(r: ResolvedBuild): BuildStats {
  const l = layoutBuild(r);
  const pd = r.platform;
  const masses = massBreakdown(r, l);
  const mass = masses.reduce((a, b) => a + b.mass, 0);
  const comZ = masses.reduce((a, b) => a + b.mass * b.z, 0) / mass;
  const moment = masses.reduce((a, b) => a + b.mass * b.z * b.z, 0);
  const balance = -comZ;
  const stock = r.parts.stock as StockPart | undefined;
  const rear = pd.platform === 'glock' ? pd.frame.receiverRearZ : l.buttZ;
  const length = rear - l.muzzleTipZ;
  const minRear = stock ? (stock.folds ? pd.frame.receiverRearZ + 0.035 : stock.collapsedZ) : rear;
  const lengthMin = minRear - l.muzzleTipZ;

  let ads = 1,
    sway = 1,
    recovery = 1,
    switchAdd = 0;
  const rec = { up: 1, side: 1, roll: 1, back: 1 };
  for (const p of Object.values(r.parts)) {
    const m = p.mods;
    if (!m) continue;
    ads *= m.adsMul ?? 1;
    sway *= m.swayMul ?? 1;
    recovery *= m.recoveryMul ?? 1;
    switchAdd += m.switchAdd ?? 0;
    rec.up *= m.recoil?.up ?? 1;
    rec.side *= m.recoil?.side ?? 1;
    rec.roll *= m.recoil?.roll ?? 1;
    rec.back *= m.recoil?.back ?? 1;
  }
  const ref = refMass(pd.weapon);
  const massRatio = mass / ref;
  // Longer length of pull is a touch slower to mount; a folded stock is quick but unstable.
  if (stock && stock.positions > 1) ads *= 1 + 0.012 * (l.stockPosition - (stock.positions - 1) / 2);
  if (l.stockFolded) {
    ads *= 0.88;
    sway *= 1.7;
    recovery *= 0.7;
    rec.up *= 1.4;
    rec.side *= 1.5;
    rec.roll *= 1.3;
    rec.back *= 1.25;
  }
  const front = Math.max(0, balance - 0.1);
  const adsTime = pd.baseAds * ads * Math.pow(massRatio, 0.5) * (1 + front * 1.5);
  const swayMul = sway * Math.pow(1 / massRatio, 0.35) * (1 + front * 0.8);
  const recoveryMul = recovery * Math.pow(massRatio, 0.3);
  const lagHalfLife = clamp(0.017 + 0.006 * mass + 0.11 * moment, 0.025, 0.06);
  const overshoot = clamp((balance - 0.07) * 2.5 + (mass - 3) * 0.05, 0, 0.35);
  const switchTime = Math.max(0.25, (pd.platform === 'glock' ? 0.4 : 0.55) + switchAdd + 0.04 * (mass - ref));

  const barrel = r.parts.barrel as BarrelPart;
  const muzzle = r.parts.muzzle as MuzzlePart | undefined;
  const inches = barrel.length / IN;
  const ammo = resolveAmmo(pd.caliber, r.params.ammo);
  const ms = muzzleState(ammo, inches, barrel.velocityMul ?? 1);
  const velocity = ms.velocity;
  const kind = muzzle?.kind ?? 'bare';
  const suppressed = kind === 'suppressor' || kind === 'integral';
  const shortness = clamp(1.6 - inches / 14, 0.4, 1.4);
  const flash = (muzzle?.flash ?? 1) * (pd.caliber === '300blk' ? 0.6 : 1) * shortness;
  const report = (muzzle?.report ?? 1) * (1 + Math.max(0, 16 - inches) * 0.03);
  const mag = r.parts.magazine as MagazinePart;
  const soundTags = [
    pd.caliber,
    suppressed ? 'suppressed' : 'unsuppressed',
    pd.platform === 'glock' ? 'pistol' : inches < 12 ? 'sbr' : 'carbine',
    `muzzle:${kind}`,
  ];
  return {
    mass,
    length,
    lengthMin,
    comZ,
    velocity,
    ammo: ammo.id,
    muzzleEnergy: ms.energy,
    subsonic: ms.subsonic,
    recoilMul: rec,
    handling: { adsTime, swayMul, recoveryMul, balance, moment, lagHalfLife, overshoot, switchTime },
    flash,
    report,
    suppressed,
    muzzle: kind,
    barrelInches: inches,
    capacity: mag.capacity,
    soundTags,
    masses,
  };
}

// ------------------------------------------------------------------ serialization

export function serializeBuild(b: WeaponBuild): string {
  const parts: Partial<Record<SlotId, string>> = {};
  for (const k of Object.keys(b.parts).sort() as SlotId[]) parts[k] = b.parts[k];
  return JSON.stringify({
    v: 1,
    weapon: b.weapon,
    ...(b.name ? { name: b.name } : {}),
    parts,
    ...(b.params ? { params: b.params } : {}),
  });
}

/** Parse + validate a loadout entry. Throws with every reason joined if invalid. */
export function parseBuild(json: string): WeaponBuild {
  let b: WeaponBuild;
  try {
    b = JSON.parse(json);
  } catch {
    throw new Error('build is not valid JSON');
  }
  if (!b || typeof b !== 'object' || typeof b.parts !== 'object' || b.parts === null)
    throw new Error('build is missing its parts');
  const errs = validateBuild(b);
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return b;
}

/** Convenience for UIs: set one slot and report what broke. */
export function withPart(
  b: WeaponBuild,
  slot: SlotId,
  id: string,
): { build: WeaponBuild; errors: BuildError[] } {
  const build: WeaponBuild = { ...b, parts: { ...b.parts, [slot]: id } };
  return { build, errors: validateBuild(build) };
}
