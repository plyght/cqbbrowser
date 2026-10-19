# Firearm physics (`src/physics/ballistics`)

Interior, external and terminal ballistics plus the physical recoil impulse. Pure math (no three.js) except
`debug.ts`; the bus router is `src/weapons/Ballistics.ts`; cartridge data is `src/weapons/ammo`.

Run `bun tools/ballistics-table.ts` for the validation tables (the same rows `ballistics.test.ts` asserts).

## Pipeline per shot

1. `shot` event → `Ballistics.fire`. The def is `shot.def ?? WEAPONS[weaponId]`; per-build constants (load,
   muzzle velocity, zero angle, dispersion, recoil) are cached by `def.model`.
2. `shot.dir` is treated as the **sight line** unless `shot.zeroed` is true: the bore is tilted up by
   `computeBoreAngle(zero, def.sightHeight, ammo, v0)` (rifles 50 m, pistols 25 m). This gives the real
   mechanical offset: at 3–7 m rounds land ~one sight height low, on the line at the zero.
3. `Ballistics.hold?(dir, tick, weaponId)` lets the handling layer add hold error; then mechanical
   dispersion (MOA of weapon ⊕ ammo, σ = ES/3) and, for buckshot, the choke pattern per pellet. All random
   draws come from an RNG seeded by `(tick, shot#, pellet)` → replays are deterministic.
4. Flight: RK4 point-mass with G1/G7 drag (ICAO atmosphere), advanced in chords whose sagitta stays under
   5 mm (`chordTime`), one raycast per chord. CQB: ~1–3 raycasts per shot. Everything within 50 m is traced
   on the firing tick; beyond that impacts arrive at their real time of flight (`fixedUpdate`).
5. Hits: `impact` event (+ `ricochet` vector, `speed`, `massKg`), then `HitListener.onHit(hit, dir, energy,
info)`. Not absorbed → ricochet test (critical grazing angle by material/nose/speed) or Poncelet
   perforation of the collider (`tag.penetrable` = authored material thickness, else the geometric path
   to the exit face). Survivors emit an `impact` with `exit: true`, get exit-deflection jitter, yaw/tumble
   (more drag, bigger presented area next time) and continue. Steel (AR500) never perforates; it logs a
   spall fan and the round stops (training rule: no ricochet damage).

## Recoil API (for the handling sim)

```ts
import { recoilFor, recoilForWeapon, sampleRecoil } from '../physics/ballistics/recoil';
const r = recoilFor(def /* or a WeaponBuild */); // cached
// also on the event: bus.on('shot', s => s.recoil) — Ballistics fills it before later listeners run,
// and the emitter can read `payload.recoil` after emit() returns.
```

`RecoilProfile`:

| field                                                    | meaning                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `impulseNs`                                              | free-recoil impulse I = m_b·v + m_gas·v_gas (N·s), after the muzzle device   |
| `velocity`, `energyJ`, `gunMassKg`                       | free recoil V = I/M, E = I²/2M of the whole gun                              |
| `profile[]`                                              | impulse packets `{ t, fx, fy, torque, kind }` (see below); Σfx = `impulseNs` |
| `boreOffset`                                             | bore height over the grip origin (model frame, m): the muzzle-rise lever     |
| `boreOverShoulder`, `shoulderZ`                          | bore over the butt-pad centre and butt z (shouldered builds)                 |
| `muzzleZ`                                                | muzzle tip z (model frame) — where `fy` acts                                 |
| `action`, `movingMassKg`, `carrierVelocity`, `cycleTime` | operating system character                                                   |
| `components`                                             | `bullet`, `gas`, `jet` (muzzle-jet share), `downforce` (brake/comp)          |

Packets are impulses in the **weapon model frame** (-z forward, y up, origin at the grip):

- `fx` (N·s): along the bore, + = rearward (toward the shooter), acting on the bore line at `y = boreOffset`.
- `fy` (N·s): vertical at the muzzle (`z = muzzleZ`), + = up. Brakes/comps give negative `fy`.
- `torque` (N·m·s): convenience angular impulse about the grip origin's x axis, + = muzzle up
  (`fx·boreOffset + fy·(−muzzleZ)`). If you apply `fx`/`fy` at their points on your rigid body, ignore it.
- `kind`: `bore` (bullet + gas column, 0 → bullet exit), `gas` (muzzle jet), then the action's internal
  exchange, which **sums to zero** but shapes the feel: `unlock` (carrier/slide takes momentum, forward
  on the receiver), `spring`, `bottom` (carrier/slide hits the stop — the sharp secondary), `return`,
  `slam` (into battery, forward).

Apply with `sampleRecoil(r, t0, t1, out)` per physics sub-step (t = seconds since the shot); windows that
tile time fire each packet exactly once. Timings: AR ~0.5 ms bore, unlock ~0.7 ms, bottom ~22 ms, slam
~72 ms; AK bottoms harder (no buffer); pistol: the slide takes ~60% at t=0, frame-stop hit ~5–7 ms, slam
~23 ms.

Muzzle devices: brake −65% jet + slight downforce; comp −25% jet + strong downforce; suppressor/integral
+5–8% jet (blast removed), more mass (in `def.mass`), +10–20% carrier speed (back-pressure).

## Other exports

- `computeBoreAngle(zeroM, sightHeightM, ammo, v0?)`, `pointOfImpact(range, sightHeight, boreAngle, ammo, v0)`
  (`trajectory.ts`) — for ADS/zeroing UI.
- `muzzleState(cartridge, inches)` (`weapons/ammo/interior.ts`) — velocity, energy, momentum, `subsonic`,
  `pressureRel` (blast). Build stats carry `velocity`, `ammo`, `muzzleEnergy`, `subsonic`;
  `BuildParams.ammo` picks the load; `BarrelPart.velocityMul` models ported barrels (KP-9 SD → subsonic).
- `steelImpulse(m, v, cosθ, construction)` / `restitution(v)` (`steel.ts`) — J = m·v·cosθ·(1+e), e ∝ v^-¼.
  The steel targets use it via `world/steel/momentum.ts#hitImpulse`.
- `?ballistics` URL flag (or `__sb.ballistics.enableDebug()`): draws the last 24 trajectories, exits
  (green), ricochets (orange), stops (red), steel + spall (yellow). `__sb.ballistics.traces()` returns them.
