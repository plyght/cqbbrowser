/**
 * Offline renders of audio scenarios (we can't listen in CI, so we look at WAVs/spectrograms instead).
 * Uses the real engine on an OfflineAudioContext with analytic probe scenes in place of Rapier.
 * Exposed as `window.__sb.audio.renderOffline(name)`; tests/e2e/audio.spec.ts writes screenshots/audio-*.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { analyseProbe } from './acoustics';
import { AudioEngine } from './AudioEngine';
import { castScene, outdoorRange, room, roomWithDoor, type Aabb } from './probeScenes';
import type { ListeningMode } from './settings';

const RATE = 48000;

interface Scenario {
  seconds: number;
  mode?: ListeningMode;
  scene: Aabb[];
  ear?: Vector3;
  run(e: AudioEngine, ctx: OfflineAudioContext, cam: PerspectiveCamera): void | Promise<void>;
}

const shot = (e: AudioEngine, weaponId: string, caliber: string, at: number) =>
  e.gunshot({ weaponId, caliber, suppressed: false, at });

export const SCENARIOS: Record<string, Scenario> = {
  'rifle-outdoor': {
    seconds: 4,
    scene: outdoorRange(),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.4);
      shot(e, 'sb16', '5.56', 2.2);
    },
  },
  'rifle-box': {
    seconds: 4,
    scene: room(1.5, 1.5, 2.4),
    run: (e) => {
      shot(e, 'sb16', '5.56', 0.4);
      shot(e, 'sb16', '5.56', 2.2);
    },
  },
  'rifle-room': {
    seconds: 4,
    scene: room(6, 5, 2.7, 'drywall'),
    run: (e) => {
      shot(e, 'k47s', '7.62x39', 0.4);
      shot(e, 'k47s', '7.62x39', 2.2);
    },
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
        e.gunshot({ weaponId: 'hb300', caliber: '300blk', suppressed: true, at: 0.4 + i * 0.3 });
    },
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
}

export async function renderScenario(name: string): Promise<RenderResult> {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
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
      ambience: 0.7,
      micArtifacts: 1,
    },
  });
  await engine.ready;
  engine.setAcoustics(analyseProbe(castScene(cam.position, sc.scene)), true);
  await sc.run(engine, ctx, cam);
  const out = await ctx.startRendering();
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
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
  return {
    name,
    wav: toBase64(encodeWavFloat([L, R], RATE)),
    peak,
    rms: Math.sqrt(acc / (L.length * 2)),
    nan,
    clipped: clip / (L.length * 2),
    seconds: sc.seconds,
    debug: engine.debug,
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
