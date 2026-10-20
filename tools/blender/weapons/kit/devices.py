"""Muzzle devices shared by the families: bare thread cap, 3-prong flash hider, brake, comp, suppressor can."""
import math

from . import kit, lib
from .lib import B, box, cut, cyl, join, lathe


def device(fam, did, L, R, kind, metal="phos", part=None):
    """Muzzle device / can on a barrel muzzle at z = 0 (anchor 'muzzle'), bore at BORE_Y."""
    if kind == "bare":
        o = lathe(did, [(0.0039, 0), (R * 0.9, 0), (R * 0.9, -L + 0.002), (R * 0.75, -L), (0.0039, -L)], 20, B, 0, metal, 0.0003)
        parts = [o]
    elif kind == "prong":
        o = lathe(did, [(0.0039, 0), (R * 0.95, 0), (R, -0.004), (R, -L), (R * 0.5, -L), (0.0045, -0.02)], 24, B, 0, metal, 0.0003)
        for i in range(3):
            a = i * 2 * math.pi / 3
            c = box("s", 0.0028, 0.02, -0.022, -L - 0.01, 0, B + R * 0.7, mat=None, bevel=0)
            lib.xf(c, lib.Matrix.Translation((0, B, 0)) @ lib.Matrix.Rotation(a, 4, "Z") @ lib.Matrix.Translation((0, -B, 0)))
            cut(o, c)
        parts = [o]
    elif kind in ("brake", "comp"):
        w = R * 1.9
        o = box(did, w, w, 0, -L, 0, B, mat=metal, bevel=w * 0.25, seg=3)
        cut(o, cyl("bore", 0.0045, 0.01, -L - 0.01, B, 0, 12, None, 0))
        for i in range(3 if kind == "brake" else 2):
            zz = -L * (0.25 + i * 0.22)
            if kind == "brake":
                cut(o, box("p", 0.04, w * 0.6, zz, zz - L * 0.12, 0, B, mat=None, bevel=0))
            cut(o, box("t", w * 0.45, 0.02, zz, zz - L * 0.1, 0, B + w / 2, mat=None, bevel=0))
        parts = [o]
    else:  # suppressor / can
        collar = 0.03
        o = lathe(did, [(0.0039, 0.002), (0.0105, 0.002), (R * 0.8, -0.002), (R * 0.8, -collar + 0.002),
                        (R * 0.94, -collar), (R, -collar - 0.004), (R, -L + 0.006), (R * 0.9, -L), (0.0055, -L),
                        (0.0045, -L + 0.004)], 32, B, 0, "can", 0.0004)
        rings = [lathe("r", [(R * 0.8, -0.008 - i * 0.006), (R * 0.8 + 0.0009, -0.009 - i * 0.006), (R * 0.8, -0.01 - i * 0.006)],
                       24, B, 0, "can", 0) for i in range(3)]
        parts = [o, *rings]
    n = join(did, parts)
    kit.node(n, fam, sockets={"muzzle": (0, B, -L)}, proxies=[dict(type="capsule", a=[0, B, 0], b=[0, B, -L], r=R)])
    kit.part(did, kit.entry(did, anchor="muzzle", part=part))
