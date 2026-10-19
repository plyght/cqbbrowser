import { Effect, EffectAttribute, MipmapBlurPass } from 'postprocessing';
import {
  HalfFloatType,
  Matrix3,
  Matrix4,
  Quaternion,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { clamp, lerp, noise1 } from '../../core/math';
import { postSettings, videoSettings, type PostSettings, type QualityPreset } from '../quality';
import { AutoExposure } from './AutoExposure';
import { BitrateModel } from './BitrateModel';
import { cam04Frag } from './cam04.frag';
import { fitScale, type LensParams } from './lens';
import { makeLensDirt } from './lensDirt';

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Daylight EV the noise gain and shutter stretch are referenced to. */
const EV_REF = -1.4;

/**
 * CAM04: the chest-camera look as a single merged pmndrs Effect (see cam04.frag.ts).
 * Owns the shared half-res blur pyramid (bloom/halation, AE metering, codec macroblocks, defocus) and the
 * GPU auto-exposure state. Feed it camera motion every frame (`setCameraMotion`/`setMotion`).
 */
export class BodycamEffect extends Effect {
  readonly bitrate = new BitrateModel();
  readonly exposure = new AutoExposure();
  private mips = new MipmapBlurPass();
  private dirt: Texture = makeLensDirt();
  private p: PostSettings = postSettings.get();
  private footage = videoSettings.get().footage;
  private aspect = 16 / 9;
  private tanHalf = new Vector2(1, 1);
  private omega = new Vector3();
  private extraSpeed = 0;
  private time = 0;
  private flashV = 0;
  private flashKick = 0;
  private boot = { t: 10, on: true, offT: -1 };
  private q = new Quaternion();
  private m4 = new Matrix4();
  private axis = new Vector3();
  /** k1, k2, circle, aspect last used to fit the crop (NaN = refit). */
  private lensKey = [NaN, NaN, NaN, NaN, NaN];
  /** Current lens model (same values the shader uses), for HUD projection via distortPoint(). */
  readonly lens: LensParams = { k1: 0, k2: 0, scale: 1, circle: Infinity };

  constructor(quality: QualityPreset) {
    super('BodycamEffect', cam04Frag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      defines: new Map(),
      uniforms: new Map<string, Uniform>([
        ['tMip0', new Uniform(null)],
        ['tMip1', new Uniform(null)],
        ['tMip2', new Uniform(null)],
        ['tBloom', new Uniform(null)],
        ['tExposure', new Uniform(null)],
        ['tDirt', new Uniform(null)],
        ['uLens', new Uniform(new Vector4(0.11, 0.025, 0.6, 1.86))],
        ['uLens2', new Uniform(new Vector4(0.07, 0.006, 0.5, 0.45))],
        ['uTanHalf', new Uniform(new Vector2(1, 1))],
        ['uBlurRot', new Uniform(new Matrix3())],
        ['uBlur', new Uniform(new Vector4(1, EV_REF, 2.2, 0))],
        ['uRoll', new Uniform(new Vector2())],
        ['uNear', new Uniform(new Vector4(0.55, 0.18, 1, 0.012))],
        ['uPost', new Uniform(new Vector4(0.09, 0.6, 0.5, 0.9))],
        ['uNoise', new Uniform(new Vector4(0.02, 0.03, 0, EV_REF))],
        ['uCodec', new Uniform(new Vector4(0.006, 1, 0.6, 0))],
        ['uWB', new Uniform(new Vector3(1, 1, 1))],
        ['uExpo', new Uniform(new Vector4(0, 0, 1, 0))],
        ['uGamma', new Uniform(1)],
        ['uGrade', new Uniform(new Vector4(1, 0.5, 0.02, 0.35))],
      ]),
    });
    this.uniforms.get('tDirt')!.value = this.dirt;
    this.mips.radius = 0.85;
    this.setQuality(quality, false);
    videoSettings.onChange((v) => {
      this.footage = v.footage;
      this.lensKey[0] = NaN;
    });
    postSettings.onChange((v) => {
      this.p = v;
      this.lensKey[0] = NaN;
    });
  }

  setQuality(q: QualityPreset, notify = true) {
    this.mips.levels = q.mipLevels;
    const d = this.defines;
    d.set('MB_TAPS', String(q.motionBlurTaps));
    if (q.nearBlur) d.set('NEAR_BLUR', '1');
    else d.delete('NEAR_BLUR');
    if (q.lensDirt) d.set('LENS_DIRT', '1');
    else d.delete('LENS_DIRT');
    if (notify) this.setChanged();
  }

  /** 0..1 ADS blend from the weapon: eases lens distortion and near-lens defocus so the sight stays crisp. */
  ads = 0;

  /** Camera tan(half-FOV), needed to reproject rotation blur. */
  setCamera(fovYDeg: number, aspect: number) {
    const ty = Math.tan((fovYDeg * Math.PI) / 360);
    this.tanHalf.set(ty * aspect, ty);
    (this.uniforms.get('uTanHalf')!.value as Vector2).copy(this.tanHalf);
  }

  /** Camera angular velocity in camera-local axes (rad/s): x = pitch, y = yaw, z = roll. */
  setCameraMotion(wx: number, wy: number, wz: number) {
    this.omega.set(wx, wy, wz);
  }

  /** Extra angular speed (rad/s) fed by gameplay (e.g. body turn rate) to drive codec starvation. */
  setMotion(angularSpeed: number) {
    this.extraSpeed = angularSpeed;
  }

  /** Muzzle flash / bright transient: brief sensor clip + halation, and a small AE pull-down. */
  flash(strength = 1) {
    this.flashV = Math.max(this.flashV, strength);
    this.flashKick = Math.max(this.flashKick, 0.35 * strength);
  }

  /** CAM04 boot: black → overexposed → AE hunts down, white balance settles (~0.6 s). */
  powerOn() {
    this.boot = { t: 0, on: true, offT: -1 };
    this.exposure.reset(3.2);
    this.bitrate.kick(1, 0.15);
  }

  /** CAM04 shutdown: encoder glitch, brief bloom, black. */
  powerOff() {
    if (!this.boot.on) return;
    this.boot.offT = 0;
    this.bitrate.kick(1, 0.2);
  }

  get poweredOn() {
    return this.boot.on && this.boot.offT < 0;
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number) {
    super.initialize(renderer, alpha, frameBufferType);
    this.mips.initialize(renderer, alpha, HalfFloatType);
  }

  override setSize(w: number, h: number) {
    this.mips.setSize(w, h);
    this.aspect = w / h;
    this.lensKey[0] = NaN;
  }

  private get mipTargets(): WebGLRenderTarget[] {
    return (this.mips as unknown as { downsamplingMipmaps: WebGLRenderTarget[] }).downsamplingMipmaps;
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, dt = 1 / 60) {
    this.time += dt;
    const u = this.uniforms;
    const p = this.p;
    const I = clamp(this.footage * p.footageIntensity, 0, 1);

    // Shared blur pyramid from the HDR scene.
    this.mips.render(renderer, inputBuffer, null as never);
    const mips = this.mipTargets;
    u.get('tMip0')!.value = mips[0].texture;
    u.get('tMip1')!.value = mips[Math.min(1, mips.length - 1)].texture;
    u.get('tMip2')!.value = mips[Math.min(2, mips.length - 1)].texture;
    u.get('tBloom')!.value = this.mips.texture;

    // Transients.
    this.flashV = Math.max(0, this.flashV - dt * 22);
    this.flashKick = Math.max(0, this.flashKick - dt * 2.5);

    // Auto-exposure (GPU).
    this.exposure.setParams(
      p.exposureDarkTime,
      p.exposureBrightTime,
      p.exposureOvershoot,
      p.exposureCompensation,
    );
    this.exposure.update(
      renderer,
      mips[Math.min(4, mips.length - 1)].texture,
      dt,
      this.time,
      p.exposureHunt,
      this.flashKick,
    );
    u.get('tExposure')!.value = this.exposure.texture;

    // Lens geometry (refit crop only when something changed).
    const adsLens = 1 - 0.45 * this.ads;
    const k1 = 0.11 * p.distortion * I * adsLens,
      k2 = 0.025 * p.distortion * I * adsLens;
    const circle = lerp(3.2, 1.78, smooth(0, 0.85, I * p.imageCircle));
    const lk = this.lensKey;
    const caK = 0.0065 * p.chromaticAberration * I;
    const lens = u.get('uLens')!.value as Vector4;
    if (lk[0] !== k1 || lk[1] !== k2 || lk[2] !== circle || lk[3] !== this.aspect || lk[4] !== caK) {
      lk[0] = k1;
      lk[1] = k2;
      lk[2] = circle;
      lk[3] = this.aspect;
      lk[4] = caK;
      // Margin so the red channel's CA magnification and the worst rolling-shutter shift (|uRoll| ≤ 0.08)
      // still sample inside the rendered frame: no clamped/smeared edge texels ever reach the image.
      const r2 = Math.min(circle * circle, this.aspect * this.aspect + 1);
      const margin = (1 + caK * r2) * 1.08;
      lens.set(k1, k2, fitScale(k1, k2, this.aspect, circle) / margin, circle);
      Object.assign(this.lens, { k1, k2, scale: lens.z, circle });
    }
    (u.get('uLens2')!.value as Vector4).set(0.07, caK, 0.22 * I, 0.42 * p.vignette * I);

    // Camera motion → shutter blur rotation, rolling shutter, codec starvation.
    const w = this.omega;
    const speed = w.length();
    // Shutter ~1/100 s; slow aim corrections (< ~1.2 rad/s) stay sharp, only real whips smear.
    const shutter = 1 / 100;
    const whip = Math.max(0, speed - 1.2);
    const ang = Math.min(whip * shutter, 0.06) * clamp(p.motionBlur, 0, 2) * lerp(0.35, 1, I);
    if (ang > 1e-5) this.axis.copy(w).divideScalar(speed);
    else this.axis.set(0, 1, 0);
    this.q.setFromAxisAngle(this.axis, ang);
    this.m4.makeRotationFromQuaternion(this.q);
    (u.get('uBlurRot')!.value as Matrix3).setFromMatrix4(this.m4);
    const readout = 0.018 * p.rollingShutter * I;
    const rs = (readout * 0.5) / Math.max(this.tanHalf.y * lens.z, 0.1);
    (u.get('uRoll')!.value as Vector2).set(clamp(w.y * rs, -0.08, 0.08), clamp(-w.x * rs * 0.5, -0.05, 0.05));
    this.bitrate.update(dt, Math.max(speed, this.extraSpeed));

    // Boot / shutdown.
    const b = this.boot;
    let fade = 1,
      bootWarm = 0,
      evBoot = 0;
    b.t += dt;
    if (b.t < 0.8) {
      fade = smooth(0.08, 0.16, b.t);
      bootWarm = 1 - smooth(0.1, 0.65, b.t);
    }
    if (b.offT >= 0) {
      b.offT += dt;
      evBoot = smooth(0.0, 0.12, b.offT) * 1.2;
      fade = 1 - smooth(0.12, 0.3, b.offT);
      if (b.offT > 0.3) {
        b.on = false;
        b.offT = -1;
      }
    }
    if (!b.on) fade = 0;

    // White balance: slow AWB drift + boot shift (starts cool, settles).
    const drift = noise1(this.time * 0.07, 3) * 0.035 * p.whiteBalanceDrift * I;
    const tint = noise1(this.time * 0.05, 5) * 0.012 * p.whiteBalanceDrift * I;
    (u.get('uWB')!.value as Vector3).set(
      (1 + drift) * (1 - 0.14 * bootWarm),
      1 + tint,
      (1 - drift) * (1 + 0.22 * bootWarm),
    );
    (u.get('uExpo')!.value as Vector4).set(p.exposureBias, evBoot, fade, this.flashV);

    // Look.
    (u.get('uPost')!.value as Vector4).set(
      0.085 * p.bloom * lerp(0.4, 1, I),
      0.9 * p.lensDirt * I,
      0.55 * p.sharpen * I,
      lerp(1, 0.86, I),
    );
    (u.get('uGrade')!.value as Vector4).set(1, 0.55 * I, 0.018 * I, 0.15 * I);
    (u.get('uBlur')!.value as Vector4).set(1, EV_REF, 2.4, 0);
    // Only things practically touching the lens defocus (a hand on the camera, a wall at the chest);
    // the gun at 0.3–0.7 m stays readable.
    (u.get('uNear')!.value as Vector4).set(
      0.16,
      0.05,
      clamp(0.5 * p.nearBlur * I * (1 - 0.9 * this.ads), 0, 1),
      0.012,
    );
    // Grain re-seeds at the camera's ~30 fps cadence.
    const seed = (Math.floor(this.time * 29.97) % 113) * 7.31;
    (u.get('uNoise')!.value as Vector4).set(0.022 * p.noise * I, 0.026 * p.noise * I, seed, EV_REF);
    const st = this.bitrate.starve * p.starvation;
    (u.get('uCodec')!.value as Vector4).set(
      (0.004 + 0.028 * st + 0.008 * this.bitrate.gop) * p.compression * I,
      1 - 0.3 * clamp(st, 0, 1) * I,
      0.5 * p.compression * I,
      0.3 * clamp(st, 0, 1) * I,
    );
  }

  override dispose() {
    super.dispose();
    this.mips.dispose();
    this.exposure.dispose();
    this.dirt.dispose();
  }
}
