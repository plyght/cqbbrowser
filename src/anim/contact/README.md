# Hand–weapon hard contact (ArmsRig)

The authored rig hands (`src/anim/rig`) were made around the source packs' guns. On our procedural guns they sink
into grips, handguards, magwells and mags by up to ~3 cm. This layer measures that against collision proxies
and blocks it. It runs every frame after `ArmsRig.update` and the arm layers, before rendering
(`WeaponController.updateRig` → `HandContact.apply(dt)`).

## Proxies

- **Hands** (`handProxy.ts`, bone-driven, so no mesh data is needed). Each phalanx is a capsule from its bone to
  the child bone (the distal one runs along the bone's +y). The palm is a rounded box (hand bone → metacarpal
  heads, 16 mm half-thickness), and the wrist is a capsule toward the elbow. The radii are glove radii measured
  on the Ch08 glove mesh. Any body that maps 1:1 onto the Mixamo arm, hand and finger bones reuses them.
- **Weapon** (`weaponCollision.ts`). The proxies come from `model.collision` (`CollisionProxy[]`, weapon or
  part-pivot frame: an asset-pipeline catalog drops in as data), or else `fitCollision(model)` fits rounded
  boxes to the model's own surface:
  - the pistol grip, in grip-axis slices;
  - the rest of the static mesh, in 1 cm bore slabs split into vertical runs;
  - every moving part (mag, slide, bolt, charging handle, trigger, …) in its pivot frame, so the boxes follow
    it live;
  - the **magwell opening**, carved out of the static boxes using the seated mag's footprint. The mag can
    enter along the well. Hands instead see a `wellPlug`, because no finger fits beside a mag.

  `bun tools/contact-audit.ts --fit` reports surface coverage: ≤ 0.12 % of mesh surface samples lie outside the
  proxies by more than 2 mm.

## Solve

1. **Baked once per weapon build** (`ArmsRig.seatProvider`, rig at idle frame 0):
   - the firing-hand **grip seat**: a rigid correction of the gun frame relative to the hand that minimises
     palm and knuckle penetration and keeps the palm on the backstrap (`seat.ts`). The rig applies it inside
     `syncWeapon`, so the handling reference, sights and support-hand anchors all follow it;
   - the support-hand hold offset off the handguard (applied through two-bone IK);
   - per-joint finger poses for both hands, hand-poser style: open until clear, then close joint by joint
     until each phalanx touches (distal joints roll back so the finger wraps instead of stopping at the tip).
2. **Every frame** (hold weights: `gunOnHand` for the firing hand, the `grip` anchor weight for the support
   hand):
   - the firing body (palm, wrist, knuckles, thenar) never moves the hand. The gun is offset instead (≤ 4 cm).
   - the support hand clears along the shortest of a few directions (palm normal ± tilts, SDF gradient), with
     two-bone IK (`ArmsRig.reachHand`). It never translates the hand bone on its own.
   - mag rules: a held mag moves out of the hand. A travelling mag can't pass through the receiver except
     through the well opening. Once seated, the mag is part of the gun.
   - fingers solve the residual on top of the bake. A knuckle-led opening synergy is applied at once (the hard
     block) and releases over ~25 ms. A PIP/DIP curl synergy closes to contact with hysteresis on the wrap
     intent. Any residual a finger can't clear backs the hand off (support hand) or the gun (firing hand).

## Audit / CI

`bun tools/contact-audit.ts` (`--before`, `--after`, `--fit`, weapon ids) plays every clip of every weapon at
60 Hz. It reports the max penetration and the proxy/shape pair, the % of frames over 2 mm and over 1 mm, the
idle palm, finger and support gaps, and the solver ms per frame. `contact.test.ts` enforces:

- hold clips (idle, shoot, shootLast, swapIn/Out): ≤ 2 mm and ≤ 0.5 % of frames over 1 mm;
- reloads, mag check and inspect: a regression ceiling only (known gap);
- idle contacts within 3 mm (support hand, firing palm). k47s and p17 have the looser palm limits noted in
  the test.

## Known gaps

- Reload, mag-check and inspect clips still spike to 10–25 mm for a few frames. These are support-hand fingers
  squeezed between a held mag and the well or handguard. The fix is per-phase baked hand poses for "mag hold"
  and "well hold".
- On the AR grips the firing hand's middle finger only wraps to about 8 mm, because its proximal phalanx sits
  under the trigger guard. On the k47s, the folded stock struts sit in the thumb web, so the gun gives way
  ~2 cm.
- Hand↔hand: the firing hand is an obstacle group (`WeaponCollision.setHand`) and the support hand yields to it,
  so the hands no longer overlap. The pistol two-hand grip is still not a baked thumbs-forward hold, though:
  after yielding, the support hand sits beside the firing hand instead of wrapping it.
- The middle-finger bake can still kink at PIP. Tighter joint ranges cost too much wrap on the bigger grips.
- The firing index only rests along the frame (knuckle-led close to touch). There is no trigger-face target
  driven by the fire state yet.
- Cost is about 1.4 ms/frame headless, over the 0.3 ms target. Most of it is bisection over the slab boxes.
  Fewer, merged boxes and caching per-hand candidate sets across frames are the next step.
- Debug: `?contact` in game, or `anim.html?mode=rig&contact=both&overlay=1&at=grip|mag|support&az=…`.
