/**
 * Grip truth audit (headless, bun): kit weapons on the real rig, true glove-mesh vs weapon-mesh distances per
 * hand region at idle / ADS / fire, raw clip vs the contact layer, with the side-aware wrap check.
 *
 *   bun tools/grip-audit.ts                  # every kit weapon, raw and contact
 *   bun tools/grip-audit.ts sb16 --mode full # subset / forced mode
 *   bun tools/grip-audit.ts --proxy          # also: proxy SDF vs truth at the hand (proxy inflation)
 *
 * Pads print as region:gap-mm + face initial (r/l/f/b/t/b), `!` = pad not facing the face.
 */
import {
  GRIP_WEAPONS,
  GripTruth,
  fmtPads,
  loadHeadlessKit,
  runState,
  wrapFailures,
  type State,
} from '../src/anim/contact/gripAudit';
import { loadHeadlessRig } from '../src/anim/contact/audit';

const args = process.argv.slice(2);
const mi = args.indexOf('--mode');
const forced = mi >= 0 ? (args[mi + 1] as 'safe' | 'full') : null;
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--mode');
const weapons = ids.length ? ids : GRIP_WEAPONS;

const rig = await loadHeadlessRig();
await loadHeadlessKit();
const { buildModel } = await import('../src/weapons/models');
const { HandContact } = await import('../src/anim/contact/HandContact');
const contact = new HandContact(rig);
const truth = new GripTruth(rig);

for (const w of weapons) {
  for (const on of [false, true]) {
    const model = buildModel(w, { detailParts: true });
    if (forced) contact.mode = forced;
    else contact.mode = HandContact.defaultMode;
    contact.autoEnable = () => on;
    contact.useGrip = !args.includes('--legacy');
    if (on && !forced) contact.mode = 'safe';
    rig.attachWeapon(model, w);
    truth.refresh(model);
    const label = on ? `contact(${contact.grip ? 'grip' : contact.mode})` : 'raw';
    for (const state of ['idle', 'ads', 'fire'] as State[]) {
      let penR = 0,
        penL = 0;
      runState(rig, contact, state, (i) => {
        if (i % 3) return;
        penR = Math.max(penR, truth.measure(model, 'R').pen);
        penL = Math.max(penL, truth.measure(model, 'L').pen);
      });
      const R = truth.measure(model, 'R'),
        L = truth.measure(model, 'L');
      const fails = [...wrapFailures(R), ...(model.parts.slide ? [] : wrapFailures(L))];
      console.log(
        `${w.padEnd(6)} ${state.padEnd(4)} ${label.padEnd(14)} maxpen R ${(penR * 1000).toFixed(1)} L ${(penL * 1000).toFixed(1)} mm | fails ${fails.length}`,
      );
      if (state === 'idle' || args.includes('--all')) {
        console.log(`   R ${fmtPads(R)}`);
        console.log(`   L ${fmtPads(L)}`);
        if (fails.length) console.log(`   ✗ ${fails.join('; ')}`);
      }
    }
    rig.detachWeapon();
  }
}
