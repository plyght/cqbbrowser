/**
 * Offline animation baker: retargets the two CC-BY BURNER packs (AK74U + Beretta, see assets/ATTRIBUTION.md)
 * onto ONE canonical arm skeleton (the AK pack's Ch08 arms) and writes public/assets/anims/clips.json.
 *
 *   bun tools/anim/build.ts            # bake
 *   bun tools/anim/build.ts --report   # bake + print the split table / events / hand gaps
 *
 * See src/anim/rig/README.md for the format and the runtime.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  AnimationMixer,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Bone,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { installHeadlessCanvas } from '../../src/anim/grip/headlessDom';
import {
  ANCHORS,
  encodeF32,
  encodeQ16,
  type AnchorName,
  type ClipEvent,
  type ClipJson,
  type ClipsFile,
  type MagJson,
  type PackJson,
  type V3,
} from '../../src/anim/rig/clipData';
import { canonicalBoneName, proximity, retargetWorld, solveArm } from '../../src/anim/rig/retarget';
import { detectEvents, smooth, splitTimeline } from '../../src/anim/library/detect';
import { loadGltf } from './loadGltf';

installHeadlessCanvas();
const { buildModel } = await import('../../src/weapons/models');

const REPORT = process.argv.includes('--report');
const OUT_DIR = 'public/assets/anims';
const FPS = 30;

// ---------------------------------------------------------------------------------------------- pack config

interface MagCfg {
  id: string;
  bone: string;
  /** Where this mag is seated (to find its rest pose relative to the gun). */
  seated: { clip: string; t: number | 'end' };
}
interface PackCfg {
  id: 'ak' | 'beretta';
  file: string;
  prefix: string;
  /** Source eye (camera) position in the source world; source looks +z with -x to the right. */
  eye: V3;
  /** Extra rig-space offset of the pack content (fit to the canonical shoulders). */
  offset: V3;
  scale: number;
  gunBone: string;
  /** Grip origin tweak in the model frame (m). */
  gripTweak: V3;
  mags: MagCfg[];
  bolt: string;
  trigger: string;
  hammer?: string;
  safety?: string;
  ref: string;
  platform: 'rifle' | 'pistol';
  /** Idle reference (clip, time) for rest poses. */
  idle: { clip: string; t: number };
  /** Bolt/slide travel normaliser: displacement at this (clip, t) = 1.0; or a fixed metre value. */
  boltTravel: { clip: string; t: number } | number;
  clips: Record<string, string> | 'split';
}

const PACKS: PackCfg[] = [
  {
    id: 'ak',
    file: 'public/assets/models/ak74u/ak74u.glb',
    prefix: 'mixamorig7',
    eye: [0.03, 1.64, -0.18],
    offset: [0, 0, 0],
    scale: 1,
    gunBone: 'Bone',
    gripTweak: [0, -0.01, -0.085],
    // carg2 is a duplicate the pack parks inside the gun to hide swaps; the clips only need carg.
    mags: [{ id: 'mag', bone: 'carg', seated: { clip: 'Armature|IDLE', t: 0 } }],
    bolt: 'recam',
    trigger: 'gatillo',
    safety: 'seg',
    ref: 'k47s',
    platform: 'rifle',
    idle: { clip: 'Armature|IDLE', t: 0 },
    boltTravel: { clip: 'Armature|RELOAD2', t: 2.4 },
    clips: {
      'Armature|IDLE': 'idle',
      'Armature|DRAW': 'draw',
      'Armature|OLSER': 'holster',
      'Armature|SHOOT': 'shoot',
      'Armature|RELOAD1': 'reloadTactical',
      'Armature|RELOAD2': 'reloadEmpty',
      'Armature|INSPEC': 'inspect',
    },
  },
  {
    id: 'beretta',
    file: 'public/assets/models/beretta/beretta.glb',
    prefix: 'mixamorig2',
    eye: [0, 0, 0],
    offset: [0.02, -0.08, -0.1],
    scale: 1,
    gunBone: 'ARMA',
    gripTweak: [0, 0.02, -0.07],
    mags: [{ id: 'mag', bone: 'CARGADOR', seated: { clip: 'Scene', t: 7.0 } }],
    bolt: 'CORREDERA',
    trigger: 'GATILLO',
    hammer: 'PALANCA',
    ref: 'p17',
    platform: 'pistol',
    idle: { clip: 'Scene', t: 7.0 },
    boltTravel: { clip: 'Scene', t: 12.0 },
    clips: 'split',
  },
];

// ---------------------------------------------------------------------------------------------- helpers

const R180 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
type Xf = { p: Vector3; q: Quaternion };
const mat = (x: Xf) => new Matrix4().compose(x.p, x.q, new Vector3(1, 1, 1));
function fromMat(m: Matrix4): Xf {
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { p, q };
}
const mul = (a: Xf, b: Xf) => fromMat(mat(a).multiply(mat(b)));
const inv = (a: Xf) => fromMat(mat(a).invert());
const pushXf = (arr: number[], x: Xf) => arr.push(x.p.x, x.p.y, x.p.z, x.q.x, x.q.y, x.q.z, x.q.w);

function worldXf(o: Object3D): Xf {
  return fromMat(o.matrixWorld);
}

/** Source world → rig space (eye origin, -z forward). */
function toRig(cfg: PackCfg, x: Xf): Xf {
  const p = x.p
    .clone()
    .sub(new Vector3(...cfg.eye))
    .multiplyScalar(cfg.scale)
    .applyQuaternion(R180)
    .add(new Vector3(...cfg.offset));
  return { p, q: R180.clone().multiply(x.q) };
}

function angleBetween(a: Quaternion, b: Quaternion) {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

// ---------------------------------------------------------------------------------------------- canonical

// A separate copy of the AK pack is the canonical skeleton (posed in rig space).
const canonScene = (await loadGltf(PACKS[0].file)).scene;
canonScene.position.set(0, 0, 0);
// Rig transform for the canonical (AK) skeleton.
{
  const ak = PACKS[0];
  canonScene.quaternion.copy(R180);
  canonScene.position.copy(new Vector3(...ak.eye).negate().applyQuaternion(R180));
  canonScene.updateMatrixWorld(true);
}
const canonMesh = canonScene.getObjectByName('Ch08_Body') as SkinnedMesh;
const canonByName = new Map<string, Bone>();
for (const b of canonMesh.skeleton.bones) canonByName.set(canonicalBoneName(b.name), b);

// Deforming arm bones (+ ancestors), parent before child.
const deforming = new Set<string>();
for (const name of ['Ch08_Body', 'Ch08_Hoodie']) {
  const m = canonScene.getObjectByName(name) as SkinnedMesh;
  const idx = m.geometry.attributes.skinIndex;
  const w = m.geometry.attributes.skinWeight;
  for (let i = 0; i < idx.count; i++)
    for (let k = 0; k < 4; k++)
      if (w.getComponent(i, k) > 0)
        deforming.add(canonicalBoneName(m.skeleton.bones[idx.getComponent(i, k)].name));
}
const CANON: string[] = [];
const addWithAncestors = (n: string) => {
  const b = canonByName.get(n)!;
  const p = b.parent as Bone;
  if (p?.isBone && !CANON.includes(canonicalBoneName(p.name))) addWithAncestors(canonicalBoneName(p.name));
  if (!CANON.includes(n)) CANON.push(n);
};
for (const b of canonMesh.skeleton.bones) {
  const n = canonicalBoneName(b.name);
  if (deforming.has(n)) addWithAncestors(n);
}
const canonBones = CANON.map((n) => canonByName.get(n)!);
const canonRestPos = canonBones.map((b) => b.position.clone());
const canonRestRot = canonBones.map((b) => b.quaternion.clone());

/** Bind world rotation (rig space) per canonical bone name, from the inverse bind matrices. */
function bindRots(mesh: SkinnedMesh, cfg: PackCfg): Map<string, Quaternion> {
  const out = new Map<string, Quaternion>();
  mesh.skeleton.bones.forEach((b, i) => {
    const m = mesh.skeleton.boneInverses[i].clone().invert();
    const q = new Quaternion();
    m.decompose(new Vector3(), q, new Vector3());
    out.set(canonicalBoneName(b.name), R180.clone().multiply(q));
    void cfg;
  });
  return out;
}
const canonBind = bindRots(canonMesh, PACKS[0]);

const len = (a: string, b: string) => {
  canonScene.updateMatrixWorld(true);
  return worldXf(canonByName.get(a)!).p.distanceTo(worldXf(canonByName.get(b)!).p);
};
const ARM = {
  Right: { upper: len('RightArm', 'RightForeArm'), fore: len('RightForeArm', 'RightHand') },
  Left: { upper: len('LeftArm', 'LeftForeArm'), fore: len('LeftForeArm', 'LeftHand') },
};

function resetCanon() {
  canonBones.forEach((b, i) => {
    b.position.copy(canonRestPos[i]);
    b.quaternion.copy(canonRestRot[i]);
  });
}

// ---------------------------------------------------------------------------------------------- reference weapons

const REF_SOCKETS = ['gripLeft', 'magwell', 'chargingHandle', 'gripRight'] as const;
function refSockets(id: string): Record<string, V3> {
  const m = buildModel(id, { detailParts: true });
  m.root.updateMatrixWorld(true);
  const out: Record<string, V3> = {};
  for (const s of REF_SOCKETS) {
    const o = m.sockets[s];
    if (o) out[s] = o.getWorldPosition(new Vector3()).toArray() as V3;
  }
  for (const p of ['boltCatch'] as const) {
    const o = m.parts[p];
    if (o) out[p] = o.getWorldPosition(new Vector3()).toArray() as V3;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- per pack

const clipsOut: Record<string, ClipJson> = {};
const packsOut: Record<string, PackJson> = {};
const report: string[] = [];

for (const cfg of PACKS) {
  const gltf = await loadGltf(cfg.file);
  const scene = gltf.scene;
  const mixer = new AnimationMixer(scene);
  const node = (n: string) => {
    const o = scene.getObjectByName(n);
    if (!o) throw new Error(`${cfg.id}: no node ${n}`);
    return o;
  };
  const srcName = (canon: string) => cfg.prefix + canon;
  const srcMesh = scene.getObjectByName(cfg.id === 'ak' ? 'Ch08_Body' : 'Ch22_Body') as SkinnedMesh;
  const srcBind = bindRots(srcMesh, cfg);
  let current: AnimationClip | null = null;
  const pose = (clip: AnimationClip, t: number) => {
    if (current !== clip) {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixer.clipAction(clip).play();
      current = clip;
    }
    mixer.setTime(Math.min(t, clip.duration - 1e-4));
    scene.updateMatrixWorld(true);
  };
  const clipByName = (n: string) => gltf.animations.find((c) => c.name === n)!;
  const rigOf = (n: string) => toRig(cfg, worldXf(node(n)));

  // Gun model frame alignment: model x = -bone X, y = -bone Z, z = -bone Y; origin at the web of the hand.
  const idleClip = clipByName(cfg.idle.clip);
  pose(idleClip, cfg.idle.t);
  const gunAxes = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)),
  );
  const gunIdle = rigOf(cfg.gunBone);
  const inGun = (n: string) => rigOf(n).p.sub(gunIdle.p).applyQuaternion(gunIdle.q.clone().invert());
  const idx1 = inGun(srcName('RightHandIndex1'));
  const th2 = inGun(srcName('RightHandThumb2'));
  const web = idx1.add(th2).multiplyScalar(0.5);
  web.x = 0;
  web.z -= 0.006; // bone -Z is up: sit the origin on top of the grip
  const A: Xf = { p: web.add(new Vector3(...cfg.gripTweak).applyQuaternion(gunAxes)), q: gunAxes };
  const gunModel = () => mul(rigOf(cfg.gunBone), A);

  // Mag rest poses (relative to the model frame) → K = (rest)⁻¹ so that part frame = M · K.
  const magK = new Map<string, Xf>();
  for (const m of cfg.mags) {
    const c = clipByName(m.seated.clip);
    pose(c, m.seated.t === 'end' ? c.duration : m.seated.t);
    magK.set(m.id, inv(mul(inv(gunModel()), rigOf(m.bone))));
  }
  // Part rests.
  pose(idleClip, cfg.idle.t);
  const restLocal = (n: string) => ({ p: node(n).position.clone(), q: node(n).quaternion.clone() });
  const boltRest = restLocal(cfg.bolt);
  const trigRest = restLocal(cfg.trigger);
  const hamRest = cfg.hammer ? restLocal(cfg.hammer) : undefined;
  const safRest = cfg.safety ? restLocal(cfg.safety) : undefined;
  const boltDisp = () => {
    const o = node(cfg.bolt);
    const s = new Vector3().setFromMatrixScale(o.parent!.matrixWorld).x;
    return o.position.distanceTo(boltRest.p) * s;
  };
  let travel: number;
  if (typeof cfg.boltTravel === 'number') travel = cfg.boltTravel;
  else {
    pose(clipByName(cfg.boltTravel.clip), cfg.boltTravel.t);
    travel = boltDisp();
  }
  // Max angles for normalisation (over every clip).
  const maxAng = { trigger: 1e-6, hammer: 1e-6, safety: 1e-6 };
  for (const c of gltf.animations)
    for (let t = 0; t <= c.duration; t += 1 / 24) {
      pose(c, t);
      maxAng.trigger = Math.max(maxAng.trigger, angleBetween(node(cfg.trigger).quaternion, trigRest.q));
      if (cfg.hammer)
        maxAng.hammer = Math.max(maxAng.hammer, angleBetween(node(cfg.hammer).quaternion, hamRest!.q));
      if (cfg.safety)
        maxAng.safety = Math.max(maxAng.safety, angleBetween(node(cfg.safety).quaternion, safRest!.q));
    }

  // Idle wrist contacts (model frame).
  pose(idleClip, cfg.idle.t);
  const idleR = mul(inv(gunModel()), rigOf(srcName('RightHand'))).p;
  const idleL = mul(inv(gunModel()), rigOf(srcName('LeftHand'))).p;

  /** Pose the canonical skeleton from the source's current pose; returns the max wrist gap (m). */
  const retargetFrame = (): number => {
    resetCanon();
    if (cfg.id === 'ak') {
      for (const b of canonBones) {
        const s = scene.getObjectByName(srcName(canonicalBoneName(b.name)));
        if (!s) continue;
        b.position.copy(s.position);
        b.quaternion.copy(s.quaternion);
      }
      canonScene.updateMatrixWorld(true);
      return 0;
    }
    canonScene.updateMatrixWorld(true);
    const want = new Map<string, Quaternion>();
    for (const n of CANON) {
      const s = scene.getObjectByName(srcName(n));
      if (!s || !srcBind.has(n) || !canonBind.has(n)) continue;
      want.set(n, retargetWorld(toRig(cfg, worldXf(s)).q, srcBind.get(n)!, canonBind.get(n)!));
    }
    let gap = 0;
    for (const side of ['Right', 'Left'] as const) {
      const arm = canonByName.get(side + 'Arm')!;
      const fore = canonByName.get(side + 'ForeArm')!;
      const hand = canonByName.get(side + 'Hand')!;
      const shoulderW = worldXf(arm.parent!);
      const sh = worldXf(arm).p;
      const srcSh = toRig(cfg, worldXf(node(srcName(side + 'Arm')))).p;
      const srcEl = toRig(cfg, worldXf(node(srcName(side + 'ForeArm')))).p;
      const target = toRig(cfg, worldXf(node(srcName(side + 'Hand')))).p;
      const pole = sh.clone().add(srcEl.clone().sub(srcSh).multiplyScalar(2));
      const sol = solveArm(
        sh,
        ARM[side].upper,
        ARM[side].fore,
        target,
        pole,
        want.get(side + 'Arm')!,
        want.get(side + 'ForeArm')!,
      );
      arm.quaternion.copy(shoulderW.q.clone().invert().multiply(sol.upper));
      fore.quaternion.copy(sol.upper.clone().invert().multiply(sol.fore));
      hand.quaternion.copy(
        sol.fore
          .clone()
          .invert()
          .multiply(want.get(side + 'Hand')!),
      );
      gap = Math.max(gap, sol.wrist.distanceTo(target));
    }
    // Fingers: local = parentWorld⁻¹ · world.
    for (const n of CANON) {
      if (!/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n) || !want.has(n)) continue;
      const b = canonByName.get(n)!;
      const pn = canonicalBoneName(b.parent!.name);
      const pw = want.get(pn);
      if (pw) b.quaternion.copy(pw.clone().invert().multiply(want.get(n)!));
    }
    canonScene.updateMatrixWorld(true);
    return gap;
  };

  // ----- clip list
  type Job = { id: string; action: string; clip: AnimationClip; t0: number; t1: number; fps: number };
  const jobs: Job[] = [];
  if (cfg.clips === 'split') {
    const c = gltf.animations[0];
    const n = Math.round(c.duration * 24) + 1;
    const restDist: number[] = [];
    const trig: number[] = [];
    const bolt: number[] = [];
    const magD: number[] = [];
    pose(c, cfg.idle.t);
    const refR = rigOf(srcName('RightHand')).p;
    const refL = rigOf(srcName('LeftHand')).p;
    const magRestRel = inv(magK.get('mag')!);
    for (let f = 0; f < n; f++) {
      pose(c, f / 24);
      restDist.push(
        Math.max(
          rigOf(srcName('RightHand')).p.distanceTo(refR),
          rigOf(srcName('LeftHand')).p.distanceTo(refL),
        ),
      );
      trig.push(angleBetween(node(cfg.trigger).quaternion, trigRest.q) / maxAng.trigger);
      bolt.push(boltDisp() / travel);
      magD.push(mul(inv(gunModel()), rigOf(cfg.mags[0].bone)).p.distanceTo(magRestRel.p));
    }
    const segs = splitTimeline({ restDist, trigger: trig, bolt, magDist: magD });
    report.push(`\n${cfg.id}: split of "${c.name}" (${c.duration.toFixed(2)} s @ 24 fps)`);
    report.push('| clip | frames | seconds | duration |', '| --- | --- | --- | --- |');
    for (const s of segs) {
      const t0 = s.f0 / 24;
      const t1 = s.f1 / 24;
      report.push(
        `| ${s.label} | ${s.f0}–${s.f1} | ${t0.toFixed(2)}–${t1.toFixed(2)} | ${(t1 - t0).toFixed(2)} |`,
      );
      if (jobs.some((j) => j.action === s.label)) continue;
      jobs.push({ id: `${cfg.id}.${s.label}`, action: s.label, clip: c, t0, t1, fps: FPS });
    }
  } else {
    for (const [name, action] of Object.entries(cfg.clips)) {
      const c = clipByName(name);
      jobs.push({
        id: `${cfg.id}.${action}`,
        action,
        clip: c,
        t0: 0,
        t1: c.duration,
        fps: action === 'idle' ? 15 : FPS,
      });
    }
  }

  // ----- bake each clip
  const contactsL: Record<string, Vector3[]> = { well: [], charge: [] };
  const contactsR: Record<string, Vector3[]> = { charge: [] };
  type Baked = {
    job: Job;
    frames: number;
    rot: number[];
    pos: Record<string, number[]>;
    gunHand: number[];
    gunRoot: number[];
    gunW: number[];
    ch: Record<string, number[]>;
    mags: { id: string; gun: number[]; hand: number[]; held: number[]; vis: number[]; dist: number[] }[];
    wristR: Vector3[];
    wristL: Vector3[];
    events: ClipEvent[];
    gap: number;
  };
  const baked: Baked[] = [];
  for (const job of jobs) {
    const frames = Math.max(2, Math.round((job.t1 - job.t0) * job.fps) + 1);
    const b: Baked = {
      job,
      frames,
      rot: [],
      pos: {},
      gunHand: [],
      gunRoot: [],
      gunW: [],
      ch: { bolt: [], trigger: [] },
      mags: cfg.mags.map((m) => ({ id: m.id, gun: [], hand: [], held: [], vis: [], dist: [] })),
      wristR: [],
      wristL: [],
      events: [],
      gap: 0,
    };
    if (cfg.hammer) b.ch.hammer = [];
    if (cfg.safety) b.ch.safety = [];
    const posBones = ['LeftShoulder', 'RightShoulder'];
    for (const n of posBones) b.pos[n] = [];
    for (let f = 0; f < frames; f++) {
      const t = job.t0 + (f / (frames - 1)) * (job.t1 - job.t0);
      pose(job.clip, t);
      b.gap = Math.max(b.gap, retargetFrame());
      for (const bone of canonBones)
        b.rot.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w);
      for (const n of posBones) b.pos[n].push(...canonByName.get(n)!.position.toArray());
      const G = gunModel();
      const HR = worldXf(canonByName.get('RightHand')!);
      const HL = worldXf(canonByName.get('LeftHand')!);
      pushXf(b.gunHand, mul(inv(HR), G));
      pushXf(b.gunRoot, G);
      const wR = mul(inv(G), HR).p;
      const wL = mul(inv(G), HL).p;
      b.wristR.push(wR);
      b.wristL.push(wL);
      b.ch.bolt.push(boltDisp() / travel);
      b.ch.trigger.push(angleBetween(node(cfg.trigger).quaternion, trigRest.q) / maxAng.trigger);
      if (cfg.hammer) b.ch.hammer.push(angleBetween(node(cfg.hammer).quaternion, hamRest!.q) / maxAng.hammer);
      if (cfg.safety) b.ch.safety.push(angleBetween(node(cfg.safety).quaternion, safRest!.q) / maxAng.safety);
      cfg.mags.forEach((m, mi) => {
        const M = rigOf(m.bone);
        const P = mul(M, magK.get(m.id)!);
        const mg = b.mags[mi];
        const gunRel = mul(inv(G), P);
        pushXf(mg.gun, gunRel);
        pushXf(mg.hand, mul(inv(HL), P));
        const restRel = inv(magK.get(m.id)!);
        mg.dist.push(mul(inv(G), M).p.distanceTo(restRel.p));
      });
    }
    // Held = rigid w.r.t. the left hand and close to it, not seated.
    for (const mg of b.mags) {
      for (let f = 0; f < frames; f++) {
        const p = (k: number) => new Vector3(mg.hand[k * 7], mg.hand[k * 7 + 1], mg.hand[k * 7 + 2]);
        const near = p(f).length() < 0.25;
        const a = Math.max(0, f - 1);
        const c = Math.min(frames - 1, f + 1);
        const rigid = p(a).distanceTo(p(f)) < 0.015 && p(c).distanceTo(p(f)) < 0.015;
        const held = near && rigid && mg.dist[f] > 0.01 ? 1 : 0;
        mg.held.push(held);
      }
      // Fill single-frame holes and keep held through seating (the hand pushes it home).
      for (let f = 1; f < frames - 1; f++)
        if (!mg.held[f] && mg.held[f - 1] && mg.held[f + 1]) mg.held[f] = 1;
      for (let f = 0; f < frames; f++) mg.vis.push(mg.held[f] || mg.dist[f] < 0.18 ? 1 : 0);
    }
    if (process.env.DEBUG_CLIP === job.id)
      for (let f = 0; f < frames; f++)
        console.log(
          (f / job.fps).toFixed(2),
          b.mags.map((m) => `${m.id} d=${m.dist[f].toFixed(3)} h=${m.held[f]} v=${m.vis[f]}`).join(' | '),
          `bolt=${b.ch.bolt[f].toFixed(2)} trig=${b.ch.trigger[f].toFixed(2)}`,
          `R=${b.wristR[f].distanceTo(idleR).toFixed(3)} L=${b.wristL[f].distanceTo(idleL).toFixed(3)}`,
        );
    b.events = detectEvents({
      fps: job.fps,
      mags: b.mags.map((m) => ({ dist: m.dist, vis: m.vis })),
      bolt: b.ch.bolt,
      trigger: b.ch.trigger,
      platform: cfg.platform,
    }).filter((e) => {
      // Shots: only fire markers; draws/holsters/inspects carry none of the reload beats.
      if (job.action.startsWith('shoot')) return e.name === 'fire';
      if (!job.action.startsWith('reload')) return false;
      return e.name !== 'fire';
    });
    if (job.action.startsWith('shoot') && !b.events.length) {
      // Trigger travel too small to cross the threshold: fire at its peak.
      const tr = b.ch.trigger;
      const f = tr.indexOf(Math.max(...tr));
      b.events.push({ name: 'fire', t: +(f / job.fps).toFixed(4) });
    }
    for (const e of b.events) {
      const f = Math.round(e.t * job.fps);
      if (e.name === 'magSeat') contactsL.well.push(b.wristL[f]);
      if (e.name === 'chargingHandle') {
        // Whichever hand moved off its idle contact is the racking hand.
        if (b.wristR[f].distanceTo(idleR) > 0.05)
          contactsR.charge.push(b.wristR[Math.min(frames - 1, f + 3)]);
        else contactsL.charge.push(b.wristL[Math.min(frames - 1, f + 3)]);
      }
    }
    baked.push(b);
  }
  const avg = (v: Vector3[]) =>
    v.length ? v.reduce((a, b) => a.clone().add(b), new Vector3()).divideScalar(v.length) : null;
  const anchorsL: Partial<Record<AnchorName, Vector3>> = { grip: idleL };
  const anchorsR: Partial<Record<AnchorName, Vector3>> = { grip: idleR };
  if (avg(contactsL.well)) anchorsL.well = avg(contactsL.well)!;
  if (avg(contactsL.charge)) anchorsL.charge = avg(contactsL.charge)!;
  if (avg(contactsR.charge)) anchorsR.charge = avg(contactsR.charge)!;

  for (const b of baked) {
    const wL: Record<string, number[]> = {};
    const wR: Record<string, number[]> = {};
    for (const a of ANCHORS) {
      const near = a === 'grip' ? 0.02 : 0.03;
      const far = a === 'grip' ? 0.07 : 0.1;
      wL[a] = b.wristL.map((p) => (anchorsL[a] ? proximity(p.distanceTo(anchorsL[a]!), near, far) : 0));
      wR[a] = b.wristR.map((p) => (anchorsR[a] ? proximity(p.distanceTo(anchorsR[a]!), near, far) : 0));
    }
    const gunW = b.wristR.map((p) => proximity(p.distanceTo(idleR), 0.02, 0.06));
    const j: ClipJson = {
      id: b.job.id,
      pack: cfg.id,
      action: b.job.action,
      fps: b.job.fps,
      frames: b.frames,
      bones: CANON,
      rot: encodeQ16(b.rot),
      pos: Object.fromEntries(Object.entries(b.pos).map(([k, v]) => [k, encodeF32(v)])),
      gunHand: encodeF32(b.gunHand),
      gunRoot: encodeF32(b.gunRoot),
      gunW: encodeF32(smooth(gunW, 1)),
      ch: Object.fromEntries(Object.entries(b.ch).map(([k, v]) => [k, encodeF32(v)])),
      mags: b.mags.map((m): MagJson => ({
        id: m.id,
        gun: encodeF32(m.gun),
        hand: encodeF32(m.hand),
        w: encodeF32(smooth(m.held, 1)),
        vis: encodeF32(m.vis),
      })),
      wL: Object.fromEntries(ANCHORS.map((a) => [a, encodeF32(smooth(wL[a], 1))])) as Record<
        AnchorName,
        string
      >,
      wR: Object.fromEntries(ANCHORS.map((a) => [a, encodeF32(smooth(wR[a], 1))])) as Record<
        AnchorName,
        string
      >,
      events: b.events,
      src: { clip: b.job.clip.name, t0: +b.job.t0.toFixed(4), t1: +b.job.t1.toFixed(4) },
    };
    clipsOut[j.id] = j;
    report.push(
      `${j.id}: ${(b.frames / b.job.fps).toFixed(2)} s, max wrist gap ${(b.gap * 1000).toFixed(1)} mm, events ${b.events
        .map((e) => `${e.name}@${e.t.toFixed(2)}`)
        .join(' ')}`,
    );
  }
  const anchorOut: Record<string, V3> = {};
  for (const [k, v] of Object.entries(anchorsL)) anchorOut['L.' + k] = v.toArray() as V3;
  for (const [k, v] of Object.entries(anchorsR)) anchorOut['R.' + k] = v.toArray() as V3;
  packsOut[cfg.id] = { id: cfg.id, ref: cfg.ref, refSockets: refSockets(cfg.ref), anchors: anchorOut };
  report.push(
    `${cfg.id}: bolt travel ${(travel * 1000).toFixed(1)} mm, anchors ${JSON.stringify(anchorOut, (_k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`,
  );
}

resetCanon();
const file: ClipsFile = {
  version: 1,
  skeleton: {
    bones: CANON,
    parents: canonBones.map((b) => CANON.indexOf(canonicalBoneName(b.parent?.name ?? ''))),
    restPos: canonRestPos.flatMap((p) => p.toArray()),
    restRot: canonRestRot.flatMap((q) => q.toArray()),
    root: [...canonScene.position.toArray(), ...canonScene.quaternion.toArray()],
  },
  packs: packsOut,
  clips: clipsOut,
};
mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify(file);
writeFileSync(`${OUT_DIR}/clips.json`, json);
console.log(
  `wrote ${OUT_DIR}/clips.json (${(json.length / 1024).toFixed(0)} KB, ${Object.keys(clipsOut).length} clips)`,
);
if (REPORT) console.log(report.join('\n'));
