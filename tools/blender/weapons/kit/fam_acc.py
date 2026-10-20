"""Accessories family: optics, back-up irons, lights, laser, foregrips — rail-mounted, shared by every platform.

Local frames (anchors resolved by src/weapons/models/kit.ts):
  optics / magnifier / BUIS  — rail top surface at y = 0, mount rear at z = 0, extending toward -z
  offset dot                 — rail-centre frame rolled 45° by the anchor
  light / laser              — lens centre at the origin looking -z, mount toward -y (the anchor rolls it around the bore)
  foregrips                  — rail contact at y = 0, centred on z = 0, hanging toward -y
Dimensions follow the catalog parts (footprint, axisOverRail) and published sizes (T-2 ~ 62 mm long, EXPS ~ 96 mm,
1-6x24 LPVO ~ 260 mm, scout light 1" body).
"""
import math

from . import kit, lib
from .lib import box, cyl, cyl_x, cyl_y, cut, done, join, lathe, prism, rbox, sweep

FAM = "acc"


def clamp(z0, z1, w=0.026, knob=True):
    """Picatinny clamp: base block + cross bolt knob on the left."""
    b = box("clamp", w, 0.0085, z0, z1, 0, -0.0012, mat="anod", bevel=0.0009)
    # dovetail jaws under the rail top
    j = [box("jaw", 0.0035, 0.0048, z0, z1, s * (w / 2 - 0.00175), -0.0058, mat="anod", bevel=0.0005) for s in (-1, 1)]
    parts = [b, *j]
    if knob:
        zc = (z0 + z1) / 2
        parts.append(cyl_x("knob", 0.0042, -w / 2 - 0.004, -w / 2, -0.003, zc, 16, "phos", 0.0004))
    return parts


def red_dot():
    """T-2 style micro dot on a 1/3 co-witness riser. footprint 0.04, axis 0.036 over the rail."""
    ax = 0.036
    zc = -0.02
    ro, ri = 0.0136, 0.0099
    zb0, zb1 = zc + 0.0225, zc - 0.0225
    parts = clamp(0, -0.04)
    riser_top = ax - ro + 0.003
    parts.append(box("riser", 0.02, riser_top - 0.003, -0.002, -0.038, 0, (riser_top + 0.003) / 2, mat="anod", bevel=0.0012))
    # saddle under the tube: its top stays below the bore (ax - ri) so the view through the tube is clear
    by0, by1 = riser_top - 0.001, ax - ri - 0.0006
    parts.append(box("base", 0.023, by1 - by0, zb0 - 0.004, zb1 + 0.004, 0, (by0 + by1) / 2, mat="anod", bevel=0.0015))
    body = lathe("body", [(ri, zb0), (ro - 0.0006, zb0), (ro, zb0 - 0.0015), (ro, zb1 + 0.0035), (ro + 0.0009, zb1 + 0.002),
                          (ro + 0.0009, zb1), (ri, zb1), (ri, zb0)], 32, ax, 0, "anod", 0.0003)
    parts.append(body)
    # turret guards + caps (elevation top, windage right), battery cap left
    for o in (cyl_y("te", 0.0052, ax + ro - 0.002, ax + ro + 0.004, 0, zc + 0.003, 18, "anod", 0.0006),
              cyl_x("tw", 0.0052, ro - 0.002, ro + 0.004, ax, zc + 0.003, 18, "anod", 0.0006),
              cyl_x("bat", 0.0068, -ro - 0.003, -ro + 0.002, ax - 0.002, zc + 0.002, 20, "anod", 0.0006)):
        parts.append(o)
    parts.append(cyl("lensF", ri, zb1 + 0.0028, zb1 + 0.0018, ax, 0, 24, "lens", 0))
    parts.append(cyl("lensR", ri, zb0 - 0.001, zb0 - 0.0018, ax, 0, 24, "glass", 0))
    parts.append(rbox("dot", 0.0011, 0.0011, 0.0004, 0, ax, zb1 + 0.004, mat="reticle", bevel=0))
    return join("acc_reddot", parts)


def holo():
    """EXPS-style holographic sight, footprint 0.093, axis 0.036."""
    ax = 0.036
    z0, z1 = 0.0, -0.093
    za = z0 - 0.034
    parts = clamp(z0, z1, 0.03, knob=False)
    parts.append(box("base", 0.044, 0.015, z0, z1, 0, 0.0055, mat="anod", bevel=0.003))
    parts.append(box("rear", 0.042, 0.03, z0, za + 0.002, 0, 0.016, mat="anod", bevel=0.004))
    for x in (-0.008, 0.008):
        parts.append(rbox("btn", 0.009, 0.006, 0.002, x, 0.022, z0 + 0.0005, mat="rubber", bevel=0.001))
    parts.append(cyl_x("batt", 0.008, 0.02, 0.029, 0.006, z1 + 0.014, 20, "anod", 0.0008))
    top = ax + 0.0175
    parts.append(box("hood", 0.046, 0.0035, za, z1, 0, top, mat="anod", bevel=0.0012))
    ear = [(za, 0.01), (z1 - 0.001, 0.01), (z1 + 0.004, top + 0.0015), (za, top + 0.0015)]
    for x in (-0.0215, 0.0215):
        parts.append(prism("ear", ear, 0.004, x=x, mat="anod", bevel=0.0008))
    parts.append(rbox("wF", 0.039, 0.029, 0.0012, 0, ax + 0.001, z1 + 0.006, mat="lens", bevel=0))
    parts.append(rbox("wR", 0.039, 0.028, 0.0012, 0, ax + 0.001, za - 0.002, mat="glass", bevel=0))
    ring = lathe("ring", [(0.0052, (za + z1) / 2 + 0.0002), (0.0058, (za + z1) / 2 + 0.0002), (0.0058, (za + z1) / 2 - 0.0002),
                          (0.0052, (za + z1) / 2 - 0.0002)], 32, ax, 0, "reticle", 0)
    parts.append(ring)
    parts.append(rbox("dot", 0.0009, 0.0009, 0.0003, 0, ax, (za + z1) / 2, mat="reticle", bevel=0))
    for z in (z0 - 0.02, z1 + 0.02):
        parts.append(rbox("qd", 0.003, 0.007, 0.018, -0.0235, -0.002, z, mat="phos", bevel=0.001))
    return join("acc_holo", parts)


def lpvo():
    """1-6x24 LPVO in a cantilever mount. footprint 0.11, axis 0.038; eyepiece rear at z0 + 0.06."""
    ax = 0.038
    z0, z1 = 0.0, -0.11
    parts = clamp(z0, z1)
    parts.append(box("mbase", 0.02, 0.008, z0, z1, 0, 0.002, mat="anod", bevel=0.002))
    for zr in (z0 - 0.014, z1 + 0.004):
        h = ax - 0.017
        parts.append(box("ringst", 0.017, h, zr + 0.0075, zr - 0.0075, 0, h / 2 + 0.002, mat="anod", bevel=0.0015))
        parts.append(lathe("ring", [(0.0151, zr + 0.008), (0.0186, zr + 0.008), (0.019, zr + 0.006), (0.019, zr - 0.006),
                                    (0.0186, zr - 0.008), (0.0151, zr - 0.008)], 32, ax, 0, "anod", 0.0003))
        parts.append(rbox("cap", 0.012, 0.004, 0.012, 0, ax + 0.019, zr, mat="anod", bevel=0.0012))
    r0 = z0 + 0.06
    tube = lathe("tube", [(0.0, r0), (0.019, r0), (0.0222, r0 - 0.004), (0.0222, r0 - 0.062), (0.0205, r0 - 0.068),
                          (0.016, r0 - 0.09), (0.0153, r0 - 0.094), (0.0153, r0 - 0.19), (0.0178, r0 - 0.212),
                          (0.0192, r0 - 0.22), (0.0192, r0 - 0.252), (0.0182, r0 - 0.256), (0, r0 - 0.256)], 40, ax, 0,
                 "anod", 0.0004)
    parts.append(tube)
    for i in range(4):
        z = r0 - 0.03 - i * 0.006
        parts.append(lathe("kn", [(0.0222, z + 0.002), (0.0232, z + 0.001), (0.0232, z - 0.001), (0.0222, z - 0.002)],
                           40, ax, 0, "rubber", 0))
    parts.append(rbox("throw", 0.007, 0.018, 0.009, 0.0235, ax + 0.008, r0 - 0.04, mat="anod", bevel=0.002))
    zt = r0 - 0.138
    parts.append(box("saddle", 0.034, 0.034, zt + 0.02, zt - 0.02, 0, ax, mat="anod", bevel=0.008, seg=3))
    parts.append(cyl_y("tE", 0.0118, ax + 0.016, ax + 0.03, 0, zt, 24, "anod", 0.0008))
    parts.append(cyl_x("tW", 0.0118, 0.016, 0.03, ax, zt, 24, "anod", 0.0008))
    parts.append(cyl_x("tI", 0.0092, -0.026, -0.015, ax, zt, 24, "anod", 0.0008))
    parts.append(cyl("oF", 0.0178, r0 - 0.2555, r0 - 0.2565, ax, 0, 32, "lens", 0))
    parts.append(cyl("oR", 0.0185, r0 + 0.0005, r0 - 0.0005, ax, 0, 32, "glass", 0))
    return join("acc_lpvo", parts)


def buis(front):
    """Flip-up BUIS (rear aperture / front post tower), footprint 0.028, axis 0.035."""
    ax = 0.035
    parts = clamp(0, -0.028, 0.024, knob=False)
    zp = -0.014
    if not front:
        plate = [(-0.0085, 0.002), (0.0085, 0.002), (0.0085, ax + 0.0045), (0.005, ax + 0.0065), (-0.005, ax + 0.0065),
                 (-0.0085, ax + 0.0045)]
        p = sweep("plate", plate, zp + 0.002, zp - 0.002, "anod", 0.0005)
        cut(p, cyl("ap", 0.0013, zp + 0.01, zp - 0.01, ax, 0, 12, None, 0))
        parts.append(p)
        for x in (-0.0105, 0.0105):
            parts.append(box("w", 0.003, ax + 0.005, zp + 0.005, zp - 0.005, x, (ax + 0.007) / 2, mat="anod", bevel=0.0008))
    else:
        tower = [(-0.0115, 0.002), (0.0115, 0.002), (0.0085, ax + 0.009), (-0.0085, ax + 0.009)]
        t = sweep("tower", tower, zp + 0.003, zp - 0.003, "anod", 0.0006)
        cut(t, sweep("win", [(-0.0068, 0.006), (0.0068, 0.006), (0.0052, ax + 0.0065), (-0.0052, ax + 0.0065)],
                     zp + 0.01, zp - 0.01, None, 0))
        parts.append(t)
        parts.append(box("post", 0.0017, ax - 0.004, zp + 0.001, zp - 0.001, 0, (ax + 0.004) / 2, mat="phos", bevel=0.0003))
    return join("acc_buis_front" if front else "acc_buis_rear", parts)


def scout():
    """1" scout-style light: lens at z = 0 looking -z, offset mount toward -y."""
    body = lathe("scout", [(0, 0.118), (0.0085, 0.118), (0.0098, 0.112), (0.0098, 0.098), (0.0091, 0.094), (0.0091, 0.04),
                           (0.0118, 0.03), (0.0128, 0.026), (0.0128, 0.004), (0.0122, 0), (0.0108, 0), (0.0108, 0.0012),
                           (0, 0.0012)], 32, 0, 0, "anod", 0.0004)
    for i in range(6):
        z = 0.008 + i * 0.003
        cut(body, lathe("fin", [(0.0129, z), (0.0118, z), (0.0118, z + 0.0012), (0.0129, z + 0.0012)], 32, 0, 0, None, 0))
    lens = cyl("lens", 0.0108, 0.0012, 0.0002, 0, 0, 32, "lightLens", 0)
    mount = box("mnt", 0.012, 0.014, 0.085, 0.055, 0, -0.014, mat="anod", bevel=0.0015)
    tape = rbox("tape", 0.006, 0.006, 0.01, 0, -0.008, 0.112, mat="rubber", bevel=0.0015)
    return join("acc_light_scout", [body, lens, mount, tape])


def compact():
    body = rbox("cbody", 0.026, 0.03, 0.068, 0, -0.004, 0.036, mat="poly", bevel=0.004, seg=3)
    bez = lathe("bez", [(0, 0.012), (0.0128, 0.012), (0.0135, 0.004), (0.0132, 0), (0.011, 0), (0.011, 0.001), (0, 0.001)],
                32, 0, 0, "anod", 0.0003)
    lens = cyl("lens", 0.011, 0.001, 0.0002, 0, 0, 32, "lightLens", 0)
    return join("acc_light_compact", [body, bez, lens])


def laser():
    b = box("lb", 0.032, 0.034, 0.078, 0, 0, 0, mat="anod", bevel=0.003, seg=3)
    for dy in (0.008, -0.008):
        cut(b, cyl("ap", 0.0045, -0.001, 0.003, dy, 0, 16, None, 0))
    em = [cyl("e", 0.0035, 0.0028, 0.0018, dy, 0, 16, "lens", 0) for dy in (0.008, -0.008)]
    sw = box("sw", 0.008, 0.012, 0.05, 0.03, 0.019, 0, mat="phos", bevel=0.001)
    return join("acc_laser", [b, *em, sw])


def foregrips():
    out = []
    # vertical: 25 mm grip with a slight cant, rail clamp
    clampv = box("vc", 0.024, 0.008, 0.022, -0.022, 0, -0.002, mat="poly", bevel=0.0015)
    g = lathe("vg", [(0, 0), (0.0138, 0), (0.0138, -0.004), (0.013, -0.08), (0.0142, -0.086), (0.0142, -0.092), (0, -0.092)],
              24, 0, 0, "polyGrip", 0.0006)
    lib.xf(g, lib.Matrix.Translation((0, -0.004, 0)) @ lib.Matrix.Rotation(-0.08, 4, "X") @ lib.Matrix.Rotation(-math.pi / 2, 4, "X"))
    out.append(join("acc_fg_vertical", [clampv, g]))
    ang = [(0.045, 0), (-0.04, 0), (-0.04, -0.01), (-0.012, -0.03), (0.006, -0.034), (0.02, -0.028), (0.045, -0.006)]
    a = prism("ag", ang, 0.027, mat="poly", bevel=0.002)
    lib.round_edges(a, lambda m, n0, n1: (abs(n0[0]) > 0.9) != (abs(n1[0]) > 0.9), 0.006, 3)
    out.append(join("acc_fg_angled", [a]))
    hs = [(0.014, 0), (-0.016, 0), (-0.012, -0.011), (-0.002, -0.017), (0.006, -0.013)]
    h = prism("hs", hs, 0.022, mat="poly", bevel=0.0015)
    lib.round_edges(h, lambda m, n0, n1: (abs(n0[0]) > 0.9) != (abs(n1[0]) > 0.9), 0.004, 3)
    out.append(join("acc_fg_handstop", [h]))
    return out


def p17_rmr():
    """P-17 slide red dot (rides with the slide): RMR footprint just ahead of the rear sight, on the slide top
    (profiles/p17.json marks, P-17 asset frame; the P-17 base offset moves it with the pistol)."""
    from .photo import Profile, bbox

    P = Profile("p17")
    top = P.m("slideTop")[1]
    rz0 = bbox(P.outer("rearSight"))[0]
    dot = join("acc_p17_rmr", rmr_parts(rz0 - 0.001, rz0 - 0.046, top - 0.0015), pivot=(0, 0, 0))
    kit.node(dot, FAM)
    kit.part("p17_rmr", kit.entry("acc_p17_rmr", part="slide"))


def build():
    lib.set_collection(FAM)
    kit.node(red_dot(), FAM)
    kit.part("opt_reddot", kit.entry("acc_reddot", anchor="optic"))
    kit.node(holo(), FAM)
    kit.part("opt_holo", kit.entry("acc_holo", anchor="optic"))
    kit.node(lpvo(), FAM)
    kit.part("opt_lpvo", kit.entry("acc_lpvo", anchor="optic"))
    kit.node(buis(False), FAM)
    kit.node(buis(True), FAM)
    kit.part("buis_flip", kit.entry("acc_buis_rear", anchor="buisRear"), kit.entry("acc_buis_front", anchor="buisFront"))
    kit.node(scout(), FAM, sockets={"light": (0, 0, 0)})
    kit.part("light_scout", kit.entry("acc_light_scout", anchor="light"))
    kit.node(compact(), FAM, sockets={"light": (0, 0, 0)})
    kit.part("light_compact", kit.entry("acc_light_compact", anchor="light"))
    kit.node(laser(), FAM)
    kit.part("laser_box", kit.entry("acc_laser", anchor="laser"))
    for n, pid in zip(foregrips(), ("fg_vertical", "fg_angled", "fg_handstop")):
        kit.node(n, FAM, proxy_slices=2)
        kit.part(pid, kit.entry(n.name, anchor="foregrip"))
    base, flip = magnifier()
    kit.node(base, FAM)
    kit.node(flip, FAM)
    kit.part("mag_3x", kit.entry("acc_mag3x_mount", anchor="magnifier"),
             kit.entry("acc_mag3x", anchor="magnifier", part="magnifier"))
    kit.node(offset_dot(), FAM)
    kit.part("off_dot45", kit.entry("acc_offset_dot", anchor="offset"))
    p17_rmr()
    for combo, pid in ((False, "p17_light"), (True, "p17_combo")):
        n = pistol_light(combo)
        kit.node(n, FAM, sockets={"light": (0, -0.0175, 0)})
        kit.part(pid, kit.entry(n.name, anchor="light"))


def rmr_parts(z0, z1, base_y, x=0.0):
    """RMR-style housing (base on y = base_y, footprint z0 → z1): body, rear battery hump, hoop, lens, dot."""
    L = z0 - z1
    zf = z1 + 0.0145
    parts = [box("rb", 0.026, 0.008, z0, z1, x, base_y + 0.004, mat="anod", bevel=0.0018),
             box("rh", 0.019, 0.009, z0, z0 - L * 0.32, x, base_y + 0.011, mat="anod", bevel=0.003)]
    hoop = sweep("hoop", [(x - 0.013, base_y + 0.006), (x + 0.013, base_y + 0.006), (x + 0.0095, base_y + 0.026),
                          (x - 0.0095, base_y + 0.026)], zf, z1, "anod", 0.0008)
    cut(hoop, sweep("win", [(x - 0.0098, base_y + 0.0085), (x + 0.0098, base_y + 0.0085), (x + 0.0072, base_y + 0.0232),
                            (x - 0.0072, base_y + 0.0232)], zf + 0.01, z1 - 0.01, None, 0))
    parts.append(hoop)
    lens = rbox("lens", 0.019, 0.015, 0.0008, x, base_y + 0.0158, zf - 0.006, mat="lens", bevel=0)
    parts.append(lens)
    parts.append(rbox("dot", 0.0008, 0.0008, 0.0003, x, base_y + 0.0155, zf - 0.004, mat="reticle", bevel=0))
    return parts


def magnifier():
    """3x flip magnifier: clamp + riser on the left, hinge, tube on the optical axis. Part `magnifier` flips about
    the hinge (rotation about z)."""
    ax = 0.036
    hinge_y = ax - 0.012
    fixed = clamp(0, -0.05) + [box("riser", 0.012, hinge_y + 0.004, -0.004, -0.046, -0.012, hinge_y / 2, mat="anod",
                                   bevel=0.0015)]
    r0 = 0.04
    tube = lathe("mtube", [(0, r0), (0.0175, r0), (0.019, r0 - 0.004), (0.019, r0 - 0.03), (0.0165, r0 - 0.036),
                           (0.0165, r0 - 0.1), (0.0172, r0 - 0.106), (0, r0 - 0.106)], 32, ax, 0, "anod", 0.0004)
    arm = box("arm", 0.014, 0.012, -0.004, -0.046, -0.014, hinge_y + 0.002, mat="anod", bevel=0.0015)
    lr = cyl("mlr", 0.0168, r0 + 0.0005, r0 - 0.0005, ax, 0, 24, "glass", 0)
    lf = cyl("mlf", 0.0158, r0 - 0.1055, r0 - 0.1065, ax, 0, 24, "lens", 0)
    base = join("acc_mag3x_mount", fixed)
    flip = join("acc_mag3x", [tube, arm, lr, lf], pivot=(-0.019, hinge_y, -0.025))
    return base, flip


def offset_dot():
    """45° offset dot: mount block + RMR, authored in the rolled rail frame (y = out along the 45° line)."""
    parts = [box("ob", 0.02, 0.022, 0, -0.028, 0, 0.012, mat="anod", bevel=0.002)] + rmr_parts(0.008, -0.036, 0.024)
    return join("acc_offset_dot", parts)


def pistol_light(combo):
    """Pistol light (+ laser pod) under the dust-cover rail: rail contact at y = 0, lens at z = 0."""
    y = -0.0175
    parts = [box("pr", 0.024, 0.006, 0.07, 0.012, 0, -0.0023, mat="poly", bevel=0.0012),
             box("pb", 0.03, 0.029, 0.074, 0.008, 0, y, mat="anod", bevel=0.0055, seg=3),
             lathe("pz", [(0, 0.012), (0.0142, 0.012), (0.0146, 0.004), (0.0142, 0), (0.0122, 0), (0.0122, 0.001),
                          (0, 0.001)], 32, y, 0, "anod", 0.0003),
             cyl("pl", 0.0122, 0.001, 0.0002, y, 0, 32, "lightLens", 0)]
    for sx in (-1, 1):
        parts.append(rbox("ps", 0.003, 0.012, 0.01, sx * 0.016, y - 0.004, 0.07, mat="poly", bevel=0.0012))
    if combo:
        parts.append(box("lz", 0.012, 0.01, 0.03, 0.002, 0, y - 0.018, mat="anod", bevel=0.002))
        parts.append(cyl("le", 0.0025, 0.0026, 0.0016, y - 0.018, 0, 12, "reticle", 0))
    return join("acc_p17_combo" if combo else "acc_p17_light", parts)
