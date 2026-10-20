/**
 * Step 0 of the weapon kit pipeline: un-skin the two CC-BY BURNER source guns (AK74U "Krinkov" and Beretta,
 * see assets/ATTRIBUTION.md) into static meshes in OUR weapon-model frame, split per bone.
 *
 *   bun tools/blender/weapons/extract_sources.ts
 *
 * The frame is computed exactly like tools/anim/build.ts (gun bone × grip-web alignment at the idle pose), so the
 * extracted gun sits where the animation clips' gun track puts the model root. Output (gitignored cache):
 *   tools/blender/weapons/.cache/src_<pack>.glb   — one node per bone group, three.js frame (y up, -z forward)
 *   tools/blender/weapons/.cache/src_<pack>.json  — bone pivots (model frame) for the moving parts
 * The Blender build (build_kit.py) imports these, sets pivots/sockets and exports the family GLBs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  AnimationMixer,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { loadGltf } from '../../anim/loadGltf';
import { writeGlb, type Out } from './glb';

const OUT = 'tools/blender/weapons/.cache';
type V3 = [number, number, number];

interface Pack {
  id: string;
  file: string;
  prefix: string;
  gunBone: string;
  gripTweak: V3;
  idle: { clip: string; t: number };
  /** Gun meshes → bone → output node name (bones not listed fall into `static`). */
  meshes: string[];
  bones: Record<string, string>;
  /** Bones whose vertices are dropped (duplicates). */
  skip: string[];
}

// Must match tools/anim/build.ts PACKS (gunBone, gripTweak, idle).
const PACKS: Pack[] = [
  {
    id: 'ak',
    file: 'public/assets/models/ak74u/ak74u.glb',
    prefix: 'mixamorig7',
    gunBone: 'Bone',
    gripTweak: [0, -0.01, -0.085],
    idle: { clip: 'Armature|IDLE', t: 0 },
    meshes: ['Gun_1', 'Gun_2'],
    bones: { carg: 'mag', recam: 'bolt', seg: 'safety', gatillo: 'trigger' },
    skip: ['carg2'],
  },
  {
    id: 'beretta',
    file: 'public/assets/models/beretta/beretta.glb',
    prefix: 'mixamorig2',
    gunBone: 'ARMA',
    gripTweak: [0, 0.02, -0.07],
    idle: { clip: 'Scene', t: 7.0 },
    meshes: ['hammer'],
    bones: { CARGADOR: 'mag', CORREDERA: 'slide', GATILLO: 'trigger', PALANCA: 'hammer' },
    skip: [],
  },
];

const R = (m: Matrix4) => {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  m.decompose(p, q, s);
  return new Matrix4().compose(p, q, new Vector3(1, 1, 1));
};

mkdirSync(OUT, { recursive: true });
for (const pk of PACKS) {
  const gltf = await loadGltf(pk.file);
  const scene = gltf.scene;
  const node = (n: string): Object3D => {
    const o = scene.getObjectByName(n);
    if (!o) throw new Error(`${pk.id}: no node ${n}`);
    return o;
  };
  const mixer = new AnimationMixer(scene);
  const clip = gltf.animations.find((c: AnimationClip) => c.name === pk.idle.clip)!;
  mixer.clipAction(clip).play();
  mixer.setTime(pk.idle.t);
  scene.updateMatrixWorld(true);

  // Frame: same as tools/anim/build.ts (toRig is rigid, so it cancels out of gun-relative transforms).
  const gunAxes = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)),
  );
  const G = R(node(pk.gunBone).matrixWorld);
  const Ginv = G.clone().invert();
  const inGun = (n: string) => new Vector3().setFromMatrixPosition(node(n).matrixWorld).applyMatrix4(Ginv);
  const web = inGun(pk.prefix + 'RightHandIndex1')
    .add(inGun(pk.prefix + 'RightHandThumb2'))
    .multiplyScalar(0.5);
  web.x = 0;
  web.z -= 0.006;
  const A = new Matrix4().compose(
    web.add(new Vector3(...pk.gripTweak).applyQuaternion(gunAxes)),
    gunAxes,
    new Vector3(1, 1, 1),
  );
  const toModel = A.clone().invert().multiply(Ginv); // world → model frame

  const groups = new Map<string, Out>();
  const pivots: Record<string, { pos: V3; x: V3; y: V3; z: V3 }> = {};
  for (const mn of pk.meshes) {
    const m = node(mn) as SkinnedMesh;
    const g = m.geometry;
    const pos = g.attributes.position,
      nrm = g.attributes.normal,
      uv = g.attributes.uv;
    const si = g.attributes.skinIndex,
      sw = g.attributes.skinWeight;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    const index = g.index!;
    const boneOf = (i: number) => {
      let best = -1,
        bi = 0;
      for (let k = 0; k < 4; k++)
        if (sw.getComponent(i, k) > best) {
          best = sw.getComponent(i, k);
          bi = si.getComponent(i, k);
        }
      return m.skeleton.bones[bi].name;
    };
    m.skeleton.update();
    const remap = new Map<string, Map<number, number>>();
    const v = new Vector3(),
      n = new Vector3();
    const nm = new Matrix3();
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const bone = boneOf(a);
      if (pk.skip.includes(bone)) continue;
      const name = pk.bones[bone] ?? (mat === 'Magazine' ? 'mag' : 'static');
      let o = groups.get(name);
      if (!o) {
        o = { name, material: mat, pos: [], nrm: [], uv: [], idx: [] };
        groups.set(name, o);
        remap.set(name, new Map());
      }
      const rm = remap.get(name) ?? new Map<number, number>();
      remap.set(name, rm);
      for (let k = 0; k < 3; k++) {
        const vi = index.getX(t + k);
        let j = rm.get(vi);
        if (j === undefined) {
          v.fromBufferAttribute(pos, vi);
          m.applyBoneTransform(vi, v);
          v.applyMatrix4(m.matrixWorld).applyMatrix4(toModel);
          // Normal: dominant bone's rotation.
          let best = -1,
            bi = 0;
          for (let q = 0; q < 4; q++)
            if (sw.getComponent(vi, q) > best) {
              best = sw.getComponent(vi, q);
              bi = si.getComponent(vi, q);
            }
          const bm = new Matrix4()
            .multiplyMatrices(m.skeleton.bones[bi].matrixWorld, m.skeleton.boneInverses[bi])
            .multiply(m.bindMatrix);
          const full = toModel.clone().multiply(m.matrixWorld).multiply(m.bindMatrixInverse).multiply(bm);
          nm.getNormalMatrix(full);
          n.fromBufferAttribute(nrm, vi).applyMatrix3(nm).normalize();
          j = o.pos.length / 3;
          o.pos.push(v.x, v.y, v.z);
          o.nrm.push(n.x, n.y, n.z);
          o.uv.push(uv.getX(vi), uv.getY(vi));
          rm.set(vi, j);
        }
        o.idx.push(j);
      }
    }
    for (const [bone, name] of Object.entries(pk.bones)) {
      const b = m.skeleton.bones.find((x) => x.name === bone);
      if (!b || pivots[name]) continue;
      const w = new Matrix4().multiplyMatrices(toModel, b.matrixWorld);
      const p = new Vector3(),
        q = new Quaternion();
      w.decompose(p, q, new Vector3());
      const ax = (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(q).toArray() as V3;
      pivots[name] = { pos: p.toArray() as V3, x: ax(1, 0, 0), y: ax(0, 1, 0), z: ax(0, 0, 1) };
    }
  }
  const outs = [...groups.values()];
  writeGlb(`${OUT}/src_${pk.id}.glb`, outs);
  writeFileSync(`${OUT}/src_${pk.id}.json`, JSON.stringify({ pivots }, null, 1));
  for (const o of outs) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < o.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], o.pos[i + k]);
        b[k + 3] = Math.max(b[k + 3], o.pos[i + k]);
      }
    console.log(pk.id, o.name, o.material, o.idx.length / 3, 'tris', b.map((x) => x.toFixed(3)).join(' '));
  }
  console.log(pk.id, 'pivots', JSON.stringify(pivots));
}
