import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { Context, System } from '../core/Context';
import type { Ballistics } from '../weapons/Ballistics';
import { makeMaterials } from './materials';
import { Gong, PaperTarget, Popper, type Target } from './targets';

/** Outdoor square range: gravel pad, dirt berms, bay walls, paper + steel. */
export class Range implements System {
  targets: Target[] = [];
  readonly spawn = new Vector3(0, 0, 8);
  readonly spawnYaw = 0;

  constructor(ctx: Context, ballistics: Ballistics) {
    const { scene, physics } = ctx;
    const m = makeMaterials();
    scene.background = new Color(0xaeb8c2);
    scene.fog = new Fog(0xaeb8c2, 60, 260);

    const sun = new DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.far = 150;
    sun.shadow.bias = -0.0005;
    scene.add(sun, new HemisphereLight(0xcfd8e2, 0x5a5046, 0.9), new AmbientLight(0xffffff, 0.15));

    // Ground
    const ground = new Mesh(new PlaneGeometry(400, 400), m.gravel);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    physics.box({ x: 0, y: -0.5, z: 0 }, { x: 200, y: 0.5, z: 200 }, { surface: 'gravel' });

    const solid = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat = m.concrete,
      surface: 'concrete' | 'berm' | 'plywood' = 'concrete',
    ) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      physics.box({ x, y: y + h / 2, z }, { x: w / 2, y: h / 2, z: d / 2 }, { surface });
      return mesh;
    };

    // Back berm and side berms
    solid(0, 0, -30, 60, 6, 6, m.berm, 'berm');
    solid(-28, 0, -5, 4, 4, 54, m.berm, 'berm');
    solid(28, 0, -5, 4, 4, 54, m.berm, 'berm');
    // Concrete firing line pad + baffles between bays
    const pad = new Mesh(new BoxGeometry(40, 0.08, 6), m.concrete);
    pad.position.set(0, 0.04, 9);
    pad.receiveShadow = true;
    scene.add(pad);
    physics.box({ x: 0, y: 0.04, z: 9 }, { x: 20, y: 0.04, z: 3 }, { surface: 'concrete' });
    for (const x of [-12, 12]) solid(x, 0, 2, 0.4, 2.4, 14, m.plywood, 'plywood');
    // Shooting barricade
    solid(-1.2, 0, 4.5, 0.12, 1.8, 1.2, m.plywood, 'plywood');
    solid(1.2, 0, 4.5, 0.12, 1.8, 1.2, m.plywood, 'plywood');

    // Targets: paper at 7 m, steel line at 10–15 m, long gong at 25 m.
    const add = <T extends Target & { onHit?: unknown }>(t: T) => {
      this.targets.push(t);
      ballistics.listeners.push(t as never);
      return t;
    };
    for (const x of [-2.5, 0, 2.5]) add(new PaperTarget(ctx, m, new Vector3(x, 0, 1), 0));
    for (const x of [-4, -2, 0, 2, 4]) add(new Popper(ctx, m, new Vector3(x, 0, -6)));
    add(new Gong(ctx, m, new Vector3(-6, 0, -12), 0.3, true));
    add(new Gong(ctx, m, new Vector3(6, 0, -12), 0.25, false));
    add(new Gong(ctx, m, new Vector3(0, 0, -20), 0.45, true, 12));
  }

  update(dt: number, alpha: number) {
    for (const t of this.targets) t.update?.(dt, alpha);
  }

  reset() {
    for (const t of this.targets) t.reset();
  }
}
