"""Grip seat of the procedural model (where the authored hand clips hold the grip) → profiles/<w>_gripseat.json.

    bun tools/blender/weapons/dump_procedural.ts sb16          # → .cache/proc_sb16.glb
    blender -b --python tools/blender/weapons/ref/seat.py -- sb16 z0 z1 ytop yfit ybot [yband]

Horizontal sections of the procedural static mesh between ytop and ybot inside the z window give the grip's side
outline (front/back strap per height, three.js weapon frame). The kit grips are lofted on it (centreline and angle
kept, thinned to the hand envelope), so the asset sits where the hand already is.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:]
w = argv[0]
z0, z1, ytop, yfit, ybot = map(float, argv[1:6])
yband = float(argv[6]) if len(argv) > 6 else ybot + 0.004  # bottom of the line-fit band (above the bottom taper)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "..", ".cache", f"proc_{w}.glb"))
segs = []
for o in bpy.context.scene.objects:
    if o.type != "MESH" or not o.name.startswith(("static", "weapon")):
        continue
    mw = o.matrix_world
    segs.append(([mw @ v.co for v in o.data.vertices], [tuple(e.vertices) for e in o.data.edges]))
rows = []
y = ytop
while y >= ybot - 1e-9:
    zs = []
    for vs, es in segs:
        for a, b in es:
            pa, pb = vs[a], vs[b]
            if (pa.z - y) * (pb.z - y) > 0 or pa.z == pb.z:
                continue
            p = pa.lerp(pb, (y - pa.z) / (pb.z - pa.z))
            if z0 <= -p.y <= z1:
                zs.append(-p.y)
    if zs:
        rows.append((y, min(zs), max(zs)))
    y -= 0.002
# Rows above yfit can include the trigger guard / receiver: fit front and back strap lines on the clean band and
# extrapolate the front strap above it (the grip top is buried in the receiver anyway).
band = [r for r in rows if yfit >= r[0] >= yband]


def fit(pts):
    n = len(pts)
    my = sum(p[0] for p in pts) / n
    mz = sum(p[1] for p in pts) / n
    b = sum((p[0] - my) * (p[1] - mz) for p in pts) / sum((p[0] - my) ** 2 for p in pts)
    return lambda y: mz + b * (y - my)


front = fit([(r[0], r[1]) for r in band])
rows = [(r[0], front(r[0]) if r[0] > yfit else r[1], r[2]) for r in rows]
n = len(band)
my = sum(r[0] for r in band) / n
mz = sum((r[1] + r[2]) / 2 for r in band) / n
b = sum((r[0] - my) * ((r[1] + r[2]) / 2 - mz) for r in band) / sum((r[0] - my) ** 2 for r in band)
angle = math.degrees(math.atan(-b))
poly = [(r[1], r[0]) for r in rows] + [(r[2], r[0]) for r in reversed(rows)]
out = dict(weapon=w, angle=angle, centre=[mz, my], rows=rows, poly=poly)
path = os.path.join(HERE, "..", "profiles", f"{w}_gripseat.json")
with open(path, "w") as f:
    json.dump(out, f, indent=1)
print(f"[seat] {w}: {len(rows)} rows, angle {angle:.1f}°, centre z {mz*1000:.1f} y {my*1000:.1f} mm → {path}")
for r in rows[::4]:
    print(f"  y={r[0]*1000:+.1f} z[{r[1]*1000:+.1f},{r[2]*1000:+.1f}]")
