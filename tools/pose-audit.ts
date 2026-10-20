/**
 * Pose-continuity audit (see src/anim/rig/poseAudit.ts): `bun tools/pose-audit.ts [weapon] [scenario] [--raw]`
 * prints the spike table, or one scenario frame by frame. `--raw` runs without the contact layer.
 */
import { AUDIT_WEAPONS, loadHeadlessRig } from '../src/anim/contact/audit';
import { formatSpikes, runScenario, scenarios, type SpikeRow } from '../src/anim/rig/poseAudit';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const raw = process.argv.includes('--raw');
const rig = await loadHeadlessRig();
const { buildModel } = await import('../src/weapons/models');
const { HandContact } = await import('../src/anim/contact/HandContact');
const { weaponAnims } = await import('../src/anim/library/library');
const contact = new HandContact(rig);
contact.autoEnable = (id) => !raw && weaponAnims(id).family === 'pistol';
const post = (dt: number) => {
  if (contact.enabled) contact.apply(dt);
};
const weapons = args[0] ? [args[0]] : AUDIT_WEAPONS;
const rows: SpikeRow[] = [];
for (const w of weapons) {
  const mk = () => buildModel(w, { detailParts: true });
  for (const sc of scenarios(rig, w, mk)) {
    if (args[1] && sc.name !== args[1]) continue;
    const r = runScenario(rig, w, mk(), sc, post, !!args[1]);
    rows.push(r);
    if (r.frames)
      r.frames.forEach((f, i) =>
        console.log(
          `${String(i).padStart(4)} ${f.action.padEnd(15)} ${f.pop.toFixed(2).padStart(7)} ${f.bone.padEnd(18)} ${f.mm.toFixed(2).padStart(7)} ${f.at}`,
        ),
      );
  }
}
console.log(formatSpikes(rows, raw ? 'POSE CONTINUITY (raw rig)' : 'POSE CONTINUITY (contact as shipped)'));
