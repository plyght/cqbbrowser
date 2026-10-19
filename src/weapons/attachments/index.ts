export * from './types';
export { BORE_Y, PARTS, PART_BY_ID, PLATFORMS, getPart, partsFor } from './catalog';
export {
  computeStats,
  defaultBuild,
  isValid,
  layoutBuild,
  parseBuild,
  resolveBuild,
  serializeBuild,
  validateBuild,
  withPart,
  type AimMode,
  type AimModeId,
  type BuildStats,
  type Handling,
  type Layout,
  type Placement,
  type RailSeg,
  type ResolvedBuild,
} from './build';
export { applyBuild, BUILD_KEY_PREFIX, BuildValidationError } from './apply';
export { PRESETS } from './presets';
