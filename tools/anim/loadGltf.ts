/** Load a (meshopt-compressed, texture-less) GLB in Bun/Node with three's GLTFLoader. */
import { readFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export async function loadGltf(path: string): Promise<GLTF> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}
