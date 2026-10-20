"""Per-family texture atlas bake (Cycles CPU).

All baked objects of a family share one UV space (smart project → average island scale → pack). Passes:
  albedo (emission): kind colour × procedural variation, worn convex edges → wear colour (bevel-normal edge mask ×
                     AO convexity × noise breakup), light cavity darkening
  mask   (emission): finish mask (1 = runtime finish colour) minus worn edges        → albedo alpha
  rough/metal (emission): roughness variation (+ polish on wear), metal → wear metal
  ao     (AO bake):  short-range ambient occlusion                                     → ORM red
  normal (NORMAL):   micro-surface bumps per kind (stipple, grain, wood, polymer)
Writes <fam>_c.webp (RGBA sRGB albedo + mask), <fam>_orm.webp (AO, rough, metal), <fam>_n.webp (tangent normal).
"""
import math
import os

import bpy
import numpy as np

from . import kit, mats


def _uv(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.003, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")


def _img(name, size, alpha=False):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=True)
    im.colorspace_settings.name = "Non-Color"
    return im


def _pattern(nt, kind, coord):
    """Height pattern (0..1) for a bump kind."""
    N = nt.nodes
    L = nt.links
    if kind == "stipple":
        v = N.new("ShaderNodeTexVoronoi")
        v.distance = "CHEBYCHEV"
        v.feature = "F1"
        v.inputs["Scale"].default_value = 620.0
        v.inputs["Randomness"].default_value = 0.0
        L.new(coord, v.inputs["Vector"])
        r = N.new("ShaderNodeMapRange")
        r.inputs["From Min"].default_value = 0.34
        r.inputs["From Max"].default_value = 0.26
        L.new(v.outputs["Distance"], r.inputs["Value"])
        return r.outputs["Result"], 1.0
    if kind == "wood":
        w = N.new("ShaderNodeTexWave")
        w.wave_type = "BANDS"
        w.bands_direction = "Z"
        w.inputs["Scale"].default_value = 60.0
        w.inputs["Distortion"].default_value = 8.0
        w.inputs["Detail"].default_value = 4.0
        L.new(coord, w.inputs["Vector"])
        return w.outputs["Fac"], 0.12
    n = N.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = {"grain": 2200.0, "poly": 1400.0, "anod": 900.0}.get(kind, 1.0)
    n.inputs["Detail"].default_value = 2.0
    L.new(coord, n.inputs["Vector"])
    return n.outputs["Fac"], {"grain": 0.12, "poly": 0.08, "anod": 0.04}.get(kind, 0.0)


def _setup(m, k, img, mode):
    """Rebuild material m's node tree for one bake pass. mode: albedo | mask | rm | normal."""
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    N.active = tex
    tc = N.new("ShaderNodeTexCoord")
    coord = tc.outputs["Object"]
    if mode == "normal":
        h, strength = _pattern(nt, k["bump"], coord)
        bs = N.new("ShaderNodeBsdfPrincipled")
        if strength > 0:
            b = N.new("ShaderNodeBump")
            b.inputs["Strength"].default_value = strength
            b.inputs["Distance"].default_value = 0.0004
            L.new(h, b.inputs["Height"])
            L.new(b.outputs["Normal"], bs.inputs["Normal"])
        L.new(bs.outputs[0], out.inputs["Surface"])
        return
    # edge (convex) wear mask
    bev = N.new("ShaderNodeBevel")
    bev.samples = 8
    bev.inputs["Radius"].default_value = 0.0007
    geo = N.new("ShaderNodeNewGeometry")
    dot = N.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(bev.outputs["Normal"], dot.inputs[0])
    L.new(geo.outputs["Normal"], dot.inputs[1])
    edge = N.new("ShaderNodeMapRange")
    edge.inputs["From Min"].default_value = 0.985
    edge.inputs["From Max"].default_value = 0.9
    L.new(dot.outputs["Value"], edge.inputs["Value"])
    ao = N.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.004
    ao.samples = 8
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 260.0
    noise.inputs["Detail"].default_value = 6.0
    L.new(coord, noise.inputs["Vector"])
    nr = N.new("ShaderNodeMapRange")
    nr.inputs["From Min"].default_value = 0.42
    nr.inputs["From Max"].default_value = 0.62
    L.new(noise.outputs["Fac"], nr.inputs["Value"])
    w1 = N.new("ShaderNodeMath")
    w1.operation = "MULTIPLY"
    L.new(edge.outputs["Result"], w1.inputs[0])
    L.new(nr.outputs["Result"], w1.inputs[1])
    w2 = N.new("ShaderNodeMath")
    w2.operation = "MULTIPLY"
    w2.use_clamp = True
    L.new(w1.outputs[0], w2.inputs[0])
    aor = N.new("ShaderNodeMapRange")
    aor.inputs["From Min"].default_value = 0.7
    aor.inputs["From Max"].default_value = 0.95
    L.new(ao.outputs["AO"], aor.inputs["Value"])
    L.new(aor.outputs["Result"], w2.inputs[1])
    wear = N.new("ShaderNodeMath")
    wear.operation = "MULTIPLY"
    wear.use_clamp = True
    wear.inputs[1].default_value = k["wear"]
    L.new(w2.outputs[0], wear.inputs[0])
    em = N.new("ShaderNodeEmission")
    L.new(em.outputs[0], out.inputs["Surface"])
    # broad variation for albedo/roughness
    var = N.new("ShaderNodeTexNoise")
    var.inputs["Scale"].default_value = 90.0
    var.inputs["Detail"].default_value = 3.0
    L.new(coord, var.inputs["Vector"])
    if mode == "albedo":
        base = N.new("ShaderNodeMix")
        base.data_type = "RGBA"
        base.inputs["Factor"].default_value = 0.0
        col = (*k["col"], 1)
        if k["bump"] == "wood":
            h, _ = _pattern(nt, "wood", coord)
            g = N.new("ShaderNodeMix")
            g.data_type = "RGBA"
            g.inputs[6].default_value = (k["col"][0] * 0.55, k["col"][1] * 0.5, k["col"][2] * 0.45, 1)
            g.inputs[7].default_value = col
            L.new(h, g.inputs["Factor"])
            src = g.outputs[2]
        else:
            vm = N.new("ShaderNodeMapRange")
            vm.inputs["To Min"].default_value = 0.9
            vm.inputs["To Max"].default_value = 1.08
            L.new(var.outputs["Fac"], vm.inputs["Value"])
            cm = N.new("ShaderNodeVectorMath")
            cm.operation = "SCALE"
            cm.inputs[0].default_value = k["col"]
            L.new(vm.outputs["Result"], cm.inputs["Scale"])
            src = cm.outputs[0]
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        L.new(wear.outputs[0], mix.inputs["Factor"])
        L.new(src, mix.inputs[6])
        mix.inputs[7].default_value = (*k["wcol"], 1)
        # cavity darkening
        cav = N.new("ShaderNodeMapRange")
        cav.inputs["To Min"].default_value = 0.72
        L.new(ao.outputs["AO"], cav.inputs["Value"])
        mul = N.new("ShaderNodeVectorMath")
        mul.operation = "SCALE"
        L.new(mix.outputs[2], mul.inputs[0])
        L.new(cav.outputs["Result"], mul.inputs["Scale"])
        L.new(mul.outputs[0], em.inputs["Color"])
        del base
    elif mode == "mask":
        inv = N.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.use_clamp = True
        inv.inputs[0].default_value = float(k["mask"])
        L.new(wear.outputs[0], inv.inputs[1])
        L.new(inv.outputs[0], em.inputs["Color"])
    elif mode == "rm":
        rv = N.new("ShaderNodeMapRange")
        rv.inputs["To Min"].default_value = k["rough"] * 0.85
        rv.inputs["To Max"].default_value = min(1.0, k["rough"] * 1.18)
        L.new(var.outputs["Fac"], rv.inputs["Value"])
        rw = N.new("ShaderNodeMix")
        rw.data_type = "FLOAT"
        L.new(wear.outputs[0], rw.inputs["Factor"])
        L.new(rv.outputs["Result"], rw.inputs[2])
        rw.inputs[3].default_value = 0.3
        mw = N.new("ShaderNodeMix")
        mw.data_type = "FLOAT"
        L.new(wear.outputs[0], mw.inputs["Factor"])
        mw.inputs[2].default_value = k["metal"]
        mw.inputs[3].default_value = k["wmetal"]
        comb = N.new("ShaderNodeCombineXYZ")
        L.new(rw.outputs[0], comb.inputs["Y"])
        L.new(mw.outputs[0], comb.inputs["Z"])
        L.new(comb.outputs[0], em.inputs["Color"])


def _bake(objs, mlist, img, mode, typ="EMIT"):
    for m in mlist:
        _setup(m, mats.KINDS[m["kind"]], img, mode)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(type=typ, margin=6, use_clear=True, target="IMAGE_TEXTURES")
    if typ == "NORMAL":
        kw.update(normal_space="TANGENT")
    bpy.ops.object.bake(**kw)


def _px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _save_png(name, arr, path):
    """Write an RGB float array (0..1, already encoded) as an 8-bit PNG without any colour transform."""
    h, w = arr.shape[:2]
    rgba = np.dstack([arr[..., :3], np.ones((h, w), np.float32)])
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(rgba.astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def _webp(dst, rgb_png, alpha_png=None, quality=88):
    """PNG(s) → WebP with the system Python's Pillow (exact=True keeps RGB under alpha = 0)."""
    import subprocess

    code = ("import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');"
            "a=sys.argv[3] if len(sys.argv)>3 else '';"
            "im=(Image.merge('RGBA',(*im.split(),Image.open(a).convert('L'))) if a else im);"
            "im.save(sys.argv[2],quality=int(sys.argv[4]) if len(sys.argv)>4 else 88,method=6,exact=True)")
    args = ["python3", "-c", code, rgb_png, dst] + ([alpha_png, str(quality)] if alpha_png else [])
    subprocess.run(args, check=True)


def bake_family(fam, size=1024, samples=12):
    objs = [n["obj"] for n in kit.NODES.values() if n["family"] == fam]
    objs = [o for o in objs if any(s and s.get("kind") in mats.KINDS for s in o.data.materials)]
    if not objs:
        return
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bakeworld")
    sc.world.light_settings.distance = 0.012
    _uv(objs)
    mlist = []
    for o in objs:
        for s in o.data.materials:
            if s and s.get("kind") in mats.KINDS and s not in mlist:
                mlist.append(s)
    # snapshot the preview node trees? (materials are rebuilt per pass; the export only needs names)
    alb = _img(f"{fam}_alb", size)
    _bake(objs, mlist, alb, "albedo")
    msk = _img(f"{fam}_msk", size)
    _bake(objs, mlist, msk, "mask")
    rm = _img(f"{fam}_rm", size)
    _bake(objs, mlist, rm, "rm")
    aoi = _img(f"{fam}_ao", size)
    for m in mlist:
        _setup(m, mats.KINDS[m["kind"]], aoi, "normal")
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True, target="IMAGE_TEXTURES")
    nrm = _img(f"{fam}_nrm", size)
    _bake(objs, mlist, nrm, "normal", "NORMAL")
    A, M, R, O, Nn = (_px(i) for i in (alb, msk, rm, aoi, nrm))
    c = np.dstack([_srgb(A[..., 0]), _srgb(A[..., 1]), _srgb(A[..., 2])])
    msk = np.dstack([M[..., 0]] * 3)
    orm = np.dstack([0.35 + 0.65 * O[..., 0], R[..., 1], R[..., 2]])
    os.makedirs(kit.OUT, exist_ok=True)
    tmp = lambda n: os.path.join(kit.CACHE, f"{fam}_{n}.png")  # noqa: E731
    for n, arr in (("c", c), ("m", msk), ("orm", orm), ("n", Nn[..., :3])):
        _save_png(f"{fam}_{n}", arr, tmp(n))
    _webp(os.path.join(kit.OUT, f"{fam}_c.webp"), tmp("c"), tmp("m"))
    _webp(os.path.join(kit.OUT, f"{fam}_orm.webp"), tmp("orm"))
    _webp(os.path.join(kit.OUT, f"{fam}_n.webp"), tmp("n"))
    kit.FAMILIES.setdefault(fam, dict(materials={}))
    kit.FAMILIES[fam]["materials"]["kit_" + fam] = dict(
        kind="atlas", map=f"assets/models/weapons/{fam}_c.webp", orm=f"assets/models/weapons/{fam}_orm.webp",
        normal=f"assets/models/weapons/{fam}_n.webp", mask="alpha")
    print(f"[bake] {fam}: {len(objs)} objects, {len(mlist)} kinds, {size}px")
