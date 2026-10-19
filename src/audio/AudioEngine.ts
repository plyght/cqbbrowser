import type { Bus } from '../core/bus';
import type { PerspectiveCamera } from 'three';

/**
 * v0 audio: procedural placeholders wired to bus events so the rest of the game can be built.
 * The full system (layered samples, organic reverb, portals, CAM04 mic) replaces these internals.
 */
export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private noiseBuf: AudioBuffer;

  constructor(
    bus: Bus,
    private camera: PerspectiveCamera,
  ) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(this.ctx.destination);
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeIR(1.6, 2.5);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(1);

    bus.on('shot', (e) => this.gunshot(e.suppressed, e.caliber));
    bus.on('steelHit', (e) => this.steel(e.size, e.thicknessMm, e.distance, e.energy));
    bus.on('footstep', (e) => this.footstep(e.speed));
    bus.on('weaponBeat', (e) => this.click(e.beat));
    bus.on('dryFire', () => this.click('dry'));
    bus.on('timerBeep', () => this.beep());
  }

  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private makeNoise(seconds: number) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** Procedural impulse response: stereo noise × exponential decay. */
  makeIR(seconds: number, decay: number) {
    const rate = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(2, rate * seconds, rate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
    return b;
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, gain: number, send = 0.5) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    g.connect(this.master);
    const s = this.ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(this.reverbSend);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  gunshot(suppressed: boolean, caliber: string) {
    const t = this.ctx.currentTime;
    const big = caliber === '7.62x39' ? 1.2 : caliber === '9mm' ? 0.8 : 1;
    if (suppressed) {
      this.noiseBurst(t, 0.12, 900, 0.8, 0.9, 0.25);
      this.noiseBurst(t, 0.05, 3200, 1.5, 0.5, 0.1);
    } else {
      this.noiseBurst(t, 0.09, 2400, 0.5, 2.2 * big, 0.9);
      this.noiseBurst(t, 0.35, 500, 0.6, 1.6 * big, 1.2);
    }
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(110 * big, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(suppressed ? 0.4 : 1.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Modal steel ring: inharmonic partials from plate size; arrives after speed-of-sound delay. */
  steel(size: number, thicknessMm: number, distance: number, energy: number) {
    const t = this.ctx.currentTime + distance / 343;
    const f0 = (380 * (thicknessMm / 10)) / Math.max(0.15, size);
    const ratios = [1, 2.32, 4.25, 6.63, 9.38];
    const amp = Math.min(1, 0.25 + energy / 1500) / (1 + distance * 0.06);
    ratios.forEach((r, i) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.01);
      const g = this.ctx.createGain();
      const decay = 1.6 / (1 + i * 0.7);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime((amp * 0.3) / (1 + i * 0.6), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.master);
      const s = this.ctx.createGain();
      s.gain.value = 0.4;
      g.connect(s).connect(this.reverbSend);
      o.start(t);
      o.stop(t + decay + 0.05);
    });
    this.noiseBurst(t, 0.02, 5000, 1, amp * 0.8, 0.2);
  }

  footstep(speed: number) {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.07, 350 + Math.random() * 200, 1.2, 0.12 + speed * 0.04, 0.1);
    this.noiseBurst(t + 0.01, 0.05, 2500, 2, 0.04, 0.05);
  }

  click(beat: string) {
    const t = this.ctx.currentTime;
    const f = beat === 'magSeat' ? 1400 : beat === 'boltRelease' ? 900 : beat === 'dry' ? 3000 : 2000;
    this.noiseBurst(t, beat === 'magOut' ? 0.15 : 0.04, f, 4, 0.35, 0.1);
  }

  beep() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 2900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.setValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.36);
  }

  /** Called per frame (listener follows the camera). */
  update() {
    const l = this.ctx.listener;
    const p = this.camera.position;
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
    }
  }
}
