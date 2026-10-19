# First-person arms rig and clip library

One canonical pair of arms for every weapon. The arms are the AK74U pack's Ch08 mesh, restyled as tactical gloves and
combat-shirt sleeves. Every weapon's clips are retargeted onto that one skeleton, so the arms stay the same even when
the pistol clips come from the Beretta pack. Each weapon gets its own composed clip set (`src/anim/library`), so the
guns also move differently.

Sources: both packs are CC-BY by BURNER (`assets/ATTRIBUTION.md`).

## Pipeline

```
public/assets/models/{ak74u,beretta}/*.glb
  └─ tools/anim/build.ts (bun, offline)      bun tools/anim/build.ts --report
       • canonical skeleton = AK Ch08 arms, bone names without "mixamorigN"
       • AK clips: same skeleton → copied local rotations
       • Beretta: world-space retarget (world_dst = srcWorld · srcBind⁻¹ · dstBind), then a two-bone IK puts
         the canonical wrist on the source wrist (its hands hang off IK helper bones, and its arms are
         longer). Max wrist gap: 0 mm.
       • Beretta "Scene" (16.8 s) split into clips by splitTimeline (rest-pose runs, trigger pulses,
         mag travel, slide lock)
       • gun track: weapon model frame (origin at the grip, -z muzzle) relative to the right hand, plus the
         same frame in rig space and a firing-hand-on-grip weight
       • part channels (bolt/slide travel 0..1, trigger, hammer, safety), mag tracks (gun-relative and
         support-hand-relative, plus hand weight and visibility), left/right anchor-contact weights,
         and event markers (detectEvents)
  └─ public/assets/anims/clips.json (~0.7 MB)
src/anim/library  — per-weapon recipes composed at load (trim/speed/reverse/hold/blend + authored layers)
src/anim/rig/ArmsRig.ts — runtime
```

Beretta timeline split (24 fps source):

| clip           | source s    | notes                                                     |
| -------------- | ----------- | --------------------------------------------------------- |
| draw           | 0.00–1.13   | swapIn uses 0.12– (the slide flick is suppressed)         |
| inspect        | 1.67–6.25   |                                                           |
| idle           | 6.25–7.42   | loop                                                      |
| shoot          | 7.46–7.71   | trigger + slide cycle, additive                           |
| reloadTactical | 8.33–10.67  | drop the old mag, insert a fresh one, slide stays forward |
| shootLast      | 11.29–11.63 | slide locks back                                          |
| reloadEmpty    | 12.00–15.96 | mag out, new mag, overhand slide release                  |
| holster        | 16.33–16.83 | swapOut                                                   |

## Runtime API

```ts
import { ArmsRig } from './anim/rig/ArmsRig';

const rig = await ArmsRig.load();          // fetches assets/anims/clips.json + the AK glb (arms only)
camera.add(rig.root);                      // rig space: origin = eye, -z forward. The handling layer moves root.
rig.attachWeapon(buildModel('sb16'), 'sb16');   // model is parented under root and placed every update
rig.play('reloadEmpty', { onEvent: (beat) => bus.emit('weaponBeat', beat) });
rig.play('shoot');                         // additive and short: call per shot (auto fire), cancels draw/inspect
rig.play('magCheck', { hold: true });      // loops the hold section…
rig.releaseHold();                         // …until released → reinsert + seat
rig.swapTo(buildModel('p17'), 'p17');      // swapOut → 'swapMid' (change visible weapon) → swapIn
rig.update(dt);                            // sample → crossfade → additive → bones → weapon → hand IK → parts
rig.syncWeapon();                          // optional: call again if you move hand bones after update()
rig.bones.handR / handL / foreArmR / armL / shoulderR …   // for grip-correction layers after the mixer
rig.busy; rig.action; rig.progress; rig.duration('reloadEmpty', 'sb16');
rig.onBeat = (beat, action) => …;          // global event listener
```

Actions: `idle` (loop), `swapIn`/`draw`, `swapOut`/`holster` (holds its last frame), `shoot`, `shootLast` (slide or
bolt stays back on weapons that lock), `reloadTactical`, `reloadEmpty`, `magCheck`, `inspect`. Non-looping actions
cross-fade back to `idle` when they end.

Events: `magRelease, magOut, magIn, magSeat, boltRelease, chargingHandle, slideRelease, magCheckOut, magCheckIn,
fire, slingDrop, holsterClear, swapMid`. Each fires on its frame through `onEvent` and `onBeat`.

### What the rig drives on a `WeaponModel`

- `root`: placed from the gun track. `WeaponAnims.grip` adds a per-weapon fine offset.
- `bolt` / `chargingHandle` / `slide`: moved +z by `channel × travel`, using the `drive` field in the library.
- `trigger` / `safety`: rotated about +x. Build the model with `{ detailParts: true }` to see these move.
- `mag`: blends between its gun-relative and support-hand-relative transforms. A clone serves as the falling old mag
  in empty reloads. `magStyle: 'straight'` straightens the mag near the well (AR/SMG/pistol); `'rock'` keeps the AK
  rock-in.
- Support hand: each clip carries anchor-contact weights (`grip`, `well`, `charge`). The rig moves the wrist by
  `(this weapon's socket − the pack's reference weapon's socket) × weight` (sockets `gripLeft`, `magwell`,
  `chargingHandle`; reference weapons are k47s for the AK pack and p17 for the Beretta pack). It then solves a
  two-bone IK, so a long SB-16 handguard or a KP-9 well still meets the hand. Authored `handL`/`handR` keys
  (bolt-catch slap, HK slap, mag-check palm) override the target on top of that.

## Per-weapon differences (src/anim/library/library.ts)

| weapon | pack    | empty reload                                               | mag      | timing           |
| ------ | ------- | ---------------------------------------------------------- | -------- | ---------------- |
| k47s   | AK      | old mag drops, rock-in, firing hand racks the carrier      | rock     | 1.0, swing swaps |
| sb16   | AK      | straight insert, support palm **slaps the bolt catch**     | straight | 1.05             |
| hb300  | AK      | same as SB-16                                              | straight | 1.15, quick swap |
| kp9    | AK      | lock the charging handle back, change the mag, **HK slap** | straight | 1.08             |
| p17    | Beretta | slide locked, new mag, overhand slide release              | straight | 1.1              |

Weapons that aren't in the table (a future revolver or shotgun) fall back by family in `weaponAnims(id)`.

## Dev page

`anim.html?mode=src&pack=beretta&clip=Scene&n=36&cols=6` renders a source contact sheet.
`anim.html?mode=rig&weapons=k47s,p17&actions=idle@0,reloadEmpty@0.6,magCheck@0.5+hold&fov=45&look=0.04,-0.15,-0.38`
renders the canonical rig (`cam`, `look`, `pitch`, `noik=1`, `nomerge=1` are debug options). The e2e spec is
`tests/e2e/anims.spec.ts`, which writes `screenshots/anims-*.png`.

## Perf

The arms are one `SkinnedMesh`: hands and sleeves are merged after de-quantising, and the sleeves are moved into the
body's quantised space. That is 2 draw calls (2 materials) and about 9k triangles.
