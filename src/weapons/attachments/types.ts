/**
 * Data model for the weapon customization system (PRD §2.5, §2.6). Pure data: no three.js, no DOM,
 * so the catalog, validation and stat math are unit-testable and usable from menus/loadout code.
 */

export type WeaponId = 'sb16' | 'hb300' | 'k47s' | 'kp9' | 'p17' | 'p92';
export type Platform = 'ar' | 'ak' | 'mp5' | 'glock';

export type SlotId =
  | 'finish'
  | 'barrel'
  | 'barrelProfile'
  | 'muzzle'
  | 'handguard'
  | 'mount'
  | 'slide'
  | 'stock'
  | 'grip'
  | 'foregrip'
  | 'optic'
  | 'magnifier'
  | 'offsetOptic'
  | 'buis'
  | 'light'
  | 'laser'
  | 'magazine'
  | 'sling';

/**
 * Capabilities a part (or the base weapon) provides and other parts require.
 * `topRail` = any picatinny on top; `topRailReceiver` = top rail over the receiver (needed by magnified
 * optics); `topRailForward` = scout/gas-tube rail only (red dots and holos).
 */
export type Feature =
  | 'topRail'
  | 'topRailReceiver'
  | 'topRailForward'
  | 'accessoryRail'
  | 'bottomRail'
  | 'thread'
  | 'integralSuppressor'
  | 'rmrCut'
  | 'pistolRail'
  | 'unityOptic'
  | 'coWitness'
  | 'magnifiedOptic'
  | 'irons';

export type MuzzleKind = 'bare' | 'flashHider' | 'brake' | 'comp' | 'booster' | 'suppressor' | 'integral';
export type OpticKind = 'irons' | 'reddot' | 'holo' | 'lpvo' | 'rmr' | 'magnifier' | 'offsetDot';
export type Finish = 'black' | 'fde' | 'od' | 'grey';

/** Multipliers applied to the base weapon's recoil impulse (1 = unchanged). */
export interface RecoilMul {
  up?: number;
  side?: number;
  roll?: number;
  back?: number;
}

/** Generic handling modifiers any part may carry. All multiplicative, default 1. */
export interface StatMods {
  adsMul?: number;
  swayMul?: number;
  recoil?: RecoilMul;
  recoveryMul?: number;
  /** Seconds added to weapon switch time (slings subtract). */
  switchAdd?: number;
}

export type Requirement =
  | { kind: 'feature'; feature: Feature; reason: string }
  | { kind: 'anyFeature'; features: readonly Feature[]; reason: string }
  | { kind: 'notFeature'; feature: Feature; reason: string }
  | { kind: 'notPart'; slot: SlotId; parts: string[]; reason: string };

export interface PartBase {
  id: string;
  slot: SlotId;
  name: string;
  fits: WeaponId[];
  /** kg */
  mass: number;
  provides?: Feature[];
  requires?: Requirement[];
  mods?: StatMods;
  /** Short description for the bench / loadout UI. */
  blurb?: string;
}

export interface BarrelPart extends PartBase {
  slot: 'barrel';
  /** Length from bolt face, metres. */
  length: number;
  /** Integral-suppressor barrels carry their own can length (beyond the barrel). */
  integralCan?: number;
  threaded?: boolean;
  /** Ported barrels (MP5SD-style) bleed gas before the muzzle: multiplies the interior-model velocity. */
  velocityMul?: number;
}

export interface ProfilePart extends PartBase {
  slot: 'barrelProfile';
  /** Mass per metre of barrel (kg/m) — barrel mass = this × length. */
  kgPerM: number;
  /** Outer radius at the muzzle (m) for the model. */
  radius: number;
}

export interface MuzzlePart extends PartBase {
  slot: 'muzzle';
  kind: MuzzleKind;
  /** Protrusion past the barrel's muzzle (m). */
  length: number;
  /** Outer radius (m). */
  radius: number;
  /** Flash multiplier (bare = 1). */
  flash: number;
  /** Relative report loudness at the shooter (bare = 1). */
  report: number;
}

export interface HandguardPart extends PartBase {
  slot: 'handguard';
  /** From the receiver face (m). */
  length: number;
  style: 'mlok' | 'quad' | 'integral' | 'wood' | 'polymer' | 'slim' | 'tropical';
  /** Has a full-length top rail continuous with the receiver. */
  topRail: boolean;
  /** For integral-suppressor handguards: the can lives inside. */
  integral?: boolean;
}

export interface MountPart extends PartBase {
  slot: 'mount';
  style: 'none' | 'sideMount' | 'topCover' | 'claw';
  /** Rail the mount provides (relative to the platform frame): rear z, front z, top-surface y. */
  rail?: { z0: number; z1: number; y: number };
}

export interface SlidePart extends PartBase {
  slot: 'slide';
  rmrCut: boolean;
}

export interface StockPart extends PartBase {
  slot: 'stock';
  style:
    'carbine' | 'sopmod' | 'pdw' | 'brace' | 'triangle' | 'polyFolder' | 'arOnAk' | 'fixed' | 'retractable';
  /** Butt rear z when fully collapsed/at the first position (m). */
  collapsedZ: number;
  /** Number of positions (1 = fixed). */
  positions: number;
  /** Travel per position (m). */
  step: number;
  /** Folding stocks may be folded (`params.stockFolded`). */
  folds?: boolean;
}

export interface GripPart extends PartBase {
  slot: 'grip';
  style: 'a2' | 'ergo' | 'vertical' | 'ak' | 'akWood' | 'mp5';
}

export interface ForegripPart extends PartBase {
  slot: 'foregrip';
  /** `stubby`: short vertical (index stop); `wedge`: low-profile angled with a heel ramp. */
  style: 'none' | 'vertical' | 'angled' | 'handstop' | 'stubby' | 'wedge';
}

export interface OpticPart extends PartBase {
  slot: 'optic' | 'magnifier' | 'offsetOptic' | 'buis';
  kind: OpticKind;
  /** Rail length the mount occupies (m). 0 for slide-mounted or none. */
  footprint: number;
  /** Optical axis height above the rail top surface (m). */
  axisOverRail: number;
  /** Preferred rear z of the mount on the rail (frame coords). Placement slides it forward if taken. */
  preferredRear?: number;
  magnification: [number, number];
  /** Eye relief behind the rear lens / aperture (m). */
  eyeRelief: number;
  /** Optical body length along the axis (m), for the sight line node. */
  bodyLength: number;
  /** Tube optics: rear lens (eyepiece) z behind the mount's rear edge (m, + = toward the shooter). */
  eyepiece?: number;
  /** Eyepiece reticle drawn at ADS through a tube optic (default: duplex crosshair). */
  reticle?: ReticleKind;
  /** Eye box radius (m): how far the eye may sit off the axis before the scope shadow closes in. */
  eyeBox?: number;
  /** Variable optics with a true 1x: used like a red dot (both eyes open) at the low end. */
  trueOneX?: boolean;
}

/** Eyepiece reticles (src/player/ScopeOverlay.ts). */
export type ReticleKind = 'duplex' | 'circleDot';

export interface LightPart extends PartBase {
  slot: 'light' | 'laser';
  style: 'none' | 'scout' | 'compact' | 'pistolLight' | 'pistolCombo' | 'laserBox';
  lumens?: number;
}

export interface MagazinePart extends PartBase {
  slot: 'magazine';
  capacity: number;
  material: 'polymer' | 'steel' | 'aluminum' | 'bakelite';
  /** Depth below the magwell (m) for the model and reload clearance. */
  drop: number;
}

export interface SlingPart extends PartBase {
  slot: 'sling';
  style: 'none' | 'single' | 'two';
}

export interface FinishPart extends PartBase {
  slot: 'finish';
  finish: Finish;
}

export type PartDef =
  | BarrelPart
  | ProfilePart
  | MuzzlePart
  | HandguardPart
  | MountPart
  | SlidePart
  | StockPart
  | GripPart
  | ForegripPart
  | OpticPart
  | LightPart
  | MagazinePart
  | SlingPart
  | FinishPart;

/** Per-weapon fixed data: receiver geometry frame, base stats and default build. */
export interface PlatformDef {
  weapon: WeaponId;
  platform: Platform;
  name: string;
  caliber: string;
  /** Slots this weapon exposes (in UI order). */
  slots: SlotId[];
  /** Slots that may be left out (others fall back to the default). All slots default if absent. */
  defaults: Partial<Record<SlotId, string>>;
  /** Mass of everything not in a slot (receivers, trigger group, bolt carrier...). */
  baseMass: number;
  /** COM z of the base mass. */
  baseComZ: number;
  provides: Feature[];
  /**
   * @deprecated Velocity now comes from the cartridge's interior-ballistics model
   * (`src/weapons/ammo/interior.ts`) and the barrel length; this table is ignored if present.
   */
  velocity?: [number, number][];
  baseAds: number;
  /** Mass of one cartridge (kg); loaded mag mass = mag mass + capacity × roundMass. */
  roundMass: number;
  /** Frame constants shared by layout and model builders (metres; -z forward; origin at the grip). */
  frame: {
    boltFaceZ: number;
    /** Front face of the receiver / barrel nut. */
    receiverFrontZ: number;
    receiverRearZ: number;
    /** Receiver top rail: rear z, front z, top surface y (absent = no top rail on the receiver). */
    receiverRail?: { z0: number; z1: number; y: number };
    /** Rail top-surface y for handguard top rails. */
    railY: number;
    magwellZ: number;
    magTopY: number;
    /** Iron sights: rear aperture z/y, front post z offset from handguard front or absolute. */
    ironRear?: { z: number; y: number };
  };
}

/** Serializable loadout entry. */
export interface WeaponBuild {
  v: 1;
  weapon: WeaponId;
  name?: string;
  parts: Partial<Record<SlotId, string>>;
  params?: BuildParams;
}

export interface BuildParams {
  /** 0-based stock position (clamped to the stock's range). */
  stockPosition?: number;
  stockFolded?: boolean;
  lightSide?: 'left' | 'right';
  offsetSide?: 'left' | 'right';
  /** Load (`AmmoId`, e.g. 'm193'); falls back to the caliber's default if it doesn't chamber. */
  ammo?: string;
}

export interface BuildError {
  slot?: SlotId;
  code: string;
  message: string;
}
