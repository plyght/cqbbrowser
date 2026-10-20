# Weapon models: parts & sockets contract

Procedural, parametric weapon models built in TypeScript (no external assets). Every model is
built from a **build** (`WeaponBuild`, see `../attachments/`), so the mesh, the stats and the
sockets always agree.

```ts
import { buildModel, buildModelFromBuild } from './models';
buildModel('sb16'); // default build of a weapon id
buildModel('sb16_lpvo'); // a preset id (attachments/presets.ts)
buildModel(def.model); // 'build:{json}' produced by applyBuild()
buildModelFromBuild(build, { detailParts: true });
```

Legacy keys `ar`, `pdw`, `ak`, `pistol` still work.

## Frame

- Metres, **-z forward** (muzzle), +y up, +x = shooter's right.
- **Origin at the grip** (top of the pistol grip, roughly the web of the firing hand).
- **Bore axis at `y = boreY` (0.03)** for every weapon, so `muzzleWorld()` style code can use
  `(0, boreY, muzzleZ)`. Prefer `sockets.muzzle`.

## `WeaponModel`

| field               | meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `root`              | `Group` to parent under the weapon view                                           |
| `muzzleZ`, `sightY` | legacy: muzzle tip z, primary sight axis y                                        |
| `boreY`             | bore axis height (0.03)                                                           |
| `parts`             | named `Object3D`s at their **pivots** (see below)                                 |
| `sockets`           | named `Object3D`s for attachments and hands (see below)                           |
| `sightLines`        | one per aim mode, in cycle order: primary → magnified → offset → irons            |
| `length`, `massKg`  | overall length in the current stock position, loaded mass (from the part catalog) |
| `stats`             | `{ drawCalls, triangles }` for perf budgeting                                     |
| `weapon`, `build`   | what was built                                                                    |
| `dispose()`         | frees geometry (materials are shared and stay alive)                              |

## Parts (animate these)

Each part is a `Group` whose origin is the pivot; meshes inside are offset so that rotating or
translating the group moves the part correctly. Rest pose = identity transform (position = pivot).

| part             | platforms                 | pivot / motion                                                                                                                                                                                                    |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mag`            | all                       | **at the model origin** (position 0,0,0) so the controller's `mag.position.y` offsets keep working; use `sockets.magwell` for the hand target. AK/KP-9 mags rock: rotate about the front lug in a child if needed |
| `chargingHandle` | AR, KP-9 (AK: pivot)      | AR: slides +z from the rear of the upper. KP-9: on the cocking tube, slides +z. AK: same object as the bolt carrier knob                                                                                          |
| `bolt`           | AR, AK (KP-9: pivot only) | AR: carrier visible through the open ejection port (the dust cover hangs open), slides +z. AK: carrier + handle, slides +z ≈ 0.09 m                                                                               |
| `slide`          | P-17                      | at origin; slides +z ≈ 0.03 m. Carries the optic, sights, barrel crown and muzzle device; `sockets.optic`/`chargingHandle`/`ejectionPort` and the sight lines are children of it                                  |
| `trigger`        | all                       | trigger pin; rotate about +x (pull = positive x rotation)                                                                                                                                                         |
| `safety`         | AR, AK, KP-9              | selector axis (AR/KP-9 left side, rotate about x; AK right-side lever, rotate about x at the rear pivot)                                                                                                          |
| `magRelease`     | all                       | button / paddle centre                                                                                                                                                                                            |
| `boltCatch`      | AR, P-17                  | lever pivot (left side)                                                                                                                                                                                           |
| `dustCover`      | AR                        | hinge rod                                                                                                                                                                                                         |
| `stock`          | AK                        | fold hinge (vertical axis at the left rear of the receiver); `params.stockFolded` pre-folds it                                                                                                                    |
| `magnifier`      | with `mag_3x`             | flip hinge on the left (rotate about z, ≈ +90° to flip aside)                                                                                                                                                     |

**Draw calls.** By default `trigger`, `safety`, `magRelease`, `boltCatch` and `dustCover` are
_pivot-only_ (their geometry is merged into the static mesh) to keep each weapon at ~8–12 draw calls.
Pass `{ detailParts: true }` to get them as separate meshes (+1 draw call each) when you animate them.
`mag`, `chargingHandle`/`bolt`, `slide`, AK `stock` and `magnifier` are always separate.

## Rounds in the mag (`magRounds.ts`, `magGeom.ts`)

`new MagRounds(model, def.caliber, def.magCapacity)` (the controller does this per equipped weapon) adds one
`InstancedMesh` named `magRounds` under `parts.mag` plus a `magFollower` plate under the last round (two extra draw
calls): a lathed brass case + projectile per
calibre (9 mm, 5.56, 5.45, .300 BLK, 7.62x39), laid from the feed lips down the mag's measured cavity (centre line
of its triangle cross-sections), double-stack stagger, turning with the curve. `set(n)` draws the top `n` rounds.
The mag's materials are cloned with real openings cut in the shader: open top between the lips, numbered-count
witness holes (Glock / Beretta back, with moulded counts drawn by the same shader; HK side), the PMAG window, none on
the AK; the inside renders as a dark cavity. The spring keeps the stack at the lips, so a part-empty mag shows brass
in the upper holes / window, the follower under the last round and dark holes below it.

## Sockets

| socket           | where                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `muzzle`         | muzzle tip on the bore axis (end of device/can); flash & tracer origin, -z out                                                                                                                           |
| `optic`          | top rail under the primary optic (or the rail centre when none)                                                                                                                                          |
| `offsetOptic`    | 45° offset mount position (rotated -45° about z for the right side)                                                                                                                                      |
| `underRail`      | bottom of the handguard / pistol dust-cover rail (rotated π about z)                                                                                                                                     |
| `sideRail`       | right side of the handguard (rotated -π/2 about z)                                                                                                                                                       |
| `light`          | weapon light lens (if fitted): spot-light origin, -z out                                                                                                                                                 |
| `stock`          | butt pad centre (shoulder contact) in the current stock position                                                                                                                                         |
| `gripRight`      | firing hand on the pistol grip (rotated by the grip angle about x)                                                                                                                                       |
| `gripLeft`       | support hand: on the handguard; depends on foregrip (vertical → on the grip, angled → thumb over it, handstop → just behind it, none → C-clamp forward). P-17: support-hand wrap on the left of the grip |
| `magwell`        | magwell mouth — reload hand target (mag base when inserted for the pistol)                                                                                                                               |
| `chargingHandle` | charging handle / slide serrations (racking hand target)                                                                                                                                                 |
| `ejectionPort`   | ejection port (brass spawn), right side                                                                                                                                                                  |

## Sight lines

`sightLines[i].node` sits at the rear of the sight on its optical axis; local -z looks downrange and
local +y is "up" for that sight (the offset dot is rolled -45°). `mode` (an `AimMode` from
`attachments/build.ts`) carries `magnification`, `sightHeight` over bore, `roll` (weapon cant needed
to use it) and `eyeRelief` (eye position = node + (0, 0, eyeRelief) in node space).

## Materials & performance

- Shared PBR materials (`materials.ts`): anodized black / tungsten grey, FDE & OD cerakote,
  phosphate & blued steel, bright steel, polymer (stipple normal), wood, bakelite, plum, rubber,
  suppressor finish, lens glass/coating, emissive reticle. Detail comes from generated canvas
  normal/roughness maps with box-projected UVs (constant texel density).
- Black anodize is modelled as a near-black satin dielectric (albedo ≈ 0.035, roughness ≈ 0.45);
  cerakote is matte and desaturated.
- **Edge wear / highlights:** every extrusion and beveled box gets a per-vertex edge factor from its
  bevel normals at build time (`setWear` in `geom.ts`). It travels in the `aux` attribute (x = edge,
  y = stipple boost), and a shared `onBeforeCompile` patch blends the finish toward bare aluminium/steel
  on those edges. Stippled grip panels (`M.polymerGrip`) use the y channel to strengthen the normal map,
  so they stay in the polymer draw call.
- Minor materials (slot/bore "dark", rubber, can finish, clear glass, grip stipple) are vertex-colour
  tints of a base material so they share its draw call.
- Static geometry is merged per material; rail teeth and M-LOK plates are merged geometry, not
  instances. Typical: 6–13 draw calls, 4–21k triangles per configured weapon.
- Metals read without a scene environment because the materials carry a generated studio
  equirect `envMap`; call `setWeaponEnvMap(pmremTexture)` to use the level's environment instead
  (or `null` to fall back to `scene.environment`).

## Parts kit (Blender GLBs)

The meshes come from a Blender-authored parts kit when it is loaded; the procedural builders above stay as the
synchronous fallback (headless tests, or any build with a part the kit doesn't have yet).

```ts
await preloadWeaponAssets(); // once at boot (Game.start, the bench); safe to call again
buildModel('sb16'); // still synchronous: assembled from kit nodes when every part is in the catalog
weaponAssetsReady(); // true after the preload
model.root.userData.kit; // true when the kit was used
kitProxies(model.root); // collision proxies of every placed node (with its weapon-frame matrix)
```

- **Pipeline** (`tools/blender/weapons/`, see its README): `extract_sources.ts` un-skins the CC-BY BURNER
  Krinkov/Beretta into our frame; `ref/trace.py` traces part outlines from scaled reference photos;
  `build_kit.py` models every family in Blender (profile prisms, lofted sections, lathes, boolean cuts with
  arrayed cutters, bevel + weighted normals), bakes one atlas per family and exports
  `public/assets/models/weapons/<family>.glb` (meshopt) + `catalog.json`.
- **Families**: `k47` (BURNER Krinkov, its own textures), `p92` (BURNER Beretta, its own textures), `p17`, `ar`
  (SB-16, HB-300), `kp9`, `acc` (optics, BUIS, lights, laser, foregrips).
- **Assembly** (`kit.ts`): the procedural build still runs first for pivots, sockets and sight lines (all from the
  layout); its meshes are then replaced by kit nodes placed at layout anchors (`origin`, `muzzle`, `gas`,
  `hgRear`, `butt`, `optic`, `magnifier`, `offset`, `buisRear`/`buisFront`, `light`, `laser`, `foregrip`) and
  merged per material per part group (moving parts stay separate). Sockets measured on an asset (base `sockets`,
  node `sockets`) override the layout ones, so hands land on the real mesh. Contract unchanged; additive: part
  `hammer` (P-92) and the P-92 weapon.
- **Atlas materials**: albedo (RGB, sRGB) with the finish mask in alpha (the runtime multiplies the build's finish
  colour there), ORM (AO, roughness, metalness: three's channel layout), tangent-space normal.

### Catalog (`public/assets/models/weapons/catalog.json`)

All coordinates in the weapon frame (metres, y up, -z forward, origin at the grip, bore at `BORE_Y`).

```jsonc
{
  "families": { "ar": { "glb": "assets/models/weapons/ar.glb", "materials": { "kit_ar": { "kind": "atlas", "map": "…_c.webp", "orm": "…", "normal": "…", "mask": "alpha" } } } },
  "nodes": { "ar_lower": { "family": "ar", "pivot": [0, 0, 0], "tris": 4200, "bounds": [[…], […]], "proxies": [ … ], "sockets": { … } } },
  "parts": {
    "ar_hg_mlok95": [{ "node": "ar_hg_mlok95", "anchor": "hgRear" }],
    "ar_b103": [{ "node": "ar_b103_{barrelProfile}", "anchor": "origin" }] // {slot} = that slot's part id
  },
  "bases": { "sb16": { "nodes": [{ "node": "ar_upper" }, { "node": "ar_bolt", "part": "bolt" }], "sockets": { … }, "anchors": { … } } }
}
```

### Collision proxies (for `src/anim/grip/shapes.ts`)

`nodes[n].proxies` are in **node-local** space (three frame; the node origin is its pivot):
`{ "type": "box", "c": [x, y, z], "h": [hx, hy, hz], "rx"?: angle }` (half extents; `rx` = rotation about +x for
raked grips, local -y running down the grip and local z = grip depth) or
`{ "type": "capsule", "a": [x, y, z], "b": [x, y, z], "r": r }`. Curved or raked parts (mags, grips, stocks,
receivers) get 2–4 boxes sliced along their long axis. `kitProxies(model.root)` returns them together with each
placed node's model-frame matrix (`matrix` = anchor × node), so shapes can be derived without reading meshes.
