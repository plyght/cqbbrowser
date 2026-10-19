/**
 * Offline renders of audio scenarios (we can't listen in CI, so we look at WAVs/spectrograms instead).
 * Uses the real engine on an OfflineAudioContext with analytic probe scenes in place of Rapier.
 * Exposed as `window.__sb.audio.renderOffline(name)`; tests/e2e/audio.spec.ts writes screenshots/audio-*.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { analyseProbe } from './acoustics';
import { crestDb, decayRt60, mono, peakIndex, wetDryDb } from './metrics';
import { AudioEngine } from './AudioEngine';
import { castScene, outdoorRange, room, roomWithDoor, type Aabb } from './probeScenes';
import type { ListeningMode } from './settings';

const RATE = 48000;

interface Scenario {
  seconds: number;
  mode?: ListeningMode;
  scene: Aabb[];
  ear?: Vector3;
  /** Time of the first shot: when set, crest / RT60 / wet-dry metrics are measured around it. */
  measureAt?: number;
  /** Shot times: per-shot peaks are measured on the linear render (level/first-round comparisons). */
  shots?: number[];
  hitTick?: boolean;
  run(e: AudioEngine, ctx: OfflineAudioContext, cam: PerspectiveCamera): void | Promise<void>;
}

const shot = (e: AudioEngine, weaponId: string, caliber: string, at: number) =>
  e.gunshot({ weaponId, caliber, suppressed: false, at });

function supRun(e: AudioEngine, weaponId: string, subsonic: boolean, times: number[], paperAt: number) {
  const caliber = weaponId === 'hb300' ? '300blk' : '5.56';
  const v = subsonic ? 300 : 790;
  for (const t of times) {
    e.gunshot({ weaponId, caliber, suppressed: true, subsonic, at: t });
    if (paperAt)
      e.targetHit({ kind: 'paper', zone: 'A', point: new Vector3(0.3, 1.4, -paperAt), at: t + paperAt / v });
  }
}

function paperRun(e: AudioEngine, shots: boolean) {
  const hit = (t: number, z: number, noShoot = false) => {
    if (shots) shot(e, 'sb16', '5.56', t);
    e.targetHit({ kind: 'paper', zone: 'A', noShoot, point: new Vector3(0.3, 1.4, -z), at: t + z / 790 });
  };
  hit(0.4, 7);
  hit(1.6, 25);
  hit(2.8, 7, true);
}

export const SCENARIOS: Record<string, Scenario> = {
  'rifle-outdoor': {
    measureAt: 0.4,
    shots: [0.4, 2.2],
    seconds: 4,
    scene: outdoorRange(),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.4);
      shot(e, 'sb16', '5.56', 2.2);
    },
  },
  'rifle-box': {
    measureAt: 0.4,
    seconds: 4,
    scene: room(1.5, 1.5, 2.4),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.4);
      shot(e, 'sb16', '5.56', 2.2);
    },
  },
  'rifle-room': {
    measureAt: 0.4,
    seconds: 4,
    scene: room(6, 5, 2.7, 'drywall'),
    run: (e) => {
      shot(e, 'k47s', '7.62x39', 0.4);
      shot(e, 'k47s', '7.62x39', 2.2);
    },
  },
  'rifle-hall': {
    measureAt: 0.4,
    seconds: 4,
    scene: room(20, 30, 8),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.4);
      shot(e, 'sb16', '5.56', 2.2);
    },
  },
  'steel-7m': {
    seconds: 3,
    scene: outdoorRange(),
    run: (e) => {
      const gong = new Vector3(0.5, 1.4, -7);
      for (let i = 0; i < 3; i++) {
        shot(e, 'p17', '9mm', 0.4 + i * 0.8);
        e.steelHit({
          point: gong,
          targetId: 'gong7',
          size: 0.25,
          thicknessMm: 10,
          energy: 480,
          at: 0.4 + i * 0.8 + 7 / 360,
        });
      }
    },
  },
  /** Paper hits at 7 and 25 m, then a no-shoot hit; rifle, outdoors. Hit-confirm tick on. */
  'paper-hits': {
    seconds: 4,
    scene: outdoorRange(),
    run: (e) => paperRun(e, true),
  },
  /** The same hits without the shots (level check: the thwap must stand on its own). Tick on. */
  'paper-hits-solo': {
    seconds: 4,
    scene: outdoorRange(),
    hitTick: true,
    run: (e) => paperRun(e, false),
  },
  'steel-25m': {
    seconds: 4,
    scene: outdoorRange(),
    run: (e) => {
      const gong = new Vector3(0, 1.4, -25);
      shot(e, 'sb16', '5.56', 0.4);
      e.steelHit({
        point: gong,
        targetId: 'gong1',
        size: 0.3,
        thicknessMm: 10,
        energy: 1250,
        at: 0.4 + 25 / 790,
      });
      const popper = new Vector3(3, 1.1, -25);
      shot(e, 'p17', '9mm', 2.2);
      e.steelHit({
        point: popper,
        targetId: 'popper2',
        size: 0.35,
        thicknessMm: 10,
        energy: 500,
        at: 2.2 + 25 / 360,
      });
      e.steelFall({ point: popper, at: 2.2 + 25 / 360 + 0.38 });
    },
  },
  /** Unsuppressed 9 mm outdoors: the one to compare with the owner's real 9 mm reference pack. */
  'pistol-outdoor': {
    measureAt: 0.4,
    shots: [0.4, 1.6, 2.8],
    seconds: 4,
    scene: outdoorRange(),
    run: (e) => {
      for (const t of [0.4, 1.6, 2.8]) shot(e, 'p17', '9mm', t);
    },
  },
  'pistol-reload-room': {
    seconds: 5,
    scene: room(4, 3.5, 2.6, 'drywall'),
    run: (e) => {
      for (let i = 0; i < 3; i++) shot(e, 'p17', '9mm', 0.3 + i * 0.28);
      e.dryFire('p17', 1.4);
      const beats = ['magRelease', 'magOut', 'magIn', 'magSeat', 'boltRelease'];
      beats.forEach((beat, i) => e.weaponBeat({ weaponId: 'p17', beat, stressed: true, at: 1.9 + i * 0.35 }));
      e.magDrop({ surface: 'concrete', polymer: true, at: 2.25 });
      for (let i = 0; i < 6; i++)
        e.footstep({
          surface: 'concrete',
          foot: i % 2 ? 'R' : 'L',
          speed: 2,
          scuff: i === 3 ? 0.6 : 0.05,
          at: 3.8 + i * 0.18,
        });
    },
  },
  /** Foley check: pistol reload calm then stressed, isolated (no shots) so the clicks can be inspected. */
  'pistol-reload-room-v2': {
    seconds: 5,
    scene: room(4, 3.5, 2.6, 'drywall'),
    run: (e) => {
      const beats = ['magRelease', 'magOut', 'magIn', 'magSeat', 'boltRelease'];
      const at = [0.3, 0.45, 1.1, 1.35, 1.75];
      beats.forEach((beat, i) => e.weaponBeat({ weaponId: 'p17', beat, stressed: false, at: at[i] }));
      e.magDrop({ surface: 'concrete', polymer: true, at: 0.45 });
      beats.forEach((beat, i) =>
        e.weaponBeat({ weaponId: 'p17', beat, stressed: true, at: 2.6 + at[i] * 0.8 }),
      );
      e.dryFire('p17', 4.3);
      e.weaponBeat({ weaponId: 'p17', beat: 'magCheck', stressed: false, at: 4.6 });
    },
  },
  /** Rifle in a concrete room: two shots, then an empty reload. Indoors should be the thumpiest. */
  'rifle-indoor-v2': {
    measureAt: 0.3,
    seconds: 5,
    scene: room(4, 4, 2.7),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.3);
      shot(e, 'sb16', '5.56', 0.65);
      const beats = ['magRelease', 'magOut', 'magIn', 'magSeat', 'boltRelease'];
      const at = [2.0, 2.15, 2.9, 3.15, 3.6];
      beats.forEach((beat, i) => e.weaponBeat({ weaponId: 'sb16', beat, stressed: false, at: at[i] }));
      e.magDrop({ surface: 'concrete', polymer: true, at: 2.15 });
      e.weaponBeat({ weaponId: 'sb16', beat: 'magCheck', stressed: false, at: 4.4 });
    },
  },
  'suppressed-outdoor': {
    seconds: 3,
    scene: outdoorRange(),
    run: (e) => {
      for (let i = 0; i < 3; i++)
        e.gunshot({
          weaponId: 'hb300',
          caliber: '300blk',
          suppressed: true,
          subsonic: true,
          at: 0.4 + i * 0.3,
        });
    },
  },
  /** HB-300 integral can + 220 gr subsonic: mostly action noise; the paper hit at 25 m carries. */
  'sup-hb300-outdoor': {
    measureAt: 0.4,
    shots: [0.4, 1.4, 2.4],
    seconds: 3.6,
    scene: outdoorRange(),
    run: (e) => supRun(e, 'hb300', true, [0.4, 1.4, 2.4], 25),
  },
  'sup-hb300-indoor': {
    measureAt: 0.4,
    shots: [0.4, 1.4, 2.4],
    seconds: 3.6,
    scene: room(5, 4, 2.7, 'drywall'),
    run: (e) => supRun(e, 'hb300', true, [0.4, 1.4, 2.4], 0),
  },
  /** SB-16 with an add-on can and supersonic 5.56: louder, cracks downrange. */
  'sup-sb16-outdoor': {
    measureAt: 0.4,
    shots: [0.4, 1.4, 2.4],
    seconds: 3.6,
    scene: outdoorRange(),
    run: (e) => supRun(e, 'sb16', false, [0.4, 1.4, 2.4], 25),
  },
  /** First-round pop: a cold can (shot 1) vs two follow-ups 0.25 s apart (shots 2–3). */
  'sup-first-round': {
    measureAt: 0.4,
    shots: [0.4, 0.65, 0.9],
    seconds: 2,
    scene: outdoorRange(),
    run: (e) => supRun(e, 'hb300', true, [0.4, 0.65, 0.9], 0),
  },
  /** Full-auto mag dump in a room with brass raining down: exercises voice stealing (≤ 32 voices). */
  'auto-room': {
    seconds: 4,
    scene: room(6, 5, 2.7),
    run: (e) => {
      for (let i = 0; i < 30; i++) {
        const t = 0.4 + i * (60 / 850);
        shot(e, 'sb16', '5.56', t);
        e.brass({ x: 0.8, y: 0, z: 0.3 }, 'concrete', 'rifle', t + 0.45);
      }
    },
  },
  /** Same room, bare ears: tinnitus whine + dulling after the shots. */
  'rifle-room-noprotect': {
    seconds: 5,
    mode: 'noprotect',
    scene: room(6, 5, 2.7, 'drywall'),
    run: (e) => {
      for (let i = 0; i < 4; i++) shot(e, 'k47s', '7.62x39', 0.4 + i * 0.3);
    },
  },
  'rifle-room-earpro': {
    seconds: 4,
    mode: 'earpro',
    scene: room(6, 5, 2.7, 'drywall'),
    run: (e) => {
      shot(e, 'k47s', '7.62x39', 0.4);
      shot(e, 'k47s', '7.62x39', 2.2);
    },
  },
  /** Walk from a concrete room out through the door while firing: the tail must morph, not switch. */
  walkout: {
    seconds: 5,
    scene: [...roomWithDoor(4, 4, 2.7), ...outdoorRange().slice(0, 1)],
    run: (e, ctx, cam) => {
      const step = 0.05;
      for (let t = step; t < 4.6; t += step) {
        const tt = t;
        void ctx.suspend(tt).then(() => {
          const z = Math.min(10, -1 + Math.max(0, tt - 0.5) * 2.6);
          cam.position.set(0, 1.6, z);
          cam.updateMatrixWorld();
          e.probeTarget = analyseProbe(castScene(cam.position, SCENARIOS.walkout.scene));
          e.update(step);
          if (Math.abs((tt % 0.5) - 0.25) < step / 2) shot(e, 'sb16', '5.56', ctx.currentTime);
          void ctx.resume();
        });
      }
    },
  },
};

export interface ShotMetrics {
  /** Sample peak vs 50 ms RMS after it (dB). */
  crestDb: number;
  /** Schroeder T20-extrapolated decay of the shot (s), measured with ambience off. NaN = didn't decay 25 dB. */
  rt60: number;
  /** Reflected (tail + early taps) vs direct energy in the second after the shot (dB). */
  wetDryDb: number;
  /** Peak of each shot (dBFS) in the linear render — compare levels between scenarios (pre-clipper). */
  shotPeaksDb: number[];
}

export interface RenderResult {
  name: string;
  /** Base64 32-bit float stereo WAV. */
  wav: string;
  peak: number;
  rms: number;
  nan: number;
  /** Fraction of samples at |x| ≥ 0.999 (hard clipping). */
  clipped: number;
  seconds: number;
  debug: AudioEngine['debug'];
  metrics?: ShotMetrics;
}

async function renderOnce(
  sc: Scenario,
  o: { ambience: number; dry?: boolean; wetOnly?: boolean; linear?: boolean },
) {
  const ctx = new OfflineAudioContext(2, Math.ceil(sc.seconds * RATE), RATE);
  const cam = new PerspectiveCamera();
  cam.position.copy(sc.ear ?? new Vector3(0, 1.6, 0));
  cam.updateMatrixWorld();
  const engine = new AudioEngine(null, cam, {
    ctx,
    seed: 1234,
    settings: {
      neighbours: false,
      mode: sc.mode ?? 'footage',
      master: 0.8,
      sfx: 1,
      ambience: o.ambience,
      // Measurement renders (ambience 0) also drop wind/body noise so quiet shots decay into silence.
      micArtifacts: o.ambience > 0 ? 1 : 0,
      hitTick: sc.hitTick ?? false,
    },
  });
  await engine.ready;
  engine.setAcoustics(analyseProbe(castScene(cam.position, sc.scene)), true);
  if (o.dry) engine.mixer.wetOut.gain.value = 0;
  if (o.wetOnly) engine.mixer.direct.gain.value = 0;
  if (o.linear) engine.mixer.setLinear(0.1);
  await sc.run(engine, ctx, cam);
  const out = await ctx.startRendering();
  return { L: out.getChannelData(0), R: out.getChannelData(1), engine };
}

export async function renderScenario(name: string): Promise<RenderResult> {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const { L, R, engine } = await renderOnce(sc, { ambience: 0.7 });
  let peak = 0,
    acc = 0,
    nan = 0,
    clip = 0;
  for (const ch of [L, R])
    for (const v of ch) {
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      peak = Math.max(peak, a);
      acc += v * v;
      if (a >= 0.999) clip++;
    }
  let metrics: ShotMetrics | undefined;
  if (sc.measureAt !== undefined) {
    // Crest: the real mic stage, ambience off. Decay + wet/dry: the same events through a linear mic stage
    // (low level, saturators bypassed) rendered twice, once with every reflection muted.
    const real = await renderOnce(sc, { ambience: 0 });
    const full = await renderOnce(sc, { ambience: 0, linear: true });
    const dry = await renderOnce(sc, { ambience: 0, linear: true, dry: true });
    const wet = await renderOnce(sc, { ambience: 0, linear: true, wetOnly: true });
    const r = mono(real.L, real.R);
    const f = mono(full.L, full.R);
    const d = mono(dry.L, dry.R);
    const w = mono(wet.L, wet.R);
    const at = (x: Float32Array) => peakIndex(x, RATE, sc.measureAt! - 0.05, sc.measureAt! + 0.3);
    const pk = at(d);
    metrics = {
      crestDb: crestDb(r, RATE, at(r)),
      rt60: decayRt60(f, RATE, pk, 1.6),
      wetDryDb: wetDryDb(w, d, RATE, pk, 1.0),
      shotPeaksDb: (sc.shots ?? [sc.measureAt]).map((t) => {
        const i = peakIndex(f, RATE, t - 0.01, t + 0.2);
        return 20 * Math.log10(Math.abs(f[i]) + 1e-12);
      }),
    };
  }
  return {
    name,
    wav: toBase64(encodeWavFloat([L, R], RATE)),
    peak,
    rms: Math.sqrt(acc / (L.length * 2)),
    nan,
    clipped: clip / (L.length * 2),
    seconds: sc.seconds,
    debug: engine.debug,
    metrics,
  };
}

/** 32-bit float WAV (keeps overs/NaNs visible to the checker). */
export function encodeWavFloat(chans: Float32Array[], rate: number) {
  const n = chans[0].length;
  const c = chans.length;
  const buf = new ArrayBuffer(44 + n * c * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * c * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, c, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * c * 4, true);
  v.setUint16(32, c * 4, true);
  v.setUint16(34, 32, true);
  str(36, 'data');
  v.setUint32(40, n * c * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let k = 0; k < c; k++) {
      v.setFloat32(o, chans[k][i], true);
      o += 4;
    }
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
