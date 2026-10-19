/**
 * SHORTBARREL audio (PRD §9): real, not cinematic. Gunshots are pressure events whose character comes from the
 * space, and everything is heard through the CAM04 body-camera microphone.
 *
 * - Sounds come from the manifest (pro → open → procedural), round-robin + jitter.
 * - A listener probe (24 rays / 100 ms, spread over frames) drives the organic reverb, early reflections,
 *   pressure layer, ambience and wind; smoothed so indoor ↔ outdoor morphs with no switch.
 * - Works on any BaseAudioContext so tools can render scenarios offline (see offline.ts).
 */
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Bus, GameEvents, Surface } from '../core/bus';
import type { Physics, RAPIER } from '../physics/Physics';
import {
  analyseProbe,
  OUTDOOR,
  PROBE_RANGE,
  probeDirections,
  smoothAcoustics,
  smoothK,
  SPEED_OF_SOUND,
  type Acoustics,
  type Portal,
  type ProbeRay,
  type Room,
} from './acoustics';
import { BANK_SPECS, generateIr } from './ir';
import {
  barrelCharacter,
  isHardSurface,
  KEYS,
  MAG_CLASS,
  SoundBank,
  STEP_CLASS,
  WEAPON_SOUNDS,
  weaponSound,
  type SoundSetManifest,
} from './manifest';
import { Mixer } from './Mixer';
import { clamp, jitter, mulberry32, type Rng } from './rng';
import { registerSettings } from '../ui/settingsSchema';
import { settings as store } from '../settings/Settings';
import { AUDIO_SETTING_ENTRIES, audioSettings, type AudioSettings, type ListeningMode } from './settings';
import * as synth from './synth';
import { BANK } from './acoustics';

export interface AudioDeps {
  physics?: Physics;
  /** Body the probe rays ignore (the player's own capsule). */
  exclude?: () => RAPIER.RigidBody | RAPIER.Collider | undefined;
  /** Supply a context (OfflineAudioContext for renders). Default: a realtime AudioContext. */
  ctx?: BaseAudioContext;
  /** Sound sets + URL base; default: the sets found at build time. */
  sets?: SoundSetManifest[];
  base?: string;
  seed?: number;
  /** Skip persisted settings (offline renders). */
  settings?: Partial<AudioSettings>;
}

registerSettings(AUDIO_SETTING_ENTRIES);

/** Suppressed-fire stack level relative to the unsuppressed one (tuned on offline renders). */
const SUP_LEVEL = 0.1;
/** Foley/footsteps/brass/mags sit well under gunfire (a mag click is far quieter than a suppressed shot). */
const FOLEY = 0.5;

/** Rays cast per frame — 24 rays complete in 6 frames (100 ms at 60 fps). */
const RAYS_PER_FRAME = 4;
const PROBE_INTERVAL = 0.1;

type ShotEvent = GameEvents['shot'];

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  readonly mixer: Mixer;
  readonly bank: SoundBank;
  readonly ready: Promise<void>;
  /** Smoothed acoustics actually driving the mix; `probeTarget` is the latest raw probe. */
  acoustics: Acoustics = { ...OUTDOOR };
  probeTarget: Acoustics = { ...OUTDOOR };
  /** Future authored rooms/portals (§9.3); the probe drives everything until a layout provides these. */
  roomGraph: { rooms: Room[]; portals: Portal[] } | null = null;
  private rng: Rng;
  private settings: AudioSettings;
  private synthGen = new Map<string, () => Float32Array[]>();
  private steelCache = new Map<string, AudioBuffer[]>();
  private dirs = probeDirections();
  private rays: ProbeRay[] = [];
  private probeT = 0;
  private applyT = 0;
  private clock = 0;
  private camPos = new Vector3();
  private camQuat = new Quaternion();
  private lastPos = new Vector3();
  private lastYaw = 0;
  private yawRate = 0;
  private speed = 0;
  private gust = 0;
  private dose = 0;
  private brassSeen = false;
  /** Last shot time per weapon (first-round pop on a suppressor after a pause). */
  private lastShot = new Map<string, number>();
  /** While a subsonic load is being fired, bullet impacts downrange are the loudest thing after the action. */
  private subsonicUntil = -1;
  private nextNeighbour = 8;
  private ambOutdoor?: { gain: GainNode; lp: BiquadFilterNode };
  private hvac?: GainNode;
  private hvacLevel = 0;
  private tmpV = new Vector3();
  private tmpDir = new Vector3();

  get master() {
    return this.mixer.master;
  }

  constructor(
    bus: Bus | null,
    private camera: PerspectiveCamera,
    private deps: AudioDeps = {},
  ) {
    this.ctx = deps.ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.rng = mulberry32(deps.seed ?? (Math.random() * 2 ** 31) >>> 0);
    this.mixer = new Mixer(this.ctx);
    this.bank = new SoundBank(this.rng);
    const ns = deps.settings ? null : audioSettings();
    this.settings = { ...(ns?.get() ?? audioSettings().defaults), ...deps.settings };
    ns?.onChange((s) => this.applySettings(s));
    this.applySettings(this.settings);
    this.registerSynth();
    this.buildStatic();
    this.ready = this.load();
    if (bus) this.subscribe(bus);
  }

  // --- Setup ----------------------------------------------------------------------------------------

  private buf(data: Float32Array | Float32Array[]) {
    const chans = Array.isArray(data) ? data : [data];
    const b = this.ctx.createBuffer(chans.length, chans[0].length, this.ctx.sampleRate);
    chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  /** Procedural generators, run lazily the first time a key has no recorded variant. */
  private registerSynth() {
    const r = this.ctx.sampleRate;
    const rng = this.rng;
    const n = <T>(k: number, f: (i: number) => T) => Array.from({ length: k }, (_, i) => f(i));
    const reg = (key: string, f: () => Float32Array[]) => this.synthGen.set(key, f);
    reg('report.synth', () => n(3, () => synth.reportFallback(r, rng, false)));
    reg('report.synth.sup', () => n(3, () => synth.reportFallback(r, rng, true)));
    for (const m of ['ar', 'ak', 'pistol'] as const)
      reg(`mech.${m}`, () => n(4, () => synth.mechanical(m, r, rng)));
    reg('pressure', () => [synth.pressurePulse(r)]);
    reg('crack', () => n(4, () => synth.crack(r, rng)));
    reg('sup.report', () => n(4, () => synth.suppressedReport(r, rng)));
    reg('sup.pop', () => n(2, () => synth.suppressedReport(r, rng, true)));
    reg('sup.spring', () => n(3, () => synth.bufferSpring(r, rng)));
    reg('sup.gas', () => n(3, () => synth.gasHiss(r, rng)));
    reg('sup.ping', () => n(3, () => synth.casePing(r, rng)));
    reg('blast.body', () => n(4, () => synth.blastBody(r, rng)));
    reg('blast.roll', () => n(3, () => synth.blastRoll(r, rng)));
    reg('hit.paper', () => n(4, () => synth.paperHit(r, rng)));
    reg('hit.noshoot', () => n(3, () => synth.noShootHit(r, rng)));
    reg('ui.tick', () => [synth.uiTick(r)]);
    reg('shot.thump', () => n(3, () => synth.shotThump(r, rng)));
    reg('steel.fall', () => n(3, () => synth.steelFallClank(r, rng)));
    reg('ricochet', () => n(4, () => synth.whizz(r, rng)));
    reg('spall', () => n(3, () => synth.spall(r, rng)));
    reg('thump', () => n(4, () => synth.bodyThump(r, rng)));
    reg('rattle', () => n(3, () => synth.rattle(r, rng)));
    reg('handling', () => n(2, () => synth.handling(r, rng)));
    reg('click.synth', () => n(3, (i) => synth.click(r, rng, 0.85 + i * 0.15)));
    reg(KEYS.click, () => n(3, (i) => synth.click(r, rng, 0.9 + i * 0.1)));
    reg(KEYS.cloth, () => n(2, () => synth.handling(r, rng)));
    reg('brass.hard', () => n(4, () => synth.brassTinkle(r, rng, 'rifle', true)));
    reg('brass.soft', () => n(4, () => synth.brassTinkle(r, rng, 'rifle', false)));
    reg('brass.shell', () => n(3, () => synth.brassTinkle(r, rng, 'shell', true)));
    for (const cls of ['concrete', 'wood', 'carpet', 'grass', 'gravel', 'tile', 'metal', 'dirt'] as const) {
      reg(KEYS.step(cls), () => n(4, () => synth.footstep(cls, r, rng)));
      reg(`scuff.${cls}`, () => n(3, () => synth.scuff(cls, r, rng)));
    }
    for (const cls of ['hard', 'metal', 'wood', 'soft'] as const)
      reg(KEYS.mag(cls), () => n(3, () => synth.impact(r, rng, cls !== 'soft', true)));
    // Gear (src/gear).
    reg('gear.flashbang', () => n(2, () => synth.flashbangBlast(r, rng)));
    reg('gear.pin', () => n(2, () => synth.pinPull(r, rng)));
    reg('gear.spoon', () => n(3, () => synth.spoonFlick(r, rng)));
    reg('gear.bounce', () => n(4, () => synth.grenadeBounce(r, rng)));
    reg('gear.nvgDetent', () => n(2, () => synth.nvgDetent(r, rng)));
    reg('gear.nvgWhine', () => [synth.nvgWhine(r)]);
  }

  /** Pick a variant; generate the procedural stand-in on first use if no set provides the key. */
  private pick(key: string): AudioBuffer | null {
    let b = this.bank.pick(key);
    if (!b) {
      const gen = this.synthGen.get(key);
      if (!gen) return null;
      this.bank.addSynth(
        key,
        gen().map((x) => this.buf(x)),
      );
      b = this.bank.pick(key);
    }
    return b;
  }

  private pickFirst(keys: string[]) {
    for (const k of keys) if (this.bank.has(k)) return this.bank.pick(k);
    for (const k of keys) {
      const b = this.pick(k);
      if (b) return b;
    }
    return null;
  }

  /** Things every mix needs from frame one: IR bank (once, never per shot), wind noise, HVAC hum. */
  private buildStatic() {
    const r = this.ctx.sampleRate;
    this.mixer.setReverbBank(BANK.map((b, i) => this.buf(generateIr(BANK_SPECS[b.name], r, 101 + i))));
    const wl = synth.noise(4, r, mulberry32(11));
    const wr = synth.noise(4, r, mulberry32(12));
    this.mixer.startWind(this.buf([wl, wr]));
    // HVAC hook: mains hum + air noise, level set by setAmbience({ hvac }) and scaled by enclosure.
    const c = this.ctx;
    this.hvac = c.createGain();
    this.hvac.gain.value = 0;
    this.hvac.connect(this.mixer.amb);
    for (const [f, a] of [
      [60, 0.5],
      [120, 0.35],
      [180, 0.12],
    ]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = a * 0.05;
      o.connect(g).connect(this.hvac);
      o.start();
    }
    const air = c.createBufferSource();
    air.buffer = this.buf([synth.noise(2, r, mulberry32(13))]);
    air.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const ag = c.createGain();
    ag.gain.value = 0.03;
    air.connect(lp).connect(ag).connect(this.hvac);
    air.start();
    this.mixer.applyAcoustics(this.acoustics, { snap: true });
  }

  private async load() {
    let sets = this.deps.sets;
    let base = this.deps.base;
    if (!sets) {
      const m = await import('./sets');
      sets = m.SOUND_SETS;
      base ??= m.AUDIO_BASE;
    }
    const audio = typeof document !== 'undefined' ? document.createElement('audio') : null;
    await this.bank.load(
      this.ctx,
      sets,
      base ?? './assets/audio/',
      async (u) => {
        const res = await fetch(u);
        return res.ok ? res.arrayBuffer() : null;
      },
      (mime) => (audio ? audio.canPlayType(mime) !== '' : true),
    );
    this.startAmbience();
  }

  private startAmbience() {
    const c = this.ctx;
    let bed = this.bank.pick(KEYS.ambOutdoor);
    if (!bed) {
      const r = c.sampleRate;
      bed = this.buf([synth.windBed(12, r, mulberry32(21)), synth.windBed(12, r, mulberry32(22))]);
    }
    const src = c.createBufferSource();
    src.buffer = bed;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(gain).connect(this.mixer.amb);
    src.start(c.currentTime, this.rng() * bed.duration * 0.8);
    this.ambOutdoor = { gain, lp };
    this.applyAmbience(true);
  }

  private subscribe(bus: Bus) {
    bus.on('shot', (e) => this.gunshot(e));
    bus.on('steelHit', (e) => this.steelHit(e));
    bus.on('steelFall', (e) => this.steelFall(e));
    bus.on('footstep', (e) => this.footstep(e));
    bus.on('brass', (e) => {
      this.brassSeen = true;
      this.brass(e.point, e.surface, e.kind);
    });
    bus.on('magDrop', (e) => this.magDrop(e));
    bus.on('weaponBeat', (e) => this.weaponBeat(e));
    bus.on('dryFire', (e) => this.dryFire(e.weaponId));
    bus.on('camHand', (e) => this.camHand(e.active));
    bus.on('timerBeep', (e) => this.beep(e.kind));
    bus.on('impact', (e) => this.impact(e));
    bus.on('targetHit', (e) => this.targetHit(e));
    bus.on('flashbang', (e) => this.flashbang(e));
    bus.on('gearSound', (e) => this.gearSound(e));
    bus.on('nvg', (e) => this.nvgHum(e.on));
  }

  // --- Gear (src/gear) -----------------------------------------------------------------------------------

  /**
   * Flashbang: the loudest thing the mic ever hears. Delayed by distance, saturates the capsule, slams the
   * room (pressure + tail, much worse indoors), and leaves the listener with tinnitus and dulled hearing for
   * seconds (`hearing` from the gear exposure model; applies in every listening mode).
   */
  flashbang(e: Pick<GameEvents['flashbang'], 'point' | 'hearing' | 'indoor' | 'training'> & { at?: number }) {
    const sp = this.spatial(e.point);
    const at = (e.at ?? this.now()) + sp.d / SPEED_OF_SOUND;
    const a = this.acoustics;
    const enc = Math.max(a.enclosure, e.indoor ? 0.7 : 0);
    const k = e.training ? 0.6 : 1;
    const near = AudioEngine.dist(sp.d, 2.5);
    const blast = this.pick('gear.flashbang');
    if (blast)
      this.mixer.play(blast, {
        at,
        gain: 3.2 * k * (0.35 + 0.65 * near) * (1 + 0.6 * enc),
        pan: sp.pan * 0.6,
        lp: sp.lp,
        send: 1.2,
        bus: 'shot',
        prio: 6,
      });
    const cr = this.pick('crack');
    if (cr)
      this.mixer.play(cr, { at, gain: 1.6 * k * near, pan: sp.pan * 0.5, send: 0.4, bus: 'shot', prio: 6 });
    const pressure = this.pick('pressure');
    if (pressure)
      this.mixer.play(pressure, {
        at,
        gain: (0.4 + 2.6 * enc ** 1.3) * k * (0.4 + 0.6 * near),
        rate: 0.8,
        lp: 220,
        peak: [a.roomMode, 6 + 8 * a.bass, 2],
        room: 0.4,
        bus: 'shot',
        prio: 5,
      });
    const th = this.pick('shot.thump');
    if (th) this.mixer.play(th, { at, gain: 1.8 * k * near * (1 + enc), rate: 0.8, bus: 'shot', prio: 5 });
    this.mixer.duck(1.6 * k * (0.5 + 0.5 * near), at);
    // Ears: tinnitus + muffling scaled by exposure; recovery takes seconds (longer when it was bad).
    const h = clamp(e.hearing, 0, 1);
    if (h > 0.03) {
      this.dose = clamp(this.dose + h, 0, 1.5);
      this.mixer.exposure(Math.min(1, 0.25 + 0.85 * h), 2 + 7 * h, at + 0.02);
    }
  }

  gearSound(e: GameEvents['gearSound'], at = this.now()) {
    const sp = e.point ? this.spatial(e.point) : { d: 0.4, pan: 0, lp: 20000 };
    const near = AudioEngine.dist(sp.d, 1);
    const play = (key: string, gain: number, o: { rate?: number; room?: number; lp?: number } = {}) => {
      const b = this.pick(key);
      if (b)
        this.mixer.play(b, {
          at: at + sp.d / SPEED_OF_SOUND,
          gain: gain * near,
          pan: sp.pan,
          rate: (o.rate ?? 1) * (0.96 + this.rng() * 0.08),
          room: o.room ?? 0.15,
          lp: Math.min(sp.lp, o.lp ?? 20000),
          prio: 3,
        });
    };
    switch (e.kind) {
      case 'pin':
        play('gear.pin', 0.5);
        break;
      case 'spoon':
        play('gear.spoon', e.speed ? 0.25 : 0.45, { rate: e.speed ? 0.85 : 1 });
        break;
      case 'bounce': {
        const v = clamp((e.speed ?? 2) / 6, 0.1, 1);
        const soft = e.surface === 'carpet' || e.surface === 'grass' || e.surface === 'dirt';
        play('gear.bounce', 0.9 * v, { lp: soft ? 1500 : 12000, rate: e.surface === 'plywood' ? 0.8 : 1 });
        break;
      }
      case 'throw':
        play(KEYS.cloth, 0.3, { rate: 1.3 });
        break;
      case 'nvgDown':
      case 'nvgUp':
        play('gear.nvgDetent', 0.35, { rate: e.kind === 'nvgUp' ? 1.12 : 1, room: 0.05 });
        break;
      case 'irClick':
        play('click.synth', 0.18, { rate: 1.4, room: 0.04 });
        break;
    }
  }

  private whine?: GainNode;
  /** Faint tube whine while the NVG is powered (it's on your face, so it's barely there and dry). */
  nvgHum(on: boolean) {
    if (!this.whine) {
      const b = this.pick('gear.nvgWhine');
      if (!b) return;
      this.whine = this.mixer.play(b, { loop: true, gain: 0, room: 0, prio: 1 });
    }
    const t = this.now();
    this.whine.gain.cancelScheduledValues(t);
    this.whine.gain.setTargetAtTime(on ? 0.012 : 0, t, on ? 0.35 : 0.08);
  }

  applySettings(s: AudioSettings) {
    this.settings = s;
    this.mixer.setLevels(s.master, s.sfx, s.ambience);
    // The settings screen's "Mic artifacts" slider writes `mic`; older saves use `micArtifacts`.
    this.mixer.setArtifactLevel((s.mic as number | undefined) ?? s.micArtifacts);
    if (this.mixer.mode !== s.mode) this.mixer.setMode(s.mode);
  }

  setMode(mode: ListeningMode) {
    this.applySettings({ ...this.settings, mode });
  }

  resume() {
    const c = this.ctx as AudioContext;
    if (c.state !== 'running' && typeof c.resume === 'function') void c.resume();
  }

  /** Hook for authored layouts (§9.3). Stored now; portal propagation will consume it. */
  setRoomGraph(rooms: Room[], portals: Portal[]) {
    this.roomGraph = { rooms, portals };
  }

  /** Ambience hooks for facilities: indoor HVAC hum level 0..1. */
  setAmbience(o: { hvac?: number }) {
    if (o.hvac !== undefined) this.hvacLevel = o.hvac;
    this.applyAmbience(false);
  }

  /** Set acoustics directly (offline renders, tests, or an authored room). `snap` skips smoothing. */
  setAcoustics(a: Acoustics, snap = false) {
    this.probeTarget = a;
    if (snap) this.acoustics = a;
    this.mixer.applyAcoustics(this.acoustics, { snap });
    this.applyAmbience(snap);
  }

  // --- Spatial helpers ---------------------------------------------------------------------------------

  private now() {
    return this.ctx.currentTime;
  }

  /** Distance, pan (-1..1) and air-absorption cutoff from the listener to a world point. */
  private spatial(p: { x: number; y: number; z: number }) {
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldQuaternion(this.camQuat);
    const v = this.tmpV.set(p.x - this.camPos.x, p.y - this.camPos.y, p.z - this.camPos.z);
    const d = v.length();
    const right = this.tmpDir.set(1, 0, 0).applyQuaternion(this.camQuat);
    const pan = d > 0.3 ? clamp(v.dot(right) / d, -1, 1) * 0.9 : 0;
    // Air absorption: ~0.03 dB/m at 4 kHz → gentle LP with distance.
    const lp = clamp(20000 * Math.exp(-d / 140), 2500, 20000);
    return { d, pan, lp };
  }

  /** Inverse-distance gain relative to `ref` metres. */
  private static dist(d: number, ref: number) {
    return ref / Math.max(ref, d);
  }

  // --- Gunshots (§9.1) -----------------------------------------------------------------------------------

  /**
   * Layers: mechanical, report (by weapon + barrel), pressure (enclosure), early reflections + tail (send),
   * exterior escape (through openings), and the mic stage downstream.
   */
  gunshot(e: Pick<ShotEvent, 'weaponId' | 'caliber' | 'suppressed'> & { at?: number; subsonic?: boolean }) {
    const at = e.at ?? this.now();
    const prof = weaponSound(e.weaponId, e.caliber, e.suppressed);
    const bc = barrelCharacter(prof.barrelIn);
    const a = this.acoustics;
    const enc = a.enclosure;
    const sup = prof.suppressed;
    const j = jitter(this.rng);
    const rate = prof.pitch * j.rate;
    const last = this.lastShot.get(e.weaponId) ?? -Infinity;
    this.lastShot.set(e.weaponId, at);
    if (e.subsonic) this.subsonicUntil = at + 2;
    if (sup) {
      this.suppressedShot(e, prof, at, at - last > 6);
      if (!this.brassSeen && !this.deps.ctx) this.autoBrass(e.weaponId, e.caliber, at);
      return;
    }

    // Everything below rides the uncompressed wide-band shot path (bus 'shot'); only the bed pumps.
    // 1. Mechanical: close and dry; with a can on, it's a big part of what you hear.
    const mech = this.pick(`mech.${prof.mech}`);
    if (mech) {
      const mj = jitter(this.rng, 0.03, 1.5);
      this.mixer.play(mech, {
        at: at + 0.004,
        gain: (sup ? 0.75 : 0.6) * mj.gain,
        rate: mj.rate,
        hp: 350,
        room: 0.03,
        bus: 'shot',
        prio: 3,
      });
    }

    // 2. Report: the recorded blast, chosen by weapon + barrel; hot into the mic's soft ceiling.
    const report = this.pickFirst([
      KEYS.report(prof.report),
      ...prof.fallbacks.map(KEYS.report),
      sup ? 'report.synth.sup' : 'report.synth',
    ]);
    const energy = Math.sqrt(prof.energy);
    if (report)
      this.mixer.play(report, {
        at,
        gain: (sup ? 0.6 : 1.9) * bc.gain * energy * j.gain,
        rate,
        // Short-barrel harshness is a rifle thing; 9 mm reference shots are mid-centred, not bright.
        presenceDb: prof.family === 'rifle' ? bc.presenceDb : 0,
        lp: prof.family === 'pistol' ? 5000 : undefined,
        send: sup ? 0.3 : 0.55,
        bus: 'shot',
        prio: 5,
      });

    // 2a. A second, different recording under the first: fills out the texture (no two shots identical),
    // darker so it adds density rather than more crack.
    const second = this.pickFirst(this.secondaryReports(prof.family, prof.report));
    if (second && second !== report)
      this.mixer.play(second, {
        at: at + 0.0007,
        gain: (sup ? 0.3 : 0.75) * bc.gain * energy,
        rate: rate * 0.985,
        lp: sup ? 2500 : 6500,
        send: 0.25,
        bus: 'shot',
        prio: 4,
      });

    // 2e. Mid roll: the warm 120 Hz–2 kHz decay a real recording keeps after the crack (ref: 9 mm pack).
    const roll = this.pick('blast.roll');
    if (roll)
      this.mixer.play(roll, {
        at: at + 0.01,
        gain: 0.8 * energy * bc.gain,
        rate: prof.pitch * (0.96 + this.rng() * 0.08),
        send: 0.1,
        bus: 'shot',
        prio: 3,
      });

    // 2d. Blast body: the 150–600 Hz "meat" between crack and thump.
    const body = this.pick('blast.body');
    if (body)
      this.mixer.play(body, {
        at,
        gain: (sup ? 0.35 : 1.4) * energy * (1 + 0.4 * enc),
        rate: prof.pitch * (0.97 + this.rng() * 0.06),
        send: 0.2,
        bus: 'shot',
        prio: 4,
      });

    if (!sup) {
      // 2b. Crack: a sub-millisecond front so the transient is sharp even when the sample's is soft.
      // Subsonic loads (e.g. 220 gr .300 BLK) have no supersonic bullet crack.
      const cr = e.subsonic ? null : this.pick('crack');
      if (cr)
        this.mixer.play(cr, {
          at,
          gain: (0.9 + 0.6 * bc.harshness) * energy,
          rate: 0.97 + this.rng() * 0.06,
          send: 0.1,
          bus: 'shot',
          prio: 5,
        });
      // 2c. Body/chest thump: tight 40–120 Hz punch on every close shot, more concussive indoors.
      const th = this.pick('shot.thump');
      if (th)
        this.mixer.play(th, {
          at,
          gain: 0.45 * prof.energy * bc.pressure * (1 + 1.7 * enc + 1.2 * a.bass),
          rate: 0.97 + this.rng() * 0.06,
          bus: 'shot',
          prio: 5,
        });
    }

    // 3. Pressure: LF pulse; huge in a bathroom, nearly gone outdoors. Rings at the room's axial mode.
    const pressure = this.pick('pressure');
    if (pressure) {
      const leak = Math.hypot(a.openness.x, a.openness.y, a.openness.z);
      const g = (0.06 + 1.6 * enc ** 1.5 * (1 + a.bass)) * bc.pressure * prof.energy * (sup ? 0.3 : 1);
      this.mixer.play(pressure, {
        at,
        gain: g,
        rate: 1 / (1 + 0.8 * enc * (1 - leak)),
        lp: 260,
        peak: [a.roomMode, 4 + 10 * a.bass, 1.5 + 8 * a.bass * (1 - leak)],
        room: 0.1,
        bus: 'shot',
        prio: 4,
      });
    }

    // 6. Exterior/escape: pressure venting through an opening, heard from its direction.
    const open = Math.hypot(a.openness.x, a.openness.z);
    if (report && enc > 0.3 && open > 0.03) {
      this.camera.getWorldQuaternion(this.camQuat);
      const right = this.tmpDir.set(1, 0, 0).applyQuaternion(this.camQuat);
      const pan =
        clamp((a.openness.x * right.x + a.openness.z * right.z) / Math.max(open, 1e-3), -1, 1) * 0.8;
      this.mixer.play(report, {
        at: at + a.predelay * 1.5 + 0.012,
        gain: clamp(open * 2.2, 0, 0.6) * enc * bc.gain * energy * (sup ? 0.4 : 1),
        rate: rate * 0.97,
        lp: 2200,
        pan,
        send: 0.3,
        bus: 'shot',
        prio: 2,
      });
    }

    // 7. Mic AGC: the bed (ambience, foley, wind) ducks and breathes back over ~1 s.
    this.mixer.duck((sup ? 0.35 : 1) * Math.min(1.2, prof.energy) * (0.8 + 0.3 * enc), at);

    // Hearing exposure (no-protection mode): indoor shots hurt more.
    if (this.mixer.mode === 'noprotect' && !sup) {
      this.dose = clamp(this.dose + prof.energy * (0.15 + 0.5 * enc), 0, 1.5);
      this.mixer.exposure(Math.min(1, this.dose), 3 + 4 * this.dose, at);
    }

    // Brass fallback until a physics brass system emits `brass` events.
    if (!this.brassSeen && !this.deps.ctx) this.autoBrass(e.weaponId, e.caliber, at);
  }

  /**
   * Suppressed fire (real, not Hollywood): the report is still ~130–135 dB at the shooter — a sharp,
   * compressed "pfft-crack" with a short thump — but the action is now just as loud: bolt carrier, buffer
   * spring, case ping, gas blowback at the port. First round after a pause pops (oxygen in the can).
   * Supersonic ammo still cracks downrange; subsonic (HB-300 220 gr) doesn't, so hits on target carry.
   */
  private suppressedShot(
    e: Pick<ShotEvent, 'weaponId' | 'subsonic'>,
    prof: ReturnType<typeof weaponSound>,
    at: number,
    firstRound: boolean,
  ) {
    const a = this.acoustics;
    const enc = a.enclosure;
    const supersonic = !e.subsonic;
    // An add-on can on a 5.56 carbine is noticeably louder than the integral-can subsonic PDW.
    // SUP_LEVEL sets suppressed fire ~12–18 dB under an unsuppressed shot at the mic (which is driven well into
    // the soft ceiling), instead of clipping just as hard.
    const L = SUP_LEVEL * (supersonic ? 1 : 0.72) * Math.sqrt(prof.energy);
    const pop = firstRound ? 1.5 : 1;
    const isAr = prof.mech === 'ar';
    const S = SUP_LEVEL;
    const play = (key: string, o: Parameters<Mixer['play']>[1]) => {
      const b = this.pick(key);
      if (b) this.mixer.play(b, { bus: 'shot', ...o });
      return b;
    };
    // Mechanical: louder and closer than unsuppressed — it's half of what you hear.
    const mj = jitter(this.rng, 0.02, 1);
    play(`mech.${prof.mech}`, {
      at: at + 0.003,
      gain: 0.85 * S * mj.gain,
      rate: mj.rate,
      hp: 250,
      room: 0.03,
      prio: 4,
    });
    if (isAr) {
      play('sup.spring', {
        at: at + 0.028,
        gain: 0.45 * S,
        rate: 0.98 + this.rng() * 0.04,
        room: 0.02,
        prio: 3,
      });
      // Gas blowback out of the ejection port, right side, a beat after the shot.
      play('sup.gas', { at: at + 0.012, gain: 0.45 * S * pop, pan: 0.3, room: 0.02, prio: 3 });
    }
    play('sup.ping', {
      at: at + 0.035,
      gain: 0.2 * S,
      pan: 0.45,
      rate: 0.97 + this.rng() * 0.06,
      room: 0.03,
      prio: 2,
    });

    // Report: real suppressed recording + the synthetic pfft-crack/thump core (pop variant on round one).
    const rj = jitter(this.rng);
    play(KEYS.report('suppressed'), {
      at,
      gain: 0.85 * L * (firstRound ? 1.4 : 1) * rj.gain,
      rate: prof.pitch * rj.rate,
      send: 0.22,
      prio: 5,
    });
    play(firstRound ? 'sup.pop' : 'sup.report', {
      at,
      gain: 1.5 * L * (firstRound ? 1.6 : 1),
      rate: prof.pitch * (0.98 + this.rng() * 0.04),
      send: 0.22,
      prio: 5,
    });
    // Supersonic: the bullet's own crack, just ahead of the muzzle and going away downrange.
    if (supersonic)
      play('crack', {
        at: at + 0.006,
        gain: 0.7 * S,
        rate: 0.95 + this.rng() * 0.08,
        lp: 11000,
        send: 0.12,
        prio: 5,
      });
    // A little pressure — mostly indoors, more on the pop.
    play('pressure', {
      at,
      gain: (0.03 + 0.55 * enc ** 1.5 * (1 + a.bass)) * L * pop,
      rate: 1 / (1 + 0.5 * enc),
      lp: 240,
      peak: [a.roomMode, 3 + 8 * a.bass, 1.5 + 5 * a.bass],
      room: 0.06,
      prio: 3,
    });
    this.mixer.duck((0.45 + 0.2 * enc) * L * (firstRound ? 1.2 : 1), at);
  }

  /** Report pools to layer under the primary (a different recording of a similar gun). */
  private secondaryReports(family: 'rifle' | 'pistol', primary: string) {
    const pool =
      family === 'pistol'
        ? ['pistol9']
        : primary === 'suppressed'
          ? ['suppressed']
          : ['rifle556.long', 'rifle762.short', 'rifle556.short'].filter((k) => k !== primary);
    const i = Math.floor(this.rng() * pool.length);
    return [...pool.slice(i), ...pool.slice(0, i)].map(KEYS.report);
  }

  /** A shot far away (neighbour bays): through air and berms, mostly echo. */
  distantShot(o: { distance: number; pan: number; family?: 'rifle' | 'pistol'; at?: number }) {
    const at = o.at ?? this.now();
    const key = o.family === 'pistol' ? KEYS.report('pistol9') : KEYS.report('rifle556.short');
    const report = this.pickFirst([key, 'report.synth']);
    if (!report) return;
    const d = o.distance;
    const indoor = this.acoustics.enclosure;
    const lp = clamp(16000 / (1 + d / 30), 900, 12000) * (1 - 0.7 * indoor);
    this.mixer.play(report, {
      at: at + 0.01,
      gain: AudioEngine.dist(d, 9) * (1 - 0.65 * indoor) * 0.9,
      rate: 0.97 + this.rng() * 0.05,
      lp,
      pan: o.pan,
      send: 1.6,
      prio: 0,
    });
  }

  // --- Steel (§9.4) ----------------------------------------------------------------------------------

  private steelBuffers(size: number, thicknessMm: number, mount: synth.Mount) {
    const key = `${size.toFixed(2)}|${thicknessMm}|${mount}`;
    let list = this.steelCache.get(key);
    if (!list) {
      const r = this.ctx.sampleRate;
      list = [0.1, 0.5, 0.9].map((hp) => this.buf(synth.steelHit(size, thicknessMm, mount, hp, r, this.rng)));
      this.steelCache.set(key, list);
    }
    return list;
  }

  steelHit(
    e: Pick<GameEvents['steelHit'], 'point' | 'targetId' | 'size' | 'thicknessMm' | 'energy'> & {
      at?: number;
    },
  ) {
    const at0 = e.at ?? this.now();
    const sp = this.spatial(e.point);
    const at = at0 + sp.d / SPEED_OF_SOUND;
    const mount: synth.Mount = e.targetId.startsWith('popper') ? 'hinge' : 'chain';
    const list = this.steelBuffers(e.size, e.thicknessMm, mount);
    const b = list[Math.floor(this.rng() * list.length)];
    const hit = clamp(0.35 + e.energy / 1600, 0.35, 1.3);
    // Floor so a 50 m plate still rings clearly over the shot that hit it.
    const dist = Math.max(0.28, AudioEngine.dist(sp.d, 6));
    this.mixer.play(b, {
      at,
      gain: hit * dist * 1.1,
      rate: 1 + (this.rng() - 0.5) * 0.012,
      lp: Math.min(sp.lp, 5000 + e.energy * 6),
      pan: sp.pan,
      send: 0.4,
      bus: 'shot',
      prio: 3,
    });
    if (this.rng() < 0.4) {
      const s = this.pick('spall');
      if (s) this.mixer.play(s, { at, gain: 0.25 * dist, pan: sp.pan, lp: sp.lp, send: 0.3, prio: 1 });
    }
    if (this.rng() < 0.18) {
      const w = this.pick('ricochet');
      const pan = clamp(sp.pan + (this.rng() - 0.5) * 0.8, -1, 1);
      if (w)
        this.mixer.play(w, {
          at: at + 0.01,
          gain: 0.35 * Math.sqrt(dist),
          pan,
          lp: sp.lp,
          send: 0.4,
          prio: 1,
        });
    }
  }

  steelFall(e: Pick<GameEvents['steelFall'], 'point'> & { at?: number }) {
    const sp = this.spatial(e.point);
    const b = this.pick('steel.fall');
    if (b)
      this.mixer.play(b, {
        at: (e.at ?? this.now()) + sp.d / SPEED_OF_SOUND,
        gain: 0.9 * AudioEngine.dist(sp.d, 6),
        rate: 0.95 + this.rng() * 0.1,
        lp: sp.lp,
        pan: sp.pan,
        send: 0.7,
        prio: 2,
      });
  }

  /** Hit-confirm tick: the audio setting, or always with the Arcade realism preset. */
  private hitTickOn() {
    if (this.settings.hitTick) return true;
    if (this.deps.settings) return false;
    return store.ns('gameplay', { realism: 'standard' }).get().realism === 'arcade';
  }

  /**
   * Target hit feedback (diegetic): paper "thwap" from the target, delayed by the speed of sound; no-shoots
   * sound deader/lower. Steel already rings via steelHit. Rides the shot path so the post-shot AGC duck can't
   * swallow it, with a distance floor so a 25 m hit is still clearly there.
   */
  targetHit(
    e: Partial<GameEvents['targetHit']> & Pick<GameEvents['targetHit'], 'kind' | 'point'> & { at?: number },
  ) {
    const at0 = e.at ?? this.now();
    const sp = this.spatial(e.point);
    if (e.kind === 'paper') {
      const b = this.pick(e.noShoot ? 'hit.noshoot' : 'hit.paper');
      if (b)
        this.mixer.play(b, {
          at: at0 + sp.d / SPEED_OF_SOUND,
          gain: (at0 < this.subsonicUntil ? 0.8 : 0.5) * Math.max(0.3, AudioEngine.dist(sp.d, 5)),
          rate: 0.98 + this.rng() * 0.04,
          lp: sp.lp,
          pan: sp.pan,
          send: 0.15,
          bus: 'shot',
          prio: 3,
        });
    }
    if (this.hitTickOn()) {
      const t = this.pick('ui.tick');
      if (t)
        this.mixer.play(t, { at: at0 + 0.03, gain: 0.25, rate: e.noShoot ? 0.7 : 1, bus: 'ui', prio: 4 });
    }
  }

  /** Paper "thup" + berm dirt for non-steel impacts (only near the listener's line of fire matters). */
  /**
   * Bullet impacts downrange (berm, walls…); paper has its own thwap (targetHit) and steel its ring. With a
   * subsonic load there's no crack to mask them, so they come through clearly (and aren't AGC-ducked).
   */
  impact(e: Pick<GameEvents['impact'], 'point' | 'surface'> & { at?: number }) {
    if (e.surface === 'steel_target' || e.surface === 'paper_target') return;
    const sp = this.spatial(e.point);
    if (sp.d > 80) return;
    const at = (e.at ?? this.now()) + sp.d / SPEED_OF_SOUND;
    const quiet = at < this.subsonicUntil;
    const cls = STEP_CLASS[e.surface];
    const b = this.pick(KEYS.mag(MAG_CLASS[cls]));
    if (b)
      this.mixer.play(b, {
        at,
        gain: (quiet ? 0.6 : 0.25) * Math.max(quiet ? 0.3 : 0, AudioEngine.dist(sp.d, 5)),
        rate: 0.7 + this.rng() * 0.2,
        lp: Math.min(sp.lp, 6000),
        pan: sp.pan,
        send: 0.2,
        bus: quiet ? 'shot' : 'dry',
        prio: 1,
      });
  }

  // --- Body, brass, mags, foley (§9.5, §9.7) -------------------------------------------------------------

  footstep(e: Pick<GameEvents['footstep'], 'surface' | 'foot' | 'speed' | 'scuff'> & { at?: number }) {
    const at = e.at ?? this.now();
    const cls = STEP_CLASS[e.surface] ?? 'concrete';
    const step = this.pick(KEYS.step(cls));
    const j = jitter(this.rng, 0.02, 1.5);
    const pan = e.foot === 'L' ? -0.12 : 0.12;
    if (step)
      this.mixer.play(step, {
        at,
        gain: FOLEY * (0.12 + 0.05 * e.speed) * j.gain,
        rate: j.rate,
        pan,
        room: 0.02,
        prio: 1,
      });
    if (e.scuff > 0.22) {
      const s = this.pick(`scuff.${cls}`);
      if (s) this.mixer.play(s, { at: at + 0.02, gain: FOLEY * 0.2 * e.scuff, pan, room: 0.015, prio: 1 });
    }
    // Heel strike through the chest rig → mic thump (harder when running).
    const t = this.pick('thump');
    if (t) this.mixer.play(t, { at, gain: 0.12 + 0.12 * clamp(e.speed - 1, 0, 4), bus: 'thump', prio: 1 });
    if (e.speed > 3.8 && this.rng() < 0.5) {
      const r = this.pick('rattle');
      if (r) this.mixer.play(r, { at: at + 0.02, gain: 0.08, bus: 'thump', prio: 0 });
    }
  }

  brass(
    point: { x: number; y: number; z: number },
    surface: Surface,
    kind: 'rifle' | 'pistol' | 'shell',
    at?: number,
  ) {
    const sp = this.spatial(point);
    const hard = isHardSurface(surface);
    const b =
      kind === 'shell'
        ? this.pick('brass.shell')
        : hard
          ? this.pick(KEYS.brass(true))
          : this.pick(KEYS.brass(false));
    if (!b) return;
    const soft = surface === 'gravel' || surface === 'grass' || surface === 'dirt' || surface === 'berm';
    this.mixer.play(b, {
      at: at ?? this.now(),
      gain: FOLEY * 0.3 * AudioEngine.dist(sp.d, 1.5) * (soft ? 0.6 : 1),
      rate: (kind === 'pistol' ? 1.2 : 1) * (0.97 + this.rng() * 0.06),
      lp: soft ? 3500 : sp.lp,
      pan: sp.pan,
      room: 0.04,
      prio: 0,
    });
  }

  private autoBrass(weaponId: string, caliber: string, at: number) {
    this.camera.getWorldPosition(this.camPos);
    const fam = WEAPON_SOUNDS[weaponId]?.family ?? 'rifle';
    const right = this.tmpDir.set(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(this.camQuat));
    const p = { x: this.camPos.x + right.x * 1.2, y: 0, z: this.camPos.z + right.z * 1.2 };
    let surface: Surface = 'gravel';
    const ph = this.deps.physics;
    if (ph) {
      const hit = ph.raycast(this.camPos, this.tmpV.set(0, -1, 0), 3, this.deps.exclude?.());
      if (hit) surface = hit.tag.surface;
    }
    const kind = caliber.includes('12') ? 'shell' : fam === 'pistol' ? 'pistol' : 'rifle';
    this.brass(p, surface, kind, at + 0.4 + this.rng() * 0.25);
  }

  magDrop(e: Pick<GameEvents['magDrop'], 'surface' | 'polymer'> & { at?: number }) {
    const cls = MAG_CLASS[STEP_CLASS[e.surface] ?? 'concrete'];
    const b = this.pick(KEYS.mag(cls));
    if (b)
      this.mixer.play(b, {
        at: (e.at ?? this.now()) + 0.32, // falls from hip height
        gain: FOLEY * 0.4,
        rate: 0.99 + this.rng() * 0.02,
        lp: e.polymer ? 7000 : undefined,
        pan: (this.rng() - 0.5) * 0.3,
        room: 0.03,
        prio: 2,
      });
  }

  /** Last time each foley key fired: a duplicate within 60 ms is dropped (no phasing double-hits). */
  private lastFoley = new Map<string, number>();

  weaponBeat(e: Pick<GameEvents['weaponBeat'], 'weaponId' | 'beat' | 'stressed'> & { at?: number }) {
    const at = e.at ?? this.now();
    const fam = WEAPON_SOUNDS[e.weaponId]?.family ?? 'rifle';
    const keys = [KEYS.foley(fam, e.beat)];
    if (fam === 'rifle' || e.beat === 'magRelease' || e.beat === 'boltRelease')
      keys.push(KEYS.foley('rifle', e.beat));
    keys.push(KEYS.click, 'click.synth');
    const tag = `${e.weaponId}.${e.beat}`;
    if (at - (this.lastFoley.get(tag) ?? -1) < 0.06) return;
    this.lastFoley.set(tag, at);
    const b = this.pickFirst(keys);
    const j = jitter(this.rng, 0.01, 1);
    if (b)
      this.mixer.play(b, {
        at,
        gain: FOLEY * 0.45 * (e.stressed ? 1.35 : 1) * j.gain,
        rate: j.rate,
        pan: 0.08,
        room: 0.02,
        prio: 3,
      });
    if (e.beat === 'magCheck') {
      const c = this.pick(KEYS.cloth);
      if (c) this.mixer.play(c, { at: at + 0.05, gain: FOLEY * 0.15, room: 0.01, prio: 1 });
    }
  }

  dryFire(_weaponId: string, at = this.now()) {
    const b = this.pickFirst([KEYS.foley('any', 'dryFire'), KEYS.click, 'click.synth']);
    if (b)
      this.mixer.play(b, { at, gain: FOLEY * 0.45, rate: 0.995 + this.rng() * 0.01, room: 0.015, prio: 3 });
  }

  camHand(active: boolean) {
    this.mixer.muffle(active);
    if (!active) return;
    const h = this.pick('handling');
    if (h) this.mixer.play(h, { gain: 0.35, bus: 'thump', prio: 2 });
    const c = this.pick(KEYS.cloth);
    if (c) this.mixer.play(c, { gain: 0.3, prio: 1 });
  }

  private beepBuf?: AudioBuffer;
  beep(kind: 'start' | 'stop' = 'start') {
    if (!this.beepBuf) {
      const r = this.ctx.sampleRate;
      const x = new Float32Array(Math.ceil(r * 0.35));
      for (let i = 0; i < x.length; i++) {
        const ph = (i * 2900) / r;
        x[i] = (ph % 1 < 0.5 ? 0.25 : -0.25) * Math.min(1, i / 48, (x.length - i) / 96);
      }
      this.beepBuf = this.buf(x);
    }
    this.mixer.play(this.beepBuf, { gain: 0.5, rate: kind === 'stop' ? 0.9 : 1, send: 0.3, prio: 4 });
  }

  // --- Per frame -----------------------------------------------------------------------------------------

  /** Called per render frame. Probe rays are spread over frames (RAYS_PER_FRAME). */
  update(dt = 1 / 60) {
    if (dt <= 0) return;
    this.clock += dt;
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldQuaternion(this.camQuat);
    const fwd = this.tmpDir.set(0, 0, -1).applyQuaternion(this.camQuat);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    let dy = yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.lastYaw = yaw;
    const k = smoothK(dt, 0.08);
    this.yawRate += (clamp(dy / dt, -12, 12) - this.yawRate) * k;
    const moved = this.camPos.distanceTo(this.lastPos);
    this.lastPos.copy(this.camPos);
    this.speed += (clamp(moved / dt, 0, 12) - this.speed) * k;

    this.probeStep(dt);
    this.acoustics = smoothAcoustics(this.acoustics, this.probeTarget, smoothK(dt, 0.3));
    this.applyT += dt;
    if (this.applyT >= 0.05) {
      this.applyT = 0;
      this.mixer.applyAcoustics(this.acoustics);
      this.applyAmbience(false);
      this.applyWind();
    }
    this.neighbours();
    if (this.dose > 0) this.dose = Math.max(0, this.dose - dt * 0.12);
  }

  private probeStep(dt: number) {
    const ph = this.deps.physics;
    if (!ph) return;
    this.probeT += dt;
    if (this.rays.length >= this.dirs.length) {
      if (this.probeT < PROBE_INTERVAL) return;
      const right = this.tmpDir.set(1, 0, 0).applyQuaternion(this.camQuat);
      this.probeTarget = analyseProbe(this.rays, { x: right.x, y: right.y, z: right.z });
      this.rays = [];
      this.probeT = 0;
    }
    const ex = this.deps.exclude?.();
    for (let i = 0; i < RAYS_PER_FRAME && this.rays.length < this.dirs.length; i++) {
      const dir = this.dirs[this.rays.length];
      const hit = ph.raycast(this.camPos, this.tmpV.set(dir.x, dir.y, dir.z), PROBE_RANGE, ex);
      this.rays.push(
        hit
          ? {
              dir,
              dist: hit.distance,
              surface: hit.tag.surface,
              normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
            }
          : { dir, dist: Infinity },
      );
    }
  }

  private applyAmbience(snap: boolean) {
    const enc = this.acoustics.enclosure;
    const t = this.now();
    const tau = snap ? 0.001 : 0.25;
    if (this.ambOutdoor) {
      // Outdoors: full bed. Indoors: through walls, quieter and duller; leaks in through openings.
      const open = Math.hypot(this.acoustics.openness.x, this.acoustics.openness.z);
      const through = clamp(1 - enc + open * 1.5, 0.12, 1);
      this.ambOutdoor.gain.gain.setTargetAtTime(0.6 * through, t, tau);
      this.ambOutdoor.lp.frequency.setTargetAtTime(clamp(900 + 17000 * through ** 2, 600, 18000), t, tau);
    }
    this.hvac?.gain.setTargetAtTime(this.hvacLevel * enc, t, tau);
  }

  /** Dynamic stereo wind: speed + yaw rate per side, outdoor gusts, attenuated by enclosure (§9.6). */
  private applyWind() {
    this.gust += (this.rng() - 0.5) * 0.15;
    this.gust = clamp(this.gust * 0.97, -0.3, 0.3);
    const outdoor = 1 - 0.88 * this.acoustics.enclosure;
    // Standing still outdoors: a faint breeze on the capsule; walking/turning makes it gust.
    const base = (0.035 + this.gust * 0.08 + this.speed * 0.045) * outdoor;
    const turn = 0.07 * outdoor;
    const left = base + turn * Math.max(0, this.yawRate);
    const right = base + turn * Math.max(0, -this.yawRate);
    this.mixer.setWind(clamp(left, 0, 1.2), clamp(right, 0, 1.2));
  }

  /** Occasional neighbour-bay gunfire on outdoor ranges (through the same pipeline, far away). */
  private neighbours() {
    if (!this.settings.neighbours || this.deps.ctx) return;
    if (this.clock < this.nextNeighbour) return;
    const pistol = this.rng() < 0.4;
    const dist = 70 + this.rng() * 140;
    const pan = (this.rng() * 2 - 1) * 0.9;
    const n = 1 + Math.floor(this.rng() * (pistol ? 5 : 4));
    let t = this.now();
    for (let i = 0; i < n; i++) {
      this.distantShot({ distance: dist, pan, family: pistol ? 'pistol' : 'rifle', at: t });
      t += (pistol ? 0.28 : 0.22) + this.rng() * (pistol ? 0.5 : 0.9);
    }
    this.nextNeighbour = this.clock + 5 + this.rng() * 14;
  }

  /** Debug/telemetry snapshot (exposed via window.__sb.audio in tests). */
  get debug() {
    return {
      enclosure: this.acoustics.enclosure,
      rt60: this.acoustics.rt60,
      volume: this.acoustics.volume,
      ceiling: this.acoustics.ceiling,
      reverb: this.mixer.reverbState,
      voices: this.mixer.activeVoices,
      stolen: this.mixer.stolen,
      dropped: this.mixer.dropped,
      peakVoices: this.mixer.peakVoices,
      loaded: this.bank.loadedFrom,
      keys: this.bank.keys().length,
    };
  }

  /** Render a demo scenario offline (lazy-loaded tool; used by the e2e audio spec). */
  async renderOffline(name: string) {
    const { renderScenario } = await import('./offline');
    return renderScenario(name);
  }
}
