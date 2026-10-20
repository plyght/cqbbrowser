"""Render a built gun in ortho side view aligned to its reference photo (silhouette + textured beauty).

blender -b --python tools/blender/weapons/ref/verify.py -- <gun> <glb> <node,node,...> [--finish r,g,b] [--side left]

Writes .cache/sil_<gun>.png and .cache/beauty_<gun>.png at half the photo resolution; ref/compare.py turns them into
the IoU number, the 50% overlay and the photo|beauty side-by-side. The saved .cache/verify_<gun>.blend has the photo
as a 50%-opacity reference image empty aligned to the same ortho view.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
CACHE = os.path.join(HERE, "..", ".cache")
argv = sys.argv[sys.argv.index("--") + 1:]
gun, glb, nodes = argv[0], argv[1], argv[2].split(",")
# "node@dz" places an anchored node (handguard, stock, muzzle device) at z = dz in the weapon frame
offsets = {n.split("@")[0]: float(n.split("@")[1]) for n in nodes if "@" in n}
nodes = [n.split("@")[0] for n in nodes]
finish = (0.035, 0.035, 0.037)
for i, a in enumerate(argv):
    if a == "--finish":
        finish = tuple(float(x) for x in argv[i + 1].split(","))
prof = json.load(open(os.path.join(HERE, "..", "profiles", f"{gun}.json")))
W, H = prof["size"]
s = prof["pxPerM"]
wx, wy = prof["webPx"]
bore = prof["boreRow"]
B = 0.03

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
keep = set(nodes)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.name in offsets:
        o.location.y -= offsets[o.name]  # three z → blender -y
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.render.resolution_x = W // 2
sc.render.resolution_y = H // 2
sc.view_settings.view_transform = "Standard"
cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = max(W, H) / s
co = bpy.data.objects.new("cam", cam)
sc.collection.objects.link(co)
zc = (W / 2 - wx) / s
yc = B + (bore - H / 2) / s
# mirrored photos show the gun's right side: render from the right, compare.py mirrors the result
FLIP = bool(prof.get("flip"))
co.location = (1.0 if FLIP else -1.0, -zc, yc)
co.rotation_euler = (1.5708, 0, 1.5708 if FLIP else -1.5708)
sc.camera = co

# reference image empty (50 %), for the saved verification scene
img_path = os.path.join(CACHE, f"photo_{gun}.png")
if os.path.exists(img_path):
    e = bpy.data.objects.new("ref_photo", None)
    e.empty_display_type = "IMAGE"
    e.data = bpy.data.images.load(img_path)
    e.empty_display_size = W / s
    e.color[3] = 0.5
    e.use_empty_image_alpha = True
    e.location = (-0.2, -zc, yc)
    e.rotation_euler = (1.5708, 0, -1.5708)
    sc.collection.objects.link(e)

meshes = [o for o in sc.objects if o.type == "MESH"]
orig = {o.name: list(o.data.materials) for o in meshes}

# 1) silhouette
white = bpy.data.materials.new("sil")
white.use_nodes = True
nt = white.node_tree
nt.nodes.clear()
em = nt.nodes.new("ShaderNodeEmission")
out = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(em.outputs[0], out.inputs[0])
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(white)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 0.0
sc.world = w
sc.cycles.samples = 2
sc.cycles.use_denoising = False
sc.render.filepath = os.path.join(CACHE, f"sil_{gun}.png")
bpy.ops.render.render(write_still=True)
# front silhouette (looking down the bore from the muzzle), 0.1 m square, 1000 px
FS = 0.1
fcam = bpy.data.cameras.new("front")
fcam.type = "ORTHO"
fcam.ortho_scale = FS
fco = bpy.data.objects.new("front", fcam)
sc.collection.objects.link(fco)
fco.location = (0, 1.0, B - 0.02)
fco.rotation_euler = (1.5708, 0, 3.14159)
sc.camera = fco
rx, ry = sc.render.resolution_x, sc.render.resolution_y
sc.render.resolution_x = sc.render.resolution_y = 1000
sc.render.filepath = os.path.join(CACHE, f"silf_{gun}.png")
bpy.ops.render.render(write_still=True)
sc.render.resolution_x, sc.render.resolution_y = rx, ry
sc.camera = co

# 2) beauty: runtime-equivalent material from the atlas (albedo × finish where mask, ORM, normal)
fam = os.path.splitext(os.path.basename(glb))[0].replace("_raw", "")
maps = {k: os.path.join(ROOT, "public", "assets", "models", "weapons", f"{fam}_{k}.webp") for k in ("c", "orm", "n")}


def atlas_mat():
    m = bpy.data.materials.new("atlas")
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bs = N["Principled BSDF"]
    if not os.path.exists(maps["c"]):
        bs.inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)
        bs.inputs["Roughness"].default_value = 0.5
        return m
    c = N.new("ShaderNodeTexImage")
    c.image = bpy.data.images.load(maps["c"])
    orm = N.new("ShaderNodeTexImage")
    orm.image = bpy.data.images.load(maps["orm"])
    orm.image.colorspace_settings.name = "Non-Color"
    nm = N.new("ShaderNodeTexImage")
    nm.image = bpy.data.images.load(maps["n"])
    nm.image.colorspace_settings.name = "Non-Color"
    fin = N.new("ShaderNodeMixRGB")
    fin.inputs["Color1"].default_value = (1, 1, 1, 1)
    fin.inputs["Color2"].default_value = (*finish, 1)
    L.new(c.outputs["Alpha"], fin.inputs["Fac"])
    mul = N.new("ShaderNodeMixRGB")
    mul.blend_type = "MULTIPLY"
    mul.inputs["Fac"].default_value = 1.0
    L.new(c.outputs["Color"], mul.inputs["Color1"])
    L.new(fin.outputs["Color"], mul.inputs["Color2"])
    L.new(mul.outputs["Color"], bs.inputs["Base Color"])
    sep = N.new("ShaderNodeSeparateColor")
    L.new(orm.outputs["Color"], sep.inputs[0])
    L.new(sep.outputs[1], bs.inputs["Roughness"])
    L.new(sep.outputs[2], bs.inputs["Metallic"])
    nmap = N.new("ShaderNodeNormalMap")
    L.new(nm.outputs["Color"], nmap.inputs["Color"])
    L.new(nmap.outputs[0], bs.inputs["Normal"])
    return m


atlas = atlas_mat()
special = {"glass": (0.6, 0.7, 0.75, 1), "lens": (0.2, 0.06, 0.3, 1), "reticle": (1, 0.1, 0.05, 1), "lightLens": (0.9, 0.9, 0.85, 1)}
for o in meshes:
    o.data.materials.clear()
    for mt in orig[o.name]:
        if mt and mt.name.split(".")[0] in special:
            o.data.materials.append(mt)
        else:
            o.data.materials.append(atlas)
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
# 3/4 beauty camera (~30° yaw off the left side, slight elevation) + 3-point lighting
import math  # noqa: E402

from mathutils import Vector  # noqa: E402

pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (lo + hi) / 2
size = (hi - lo).length
bc = bpy.data.cameras.new("beauty")
bc.lens = 85
bc.sensor_width = 36
bco = bpy.data.objects.new("beauty", bc)
sc.collection.objects.link(bco)
yaw, el = math.radians(30), math.radians(14)
d = size * 2.15
dirv = Vector(((1 if FLIP else -1) * math.cos(yaw) * math.cos(el), -math.sin(yaw) * math.cos(el), math.sin(el)))
bco.location = ctr + dirv * d
bco.rotation_euler = (-dirv).to_track_quat("-Z", "Y").to_euler()
sc.camera = bco


def area(name, loc, energy, sz, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = sz
    ld.color = color
    lo_ = bpy.data.objects.new(name, ld)
    lo_.location = ctr + Vector(loc)
    lo_.rotation_euler = (ctr - lo_.location).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(lo_)


k = size
area("key", (-1.2 * k, -0.9 * k, 1.1 * k), 1.4 * k * k / 0.0625, 1.6 * k)
area("fill", (-1.0 * k, 1.2 * k, -0.2 * k), 0.7 * k * k / 0.0625, 2.0 * k, (0.85, 0.9, 1.0))
area("rim", (1.3 * k, 0.3 * k, 0.9 * k), 1.6 * k * k / 0.0625, 1.2 * k)
sc.cycles.samples = int(next((argv[i + 1] for i, a in enumerate(argv) if a == "--samples"), 48))
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.filepath = os.path.join(CACHE, f"beauty34_{gun}.png")
bpy.ops.render.render(write_still=True)
# same ortho side view + scale as the photo (key light from the camera side for this one)
sc.camera = co
for o in sc.objects:
    if o.type == "LIGHT" and o.name.startswith("key"):
        o.location = ctr + Vector(((1.4 if FLIP else -1.4) * k, -0.4 * k, 0.9 * k))
        o.rotation_euler = (ctr - o.location).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = os.path.join(CACHE, f"beauty_{gun}.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, f"verify_{gun}.blend"))
