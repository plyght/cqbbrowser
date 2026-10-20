/** Minimal GLB writer (positions, normals, uv, indices; one primitive per node) for the kit tools. */
import { writeFileSync } from 'node:fs';

export interface Out {
  name: string;
  material: string;
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

export function writeGlb(path: string, outs: Out[]) {
  const chunks: Buffer[] = [];
  let off = 0;
  const views: object[] = [];
  const accessors: object[] = [];
  const add = (arr: Float32Array | Uint32Array, type: string, comp: number, target: number, mm = false) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    chunks.push(b);
    off += b.length;
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      off += pad;
    }
    const n = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : 3;
    const acc: Record<string, unknown> = {
      bufferView: views.length - 1,
      componentType: comp,
      count: arr.length / n,
      type,
    };
    if (mm) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], arr[i + k]);
          max[k] = Math.max(max[k], arr[i + k]);
        }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const mats = [...new Set(outs.map((o) => o.material))];
  const meshes = outs.map((o) => {
    const P = add(new Float32Array(o.pos), 'VEC3', 5126, 34962, true);
    const N = add(new Float32Array(o.nrm), 'VEC3', 5126, 34962);
    const T = add(new Float32Array(o.uv), 'VEC2', 5126, 34962);
    const I = add(new Uint32Array(o.idx), 'SCALAR', 5125, 34963);
    return {
      name: o.name,
      primitives: [
        {
          attributes: { POSITION: P, NORMAL: N, TEXCOORD_0: T },
          indices: I,
          material: mats.indexOf(o.material),
        },
      ],
    };
  });
  const json = {
    asset: { version: '2.0', generator: 'shortbarrel extract_sources' },
    scene: 0,
    scenes: [{ nodes: outs.map((_, i) => i) }],
    nodes: outs.map((o, i) => ({ name: o.name, mesh: i })),
    meshes,
    materials: mats.map((m) => ({
      name: m,
      pbrMetallicRoughness: { metallicFactor: 0.5, roughnessFactor: 0.5 },
    })),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: off }],
  };
  let js = Buffer.from(JSON.stringify(json));
  const jp = (4 - (js.length % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (b: Buffer, t: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(t, 4);
    return Buffer.concat([h, b]);
  };
  writeFileSync(path, Buffer.concat([header, ch(js, 0x4e4f534a), ch(bin, 0x004e4942)]));
}
