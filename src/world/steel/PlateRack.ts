import { Shape, Vector3 } from 'three';
import type { TargetEnv } from '../targets';
import { Knockdown } from './Knockdown';
import { PLATE_ANY } from './momentum';

/** Circle of radius r whose bottom sits `tab` above the hinge (y = 0). */
function hingedDisc(r: number, tab: number) {
  const s = new Shape();
  s.moveTo(-0.03, 0);
  s.lineTo(0.03, 0);
  s.lineTo(0.03, tab + 0.01);
  s.absarc(0, tab + r, r, -Math.PI / 2 + 0.3, Math.PI * 1.5 - 0.3, false);
  s.lineTo(-0.03, tab + 0.01);
  s.closePath();
  return s;
}

/**
 * Six 8" plates standing on hinges along a steel beam. Any solid hit knocks a plate back onto the
 * beam. Returns the six plate targets (ids `${id}.p0` … `${id}.p5`, left to right).
 */
export function makePlateRack(env: TargetEnv, id: string, ground: Vector3, yaw = 0): Knockdown[] {
  const { batch, mats } = env;
  const beamY = 1.0;
  const n = 6,
    pitch = 0.3,
    r = 0.1;
  const len = pitch * n + 0.3;
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const at = (lx: number, lz: number) =>
    new Vector3(ground.x + c * lx + s * lz, ground.y, ground.z - s * lx + c * lz);
  // Beam, top flange the plates hinge on, front face guard over the hinges.
  const b = at(0, 0);
  batch.box(mats.steelPost, b.x, beamY - 0.12, b.z, len, 0.12, 0.1, {
    yaw,
    cast: true,
    tag: { surface: 'metal' },
  });
  batch.box(mats.steelPost, b.x, beamY, b.z, len, 0.012, 0.32, { yaw, cast: true });
  const g = at(0, 0.07);
  batch.box(mats.steelPost, g.x, beamY - 0.02, g.z, len, 0.07, 0.008, { yaw, cast: true, pitch: -0.5 });
  // Legs: an inverted V at each end + foot.
  for (const k of [-1, 1]) {
    for (const f of [-1, 1]) {
      const p = at(k * (len / 2 - 0.08), f * 0.14);
      batch.box(mats.steelPost, p.x, ground.y, p.z, 0.05, beamY - 0.06, 0.05, { yaw, pitch: -f * 0.27 });
    }
    const foot = at(k * (len / 2 - 0.08), 0);
    batch.box(mats.steelPost, foot.x, ground.y, foot.z, 0.06, 0.04, 0.75, { yaw });
  }
  const plates: Knockdown[] = [];
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * pitch;
    const hinge = at(lx, -0.02);
    hinge.y = ground.y + beamY + 0.006;
    plates.push(
      new Knockdown(env, `${id}.p${i}`, hinge, {
        kind: 'plate',
        shape: hingedDisc(r, 0.03),
        thicknessMm: 10,
        cal: PLATE_ANY,
        yaw,
        fallLimit: -1.45,
        size: 0.2,
      }),
    );
  }
  return plates;
}
