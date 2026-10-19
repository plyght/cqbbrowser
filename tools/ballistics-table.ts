/**
 * Prints the ballistics validation tables as markdown: `bun tools/ballistics-table.ts`.
 * Same rows the unit tests check (src/physics/ballistics/validation.ts); ✗ marks a row outside its range.
 */
import {
  dropTable,
  fpsPerInch,
  PEN_CASES,
  PEN_LOADS,
  penetrationTable,
  recoilTable,
  steelTable,
  velocityTable,
  zeroTable,
} from '../src/physics/ballistics/validation';
import { POPPER_HEAVY, POPPER_STANDARD } from '../src/world/steel/momentum';

const f = (x: number, d = 0) => x.toFixed(d);
const ok = (b: boolean) => (b ? '✓' : '✗');
const out: string[] = [];
const table = (head: string[], rows: (string | number)[][]) => {
  out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('');
};

out.push('## Muzzle velocity / energy (interior model vs published)', '');
table(
  ['load', 'barrel', 'm/s', 'fps', 'J', 'ref m/s', 'reference', ''],
  velocityTable().map((r) => [
    r.ammo,
    `${r.inches}"`,
    f(r.v),
    f(r.fps),
    f(r.energy),
    `${r.ref[0]}–${r.ref[1]}`,
    r.note,
    ok(r.ok),
  ]),
);
out.push(
  `Loss below 16": M193 ${f(fpsPerInch('m193'))} fps/in, M855 ${f(fpsPerInch('m855'))}, ` +
    `.300 BLK 220 ${f(fpsPerInch('blk220', 9))}, 9 mm 124 ${f(fpsPerInch('p9_124', 4))} (4–16").`,
  '',
);

out.push('## Drop from a horizontal bore / time of flight', '');
table(
  ['load', 'barrel', 'v0', '25 m', '50 m', '100 m', ''],
  dropTable().map((r) => [
    r.ammo,
    `${r.inches}"`,
    f(r.v0),
    ...r.at.map((a) => `${f(a.dropCm, 1)} cm · ${f(a.tofMs)} ms · ${f(a.v)} m/s`),
    ok(r.ok),
  ]),
);

out.push('## Zero / mechanical offset (POI vs line of sight, cm)', '');
table(
  ['weapon', 'zero', 'sight ht', 'bore mrad', '3 m', '7 m', '15 m', '25 m', '50 m', '100 m', ''],
  zeroTable().map((r) => [
    r.weapon,
    `${r.zero} m`,
    `${f(r.sightHeightCm, 1)} cm`,
    f(r.boreMrad, 2),
    ...r.poi.map((p) => f(p.cm, 1)),
    ok(r.ok),
  ]),
);

out.push('## Free recoil (default builds)', '');
table(
  ['weapon', 'load', 'mass kg', 'impulse N·s', 'V m/s', 'E J', 'ft·lbf', 'action', 'cycle ms', 'ref J', ''],
  recoilTable().map((r) => [
    r.weapon,
    r.ammo,
    f(r.massKg, 2),
    f(r.impulse, 2),
    f(r.velocity, 2),
    f(r.energy, 2),
    f(r.ftlb, 2),
    r.action,
    f(r.cycleMs),
    `${r.ref[0]}–${r.ref[1]} (${r.note})`,
    ok(r.ok),
  ]),
);

out.push('## Penetration: exit speed m/s (✗ = stopped; ~ tumbling, * fragmented)', '');
const pen = penetrationTable();
table(
  ['target', ...PEN_LOADS.map(([a, l]) => `${a} ${l}"`)],
  PEN_CASES.map((c, i) => [
    c.label,
    ...pen[i].map((x) => (x.out > 0 ? `${f(x.out)}${x.tumbling ? '~' : ''}${x.fragmented ? '*' : ''}` : '✗')),
  ]),
);

out.push(
  `## Steel knockdown at 9 m (impulse m·v·(1+e), N·s; standard ≥ ${POPPER_STANDARD.threshold}, heavy ≥ ${POPPER_HEAVY.threshold} at the line, 1.3× lever cap)`,
  '',
);
table(
  ['weapon', 'load', 'impulse', 'standard popper', 'heavy @ line', 'heavy @ head', 'rack plate'],
  steelTable().map((r) => [
    r.weapon,
    r.ammo,
    f(r.impulse, 2),
    r.standard ? 'DROP' : 'ring',
    r.heavyAtLine ? 'DROP' : 'ring',
    r.heavyHigh ? 'DROP' : 'ring',
    r.plate ? 'DROP' : 'ring',
  ]),
);

console.log(out.join('\n'));
