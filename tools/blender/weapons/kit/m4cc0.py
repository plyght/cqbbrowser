"""CC0 M4A1 base mesh for the AR family (3dmodelscc0.com "M4A1 Assault Rifle", CC0, via OpenGameArt
https://opengameart.org/content/m4a1-assault-rifle — see assets/ATTRIBUTION.md).

Replaces the parametric receiver, A2 grip, carbine stock, 30-rd mag, A2 flash hider and the moving receiver
parts (charging handle, dust cover, bolt, trigger, selector) with the CC0 meshes and their PBR texture set
(public/assets/models/weapons/m4cc0_*.webp). Fitted into our AR frame by translation only (its scale matches
published M4 dimensions): bore → BORE_Y, upper-receiver front → the catalog's receiverFrontZ.
"""
import os

import bpy
from mathutils import Matrix, Vector

from . import kit, lib, src

HERE = os.path.dirname(os.path.abspath(__file__))
FBX = os.path.join(HERE, "..", "src", "m4a1_cc0", "M4A1.fbx")
DY = 0.03 - 0.0205  # CC0 barrel axis → BORE_Y
DZ = -0.005  # CC0 upper front (z -0.100) → receiverFrontZ (-0.105)
W = "assets/models/weapons/"


def _replace(name, obj, fam, **kw):
    """Swap the registered node `name` for obj (same catalog name)."""
    old = kit.NODES.pop(name, None)
    if old:
        lib.delete(old["obj"])
    obj.name = name
    obj.data.name = name
    kit.node(obj, fam, **kw)
    return obj


def apply(fam):
    mat = bpy.data.materials.get("m4cc0") or bpy.data.materials.new("m4cc0")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=FBX)
    objs = {}
    new = list(set(bpy.data.objects) - before)
    meshes = [o for o in new if o.type == "MESH"]
    worlds = {o.name: o.matrix_world.copy() for o in meshes}
    for o in meshes:
        o.parent = None
        o.data.transform(worlds[o.name])
        o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        o.data.transform(Matrix.Translation(lib.T(0, DY, DZ)))
        o.data.materials.clear()
        o.data.materials.append(mat)
        for c in o.users_collection:
            c.objects.unlink(o)
        lib._coll.objects.link(o)
        objs[o.name.split(".")[0]] = o

    # Base = upper + lower + pins/controls + pistol grip → receiver / grip
    def cls_base(mn, mx):
        return "grip" if mn[1] < -0.1 + DY and mn[2] > 0.03 + DZ else "recv"

    base = src.split(objs["Base"], cls_base)
    for n in ("Switch1", "Switch2"):
        lib.delete(objs[n])
    recv = src.join_objs([base["recv"]], "recv")
    src.set_pivot(recv, (0, 0, 0), "recv")
    # trigger-finger rest on the lower: ≤ 12.5 mm half-width (z +35…+68 mm, y +4…+7 mm)
    print("[m4cc0] receiver half-width at the finger rest %.1f mm → 12.5" % (lib.thin_x(recv, 0.035, 0.068, 0.0, 0.011, 0.0125) * 1000))
    _replace("ar_upper", recv, fam, proxy_slices=4)
    old = kit.NODES.pop("ar_lower", None)
    if old:
        lib.delete(old["obj"])
    for w in ("sb16", "hb300"):
        kit.BASES[w]["nodes"] = [e for e in kit.BASES[w]["nodes"] if e["node"] not in ("ar_lower", "ar_magrelease", "ar_boltcatch")]
    for n in ("ar_magrelease", "ar_boltcatch"):
        old = kit.NODES.pop(n, None)
        if old:
            lib.delete(old["obj"])
    grip = src.set_pivot(base["grip"], (0, 0, 0), "g")
    fit = lib.fit_grip(grip, 0.027, 0.043, 25, -0.05)
    print("[m4cc0] A2 grip w×d %.1f×%.1f → %.1f×%.1f mm" % tuple(x * 1000 for x in fit))
    _replace("ar_grip_a2", grip, fam, proxies=lib.obb_proxies(grip, 3, angle_deg=25))

    # Barrel object: keep only the A2 birdcage (anchor 'muzzle': rear at z = 0)
    def cls_barrel(mn, mx):
        return "fh" if mx[2] < -0.495 + DZ else "rest"

    bar = src.split(objs["Barrel"], cls_barrel)
    lib.delete(bar["rest"])
    fh = bar["fh"]
    fmn, fmx = src.bbox3(fh)
    fh.data.transform(Matrix.Translation(lib.T(0, 0, -fmx[2])))
    tip = fmn[2] - fmx[2]
    _replace("ar_fh_a2", fh, fam, sockets={"muzzle": (0, lib.B, tip)},
             proxies=[dict(type="capsule", a=[0, lib.B, 0], b=[0, lib.B, round(tip, 5)], r=0.0115)])

    # Stock (anchor 'butt': rear at z = 0)
    st = objs["Stock"]
    smn, smx = src.bbox3(st)
    st.data.transform(Matrix.Translation(lib.T(0, 0, -smx[2])))
    _replace("ar_stock_carbine", st, fam, sockets={"stock": (0, lib.B - 0.03, 0)}, proxy_slices=2)

    # Magazine (part `mag`, pivot at the origin): the 30-rd GI and PMAG slots share it
    mag = objs["Magazine"]
    _replace("ar_mag_s30", mag, fam, proxy_slices=3)
    pm = mag.copy()
    pm.data = mag.data.copy()
    lib._coll.objects.link(pm)
    _replace("ar_mag_p30", pm, fam, proxy_slices=3)

    # Moving parts at their real pivots
    ch = objs["Charging_Handle"]
    cmn, cmx = src.bbox3(ch)
    src.set_pivot(ch, (0, (cmn[1] + cmx[1]) / 2, cmx[2]), "ch")
    _replace("ar_ch", ch, fam, sockets={"chargingHandle": (0, cmx[1], cmx[2] - 0.004)})
    lid = objs["Ejector_Lid"]
    lmn, lmx = src.bbox3(lid)
    src.set_pivot(lid, (lmx[0], lmn[1], (lmn[2] + lmx[2]) / 2), "dc")
    _replace("ar_dustcover", lid, fam)
    bolt = objs["Ejector_2"]
    bmn, bmx = src.bbox3(bolt)
    src.set_pivot(bolt, (0, lib.B, (bmn[2] + bmx[2]) / 2), "bolt")
    _replace("ar_bolt", bolt, fam)
    tr = objs["Trigger"]
    tmn, tmx = src.bbox3(tr)
    src.set_pivot(tr, (0, tmx[1] - 0.002, tmx[2] - 0.004), "tr")
    _replace("ar_trigger", tr, fam)
    sel = objs["Firemode_Selector"]
    emn, emx = src.bbox3(sel)
    src.set_pivot(sel, (0, (emn[1] + emx[1]) / 2, (emn[2] + emx[2]) / 2), "sel")
    _replace("ar_safety", sel, fam)
    for n in ("Sight", "Sight_2"):
        lib.delete(objs[n])
    kit.FAMILIES[fam]["materials"]["m4cc0"] = dict(kind="source", map=W + "m4cc0_c.webp", orm=W + "m4cc0_orm.webp",
                                                   normal=W + "m4cc0_n.webp")
    return Vector((lmn[0], lmn[1], lmn[2]))
