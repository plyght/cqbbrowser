# Asset attribution

Every file under `public/assets/**` (and, once the repo is private, `assets/audio/pro/**`) must be covered by a row in
a table below. `bun run check:assets` (also run in CI) fails on unlisted files, on licenses other than **CC0, CC-BY,
OFL, MIT or `generated`**, and on any `pro` (Sonniss) file while the repo is public (`SHORTBARREL_PUBLIC=1`). See
PRD §10.3 and the header of `tools/check-assets.ts`.

- **Path**: a file or glob (`*`, `**`, `{a,b}`), relative to the repo root.
- **Source**: where it came from (URL), or the script that generates it.
- **License**: `CC0-1.0`, `CC-BY-4.0` (credit the author below the table), `OFL-1.1`, `MIT`, or `generated`.
- **Set**: `open` (ships while the repo is public) or `pro` (Sonniss, private repo only).

Append your rows to the matching section; one row per pack/source is fine.

## Fonts

| Path                                                     | Source                                                                                                                  | License | Set  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| `public/assets/fonts/oswald-latin-*-normal.*`            | https://github.com/googlefonts/OswaldFont via https://www.npmjs.com/package/@fontsource/oswald (5.3.0)                  | OFL-1.1 | open |
| `public/assets/fonts/share-tech-mono-latin-400-normal.*` | https://fonts.google.com/specimen/Share+Tech+Mono via https://www.npmjs.com/package/@fontsource/share-tech-mono (5.3.0) | OFL-1.1 | open |
| `public/assets/fonts/cinzel-latin-900-normal.*`          | https://github.com/NDISCOVER/Cinzel via https://www.npmjs.com/package/@fontsource/cinzel (5.3.0)                        | OFL-1.1 | open |

Oswald: Copyright 2016 The Oswald Project Authors. Share Tech Mono: Copyright 2012 Carrois Type Design. Cinzel:
Copyright 2020 The Cinzel Project Authors. All under the SIL Open Font License 1.1 (https://openfontlicense.org).
Cinzel is only used by `tools/brand/build-brand.ts` (outlined into the patch SVG); the UI loads Oswald and Share Tech
Mono.

## Brand (generated)

| Path                 | Source                                                                                            | License   | Set  |
| -------------------- | ------------------------------------------------------------------------------------------------- | --------- | ---- |
| `public/brand/*.svg` | `tools/brand/build-brand.ts` (original UMBRA CO. artwork; text outlined from the OFL fonts above) | generated | open |

## Textures, models, HDRIs

| Path                            | Source                                                                                                                                                                                                                                                                    | License   | Set  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| `public/assets/models/ak74u/*`  | "AK74U \| FREE ANIMATION." by BURNER — https://sketchfab.com/3d-models/ak74u-free-animation-2ab66220c48b465e9501067667965569 (FBX → GLB via FBX2glTF + meshopt; textures → 2K WebP, glossiness inverted to roughness). Arms are a Mixamo character embedded in the model. | CC-BY-4.0 | open |
| `public/assets/models/hands/*`  | Godot XR Tools hand models by DigitalN8m4r3 (Miodrag Sejic), made with MakeHuman CE — https://github.com/GodotVR/godot-xr-tools/tree/master/addons/godot-xr-tools/hands (glTF → GLB via gltf-transform, textures → 1K WebP)                                               | CC0-1.0   | open |
| `public/assets/textures/*.webp` | https://polyhaven.com (per-texture sources in "Textures" detail section below)                                                                                                                                                                                            | CC0-1.0   | open |

## Audio (open set)

| Path                          | Source                                                                                                                                     | License | Set  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---- |
| `public/assets/audio/open/**` | Freesound CC0 + Kenney CC0, built by `tools/audio/process.ts` from `tools/audio/sources.ts` (per-file sources in the detail section below) | CC0-1.0 | open |

## Audio (pro set: Sonniss, private repo only)

| Path | Source | License | Set |
| ---- | ------ | ------- | --- |

---

# Detail (per-source credits)

## Audio — `open` set (`public/assets/audio/open/`)

Built by `bun tools/audio/process.ts` from the list in `tools/audio/sources.ts` (trimmed, faded, normalised,
encoded to Opus `.webm` + AAC `.m4a`). Each Freesound licence is re-checked on the sound's page by
`tools/audio/freesound.ts` before download (HQ preview files). Anything not listed here is procedural
(`src/audio/synth.ts`, `src/audio/ir.ts`): steel modal synthesis, pressure layer, mechanical layers, IRs, wind,
body thumps, tinnitus, beeps, scuffs and fallbacks.

| Source                                                                                                                                                               | Author        | Licence | Output files                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- | ----------------------------------------------------------------------------------------- |
| [AR15 rifle shot](https://freesound.org/people/michorvath/sounds/427596/)                                                                                            | michorvath    | CC0 1.0 | rep-ar15-0                                                                                |
| [AR15 pistol shot](https://freesound.org/people/michorvath/sounds/427598/)                                                                                           | michorvath    | CC0 1.0 | rep-ar15p-0                                                                               |
| [Rifle Gun Shot AK47. close recording in a shooting range.](https://freesound.org/people/felix.blume/sounds/136399/)                                                 | felix.blume   | CC0 1.0 | rep-ak-0 … rep-ak-4                                                                       |
| [ak 47 - single shot.mp3](https://freesound.org/people/ninebilly/sounds/520934/)                                                                                     | ninebilly     | CC0 1.0 | rep-ak-5                                                                                  |
| [Single Pistol Gunshot 3.wav](https://freesound.org/people/morganpurkis/sounds/385811/)                                                                              | morganpurkis  | CC0 1.0 | rep-p9-0                                                                                  |
| [Single Pistol Gunshot 4.2.wav](https://freesound.org/people/morganpurkis/sounds/391846/)                                                                            | morganpurkis  | CC0 1.0 | rep-p9-1                                                                                  |
| [Single Pistol Gunshot 2.wav](https://freesound.org/people/morganpurkis/sounds/371440/)                                                                              | morganpurkis  | CC0 1.0 | rep-p9-2                                                                                  |
| [Silenced Gunshot.wav](https://freesound.org/people/morganpurkis/sounds/369781/)                                                                                     | morganpurkis  | CC0 1.0 | rep-sup-0                                                                                 |
| [Silenced Gunshot 2.wav](https://freesound.org/people/morganpurkis/sounds/380185/)                                                                                   | morganpurkis  | CC0 1.0 | rep-sup-1                                                                                 |
| [Silenced Gunshot 3.wav](https://freesound.org/people/morganpurkis/sounds/381569/)                                                                                   | morganpurkis  | CC0 1.0 | rep-sup-2                                                                                 |
| [Silenced Gunshot 4.wav](https://freesound.org/people/morganpurkis/sounds/396015/)                                                                                   | morganpurkis  | CC0 1.0 | rep-sup-3                                                                                 |
| [Brass bullet shell casing drop onto concrete, multiple takes](https://freesound.org/people/GrayJoy/sounds/210102/)                                                  | GrayJoy       | CC0 1.0 | brass-conc-0 … brass-conc-5                                                               |
| [AR15 M4 Gun Hardware Magazine Movement Sounds](https://freesound.org/people/jackthemurray/sounds/393732/)                                                           | jackthemurray | CC0 1.0 | rl-r-release-0/1, rl-r-out-0/1, rl-r-in-0/1, rl-r-seat-0/1, rl-r-check-0/1, rl-r-bolt-0/1 |
| [Assault Rifle Reload](https://freesound.org/people/qubodup/sounds/815879/)                                                                                          | qubodup       | CC0 1.0 | rl-r-out-q-0, rl-r-in-q-0, rl-r-seat-q-0, rl-r-bolt-q-0                                   |
| [G17 Handling 01](https://freesound.org/people/qubodup/sounds/844184/)                                                                                               | qubodup       | CC0 1.0 | rl-p-slide-g-0                                                                            |
| [G17 Handling 02](https://freesound.org/people/qubodup/sounds/844185/)                                                                                               | qubodup       | CC0 1.0 | rl-p-release-0                                                                            |
| [G17 Handling 03](https://freesound.org/people/qubodup/sounds/844186/)                                                                                               | qubodup       | CC0 1.0 | rl-p-in-g3-0                                                                              |
| [G17 Handling 04](https://freesound.org/people/qubodup/sounds/844187/)                                                                                               | qubodup       | CC0 1.0 | rl-p-check-0                                                                              |
| [G17 Handling 06](https://freesound.org/people/qubodup/sounds/844189/)                                                                                               | qubodup       | CC0 1.0 | rl-p-seat-0                                                                               |
| [G17 Handling 07](https://freesound.org/people/qubodup/sounds/844190/)                                                                                               | qubodup       | CC0 1.0 | rl-p-out-g-0                                                                              |
| [G17 Handling 08](https://freesound.org/people/qubodup/sounds/844191/)                                                                                               | qubodup       | CC0 1.0 | rl-p-in-0                                                                                 |
| [Taurus G2c Magazine Release](https://freesound.org/people/NoonerBear/sounds/589845/)                                                                                | NoonerBear    | CC0 1.0 | rl-p-release-t-0/1, rl-p-out-0…2, rl-p-seat-t-0/1                                         |
| [Taurus G2c Slide Racking](https://freesound.org/people/NoonerBear/sounds/589849/)                                                                                   | NoonerBear    | CC0 1.0 | rl-p-slide-0…3                                                                            |
| [Magazine Hitting Surface.wav](https://freesound.org/people/MootMcnoodles/sounds/444402/)                                                                            | MootMcnoodles | CC0 1.0 | mag-hard-mag                                                                              |
| [Beretta M9 hammer click](https://freesound.org/people/vabadus/sounds/151068/)                                                                                       | vabadus       | CC0 1.0 | dry-0                                                                                     |
| [Hiking Boot Footsteps on Gravel](https://freesound.org/people/Fission9/sounds/521588/)                                                                              | Fission9      | CC0 1.0 | step-gravel-0 … step-gravel-3                                                             |
| [Footsteps On Tile](https://freesound.org/people/IENBA/sounds/834027/)                                                                                               | IENBA         | CC0 1.0 | step-tile-0, step-tile-1                                                                  |
| [Typical spring birdsong](https://freesound.org/people/rubindaniel/sounds/844820/)                                                                                   | rubindaniel   | CC0 1.0 | amb-outdoor-1                                                                             |
| [Early Spring Atmos Outside atmosphere Birds Air Distant Traffic Town 01](https://freesound.org/people/DeeryJ/sounds/788065/)                                        | DeeryJ        | CC0 1.0 | amb-outdoor-0                                                                             |
| [Kenney Impact Sounds 1.0](https://kenney.nl/assets/impact-sounds) (footstep_concrete/wood/carpet/grass, impactGeneric_light, impactMetal_light, impactPlank_medium) | Kenney        | CC0 1.0 | step-conc/wood/carpet/grass-0…4, mag-hard/metal/wood-0…4                                  |
| [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) (metalClick, metalLatch, cloth1–4)                                                                            | Kenney        | CC0 1.0 | click-0, click-1, cloth-0 … cloth-3                                                       |

The Free Firearm Sound Library (CC0, [OpenGameArt](https://opengameart.org/content/the-free-firearm-sound-library))
was the first choice for reports, but opengameart.org returned HTTP 500 for every request during the build; the
Freesound CC0 recordings above stand in. Swapping in that library later is a `sources.ts` data change.

Audit (`bun tools/audio/audit.ts`, title/tag check per source): the first open set's reload foley (serøutōnin
M16 and Glock sequences) was dropped because its scrape-heavy slices read as watery/splashy; so were Kenney
`footstep_snow` (was standing in for dirt) and `impactSoft` (was standing in for a mag on soft ground). Those
categories now use the clean sources above or procedural fallbacks.

## Textures (`public/assets/textures/`)

All from [Poly Haven](https://polyhaven.com) — **CC0** (public domain). Downloaded at 1K via the keyless
API (`https://api.polyhaven.com/files/<id>`), resized/re-encoded to WebP (diffuse 1024², normal 512²).
Grass and plywood diffuse maps were brightened (ImageMagick `-modulate`).

| File                             | Poly Haven asset  | URL                                       |
| -------------------------------- | ----------------- | ----------------------------------------- |
| `gravel_{diff,nor}.webp`         | gravel_floor_02   | https://polyhaven.com/a/gravel_floor_02   |
| `concrete_pad_{diff,nor}.webp`   | brushed_concrete  | https://polyhaven.com/a/brushed_concrete  |
| `concrete_dusty_{diff,nor}.webp` | concrete_floor_02 | https://polyhaven.com/a/concrete_floor_02 |
| `berm_dirt_{diff,nor}.webp`      | brown_mud_dry     | https://polyhaven.com/a/brown_mud_dry     |
| `grass_{diff,nor}.webp`          | sparse_grass      | https://polyhaven.com/a/sparse_grass      |
| `plywood_{diff,nor}.webp`        | plywood           | https://polyhaven.com/a/plywood           |

Everything else in the world (steel paint, paper targets, signage, plywood sheet seams) is generated in
code at runtime.

## CC-BY credits

- **AK74U | FREE ANIMATION.** by **BURNER** (Sketchfab), licensed CC BY 4.0 — https://sketchfab.com/3d-models/ak74u-free-animation-2ab66220c48b465e9501067667965569. Modified: format conversion, texture resize/re-encode, retargeted/blended animation in game.
