"""Quick orthographic workbench preview of one or more GLBs (side view from the right).

blender -b --python tools/blender/weapons/preview.py -- out.png a.glb [b.glb ...] [--ortho 0.8] [--center y,z]
"""
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
files = [a for a in argv[1:] if a.endswith(".glb")]
ortho = 0.8
center = (0.0, 0.0)
side = "right"
for i, a in enumerate(argv):
    if a == "--ortho":
        ortho = float(argv[i + 1])
    if a == "--center":
        center = tuple(float(x) for x in argv[i + 1].split(","))
    if a == "--side":
        side = argv[i + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
layer = {}
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    for o in set(bpy.data.objects) - before:
        layer[o.name] = i
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = int(next((argv[i + 1] for i, a in enumerate(argv) if a == "--samples"), 16))
sc.cycles.use_denoising = True
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.62, 0.66, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.world = world
for rot, e in (((0.9, 0.2, 0.8), 3.0), ((1.2, 0, -2.2), 1.5)):
    ld = bpy.data.lights.new("s", "SUN")
    ld.energy = e
    lo = bpy.data.objects.new("s", ld)
    lo.rotation_euler = rot
    sc.collection.objects.link(lo)
if "--mat" not in argv:
    grey = bpy.data.materials.new("grey")
    grey.use_nodes = True
    grey.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
    red = bpy.data.materials.new("red")
    red.use_nodes = True
    bs = red.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (1, 0.05, 0.02, 1)
    bs.inputs["Alpha"].default_value = 0.35
    for o in sc.objects:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(red if layer.get(o.name, 0) > 0 else grey)
sc.render.resolution_x = 1600
sc.render.resolution_y = 900
cam = bpy.data.cameras.new("c")
cam.type = "ORTHO"
cam.ortho_scale = ortho
co = bpy.data.objects.new("c", cam)
sc.collection.objects.link(co)
# Blender frame: three (x, y, z) -> (x, -z, y). Look from +x (shooter's right) toward -x.
if side == "right":
    co.location = (1.0, -center[0], center[1])
    co.rotation_euler = (1.5708, 0, 1.5708)
elif side == "left":
    co.location = (-1.0, -center[0], center[1])
    co.rotation_euler = (1.5708, 0, -1.5708)
elif side == "top":
    co.location = (0, -center[0], 1.0)
    co.rotation_euler = (0, 0, 1.5708)
elif side == "front":
    co.location = (0, 1.0, center[1])
    co.rotation_euler = (1.5708, 0, 3.14159)
elif side == "rear":
    co.location = (0, -1.0, center[1])
    co.rotation_euler = (1.5708, 0, 0)
sc.camera = co
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
