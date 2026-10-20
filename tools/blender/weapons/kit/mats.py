"""Material kinds of the kit. Each Blender material is named after its kind; bake.py turns the parameters into the
family atlas (albedo + finish mask, AO/roughness/metal, normal). Special kinds (glass, lens, reticle, lightLens) are
not baked: the runtime gives them their own shared materials.

Fields: col = linear albedo (for `mask` kinds this is a neutral modulation, the runtime multiplies the build's finish
colour in), rough, metal, mask (1 = takes the finish colour), wear (edge-wear strength), wcol/wmetal = what worn edges
show, bump = micro-surface pattern baked into the normal map.
"""
import bpy

KINDS = {
    # finish-coloured aluminium (anodize / cerakote): albedo is a modulation map, edges wear to bare aluminium
    "anod": dict(col=(0.92, 0.92, 0.92), rough=0.46, metal=0.0, mask=1, wear=1.0, wcol=(0.62, 0.62, 0.63), wmetal=1.0, bump="anod"),
    # finish-coloured polymer (pistol frames): no metal underneath
    "polyFin": dict(col=(0.9, 0.9, 0.9), rough=0.62, metal=0.0, mask=1, wear=0.25, wcol=(1.25, 1.25, 1.25), wmetal=0.0, bump="poly"),
    "polyFinGrip": dict(col=(0.85, 0.85, 0.85), rough=0.75, metal=0.0, mask=1, wear=0.15, wcol=(1.2, 1.2, 1.2), wmetal=0.0, bump="stipple"),
    "phos": dict(col=(0.052, 0.052, 0.05), rough=0.6, metal=0.35, mask=0, wear=0.7, wcol=(0.32, 0.32, 0.32), wmetal=1.0, bump="grain"),
    "nitride": dict(col=(0.075, 0.075, 0.08), rough=0.42, metal=1.0, mask=0, wear=0.8, wcol=(0.45, 0.45, 0.45), wmetal=1.0, bump="none"),
    "blued": dict(col=(0.028, 0.03, 0.036), rough=0.34, metal=0.7, mask=0, wear=0.8, wcol=(0.4, 0.4, 0.42), wmetal=1.0, bump="grain"),
    "steel": dict(col=(0.32, 0.32, 0.32), rough=0.3, metal=1.0, mask=0, wear=0.3, wcol=(0.6, 0.6, 0.6), wmetal=1.0, bump="grain"),
    "alu": dict(col=(0.55, 0.55, 0.56), rough=0.38, metal=1.0, mask=0, wear=0.0, wcol=(0.6, 0.6, 0.6), wmetal=1.0, bump="none"),
    "poly": dict(col=(0.032, 0.032, 0.033), rough=0.62, metal=0.0, mask=0, wear=0.35, wcol=(0.09, 0.09, 0.09), wmetal=0.0, bump="poly"),
    "polyGrip": dict(col=(0.03, 0.03, 0.031), rough=0.78, metal=0.0, mask=0, wear=0.2, wcol=(0.08, 0.08, 0.08), wmetal=0.0, bump="stipple"),
    "rubber": dict(col=(0.022, 0.022, 0.022), rough=0.88, metal=0.0, mask=0, wear=0.0, wcol=(0.05, 0.05, 0.05), wmetal=0.0, bump="poly"),
    "can": dict(col=(0.045, 0.045, 0.043), rough=0.72, metal=0.1, mask=0, wear=0.4, wcol=(0.2, 0.2, 0.2), wmetal=0.8, bump="anod"),
    "wood": dict(col=(0.3, 0.13, 0.05), rough=0.5, metal=0.0, mask=0, wear=0.35, wcol=(0.45, 0.25, 0.12), wmetal=0.0, bump="wood"),
    "plum": dict(col=(0.2, 0.055, 0.04), rough=0.42, metal=0.0, mask=0, wear=0.3, wcol=(0.3, 0.1, 0.07), wmetal=0.0, bump="poly"),
    "bakelite": dict(col=(0.16, 0.045, 0.02), rough=0.38, metal=0.0, mask=0, wear=0.3, wcol=(0.25, 0.08, 0.04), wmetal=0.0, bump="poly"),
    "dark": dict(col=(0.01, 0.01, 0.01), rough=0.9, metal=0.0, mask=0, wear=0.0, wcol=(0.01, 0.01, 0.01), wmetal=0.0, bump="none"),
    "white": dict(col=(0.8, 0.8, 0.78), rough=0.5, metal=0.0, mask=0, wear=0.0, wcol=(0.8, 0.8, 0.8), wmetal=0.0, bump="none"),
}
SPECIAL = {
    "glass": (0.6, 0.7, 0.75),
    "lens": (0.25, 0.08, 0.35),
    "reticle": (1.0, 0.1, 0.05),
    "lightLens": (0.9, 0.9, 0.85),
}


def get(kind):
    m = bpy.data.materials.get(kind)
    if m:
        return m
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    if kind in KINDS:
        k = KINDS[kind]
        c = k["col"] if not k["mask"] else (0.05, 0.05, 0.05)
        bs.inputs["Base Color"].default_value = (*c, 1)
        bs.inputs["Roughness"].default_value = k["rough"]
        bs.inputs["Metallic"].default_value = k["metal"]
    else:
        c = SPECIAL.get(kind, (1, 0, 1))
        bs.inputs["Base Color"].default_value = (*c, 1)
        bs.inputs["Roughness"].default_value = 0.05
    m["kind"] = kind
    return m
