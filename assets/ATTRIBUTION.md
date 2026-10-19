# Asset attribution

Every external asset in the repo is listed here with its source and license.

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
