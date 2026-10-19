import type { HitInfo } from '../weapons/Ballistics';
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import type { Context, System } from '../core/Context';
import { Spring } from '../core/math';
import type { RayHit } from '../physics/Physics';
import { WEAPONS } from '../weapons/defs';
import type { StaticBatch } from './geo';
import type { Materials } from './materials';
import {
  A_BODY,
  A_HEAD,
  BODY,
  C_BODY,
  HEAD,
  NECK,
  PAPER_H_CM,
  PAPER_W_CM,
  zoneAt,
  type Pt,
} from './paperZones';
import type { PaintAtlas } from './steel/paint';

export type TargetKind = 'paper' | 'gong' | 'popper' | 'plate' | 'paddle' | 'star';

export interface Target extends System {
  id: string;
  kind: TargetKind;
  hits: number;
  /** Steel: fallen / knocked off / swung over. */
  down: boolean;
  /** Steel that scores only when it falls (poppers, rack/star plates, paddles) vs. rings (gongs). */
  mustFall: boolean;
  steel: boolean;
  /** No-shoot paper: penalty on hit, and aim assist must ignore it. */
  noShoot: boolean;
  /** World-space point to aim at (centre of the scoring area / remaining plate). For aim assist. */
  aimPoint(): Vector3;
  onHit(hit: RayHit, dir: Vector3, energy: number, info?: HitInfo): boolean;
  reset(): void;
}

/** Remembers the projectile of the most recent shot so steel can judge momentum, not just energy. */
export class ShotTracker {
  massKg = 0.0075;
  constructor(ctx: Context) {
    ctx.bus.on('shot', (s) => {
      const d = WEAPONS[s.weaponId];
      this.massKg = d ? d.bulletMass / 1000 / (d.pellets ?? 1) : 0.0075;
    });
  }
}

/** Everything a target needs to build itself into a facility. */
export interface TargetEnv {
  ctx: Context;
  mats: Materials;
  atlas: PaintAtlas;
  shots: ShotTracker;
  /** Static, merged geometry (frames, stands). */
  batch: StaticBatch;
  /** Facility root for moving meshes. */
  parent: Object3D;
  /** Register a target (and extra collider target ids that route to it). */
  register(t: Target, ids?: string[]): void;
}

export function emitSteelHit(
  env: TargetEnv,
  targetId: string,
  point: Vector3,
  size: number,
  thicknessMm: number,
  energy: number,
) {
  const bus = env.ctx.bus;
  bus.emit('steelHit', {
    point: point.clone(),
    targetId,
    size,
    thicknessMm,
    energy,
    distance: env.ctx.camera.position.distanceTo(point),
  });
  bus.emit('targetHit', { targetId, kind: 'steel', point: point.clone() });
}

/**
 * IPSC-style cardboard target on a lath stand. Hits are punched into its canvas (visible from both
 * sides). `noShoot` turns it into a white hands-up no-shoot.
 */
export class PaperTarget implements Target {
  kind = 'paper' as const;
  hits = 0;
  down = false;
  mustFall = false;
  steel = false;
  score = 0;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  readonly mesh: Mesh;
  private flutter = new Spring(5, 0.25);
  static readonly W = PAPER_W_CM / 100;
  static readonly H = PAPER_H_CM / 100;
  private static PX = 3; // px per cm

  constructor(
    private env: TargetEnv,
    public id: string,
    pos: Vector3,
    yaw = 0,
    public noShoot = false,
    centreHeight = 1.3,
  ) {
    const ctx = env.ctx;
    this.canvas.width = PAPER_W_CM * PaperTarget.PX;
    this.canvas.height = PAPER_H_CM * PaperTarget.PX;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.drawFace();
    const mat = new MeshStandardMaterial({
      map: this.tex,
      roughness: 0.95,
      alphaTest: 0.5,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new PlaneGeometry(PaperTarget.W, PaperTarget.H), mat);
    this.mesh.position.set(pos.x, pos.y + centreHeight, pos.z);
    this.mesh.rotation.y = yaw;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    env.parent.add(this.mesh);

    // Stand: 2x4 base on the ground + two 1x2 laths stapled behind the cardboard.
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const back = -0.012;
    const bottom = centreHeight - PaperTarget.H / 2;
    env.batch.box(env.mats.woodStand, pos.x - s * 0.05, pos.y, pos.z - c * 0.05, 0.62, 0.09, 0.09, { yaw });
    for (const k of [-1, 1]) {
      const lx = k * 0.17;
      env.batch.box(
        env.mats.woodStand,
        pos.x + c * lx + s * back,
        pos.y + 0.09,
        pos.z - s * lx + c * back,
        0.038,
        bottom + PaperTarget.H * 0.85 - 0.09,
        0.019,
        { yaw },
      );
    }
    ctx.physics.box(
      { x: pos.x, y: pos.y + centreHeight, z: pos.z },
      { x: PaperTarget.W / 2, y: PaperTarget.H / 2, z: 0.004 },
      { surface: 'paper_target', targetId: id, penetrable: 0.004 },
      yaw,
    );
    env.register(this);
  }

  aimPoint() {
    // Centre of the A-zone body.
    return this.mesh.localToWorld(new Vector3(0, 0.37 - PaperTarget.H / 2, 0));
  }

  setNoShoot(v: boolean) {
    this.noShoot = v;
    this.drawFace();
  }

  private drawFace() {
    const g = this.canvas.getContext('2d')!;
    const P = PaperTarget.PX;
    const W = this.canvas.width,
      H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const X = (x: number) => (x + PAPER_W_CM / 2) * P;
    const Y = (y: number) => (PAPER_H_CM - y) * P;
    const poly = (pts: Pt[]) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
    };
    const rect = (r: [number, number, number, number]) => {
      g.beginPath();
      g.rect(X(r[0]), Y(r[3]), (r[2] - r[0]) * P, (r[3] - r[1]) * P);
    };
    const base = this.noShoot ? '#ecebe6' : '#c09f6c';
    g.fillStyle = base;
    poly(BODY);
    g.fill();
    rect(NECK);
    g.fill();
    rect(HEAD);
    g.fill();
    // Cardboard fibre speckle.
    g.save();
    poly(BODY);
    g.rect(X(HEAD[0]), Y(HEAD[3]), (HEAD[2] - HEAD[0]) * P, (HEAD[3] - HEAD[1]) * P);
    g.clip();
    for (let i = 0; i < 700; i++) {
      g.fillStyle = this.noShoot ? 'rgba(150,150,140,0.12)' : 'rgba(90,60,30,0.14)';
      g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1);
    }
    g.restore();
    // Perforated zone lines.
    g.strokeStyle = this.noShoot ? 'rgba(80,80,80,0.35)' : 'rgba(70,45,20,0.55)';
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    poly(C_BODY);
    g.stroke();
    rect(A_BODY);
    g.stroke();
    rect(A_HEAD);
    g.stroke();
    g.setLineDash([]);
    g.font = `bold ${3 * P}px Arial, sans-serif`;
    g.fillStyle = this.noShoot ? 'rgba(60,60,60,0.4)' : 'rgba(70,45,20,0.6)';
    g.textAlign = 'center';
    g.fillText('A', X(0), Y(48));
    g.fillText('C', X(0), Y(14));
    g.fillText('D', X(19), Y(30));
    if (this.noShoot) this.drawHands(g, X, Y, P);
  }

  /** Open hands raised in front of the chest: the universal "no-shoot". */
  private drawHands(
    g: CanvasRenderingContext2D,
    X: (x: number) => number,
    Y: (y: number) => number,
    P: number,
  ) {
    g.fillStyle = '#1b1b1b';
    for (const side of [-1, 1]) {
      const cx = X(side * 12),
        cy = Y(36);
      // Palm
      g.beginPath();
      g.ellipse(cx, cy, 5 * P, 6 * P, 0, 0, Math.PI * 2);
      g.fill();
      // Fingers
      for (let f = 0; f < 4; f++) {
        const fx = cx + (f - 1.5) * 2.4 * P;
        g.beginPath();
        g.roundRect(fx - 1 * P, cy - 13 * P + Math.abs(f - 1.5) * 1.2 * P, 2 * P, 8 * P, P);
        g.fill();
      }
      // Thumb
      g.save();
      g.translate(cx - side * 4.5 * P, cy + 0.5 * P);
      g.rotate(side * 0.7);
      g.beginPath();
      g.roundRect(-1.1 * P, -5 * P, 2.2 * P, 6 * P, P);
      g.fill();
      g.restore();
      // Wrist/forearm
      g.fillRect(cx - 3.5 * P, cy + 4 * P, 7 * P, 10 * P);
    }
    this.tex.needsUpdate = true;
  }

  onHit(hit: RayHit, dir: Vector3, _energy: number): boolean {
    const local = this.mesh.worldToLocal(hit.point.clone());
    const z = zoneAt(local.x, local.y);
    if (!z) return false; // through the gap beside the silhouette
    this.hits++;
    if (!this.noShoot) this.score += z === 'A' ? 5 : z === 'C' ? 3 : 1;
    const g = this.canvas.getContext('2d')!;
    const P = PaperTarget.PX;
    const px = (local.x * 100 + PAPER_W_CM / 2) * P;
    const py = (PAPER_H_CM / 2 - local.y * 100) * P;
    g.fillStyle = 'rgba(70,50,30,0.5)';
    g.beginPath();
    g.arc(px, py, 0.75 * P, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d0a07';
    g.beginPath();
    g.arc(px, py, 0.45 * P, 0, Math.PI * 2);
    g.fill();
    this.tex.needsUpdate = true;
    // Cardboard flutters away from the shot.
    const n = new Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    this.flutter.impulse(-dir.dot(n) * 0.9);
    this.env.ctx.bus.emit('targetHit', {
      targetId: this.id,
      kind: 'paper',
      zone: z,
      noShoot: this.noShoot,
      point: hit.point.clone(),
    });
    return false; // round continues through paper into the berm
  }

  update(dt: number) {
    this.flutter.step(0, dt);
    this.mesh.rotation.x = this.flutter.value * 0.08;
  }

  reset() {
    this.hits = 0;
    this.score = 0;
    this.drawFace();
    this.tex.needsUpdate = true;
  }
}
