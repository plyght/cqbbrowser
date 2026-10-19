import type { WeaponDef } from '../defs';
import { computeStats, layoutBuild, resolveBuild, serializeBuild, validateBuild } from './build';
import type { WeaponBuild } from './types';

/** Model key prefix: `buildModel('build:{json}')` builds that exact configuration. */
export const BUILD_KEY_PREFIX = 'build:';

export class BuildValidationError extends Error {
  constructor(
    readonly build: WeaponBuild,
    readonly reasons: string[],
  ) {
    super(`invalid ${build.weapon} build: ${reasons.join('; ')}`);
  }
}

/**
 * Derive a full `WeaponDef` for a build. Existing fields are recomputed (velocity, mass, length, recoil,
 * sightHeight, magCapacity, suppressed, model); additive fields carry handling/aim/sound data.
 * Throws `BuildValidationError` on an invalid build.
 */
export function applyBuild(base: WeaponDef, build: WeaponBuild): WeaponDef {
  const errors = validateBuild(build);
  if (errors.length)
    throw new BuildValidationError(
      build,
      errors.map((e) => e.message),
    );
  const r = resolveBuild(build);
  const s = computeStats(r);
  const l = layoutBuild(r);
  const primary = l.aimModes[0];
  const inches = s.barrelInches;
  return {
    ...base,
    name: build.name ?? `${r.platform.name} ${inches.toFixed(1).replace(/\.0$/, '')}"`,
    velocity: Math.round(s.velocity),
    mass: +s.mass.toFixed(3),
    length: +s.length.toFixed(3),
    magCapacity: s.capacity,
    recoil: {
      up: base.recoil.up * s.recoilMul.up,
      side: base.recoil.side * s.recoilMul.side,
      roll: base.recoil.roll * s.recoilMul.roll,
      back: base.recoil.back * s.recoilMul.back,
    },
    sightHeight: primary ? +primary.sightHeight.toFixed(4) : base.sightHeight,
    suppressed: s.suppressed,
    model: BUILD_KEY_PREFIX + serializeBuild(build),
    build,
    barrelLength: l.barrelLength,
    lengthMin: +s.lengthMin.toFixed(3),
    balance: s.handling.balance,
    handling: s.handling,
    aimModes: l.aimModes,
    muzzleDevice: s.muzzle,
    flash: s.flash,
    report: s.report,
    soundTags: s.soundTags,
  };
}
