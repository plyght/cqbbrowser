import { Effect, EffectAttribute } from 'postprocessing';
import {
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ABC_DEFAULTS, ABC_GLSL, type AbcParams } from './abc';
import { histFrag, nvgFrag, quadVert, stateFrag } from './nvg.frag';

export interface NvgView {
  /** Tube flipped down far enough to be on screen (0..1 slide; 1 = in front of the eye). */
  down: number;
  /** Intensifier power ramp 0..1 (auto-off when flipped up). */
  power: number;
  /** Power-on swirl (radians at the tube centre). */
  swirl: number;
  /** Manual gain knob (EV). */
  gainEv: number;
  phosphor: 'green' | 'white';
  tubes: 'mono' | 'dual';
}

const mkRT = (w: number, h: number, linear = false) =>
  new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: linear ? LinearFilter : NearestFilter,
    magFilter: linear ? LinearFilter : NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });

/**
 * Gear post effect (render/post/nvg): NVG intensifier view + flashbang sensor white-out, in its own EffectPass
 * between the scene render and CAM04. The renderer enables the pass only while `active` (NVG on screen or a
 * flash still decaying), so it costs nothing otherwise. Side passes are tiny: a 1×1 ABC gain state and a
 * quarter-res persistence/ghost history (both ping-pong).
 */
export class NvgEffect extends Effect {
  private state: [WebGLRenderTarget, WebGLRenderTarget] = [mkRT(1, 1), mkRT(1, 1)];
  private hist: [WebGLRenderTarget, WebGLRenderTarget] = [mkRT(4, 4, true), mkRT(4, 4, true)];
  private si = 0;
  private hi = 0;
  private stateMat: ShaderMaterial;
  private histMat: ShaderMaterial;
  private stateQuad: FullScreenQuad;
  private histQuad: FullScreenQuad;
  private resetState = true;
  private resetHist = true;
  private wasActive = false;
  private time = 0;
  readonly abc: AbcParams = { ...ABC_DEFAULTS };
  readonly view: NvgView = { down: 0, power: 0, swirl: 0, gainEv: 0, phosphor: 'green', tubes: 'mono' };
  /** Flash state set by gear each frame: white-out 0..1, ghost 0..1, capture 0..1 (this frame). */
  readonly flashState = { white: 0, ghost: 0, capture: 0 };

  constructor() {
    super('NvgEffect', nvgFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['tState', new Uniform(null)],
        ['tHist', new Uniform(null)],
        ['uNvg', new Uniform(new Vector4(0, 1, 0, 0))],
        ['uTube', new Uniform(new Vector4(0.24, 0, 0.88, 0))],
        ['uFx', new Uniform(new Vector4(0, 1, 1, 1))],
        ['uFlash', new Uniform(new Vector4())],
      ]),
    });
    this.stateMat = new ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: stateFrag(ABC_GLSL),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPrev: new Uniform(null),
        tInput: new Uniform(null),
        uAbc: new Uniform(new Vector4()),
        uTau: new Uniform(new Vector2()),
        uTime: new Uniform(new Vector4()),
      },
    });
    this.histMat = new ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: histFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: { tPrev: new Uniform(null), tInput: new Uniform(null), uHist: new Uniform(new Vector4()) },
    });
    this.stateQuad = new FullScreenQuad(this.stateMat);
    this.histQuad = new FullScreenQuad(this.histMat);
  }

  /** The renderer runs the pass only when this is true. */
  get active() {
    const f = this.flashState;
    return this.view.down > 0.001 || f.white > 0.002 || f.ghost > 0.002 || f.capture > 0;
  }

  get nvgOn() {
    return this.view.down > 0.001;
  }

  override setSize(w: number, h: number) {
    const qw = Math.max(1, Math.round(w / 4)),
      qh = Math.max(1, Math.round(h / 4));
    for (const t of this.hist) t.setSize(qw, qh);
    this.resetHist = true;
  }

  /** Current tube gain texture (debug). */
  get stateTexture(): Texture {
    return this.state[this.si].texture;
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, dt = 1 / 60) {
    this.time += dt;
    const active = this.active;
    if (!this.wasActive && active) this.resetHist = true;
    this.wasActive = active;
    const v = this.view;
    const f = this.flashState;
    const old = renderer.getRenderTarget();

    // ABC state (only while the tube is powered; reset to minimum gain at power-on so the image fades up).
    if (v.down > 0.001) {
      const su = this.stateMat.uniforms;
      const prev = this.state[this.si];
      this.si ^= 1;
      su.tPrev.value = prev.texture;
      su.tInput.value = inputBuffer.texture;
      (su.uAbc.value as Vector4).set(this.abc.target, this.abc.maxEv, this.abc.minEv, v.gainEv);
      (su.uTau.value as Vector2).set(this.abc.tauDown, this.abc.tauUp);
      (su.uTime.value as Vector4).set(
        Math.min(dt, 0.5),
        this.resetState ? 1 : 0,
        this.abc.minEv + 2,
        this.time,
      );
      this.resetState = false;
      renderer.setRenderTarget(this.state[this.si]);
      this.stateQuad.render(renderer);
    } else this.resetState = true;

    // Persistence + flash-ghost history.
    const hu = this.histMat.uniforms;
    const hp = this.hist[this.hi];
    this.hi ^= 1;
    hu.tPrev.value = hp.texture;
    hu.tInput.value = inputBuffer.texture;
    (hu.uHist.value as Vector4).set(
      Math.exp(-dt / 0.07),
      Math.exp(-dt / 0.9),
      f.capture,
      this.resetHist ? 1 : 0,
    );
    this.resetHist = false;
    renderer.setRenderTarget(this.hist[this.hi]);
    this.histQuad.render(renderer);
    renderer.setRenderTarget(old);

    const u = this.uniforms;
    u.get('tState')!.value = this.state[this.si].texture;
    u.get('tHist')!.value = this.hist[this.hi].texture;
    const ease = v.down * v.down * (3 - 2 * v.down);
    (u.get('uNvg')!.value as Vector4).set(
      v.down > 0.001 ? 1 : 0,
      Math.pow(2, 0),
      v.phosphor === 'white' ? 1 : 0,
      v.tubes === 'dual' ? 1 : 0,
    );
    const dual = v.tubes === 'dual';
    (u.get('uTube')!.value as Vector4).set(dual ? 0 : 0.26, (1 - ease) * 1.9, dual ? 0.74 : 0.9, v.swirl);
    (u.get('uFx')!.value as Vector4).set((Math.floor(this.time * 60) % 997) * 0.731, v.power, 1, 1);
    (u.get('uFlash')!.value as Vector4).set(f.white, f.ghost, 0, 0);
    f.capture = 0;
  }

  override dispose() {
    super.dispose();
    for (const t of [...this.state, ...this.hist]) t.dispose();
    this.stateMat.dispose();
    this.histMat.dispose();
    this.stateQuad.dispose();
    this.histQuad.dispose();
  }
}
