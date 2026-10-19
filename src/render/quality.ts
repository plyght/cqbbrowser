import { settings } from '../settings/Settings';

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Motion-blur taps in the CAM04 shader (0 = off). */
  motionBlurTaps: number;
  /** Near-lens defocus on the weapon/hands. */
  nearBlur: boolean;
  lensDirt: boolean;
  /** Mip levels of the shared half-res blur pyramid (bloom, AE metering, codec blocks). */
  mipLevels: number;
  /** Update the sun shadow map every N frames. */
  shadowEvery: number;
  /** Weapon light casts a shadow (and therefore can use its cookie texture). */
  weaponLightShadow: boolean;
  /** Device pixel ratio cap before resolution scale. */
  pixelRatioCap: number;
  /** Upper bound for (dynamic) resolution scale. */
  maxScale: number;
}

export const QUALITY: Record<QualityTier, QualityPreset> = {
  low: {
    motionBlurTaps: 0,
    nearBlur: false,
    lensDirt: false,
    mipLevels: 5,
    shadowEvery: 4,
    weaponLightShadow: false,
    pixelRatioCap: 1,
    maxScale: 0.85,
  },
  medium: {
    motionBlurTaps: 6,
    nearBlur: true,
    lensDirt: true,
    mipLevels: 6,
    shadowEvery: 2,
    weaponLightShadow: false,
    pixelRatioCap: 1,
    maxScale: 1,
  },
  high: {
    motionBlurTaps: 10,
    nearBlur: true,
    lensDirt: true,
    mipLevels: 7,
    shadowEvery: 1,
    weaponLightShadow: true,
    pixelRatioCap: 1.5,
    maxScale: 1,
  },
};

/** Map a stored tier (the settings UI also offers 'ultra') onto a preset. */
export function toTier(q: string): QualityTier {
  if (q === 'ultra') return 'high';
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'medium';
}

/**
 * Renderer-level video settings. Keys shared with the settings UI (src/ui/settingsSchema.ts): `quality`,
 * `resScale` (static scale; dynamic resolution works under it) and `footage` (the Footage-intensity master).
 */
export const videoSettings = settings.ns('video', {
  quality: 'medium' as string,
  resScale: 1,
  /** Footage intensity master, 0 = clean render, 1 = full CAM04. */
  footage: 0.9,
  dynamicResolution: true,
  targetFps: 60,
  /** Vertical lens FOV before the CAM04 fisheye remap (degrees). ADS narrows from this. */
  fov: 92,
  /** Display gamma: >1 darkens mids, <1 lifts them. */
  gamma: 1,
  /** 0 = uncapped (vsync). */
  frameCap: '0' as string,
});

/**
 * CAM04 post settings (Advanced). Effective intensity = `video.footage` × `footageIntensity`; every other
 * value is a per-effect multiplier (1 = default look) or an explicit tuning value.
 */
export const postSettings = settings.ns('video.post', {
  footageIntensity: 1,
  distortion: 1,
  imageCircle: 1,
  chromaticAberration: 1,
  motionBlur: 1,
  nearBlur: 1,
  bloom: 1,
  sharpen: 1,
  noise: 1,
  compression: 1,
  starvation: 1,
  rollingShutter: 1,
  lensDirt: 1,
  vignette: 1,
  whiteBalanceDrift: 1,
  /** Exposure compensation, EV. */
  exposureBias: 0,
  /** Time constant (s) when the scene gets darker and the camera opens up (slow, like eyes). */
  exposureDarkTime: 0.55,
  /** Time constant (s) when the scene gets brighter and the camera stops down (faster). */
  exposureBrightTime: 0.2,
  /** How far the AE overshoots past its target after a sudden change (0..1). */
  exposureOvershoot: 0.4,
  /** Small exposure hunting while the AE settles. */
  exposureHunt: 1,
  /** How completely the AE compensates for scene brightness (1 = perfectly, <1 keeps dark rooms dark). */
  exposureCompensation: 0.86,
});

export type PostSettings = ReturnType<typeof postSettings.get>;
