import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { makeDecalAtlas } from './textures';

export type DecalKind = 0 | 1 | 2 | 3; // concrete, wood, dirt, metal

/**
 * Pooled bullet-hole decals: one InstancedMesh (single draw call), projected quads offset along the surface
 * normal, lit by the scene (MeshStandardMaterial) with a per-instance atlas cell. Ring buffer: the oldest
 * hole is reused once the pool is full.
 */
export class Decals {
  readonly mesh: InstancedMesh;
  private next = 0;
  private used = 0;
  private frames: InstancedBufferAttribute;
  private m = new Matrix4();
  private q = new Quaternion();
  private q2 = new Quaternion();
  private s = new Vector3();
  private p = new Vector3();
  private z = new Vector3(0, 0, 1);

  constructor(
    scene: Scene,
    readonly capacity = 256,
  ) {
    const mat = new MeshStandardMaterial({
      map: makeDecalAtlas(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.95,
      metalness: 0,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFrame;')
        .replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + vec2(mod(aFrame, 2.0), 1.0 - floor(aFrame / 2.0)) * 0.5;',
        );
    };
    const geo = new PlaneGeometry(1, 1);
    this.frames = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aFrame', this.frames);
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  add(point: Vector3, normal: Vector3, kind: DecalKind, size: number, roll: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.used = Math.min(this.used + 1, this.capacity);
    this.q.setFromUnitVectors(this.z, normal);
    this.q2.setFromAxisAngle(this.z, roll);
    this.q.multiply(this.q2);
    this.p.copy(point).addScaledVector(normal, 0.002);
    this.s.set(size, size, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    (this.frames.array as Float32Array)[i] = kind;
    this.frames.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = this.used;
  }

  clear() {
    this.next = this.used = 0;
    this.mesh.count = 0;
  }
}
