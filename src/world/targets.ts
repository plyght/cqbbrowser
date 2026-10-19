import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Vector3,
  BoxGeometry,
  CanvasTexture,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import type { Context, System } from '../core/Context';
import { RAPIER, type RayHit } from '../physics/Physics';
import type { HitListener } from '../weapons/Ballistics';
import type { Materials } from './materials';

export interface Target extends System {
  id: string;
  kind: 'gong' | 'popper' | 'paper';
  hits: number;
  down: boolean;
  reset(): void;
}

let nextId = 1;

/** AR500-style gong hung on chains: dynamic body on a revolute joint under a steel frame. */
export class Gong implements Target, HitListener {
  id = `gong${nextId++}`;
  kind = 'gong' as const;
  hits = 0;
  down = false;
  readonly group = new Group();
  private body: RAPIER.RigidBody;
  private mesh: Mesh;

  constructor(
    private ctx: Context,
    mats: Materials,
    pos: Vector3,
    public size = 0.3,
    public round = true,
    public thicknessMm = 10,
  ) {
    const w = ctx.physics.world;
    const hang = 1.45;
    // Frame
    const postGeo = new BoxGeometry(0.05, hang + 0.15, 0.05);
    for (const s of [-1, 1]) {
      const post = new Mesh(postGeo, mats.steelPost);
      post.position.set(pos.x + s * (size * 0.5 + 0.25), pos.y + (hang + 0.15) / 2, pos.z);
      this.group.add(post);
    }
    const bar = new Mesh(new BoxGeometry(size + 0.55, 0.05, 0.05), mats.steelPost);
    bar.position.set(pos.x, pos.y + hang + 0.12, pos.z);
    this.group.add(bar);
    // Plate
    const geo = round
      ? new CylinderGeometry(size / 2, size / 2, thicknessMm / 1000, 28)
      : new BoxGeometry(size, thicknessMm / 1000, size);
    geo.rotateX(Math.PI / 2);
    this.mesh = new Mesh(geo, mats.steel);
    this.group.add(this.mesh);
    ctx.scene.add(this.group);

    const plateY = pos.y + hang - 0.18 - size / 2;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, plateY, pos.z)
        .setAngularDamping(0.25)
        .setLinearDamping(0.3),
    );
    const col = w.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, size / 2, thicknessMm / 2000).setDensity(7850),
      this.body,
    );
    ctx.physics.tag(col, { surface: 'steel_target', targetId: this.id });
    const anchor = w.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + hang + 0.12, pos.z),
    );
    const joint = RAPIER.JointData.revolute(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: hang + 0.12 - (plateY - pos.y), z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    w.createImpulseJoint(joint, anchor, this.body, true);
    // Chain visuals
    for (const s of [-1, 1]) {
      const chain = new Mesh(new BoxGeometry(0.008, 0.3, 0.008), mats.steelPost);
      chain.name = 'chain';
      chain.userData.side = s;
      this.group.add(chain);
    }
  }

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    if (hit.tag.targetId !== this.id) return false;
    this.hits++;
    const momentum = Math.sqrt(2 * energy * 0.008); // rough p from E with assumed mass
    this.body.applyImpulseAtPoint(
      { x: dir.x * momentum * 2, y: dir.y * momentum * 2, z: dir.z * momentum * 2 },
      hit.point,
      true,
    );
    const cam = this.ctx.camera.position;
    this.ctx.bus.emit('steelHit', {
      point: hit.point,
      targetId: this.id,
      size: this.size,
      thicknessMm: this.thicknessMm,
      energy,
      distance: cam.distanceTo(hit.point),
    });
    return true;
  }

  update() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const top = new Vector3(0, this.size / 2, 0)
      .applyQuaternion(this.mesh.quaternion)
      .add(this.mesh.position);
    for (const c of this.group.children) {
      if (c.name !== 'chain') continue;
      const s = c.userData.side as number;
      c.position.set(top.x + s * this.size * 0.3, top.y + 0.13, top.z);
    }
  }

  reset() {
    this.hits = 0;
  }
}

/** Steel popper: falls when struck above the calibration line with enough momentum. */
export class Popper implements Target, HitListener {
  id = `popper${nextId++}`;
  kind = 'popper' as const;
  hits = 0;
  down = false;
  private body: RAPIER.RigidBody;
  private mesh: Group;
  private home: Vector3;

  constructor(
    private ctx: Context,
    mats: Materials,
    pos: Vector3,
    /** Joules above calibration needed to fall. */
    public threshold = 380,
  ) {
    this.home = pos.clone();
    const w = ctx.physics.world;
    this.mesh = new Group();
    const plate = new Mesh(new BoxGeometry(0.3, 0.75, 0.012), mats.steel);
    plate.position.y = 0.55;
    const head = new Mesh(new CircleGeometry(0.15, 24), mats.steel);
    head.position.set(0, 1.05, 0.0065);
    const headBack = head.clone();
    headBack.rotation.y = Math.PI;
    headBack.position.z = -0.0065;
    const base = new Mesh(new BoxGeometry(0.5, 0.06, 0.4), mats.steelPost);
    base.position.y = 0.03;
    this.mesh.add(plate, head, headBack);
    base.position.add(pos);
    ctx.scene.add(base, this.mesh);
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + 0.12, pos.z)
        .setAngularDamping(0.6),
    );
    const c1 = w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 0.45, 0.006).setTranslation(0, 0.45, 0).setDensity(7850),
      this.body,
    );
    const c2 = w.createCollider(
      RAPIER.ColliderDesc.ball(0.15).setTranslation(0, 0.93, 0).setDensity(200),
      this.body,
    );
    for (const c of [c1, c2]) ctx.physics.tag(c, { surface: 'steel_target', targetId: this.id });
    const anchor = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.12, pos.z));
    const j = w.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      anchor,
      this.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    j.setLimits(-1.6, 1.6);
    // Hold upright with a stiff-ish motor that a solid hit overcomes; released when knocked.
    j.configureMotorPosition(0, 600, 40);
    this.joint = j;
  }

  private joint: RAPIER.RevoluteImpulseJoint;

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    if (hit.tag.targetId !== this.id) return false;
    this.hits++;
    const local = hit.point.y - this.home.y;
    const aboveCal = local > 0.7;
    if (!this.down && aboveCal && energy >= this.threshold) {
      this.down = true;
      this.joint.configureMotorPosition(0, 0, 0);
      this.body.applyImpulseAtPoint({ x: dir.x * 8, y: 0, z: dir.z * 8 }, hit.point, true);
      setTimeout(() => this.ctx.bus.emit('steelFall', { point: hit.point.clone(), targetId: this.id }), 380);
    } else {
      this.body.applyImpulseAtPoint({ x: dir.x * 1.5, y: 0, z: dir.z * 1.5 }, hit.point, true);
    }
    this.ctx.bus.emit('steelHit', {
      point: hit.point,
      targetId: this.id,
      size: 0.35,
      thicknessMm: 10,
      energy,
      distance: this.ctx.camera.position.distanceTo(hit.point),
    });
    return true;
  }

  update() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y - 0.12, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  reset() {
    this.down = false;
    this.hits = 0;
    this.body.setTranslation({ x: this.home.x, y: this.home.y + 0.12, z: this.home.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.joint.configureMotorPosition(0, 600, 40);
  }
}

/** IPSC-style cardboard target on a stand. Draws hits onto a canvas texture. */
export class PaperTarget implements Target, HitListener {
  id = `paper${nextId++}`;
  kind = 'paper' as const;
  hits = 0;
  down = false;
  score = 0;
  private canvas: HTMLCanvasElement;
  private tex: CanvasTexture;
  private mesh: Mesh;
  static readonly W = 0.46;
  static readonly H = 0.76;

  constructor(ctx: Context, mats: Materials, pos: Vector3, yaw = 0) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 230;
    this.canvas.height = 380;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.drawFace();
    const mat = new MeshStandardMaterial({ map: this.tex, roughness: 0.95 });
    this.mesh = new Mesh(new PlaneGeometry(PaperTarget.W, PaperTarget.H), mat);
    this.mesh.position.set(pos.x, pos.y + 1.2, pos.z);
    this.mesh.rotation.y = yaw;
    const back = new Mesh(new PlaneGeometry(PaperTarget.W, PaperTarget.H), mats.paper);
    back.rotation.y = Math.PI;
    this.mesh.add(back);
    ctx.scene.add(this.mesh);
    for (const s of [-1, 1]) {
      const stick = new Mesh(new BoxGeometry(0.03, 1.3, 0.02), mats.woodStand);
      stick.position.set(pos.x + Math.cos(yaw) * s * 0.2, pos.y + 0.6, pos.z - Math.sin(yaw) * s * 0.2);
      stick.rotation.y = yaw;
      ctx.scene.add(stick);
    }
    const col = ctx.physics.box(
      { x: pos.x, y: pos.y + 1.2, z: pos.z },
      { x: PaperTarget.W / 2, y: PaperTarget.H / 2, z: 0.004 },
      { surface: 'paper_target', targetId: this.id, penetrable: 0.004 },
      yaw,
    );
    void col;
  }

  private drawFace() {
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width,
      H = this.canvas.height;
    g.fillStyle = '#c4a876';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(60,40,20,0.55)';
    g.lineWidth = 2;
    // Octagon-ish body (D), C, A zones + head.
    const zone = (x: number, y: number, w: number, h: number) => g.strokeRect(x, y, w, h);
    zone(10, 95, W - 20, H - 105); // D
    zone(40, 120, W - 80, H - 150); // C
    zone(78, 140, W - 156, 140); // A body
    g.strokeRect(70, 10, 90, 80); // head C
    g.strokeRect(92, 28, 46, 34); // head A
  }

  /** Score zone from local hit coordinates (metres from centre). */
  static zoneAt(lx: number, ly: number): 'A' | 'C' | 'D' | 'M' {
    const px = (lx / PaperTarget.W + 0.5) * 230;
    const py = (0.5 - ly / PaperTarget.H) * 380;
    const inR = (x: number, y: number, w: number, h: number) =>
      px >= x && px <= x + w && py >= y && py <= y + h;
    if (inR(92, 28, 46, 34) || inR(78, 140, 74, 140)) return 'A';
    if (inR(70, 10, 90, 80) || inR(40, 120, 150, 230)) return 'C';
    if (inR(10, 95, 210, 275)) return 'D';
    return 'M';
  }

  onHit(hit: RayHit, _dir: Vector3, _energy: number): boolean {
    if (hit.tag.targetId !== this.id) return false;
    const local = this.mesh.worldToLocal(hit.point.clone());
    const z = PaperTarget.zoneAt(local.x, local.y);
    if (z === 'M') return false;
    this.hits++;
    this.score += z === 'A' ? 5 : z === 'C' ? 3 : 1;
    const g = this.canvas.getContext('2d')!;
    const px = (local.x / PaperTarget.W + 0.5) * 230;
    const py = (0.5 - local.y / PaperTarget.H) * 380;
    g.fillStyle = '#120d08';
    g.beginPath();
    g.arc(px, py, 2.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(80,60,40,0.6)';
    g.stroke();
    this.tex.needsUpdate = true;
    return false; // round continues through paper into the berm
  }

  reset() {
    this.hits = 0;
    this.score = 0;
    this.drawFace();
    this.tex.needsUpdate = true;
  }
}
