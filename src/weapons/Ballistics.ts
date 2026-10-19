import { Vector3 } from 'three';
import type { Context } from '../core/Context';
import type { RayHit } from '../physics/Physics';
import { WEAPONS } from './defs';

export interface HitListener {
  /** Return true if this listener handled (absorbed) the round. */
  onHit(hit: RayHit, dir: Vector3, energy: number): boolean;
}

/** Hitscan with simple penetration: drywall/doors let rounds through with energy loss. */
export class Ballistics {
  listeners: HitListener[] = [];

  constructor(
    private ctx: Context,
    private exclude: () => unknown,
  ) {
    ctx.bus.on('shot', (s) => this.fire(s.weaponId, s.origin, s.dir));
  }

  private fire(weaponId: string, origin: Vector3, dir: Vector3) {
    const d = WEAPONS[weaponId];
    const pellets = d?.pellets ?? 1;
    const energy0 = d ? 0.5 * (d.bulletMass / 1000) * d.velocity * d.velocity : 500;
    for (let i = 0; i < pellets; i++) {
      const spread = ((d?.spreadMoa ?? 3) / 60) * (Math.PI / 180) * 0.5;
      const dd = dir
        .clone()
        .add(
          new Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
          ),
        )
        .normalize();
      this.trace(origin.clone(), dd, energy0 / pellets, 0);
    }
  }

  private trace(origin: Vector3, dir: Vector3, energy: number, depth: number) {
    if (depth > 3 || energy < 20) return;
    const hit = this.ctx.physics.raycast(origin, dir, 300, this.exclude() as never);
    if (!hit) return;
    this.ctx.bus.emit('impact', {
      point: hit.point,
      normal: hit.normal,
      surface: hit.tag.surface,
      targetId: hit.tag.targetId,
      energy,
    });
    for (const l of this.listeners) if (l.onHit(hit, dir, energy)) return;
    const pen = hit.tag.penetrable ?? 0;
    if (pen > 0) {
      const loss = pen * 6000;
      this.trace(hit.point.clone().addScaledVector(dir, pen + 0.01), dir, energy - loss, depth + 1);
    }
  }
}
