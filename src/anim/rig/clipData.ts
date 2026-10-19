/**
 * Baked first-person clip format (public/assets/anims/clips.json, written by tools/anim/build.ts) and its
 * decoded, sampled runtime form. Everything is in **rig space**: origin at the eye, -z forward, +y up, metres.
 *
 * Per frame a clip carries:
 *  - `rot`: local quaternions of the canonical arm bones (Mixamo names without prefix), `pos` for bones whose
 *    local position moves (shoulders);
 *  - `gunHand`: the weapon model frame (origin at the grip, -z muzzle) relative to the right hand bone frame,
 *    `gunRoot` the same frame in rig space and `gunW` = 1 while the right hand holds the grip (0 = the gun rides
 *    the support hand / rig, e.g. during an AK rack with the firing hand);
 *  - part channels `bolt` (0 = forward, 1 = locked back / full travel), `trigger`, `hammer`, `safety` (0..1);
 *  - mags: `gun` = part transform in the model frame (rest = identity), `hand` = part frame relative to the
 *    left hand bone, `w` = blend toward the hand-relative transform, `vis` = visible;
 *  - anchor weights per hand (`grip`, `well`, `charge`): how strongly that hand is in contact with that weapon
 *    anchor; the runtime shifts the hand by (this weapon's socket − the pack reference weapon's socket) times
 *    the weight, so the same clip fits a longer handguard or a different magwell;
 *  - events (`magRelease`, `magOut`, `magIn`, `magSeat`, `boltRelease`, `chargingHandle`, `slideRelease`,
 *    `fire`, …) at their contact time.
 */

export type AnchorName = 'grip' | 'well' | 'charge';
export const ANCHORS: AnchorName[] = ['grip', 'well', 'charge'];
export type PartChannel = 'bolt' | 'trigger' | 'hammer' | 'safety';
export const PART_CHANNELS: PartChannel[] = ['bolt', 'trigger', 'hammer', 'safety'];
export type V3 = [number, number, number];

export interface ClipEvent {
  name: string;
  t: number;
}

export interface MagJson {
  id: string;
  gun: string;
  hand: string;
  w: string;
  vis: string;
}

export interface ClipJson {
  id: string;
  pack: string;
  action: string;
  fps: number;
  frames: number;
  bones: string[];
  rot: string;
  pos: Record<string, string>;
  gunHand: string;
  gunRoot: string;
  gunW: string;
  ch: Partial<Record<PartChannel, string>>;
  mags: MagJson[];
  wL: Record<AnchorName, string>;
  wR: Record<AnchorName, string>;
  events: ClipEvent[];
  /** Source range for split clips (seconds in the source timeline). */
  src?: { clip: string; t0: number; t1: number };
}

export interface PackJson {
  id: string;
  /** Weapon whose sockets the pack's hands were authored around (anchor offsets are relative to it). */
  ref: string;
  /** Socket positions of the reference weapon (model frame). */
  refSockets: Record<string, V3>;
  /** Wrist contact points (model frame) per anchor, for docs/debug. */
  anchors: Record<string, V3>;
}

export interface ClipsFile {
  version: number;
  /** Canonical skeleton: bone names (parent before child) and their rest local TRS. */
  skeleton: {
    bones: string[];
    parents: number[];
    restPos: number[];
    restRot: number[];
    /** Transform of the source scene root in rig space (px, py, pz, qx, qy, qz, qw). */
    root: number[];
  };
  packs: Record<string, PackJson>;
  clips: Record<string, ClipJson>;
}

// ---------------------------------------------------------------- base64 (browser + bun)

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function encodeF32(a: ArrayLike<number>): string {
  return toB64(new Uint8Array(Float32Array.from(a).buffer));
}
export function decodeF32(s: string): Float32Array {
  const b = fromB64(s);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
/** Unit quaternions as int16 (precision ~3e-5). */
export function encodeQ16(a: ArrayLike<number>): string {
  const q = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, a[i])) * 32767);
  return toB64(new Uint8Array(q.buffer));
}
export function decodeQ16(s: string): Float32Array {
  const b = fromB64(s);
  const q = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 32767;
  return out;
}
