import { Vector3 } from 'three';
import { berm, floor, shootingBox, signBoard, type Facility, type FacilityEnv } from './facility';
import { makeDuelingTree } from './steel/DuelingTree';
import { Gong } from './steel/Gong';
import { makePopper } from './steel/Knockdown';
import { makePlateRack } from './steel/PlateRack';
import { TexasStar } from './steel/TexasStar';

export const STEEL_ORIGIN = new Vector3(150, 0, 0);

/** Steel park: five stages in one bowl — plate rack, Texas star, 5-to-go, popper field, dueling tree. */
export function buildSteelPark(env: FacilityEnv): Facility {
  const { batch, mats } = env;
  const O = STEEL_ORIGIN;
  const P = (x: number, z: number) => new Vector3(O.x + x, 0, O.z + z);

  floor(batch, mats.gravel, O.x, O.z - 6, 66, 46);
  batch.box(mats.concrete, O.x, 0, O.z + 9.5, 62, 0.06, 4, { tag: { surface: 'concrete' } });
  berm(env, O.x, O.z - 31, 74, 12, 6, 2.5, 0, 11);
  berm(env, O.x - 36.5, O.z - 8, 50, 10, 4, 2, Math.PI / 2, 12);
  berm(env, O.x + 36.5, O.z - 8, 50, 10, 4, 2, Math.PI / 2, 13);

  const stage = (n: number, name: string, x: number, sub: string) => {
    shootingBox(env, O.x + x, O.z + 9);
    signBoard(
      env,
      { lines: [`STAGE ${n}`, name, sub], bg: '#f2efe4', fg: '#141414', px: [256, 160], border: '#1f3b63' },
      P(x + 1.3, 10.2),
      0.75,
      0.47,
      0.25,
      0.9,
    );
  };

  // Stage 1: plate rack (10 m).
  makePlateRack(env, 'steel.rack', P(-4, -1), 0);
  stage(1, 'PLATE RACK', -4, '6 PLATES · 10 M');
  // Stage 2: Texas star (11 m).
  new TexasStar(env, 'steel.star', P(3, -2), 0);
  stage(2, 'TEXAS STAR', 3, '5 PLATES · 11 M');
  // Stage 3: 5 to Go — four 12" plates and a stop plate.
  const tg: [number, number][] = [
    [12, -1],
    [14, -5],
    [18, -5],
    [20, -1],
  ];
  tg.forEach(([x, z], i) => new Gong(env, `steel.5tg.${i}`, P(x, z), { w: 0.3, hookY: 1.35 }));
  new Gong(env, 'steel.5tg.stop', P(16, -9), { w: 0.45, h: 0.6, round: false, hookY: 1.75, thicknessMm: 12 });
  stage(3, '5 TO GO', 16, 'STOP PLATE LAST');
  // Stage 4: popper field (7–20 m), one heavy popper at the back.
  const pf: [number, number][] = [
    [-26, 1],
    [-23.5, -3],
    [-21, -6],
    [-18.5, -3],
    [-16, 1],
  ];
  pf.forEach(([x, z], i) => makePopper(env, `steel.popper.${i}`, P(x, z)));
  makePopper(env, 'steel.popper.heavy', P(-21, -11), 0, true);
  stage(4, 'POPPER FIELD', -21, 'HEAVY POPPER · 20 M');
  // Stage 5: dueling tree.
  makeDuelingTree(env, 'steel.tree', P(27, -1), 0);
  stage(5, 'DUELING TREE', 27, '6 PADDLES · 10 M');

  const sp = (x: number, z = 9) => ({ pos: P(x, z).setY(0.06), yaw: 0 });
  return {
    id: 'steel',
    name: 'Steel Park',
    group: env.parent as never,
    spawns: {
      'steel.park': sp(-0.5, 9.5),
      'steel.rack': sp(-4),
      'steel.star': sp(3),
      'steel.5tg': sp(16),
      'steel.popper': sp(-21),
      'steel.tree': sp(27),
    },
    defaultSpawn: 'steel.park',
  };
}
