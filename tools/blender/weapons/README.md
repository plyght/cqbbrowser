# Weapon parts kit (Blender)

Builds `public/assets/models/weapons/<family>.glb` + atlases + `catalog.json` for `src/weapons/models/kit.ts`.

```sh
tools/setup-blender.sh                                   # Blender 4.2 LTS, headless
bun tools/blender/weapons/extract_sources.ts             # BURNER Krinkov + Beretta → .cache/src_*.glb (our frame)
<venv>/bin/python tools/blender/weapons/ref/trace.py p17 <photo-dir>   # photo → profiles/p17.json (needs opencv)
blender -b --python tools/blender/weapons/build_kit.py -- [k47 p92 p17 ar kp9 acc] [--nobake] [--size 2048]
```

- `kit/lib.py` hard-surface helpers in the three.js weapon frame (prisms, sweeps, lathes, lofts, boolean cuts,
  arrayed cutters for rail slots / M-LOK / serrations, bevel + harden normals + weighted normals).
- `kit/fam_*.py` one module per family; `kit/kit.py` registry, collision proxies, GLB export (gltfpack meshopt via
  `bunx gltfpack`, `-kn -km -noq` so node names and pivots survive), catalog writer; `kit/bake.py` Cycles atlas bake
  (albedo + finish mask, ORM, normal; edge wear from a bevel-normal mask × AO convexity).
- **Reference photos** (not committed; sources in `ref/guns.py`): Glock 17 Gen 4 (MOD, OGL v1.0), M4 carbine
  (US Army PEO Soldier, public domain), HK MP5 (Wikimedia Commons). `ref/trace.py` scales each photo to published
  dimensions and traces part regions; `ref/verify.py` + `ref/compare.py` render the built model in the same ortho
  view and report the silhouette IoU (+ overlay / side-by-side PNGs).
- K-47S and P-92 reuse the CC-BY BURNER meshes and textures (see `assets/ATTRIBUTION.md`), split per bone and
  per connected component, shifted onto `BORE_Y`.
