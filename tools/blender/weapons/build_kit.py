"""Build the weapon parts kit: model → bake atlases → export GLB per family → update the catalog.

    blender -b --python tools/blender/weapons/build_kit.py -- [family ...] [--nobake] [--size 1024] [--blend out.blend]

Families: k47 (BURNER Krinkov, split), p92 (BURNER Beretta, split), p17, ar, kp9, acc. Default: all.
Run tools/blender/weapons/extract_sources.ts first (bun) for k47/p92, and ref/trace.py for photo profiles.
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from kit import bake, kit  # noqa: E402

ALL = ["k47", "p92", "p17", "ar", "kp9", "acc"]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
fams = [a for a in argv if not a.startswith("--") and a in ALL] or ALL
nobake = "--nobake" in argv
size = int(next((argv[i + 1] for i, a in enumerate(argv) if a == "--size"), 1024))
blend = next((argv[i + 1] for i, a in enumerate(argv) if a == "--blend"), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.scale_length = 1.0
for fam in fams:
    mod = importlib.import_module(f"kit.fam_{fam}")
    mod.build()
    if not nobake and getattr(mod, "BAKE", True):
        bake.bake_family(fam, size=getattr(mod, "SIZE", size))
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend.replace(".blend", f"_{fam}.blend"))
    kit.export_family(fam)
# "none" choices and parts with no geometry of their own
for pid in ("opt_none", "mag_none", "off_none", "buis_none", "light_none", "laser_none", "fg_none", "sling_none",
            "sling_single", "sling_two", "fin_black", "fin_fde", "fin_od", "fin_grey"):
    kit.part(pid)
kit.write_catalog()
