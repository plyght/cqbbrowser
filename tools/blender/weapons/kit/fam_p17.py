"""P-17 (Glock 17 Gen 4 pattern), modelled over the traced left-profile photo (profiles/p17.json).

Side outlines come from the photo; widths and cross-sections from published dimensions (slide 25.5 mm, frame
30 mm at the grip, ~24 mm at the dust cover, 10 mm trigger guard). Pivots at the real pivots: trigger (trigger pin),
slide stop (front pin), mag release (button centre), slide/mag at the model origin (contract).
"""
import math

from . import kit, lib
from .lib import B, box, cut, cyl_x, done, join, prism
from .photo import Profile, bbox

FAM = "p17"
GRIP_ANGLE = math.radians(22)
# The traced pistol is authored muzzle-registered (muzzle at the procedural -0.171). In game the whole asset is
# shifted rearward so its backstrap sits where the authored hand clip holds the old procedural grip (backstrap
# sections matched over y -0.045..-0.080, mean 50 mm); the runtime applies it via the base `offset`. Platform
# frame values (catalog.ts p17) and the frame dict below are in the shifted (game) frame.
OFFSET_Z = 0.050
OLD_GRIP_RIGHT = (0.0, -0.0607, 0.0415)  # procedural gripRight socket the hand clip was authored against


def build():
    lib.set_collection(FAM)
    P = Profile("p17")
    mk = P.m
    top = mk("slideTop")[1]
    bot = mk("slideBottom")[1]
    front = mk("slideFront")[0]
    rear = mk("slideRear")[0]
    muzzle_z = front + 0.0012
    breech = muzzle_z + 0.114
    PORT = (breech + 0.002, breech - 0.041)  # ejection port rear/front edge (right-side photo proportions)
    W = 0.0255

    # ------------------------------------------------------------------ slide
    s = prism("slide", P.outer("slide"), W, mat="nitride", bevel=0.0009, seg=3)
    ch = 0.0019  # top-edge chamfer
    for sx in (-1, 1):
        a = ch * math.sqrt(2)
        c = box("c", a, a, rear + 0.01, front - 0.01, 0, 0, mat=None, bevel=0)
        lib.xf(c, lib.Matrix.Translation((sx * W / 2, top, 0)) @ lib.Matrix.Rotation(math.radians(45), 4, "Z"))
        cut(s, c)
    # rear serrations (both sides), 13 grooves
    zf, zr = mk("serrFront")[0], mk("serrRear")[0]
    n = 13
    pitch = (zr - zf) / n
    for sx in (-1, 1):
        g = box("g", 0.0016, top - bot - 0.0042, zf + pitch * 0.5 + 0.00055, zf + pitch * 0.5 - 0.00055,
                sx * (W / 2 + 0.0001), (top + bot) / 2 - 0.0002, mat=None, bevel=0)
        lib.array(g, n, (0, 0, pitch))
        cut(s, g)
    # ejection port (right side + top) and the barrel hood showing through it
    pz0, pz1 = PORT
    cut(s, box("port", 0.024, 0.02, pz0, pz1, 0.0105, top + 0.0045, mat=None, bevel=0))
    # extractor step (right side, behind the port)
    ext = box("ext", 0.0009, 0.0052, pz0 + 0.017, pz0 - 0.002, W / 2 + 0.0002, B + 0.0062, mat="steel", bevel=0.0003)
    # muzzle: barrel bore through the front face, recoil spring tunnel below it
    cut(s, lib.cyl("bh", 0.0071, front - 0.002, front + 0.004, B, 0, 24, None, 0))
    cut(s, lib.cyl("rh", 0.0043, front - 0.002, front + 0.006, bot + 0.0046, 0, 16, None, 0))
    done(s)
    hood = box("hood", 0.0168, top - B - 0.0012, pz0, pz1 + 0.001, 0, (top - 0.0012 + B) / 2, mat="steel", bevel=0.0006)
    barrel = lib.lathe("barrel", [(0.0045, front + 0.004), (0.0068, front + 0.004), (0.0068, muzzle_z + 0.0003),
                                  (0.0055, muzzle_z), (0.0045, muzzle_z)], 24, B, 0, "steel", 0.0)
    bore = lib.cyl("bore", 0.0045, muzzle_z + 0.0002, muzzle_z + 0.02, B, 0, 16, "dark", 0)
    guide = lib.cyl("guide", 0.0034, front + 0.003, front + 0.0006, bot + 0.0046, 0, 14, "steel", 0.0003)
    # sights: front post with a white dot, rear U-notch block
    fs = prism("fs", P.outer("frontSight"), 0.0034, mat="phos", bevel=0.0005)
    fz0, fz1, fy0, fy1 = bbox(P.outer("frontSight"))
    dot = box("dot", 0.0016, 0.0016, fz1 + 0.0002, fz1 - 0.0004, 0, fy1 - 0.0014, mat="white", bevel=0)
    rs = prism("rs", P.outer("rearSight"), 0.0102, mat="phos", bevel=0.0005)
    rz0, rz1, ry0, ry1 = bbox(P.outer("rearSight"))
    notch_bottom = fy1  # line of sight level with the post tip
    cut(rs, box("notch", 0.0033, 0.006, rz1 + 0.001, rz0 - 0.001, 0, notch_bottom + 0.003, mat=None, bevel=0))
    slide = join("p17_slide", [s, hood, ext, barrel, bore, guide, fs, dot, rs], pivot=(0, 0, 0))
    kit.node(slide, FAM)

    # ------------------------------------------------------------------ frame
    outer = P.outer("frame")
    f = prism("frame", outer, 0.0300, mat="polyFin", bevel=0.0012, seg=3, angle=35)
    for h in P.holes("frame"):
        cut(f, prism("hole", h, 0.05, mat=None, bevel=0))
    z_grip_front = mk("slideStopA")[0] - 0.0005
    guard_top = 0.0035
    # dust cover / upper frame 24.5 mm, frame top over the grip 26 mm, trigger guard 10 mm
    def thin(poly, w):
        for sx in (-1, 1):
            c = prism("thin", poly, 0.03, x=sx * (w / 2 + 0.015), mat=None, bevel=0)
            cut(f, c)

    thin([(front - 0.01, guard_top), (z_grip_front, guard_top), (z_grip_front, 0.03), (front - 0.01, 0.03)], 0.0245)
    thin([(z_grip_front, 0.0125), (rear + 0.02, 0.0125), (rear + 0.02, 0.03), (z_grip_front, 0.03)], 0.026)
    thin([(mk("guardFront")[0] - 0.01, guard_top), (-0.0565, guard_top), (-0.0565, -0.04),
          (mk("guardFront")[0] - 0.01, -0.04)], 0.0102)
    # accessory rail: side grooves + one cross slot
    rb = mk("railBottom")[1]
    for sx in (-1, 1):
        cut(f, box("rg", 0.0026, 0.0014, -0.119, front - 0.01, sx * 0.01225, 0.011, mat=None, bevel=0))
    cut(f, box("slot", 0.04, 0.005, -0.1458, -0.1497, 0, rb, mat=None, bevel=0))
    # rounded grip cross-section, rounded trigger guard, chamfered dust-cover bottom
    lib.round_edges(f, lambda m, a, b: m[1] < 0.002 and m[2] > -0.06 and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9)
                    and abs(m[0]) > 0.0135, 0.0052, 5)
    lib.round_edges(f, lambda m, a, b: m[1] < guard_top and -0.12 < m[2] < -0.0565 and abs(m[0]) > 0.004
                    and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), 0.0021, 3)
    lib.round_edges(f, lambda m, a, b: m[1] < 0.0125 and m[2] < -0.06 and m[1] > guard_top - 0.001 and abs(m[0]) > 0.01
                    and ((a[1] < -0.9 and abs(b[0]) > 0.9) or (b[1] < -0.9 and abs(a[0]) > 0.9)), 0.0017, 1)
    done(f)
    # grip texture: side/strap faces of the grip get the stippled material
    from . import mats
    f.data.materials.append(mats.get("polyFinGrip"))
    gi = len(f.data.materials) - 1
    for p in f.data.polygons:
        c = p.center  # blender coords
        z3, y3 = -c.y, c.z
        if y3 < -0.009 and z3 > -0.062 and abs(p.normal.z) < 0.9:
            p.material_index = gi
    pins = []
    for k, r, w in (("pinTrigger", 0.0016, 0.0249), ("pinBlock", 0.0016, 0.0249), ("pinRear", 0.0013, 0.0304)):
        z, y = mk(k)
        pins.append(cyl_x("pin", r, -w / 2, w / 2, y, z, 14, "steel", 0.0002))
    # slide-stop guard ledge (left) and takedown tabs (both sides)
    ledge = box("ledge", 0.0016, 0.004, -0.0313, -0.0489, -0.0128, 0.0118, mat="polyFin", bevel=0.0005)
    tds = []
    for sx in (-1, 1):
        t = box("td", 0.0012, 0.0095, -0.0795, -0.0873, sx * 0.0124, 0.0135, mat="phos", bevel=0.0004)
        g = box("tg", 0.003, 0.0006, -0.0790, -0.0880, sx * 0.0132, 0.0098, mat=None, bevel=0)
        lib.array(g, 4, (0, 0.0019, 0))
        cut(t, g)
        tds.append(t)
    frame = join("p17_frame", [f, ledge, *pins, *tds], pivot=(0, 0, 0))
    in_grip = lambda p: p[1] < -0.012 and p[2] > -0.062  # noqa: E731
    feather = lambda p: max(0.0, min(1.0, (-0.002 - p[1]) / 0.01)) if p[2] > -0.062 else 0.0  # noqa: E731
    fit = lib.fit_grip(frame, 0.030, 0.050, 22, -0.045, in_grip, feather)
    print("[p17] grip w×d %.1f×%.1f → %.1f×%.1f mm" % tuple(x * 1000 for x in fit))
    prox = lib.obb_proxies(frame, 3, in_grip, 22) + kit.auto_proxies_where(frame, lambda p: not in_grip(p), 2)
    kit.node(frame, FAM, proxies=prox)

    # ------------------------------------------------------------------ small parts
    tz, ty = mk("pinTrigger")
    trig = prism("trig", P.outer("trigger"), 0.0064, mat="polyFin", bevel=0.0008, seg=2)
    tz0, tz1, ty0, ty1 = bbox(P.outer("trigger"))
    cut(trig, box("ts", 0.0022, ty1 - ty0, tz1 + 0.002, tz0 - 0.002, 0, (ty0 + ty1) / 2 - 0.004, mat=None, bevel=0))
    done(trig)
    blade = box("blade", 0.0019, (ty1 - ty0) * 0.55, (tz0 + tz1) / 2 + 0.0035, (tz0 + tz1) / 2 - 0.0018, 0,
                ty0 + (ty1 - ty0) * 0.38, mat="polyFin", bevel=0.0004)
    trigger = join("p17_trigger", [trig, blade], pivot=(0, ty, tz))
    kit.node(trigger, FAM)

    ss = prism("ss", [(-0.0452, 0.0168), (-0.0448, 0.0198), (-0.0362, 0.0201), (-0.0352, 0.0176), (-0.0372, 0.0152),
                      (-0.0452, 0.0150)], 0.0013, x=-0.0137, mat="steel", bevel=0.0003)
    g = box("sg", 0.002, 0.0006, -0.0365, -0.0445, -0.0144, 0.0182, mat=None, bevel=0)
    lib.array(g, 3, (0, 0.0007, 0.0))
    cut(ss, g)
    stop = join("p17_slidestop", [ss], pivot=(-0.0135, 0.0175, -0.0448))
    kit.node(stop, FAM)

    mz, my = mk("magRelease")
    mr = box("mr", 0.0042, 0.0105, mz + 0.0058, mz - 0.0058, -0.0148, my, mat="polyFin", bevel=0.0009)
    g = box("mg", 0.004, 0.0007, mz + 0.0065, mz - 0.0065, -0.0172, my - 0.0042, mat=None, bevel=0)
    lib.array(g, 5, (0, 0.0021, 0))
    cut(mr, g)
    rel = join("p17_magrelease", [mr], pivot=(-0.013, my, mz))
    kit.node(rel, FAM)

    # ------------------------------------------------------------------ magazines (17 / 21 / 33)
    bp = P.outer("magbase")
    bz0, bz1, by0, by1 = bbox(bp)
    down = (0.0, -math.cos(GRIP_ANGLE), math.sin(GRIP_ANGLE))
    for cap, drop in ((17, 0.0), (21, 0.022), (33, 0.105)):
        dz, dy = down[2] * drop, down[1] * drop
        base_poly = [(z + dz, y + dy) for z, y in bp]
        plate = prism("bp", base_poly, 0.0305, mat="poly", bevel=0.0012, seg=2)
        # body: from the base plate up the grip axis to just under the slide
        cz, cy = (bz0 + bz1) / 2 + 0.002 + dz, by1 + dy
        length = (bot - 0.002 - cy) / math.cos(GRIP_ANGLE)
        body = lib.rbox("mb", 0.0225, length, 0.0305, 0, 0, 0, mat="poly", bevel=0.0018, seg=2)
        lib.xf(body, lib.Matrix.Translation((0, cy, cz)) @ lib.Matrix.Rotation(-GRIP_ANGLE, 4, "X")
               @ lib.Matrix.Translation((0, length / 2, 0)))
        # witness holes on the back (dark dots) read at FP distance
        follower = lib.rbox("fo", 0.0105, 0.003, 0.026, 0, 0, 0, mat="phos", bevel=0.0006)
        lib.xf(follower, lib.Matrix.Translation((0, cy, cz)) @ lib.Matrix.Rotation(-GRIP_ANGLE, 4, "X")
               @ lib.Matrix.Translation((0, length + 0.0005, 0)))
        mag = join(f"p17_mag{cap}", [plate, body, follower], pivot=(0, 0, 0))
        base_c = ((bz0 + bz1) / 2 + dz, by0 + dy)
        kit.node(mag, FAM, sockets={"magwell": (0, base_c[1], base_c[0])}, proxy_slices=2 if cap < 30 else 3)
        kit.part(f"p17_mag{cap}", kit.entry(f"p17_mag{cap}", part="mag"))

    # ------------------------------------------------------------------ catalog entries
    serr_mid = (zf + zr) / 2
    kit.base("p17", [kit.entry("p17_frame"), kit.entry("p17_trigger", part="trigger"),
                     kit.entry("p17_slidestop", part="boltCatch"), kit.entry("p17_magrelease", part="magRelease")],
             sockets={
                 "muzzle": (0, B, muzzle_z),
                 "gripRight": (OLD_GRIP_RIGHT[0], OLD_GRIP_RIGHT[1], OLD_GRIP_RIGHT[2] - OFFSET_Z),
                 "chargingHandle": (0, B + 0.004, serr_mid),
                 "ejectionPort": (0.0128, top - 0.006, sum(PORT) / 2),
                 "optic": (0, top, rz0 - 0.024),
                 "underRail": (0, rb, -0.1478),
             },
             frame=dict(boltFaceZ=breech + OFFSET_Z, receiverFrontZ=front + 0.0014 + OFFSET_Z,
                        receiverRearZ=rear + OFFSET_Z, railY=top,
                        ironRear=dict(z=(rz0 + rz1) / 2 + OFFSET_Z, y=notch_bottom), railBottomY=rb),
             offset=(0.0, 0.0, OFFSET_Z),
             anchors={"pistolRail": (0, rb, 0)},
             gripAngle=math.degrees(GRIP_ANGLE))
    for pid in ("p17_slide", "p17_slide_rmr"):
        kit.part(pid, kit.entry("p17_slide", part="slide"))
    for pid in ("p17_b_std", "p17_b_thread", "p17_bare", "p17_irons"):
        kit.part(pid)
    # The slide red dot (part p17_rmr) is built in the acc family (fam_acc.p17_rmr) from the same profile marks.
    from .devices import device

    device(FAM, "p17_comp", 0.028, 0.0135, "comp", "nitride", part="slide")
    device(FAM, "p17_supp", 0.165, 0.0172, "can", "can", part="slide")
