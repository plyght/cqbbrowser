import { AnimationMixer, Mesh, Vector3 } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadSourceGltf, texturePack, type SourceId } from '../sourceAssets';
import { Sheet, type Tile } from './sheet';

/**
 * Arms-rig dev page (anim.html). Contact sheets for checking the animation pipeline.
 *   anim.html?mode=src&pack=beretta&clip=Scene&t0=0&t1=16.8&n=24&cols=6
 *   anim.html?mode=rig&weapons=k47s,sb16&actions=idle,reloadEmpty@0.6
 * Test hook: window.__anim { ready, info }.
 */
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const vec = (k: string, d: [number, number, number]) =>
  q.has(k) ? (q.get(k)!.split(',').map(Number) as [number, number, number]) : d;

const W = ((window as unknown as { __anim: Record<string, unknown> }).__anim = {} as Record<string, unknown>);

async function sourceSheet() {
  const pack = (q.get('pack') ?? 'ak') as SourceId;
  const gltf = await loadSourceGltf(pack);
  const root = skeletonClone(gltf.scene);
  await texturePack(root);
  root.traverse((o) => {
    if ((o as Mesh).isMesh) o.frustumCulled = false;
    if (o.name === 'Gun_3') o.visible = false;
  });
  const clip = gltf.animations.find((c) => c.name.includes(q.get('clip') ?? 'IDLE')) ?? gltf.animations[0];
  const n = num('n', 12);
  const cols = num('cols', 4);
  const rows = Math.ceil(n / cols);
  const sheet = new Sheet(cols, rows, num('tw', 320), num('th', 240));
  sheet.scene.add(root);
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  const eye = vec('eye', pack === 'ak' ? [0, 1.58, -0.12] : [0, 0.02, -0.1]);
  const look = vec('look', [0, 0, 1]);
  sheet.camera.fov = num('fov', 60);
  sheet.camera.position.set(...eye);
  sheet.camera.lookAt(new Vector3(...eye).add(new Vector3(...look)));
  const t0 = num('t0', 0);
  const t1 = num('t1', clip.duration);
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? t0 : t0 + ((t1 - t0) * i) / (n - 1);
    tiles.push({
      label: `${clip.name} ${t.toFixed(2)}s (f${Math.round(t * 24)})`,
      pose: () => mixer.setTime(t),
    });
  }
  sheet.render(tiles);
}

async function main() {
  const mode = q.get('mode') ?? 'src';
  if (mode === 'src') await sourceSheet();
  else {
    const { rigSheet } = await import('./rigSheet');
    await rigSheet(q, W);
  }
  W.ready = true;
  document.body.dataset.ready = '1';
}

main().catch((e) => {
  console.error(e);
  document.body.dataset.ready = '1';
});
