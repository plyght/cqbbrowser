/** Dump the procedural (three.js) weapon models as plain GLBs for overlay/fit checks in Blender. */
import { mkdirSync } from 'node:fs';
import { Vector3, type Mesh } from 'three';
import { installHeadlessCanvas } from '../../../src/anim/grip/headlessDom';
import { writeGlb, type Out } from './glb';

installHeadlessCanvas();
const { buildModel } = await import('../../../src/weapons/models');
mkdirSync('tools/blender/weapons/.cache', { recursive: true });
for (const key of process.argv.slice(2)) {
  const m = buildModel(key, { detailParts: true });
  m.root.updateMatrixWorld(true);
  const outs: Out[] = [];
  m.root.traverse((o) => {
    const me = o as Mesh;
    if (!me.isMesh) return;
    const g = me.geometry.index ? me.geometry.toNonIndexed() : me.geometry;
    const p = g.attributes.position;
    const out: Out = {
      name: me.parent?.name || 'static',
      material: 'proc',
      pos: [],
      nrm: [],
      uv: [],
      idx: [],
    };
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(me.matrixWorld);
      out.pos.push(v.x, v.y, v.z);
      out.nrm.push(0, 1, 0);
      out.uv.push(0, 0);
      out.idx.push(i);
    }
    outs.push(out);
  });
  writeGlb(`tools/blender/weapons/.cache/proc_${key}.glb`, outs);
  const r = (v: Vector3) => v.toArray().map((x) => +x.toFixed(4));
  const s = Object.fromEntries(
    Object.entries(m.sockets).map(([k, o]) => [k, r(o!.getWorldPosition(new Vector3()))]),
  );
  const p = Object.fromEntries(
    Object.entries(m.parts).map(([k, o]) => [k, r(o!.getWorldPosition(new Vector3()))]),
  );
  console.log(key, 'sockets', JSON.stringify(s));
  console.log(key, 'parts', JSON.stringify(p));
  console.log(key, 'sights', JSON.stringify(m.sightLines.map((l) => l.mode.point)));
}
