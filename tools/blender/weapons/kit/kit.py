"""Kit registry + export: nodes (one Blender object each), part/base entries, collision proxies, catalog JSON.

Catalog (public/assets/models/weapons/catalog.json), all coordinates in the three.js weapon frame:
  families[fam]  = { glb, materials: { <gltf material name>: { kind: 'atlas'|'source'|'special', maps... } } }
  nodes[name]    = { family, pivot, tris, bounds:[min,max], proxies:[...], sockets?:{name:[x,y,z]} }
  parts[partId]  = [ { node, anchor, part?, parent?, scale? } ]      (attachment part id → placed nodes)
  bases[weapon]  = { nodes:[{node, part?, parent?}], sockets:{...}, anchors:{...}, layout?:{...} }
Anchors are resolved at runtime from the build layout (src/weapons/models/kit.ts); a base may override them.
Proxies (node-local, three frame): {type:'box', c:[x,y,z], h:[hx,hy,hz]} | {type:'capsule', a:[..], b:[..], r}.
"""
import json
import math
import os
import subprocess

import bpy
from mathutils import Vector

from . import lib

NODES = {}
PARTS = {}
BASES = {}
FAMILIES = {}

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "weapons")
CACHE = os.path.join(ROOT, "tools", "blender", "weapons", ".cache")


def r5(v):
    return [round(float(x), 5) for x in v]


def node(obj, family, sockets=None, proxies=None, proxy_slices=None):
    """Register a finished object as a kit node. sockets are in the WEAPON frame (converted to node-local)."""
    obj["family"] = family
    piv = Vector(obj.location)
    p3 = (piv.x, piv.z, -piv.y)
    loc = {}
    for k, v in (sockets or {}).items():
        loc[k] = r5((v[0] - p3[0], v[1] - p3[1], v[2] - p3[2]))
    NODES[obj.name] = dict(obj=obj, family=family, sockets=loc, proxies=proxies, slices=proxy_slices)
    FAMILIES.setdefault(family, dict(materials={}))
    return obj


def part(pid, *entries):
    PARTS.setdefault(pid, []).extend(entries)


def entry(n, anchor="origin", part=None, parent=None, **kw):
    e = dict(node=n, anchor=anchor)
    if part:
        e["part"] = part
    if parent:
        e["parent"] = parent
    e.update(kw)
    return e


def base(weapon, entries, sockets=None, anchors=None, **kw):
    BASES[weapon] = dict(nodes=entries, sockets={k: r5(v) for k, v in (sockets or {}).items()},
                         anchors={k: r5(v) for k, v in (anchors or {}).items()}, **kw)


# ------------------------------------------------------------------ collision proxies


def local_pts(o):
    return [(v.co.x, v.co.z, -v.co.y) for v in o.data.vertices]


def auto_proxies(o, slices=None):
    """Boxes from slicing the node along its longest axis (curved mags/grips get several)."""
    pts = local_pts(o)
    if not pts:
        return []
    mn = [min(p[k] for p in pts) for k in range(3)]
    mx = [max(p[k] for p in pts) for k in range(3)]
    ext = [mx[k] - mn[k] for k in range(3)]
    ax = max(range(3), key=lambda k: ext[k])
    second = sorted(ext)[1]
    n = slices or max(1, min(4, round(ext[ax] / max(1e-4, 2.2 * second))))
    out = []
    for i in range(n):
        a = mn[ax] + ext[ax] * i / n
        b = mn[ax] + ext[ax] * (i + 1) / n
        sl = [p for p in pts if a - 1e-6 <= p[ax] <= b + 1e-6]
        if len(sl) < 3:
            continue
        lo = [min(p[k] for p in sl) for k in range(3)]
        hi = [max(p[k] for p in sl) for k in range(3)]
        out.append(dict(type="box", c=r5([(lo[k] + hi[k]) / 2 for k in range(3)]), h=r5([(hi[k] - lo[k]) / 2 for k in range(3)])))
    return out


def auto_proxies_where(o, pred, slices=2):
    """auto_proxies over the vertices selected by pred(p3) (weapon frame), node-local output."""
    loc = o.location
    p0 = (loc.x, loc.z, -loc.y)
    pts = [p for p in local_pts(o) if pred((p[0] + p0[0], p[1] + p0[1], p[2] + p0[2]))]
    return _boxes(pts, slices)


def _boxes(pts, slices):
    if not pts:
        return []
    mn = [min(p[k] for p in pts) for k in range(3)]
    mx = [max(p[k] for p in pts) for k in range(3)]
    ext = [mx[k] - mn[k] for k in range(3)]
    ax = max(range(3), key=lambda k: ext[k])
    out = []
    for i in range(slices):
        a = mn[ax] + ext[ax] * i / slices
        b = mn[ax] + ext[ax] * (i + 1) / slices
        sl = [p for p in pts if a - 1e-6 <= p[ax] <= b + 1e-6]
        if len(sl) < 3:
            continue
        lo = [min(p[k] for p in sl) for k in range(3)]
        hi = [max(p[k] for p in sl) for k in range(3)]
        out.append(dict(type="box", c=r5([(lo[k] + hi[k]) / 2 for k in range(3)]), h=r5([(hi[k] - lo[k]) / 2 for k in range(3)])))
    return out


def bounds(o):
    pts = local_pts(o)
    return [r5([min(p[k] for p in pts) for k in range(3)]), r5([max(p[k] for p in pts) for k in range(3)])]


# ------------------------------------------------------------------ export


def consolidate(o, fam):
    """Replace bakeable material slots by the family atlas material (one primitive per real material)."""
    from . import mats

    atlas = bpy.data.materials.get("kit_" + fam) or bpy.data.materials.new("kit_" + fam)
    names = []
    remap = []
    for s in o.data.materials:
        k = s["kind"] if s and "kind" in s else None
        tgt = atlas if (k in mats.KINDS) else s
        if tgt not in names:
            names.append(tgt)
        remap.append(names.index(tgt))
    for p in o.data.polygons:
        p.material_index = remap[p.material_index] if p.material_index < len(remap) else 0
    o.data.materials.clear()
    for m in names:
        o.data.materials.append(m)


def export_family(fam, extra_materials=None):
    objs = [n["obj"] for n in NODES.values() if n["family"] == fam]
    for o in objs:
        print(f"[kit]   {o.name}: {len(o.data.vertices)} verts")
    for o in objs:
        consolidate(o, fam)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(CACHE, f"{fam}_raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=raw, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_image_format="NONE", export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_animations=False, export_skins=False, export_morph=False,
        export_extras=False, export_attributes=False,
    )
    dst = os.path.join(OUT, f"{fam}.glb")
    subprocess.run(["bunx", "--bun", "gltfpack", "-i", raw, "-o", dst, "-cc", "-kn", "-km", "-noq"],
                   check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    FAMILIES[fam]["glb"] = f"assets/models/weapons/{fam}.glb"
    FAMILIES[fam]["bytes"] = os.path.getsize(dst)
    for o in objs:
        n = NODES[o.name]
        piv = o.location
        n["pivot"] = r5((piv.x, piv.z, -piv.y))
        n["tris"] = sum(len(p.vertices) - 2 for p in o.data.polygons)
        n["bounds"] = bounds(o)
        n["proxiesOut"] = n["proxies"] if n["proxies"] is not None else auto_proxies(o, n["slices"])
    print(f"[kit] {fam}: {len(objs)} nodes, {sum(NODES[o.name]['tris'] for o in objs)} tris, {FAMILIES[fam]['bytes']} B")


def write_catalog():
    path = os.path.join(OUT, "catalog.json")
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
    cat = dict(version=1, families=old.get("families", {}), nodes=old.get("nodes", {}), parts=old.get("parts", {}),
               bases=old.get("bases", {}))
    # families rebuilt in this run replace their old nodes/parts
    rebuilt = set(FAMILIES)
    cat["nodes"] = {k: v for k, v in cat["nodes"].items() if v["family"] not in rebuilt}
    for fam, f in FAMILIES.items():
        cat["families"][fam] = {k: v for k, v in f.items()}
    for name, n in NODES.items():
        if "pivot" not in n:
            continue
        d = dict(family=n["family"], pivot=n["pivot"], tris=n["tris"], bounds=n["bounds"], proxies=n["proxiesOut"])
        if n["sockets"]:
            d["sockets"] = n["sockets"]
        cat["nodes"][name] = d
    for pid, es in PARTS.items():
        cat["parts"][pid] = es
    for w, b in BASES.items():
        cat["bases"][w] = b
    # drop part/base entries that point at nodes that no longer exist
    cat["parts"] = {k: v for k, v in cat["parts"].items() if all("{" in e["node"] or e["node"] in cat["nodes"] for e in v)}
    with open(path, "w") as f:
        json.dump(cat, f, indent=1, sort_keys=True)
    print("[kit] catalog:", len(cat["nodes"]), "nodes,", len(cat["parts"]), "parts,", len(cat["bases"]), "bases")
