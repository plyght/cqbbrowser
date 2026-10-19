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

| Path | Source | License | Set |
| ---- | ------ | ------- | --- |

## Audio (open set)

| Path | Source | License | Set |
| ---- | ------ | ------- | --- |

## Audio (pro set: Sonniss, private repo only)

| Path | Source | License | Set |
| ---- | ------ | ------- | --- |
