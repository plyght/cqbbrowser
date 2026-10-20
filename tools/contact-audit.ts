/**
 * Hand–weapon hard-contact audit (headless, bun): every clip of every weapon at 60 Hz on the ArmsRig.
 *
 *   bun tools/contact-audit.ts                 # BEFORE (raw rig) and AFTER (contact layer) tables
 *   bun tools/contact-audit.ts --after sb16    # one mode / weapon subset
 *   bun tools/contact-audit.ts --fit           # also: proxy fit vs the weapon meshes (surface coverage)
 *
 * See src/anim/contact/README.md.
 */
import { Matrix4, Vector3 } from 'three';
import { AUDIT_WEAPONS, auditWeapon, formatTable, loadHeadlessRig } from '../src/anim/contact/audit';

const args = process.argv.slice(2);
const modes = args.includes('--before') ? [false] : args.includes('--after') ? [true] : [false, true];
const ids = args.filter((a) => !a.startsWith('--'));
const weapons = ids.length ? ids : AUDIT_WEAPONS;

const rig = await loadHeadlessRig();
const { buildModel } = await import('../src/weapons/models');
const { HandContact } = await import('../src/anim/contact/HandContact');
const { collect } = await import('../src/anim/contact/weaponCollision');
const contact = new HandContact(rig);

if (args.includes('--fit')) {
  console.log('Proxy fit: weapon surface samples (3 mm grid) vs the collision set at rest');
  for (const w of weapons) {
    const m = buildModel(w, { detailParts: true });
    rig.attachWeapon(m, w);
    rig.update(0);
    contact.sync();
    const pts = { p: [] as number[] };
    collect(m.root, new Matrix4().copy(m.root.matrixWorld).invert(), () => false, pts, 0.003);
    const v = new Vector3();
    let out = 0,
      n = 0,
      worst = 0;
    for (let i = 0; i < pts.p.length; i += 3) {
      v.set(pts.p[i], pts.p[i + 1], pts.p[i + 2]);
      const d = contact.col!.sdf(v);
      n++;
      if (d > 0.002) out++;
      worst = Math.max(worst, d);
    }
    console.log(
      `${w}: ${contact.col!.shapeCount} shapes, ${n} surface samples, ${((out / n) * 100).toFixed(2)}% outside by > 2 mm (worst ${(worst * 1000).toFixed(1)} mm)`,
    );
  }
}

for (const resolve of modes) {
  const rows = [];
  for (const w of weapons)
    rows.push(...auditWeapon(rig, contact, w, buildModel(w, { detailParts: true }), resolve));
  console.log('\n' + formatTable(rows, resolve ? 'AFTER (contact layer)' : 'BEFORE (raw rig)'));
}
