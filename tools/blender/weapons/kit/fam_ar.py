"""AR family (SB-16 / HB-300), modelled over the traced M4 right-side photo (profiles/ar.json; anchored so the
receiver rear sits at the catalog's z = 0.085 and the bore on BORE_Y).

From the photo: upper + lower receiver outlines, A2 grip, SOPMOD stock, GI 30-rd mag outline (PMAG / 20 / 40 are
derived from it), A2 flash hider radius profile, trigger. Parametric (published dimensions): picatinny rails,
M-LOK / quad / integral handguards per catalog length, barrels per length × profile, gas block, muzzle devices,
cans, buffer tube, carbine / PDW / brace stocks, controls (selector, mag release, bolt catch, charging handle,
forward assist, dust cover, bolt carrier).
"""
import math

from . import kit, lib
from .lib import B, box, cut, cyl, cyl_x, done, join, lathe, prism, sweep
from .photo import Profile, bbox, line_hits, span_at_z

FAM = "ar"
SIZE = 2048  # 50+ parts share the atlas
IN = 0.0254
BOLT_FACE = -0.08
RECV_FRONT = -0.105
RECV_REAR = 0.085
RAIL_Y = 0.0575  # top of the CC0 M4 upper rail (bore + 27.5 mm)


def clip(o, z0=None, z1=None, y0=None, y1=None):
    """Boolean away everything outside the given z/y window (three frame)."""
    big = 1.0
    if y1 is not None:
        cut(o, box("c", big, big, big, -big, 0, y1 + big / 2, mat=None, bevel=0))
    if y0 is not None:
        cut(o, box("c", big, big, big, -big, 0, y0 - big / 2, mat=None, bevel=0))
    if z0 is not None:
        cut(o, box("c", big, big, z0 + big, z0, 0, 0, mat=None, bevel=0))
    if z1 is not None:
        cut(o, box("c", big, big, z1, z1 - big, 0, 0, mat=None, bevel=0))
    return o


def thin(o, poly, w):
    for sx in (-1, 1):
        cut(o, prism("thin", poly, 0.03, x=sx * (w / 2 + 0.015), mat=None, bevel=0))


def side_round(o, r, seg=3, where=lambda m: True):
    lib.round_edges(o, lambda m, a, b: where(m) and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), r, seg)


def build():
    lib.set_collection(FAM)
    P = Profile("ar")
    mk = P.m

    # ------------------------------------------------------------------ upper receiver
    up = prism("upper", P.outer("upper"), 0.0246, mat="anod", bevel=0.0008, seg=2)
    clip(up, z0=RECV_REAR, z1=RECV_FRONT - 0.009, y1=RAIL_Y - 0.0064)
    # ejection port (right) and the forward-assist housing cut
    port = box("port", 0.006, 0.0172, -0.002, -0.068, 0.0123, B + 0.0016, mat=None, bevel=0)
    cut(up, port)
    side_round(up, 0.0012, 2)
    done(up)
    rail = lib.picatinny("rail", 0.068, -0.104, RAIL_Y)
    fa = lathe("fa", [(0, -0.002), (0.0082, -0.002), (0.0074, 0.018), (0.0078, 0.0185), (0.0078, 0.0245),
                      (0.0072, 0.0255), (0, 0.0255)], 18, 0, 0, "anod", 0.0003)
    lib.xf(fa, lib.Matrix.Translation((0.0085, B + 0.0065, 0.058)) @ lib.Matrix.Rotation(0.42, 4, "Y"))
    defl = prism("defl", [(0.021, B - 0.001), (0.021, B + 0.019), (0.003, B + 0.0095), (0.003, B + 0.0055)], 0.006,
                 x=0.0145, mat="anod", bevel=0.0006)
    boss = cyl("boss", 0.0158, -0.088, -0.1048, B, 0, 24, "anod", 0.0006)
    hinge = cyl("hinge", 0.0011, -0.001, -0.069, B - 0.0072, 0.0129, 8, "steel", 0)
    upper = join("ar_upper", [up, rail, fa, defl, boss, hinge])
    kit.node(upper, FAM, proxy_slices=3)

    # bolt carrier seen through the open port
    bc = box("bc", 0.0016, 0.0118, -0.004, -0.058, 0.0121, B + 0.002, mat="nitride", bevel=0.0005)
    lug = box("lug", 0.0014, 0.0068, -0.056, -0.066, 0.0122, B + 0.0005, mat="nitride", bevel=0.0004)
    bolt = join("ar_bolt", [bc, lug], pivot=(0, B, 0.0))
    kit.node(bolt, FAM)
    # dust cover hanging open (hinge rod)
    hz = (0.0129, B - 0.0072)
    dc = box("dc", 0.0012, 0.0168, -0.003, -0.067, 0, 0.0084, mat="anod", bevel=0.0004)
    rib = box("rib", 0.0015, 0.0026, -0.006, -0.064, 0.0012, 0.0128, mat="anod", bevel=0.0004)
    for o in (dc, rib):
        lib.xf(o, lib.Matrix.Translation((hz[0], hz[1], 0)) @ lib.Matrix.Rotation(-1.95, 4, "Z"))
    dust = join("ar_dustcover", [dc, rib], pivot=(hz[0], hz[1], -0.035))
    kit.node(dust, FAM)
    # charging handle (T-handle with latch)
    top = RAIL_Y - 0.0064
    chb = box("chb", 0.011, 0.0055, 0.098, 0.07, 0, top - 0.004, mat="anod", bevel=0.0008)
    cht = lib.rbox("cht", 0.04, 0.0066, 0.0075, 0, top - 0.004, 0.0935, mat="anod", bevel=0.0018)
    chl = lib.rbox("chl", 0.013, 0.0064, 0.011, -0.0165, top - 0.0042, 0.0895, mat="anod", bevel=0.0016)
    ch = join("ar_ch", [chb, cht, chl], pivot=(0, top - 0.004, 0.085))
    kit.node(ch, FAM, sockets={"chargingHandle": (0, top - 0.002, 0.096)})

    # ------------------------------------------------------------------ lower receiver
    lo = prism("lower", P.outer("lower"), 0.0272, mat="anod", bevel=0.0009, seg=2)
    for h in P.holes("lower", min_area=2e-5):
        cut(lo, prism("hole", h, 0.05, mat=None, bevel=0))
    mwf, mwr = mk("magwellFront")[0], mk("magwellRear")[0]
    # body behind the magwell 22.5 mm, trigger guard 11 mm
    thin(lo, [(mwr + 0.001, -0.2), (0.2, -0.2), (0.2, 0.2), (mwr + 0.001, 0.2)], 0.0225)
    thin(lo, [(mwr + 0.004, -0.03), (0.034, -0.03), (0.034, -0.016), (mwr + 0.004, -0.016)], 0.011)
    clip(lo, y1=0.016)
    side_round(lo, 0.0015, 2, lambda m: m[1] < -0.012)
    done(lo)
    # magwell flare lip at the mouth, mag-release fence (right), bolt-catch ears (left)
    mouth = span_at_z(P.outer("lower"), (mwf + mwr) / 2)
    my = mouth[0] if mouth else -0.035
    flare = box("flare", 0.0298, 0.0045, mwr + 0.0015, mwf - 0.0015, 0, my + 0.0022, mat="anod", bevel=0.0012)
    fence = prism("fence", [(-0.024, 0.002), (-0.024, -0.017), (-0.038, -0.017), (-0.038, -0.012), (-0.0275, -0.012),
                            (-0.0275, 0.002)], 0.0034, x=0.0128, mat="anod", bevel=0.0006)
    ears = [prism("ear", [(-0.035, y0), (-0.051, y0), (-0.051, y1), (-0.035, y1)], 0.0034, x=-0.0128, mat="anod",
                  bevel=0.0006) for y0, y1 in ((0.0105, 0.006), (-0.012, -0.016))]
    pins = [cyl_x("pin", 0.0032, -0.0124, 0.0124, y, z, 14, "phos", 0.0002) for z, y in ((0.077, 0.006), (-0.106, 0.004))]
    pins += [cyl_x("tp", 0.0018, -0.0116, 0.0116, -0.0042, z, 10, "steel", 0.0001) for z in (-0.009, 0.006)]
    lower = join("ar_lower", [lo, flare, fence, *ears, *pins])
    kit.node(lower, FAM, proxy_slices=3)

    tr = prism("trig", P.outer("trigger"), 0.0045, mat="phos", bevel=0.0005)
    trigger = join("ar_trigger", [tr], pivot=(0, -0.012, 0.004))
    kit.node(trigger, FAM)
    SP = (0.046, 0.0005)
    sel = []
    for sx, L in ((-1, 0.017), (1, 0.01)):
        sel.append(cyl_x("sd", 0.0056, sx * 0.0115, sx * 0.0133, SP[1], SP[0], 16, "phos", 0.0003))
        lever = [(SP[0] + 0.004, SP[1] + 0.0028), (SP[0] - L, SP[1] + 0.0042), (SP[0] - L - 0.0035, SP[1] + 0.0012),
                 (SP[0] - L - 0.0035, SP[1] - 0.0016), (SP[0] - L, SP[1] - 0.004), (SP[0] + 0.004, SP[1] - 0.0028)]
        sel.append(prism("sl", lever, 0.0022, x=sx * 0.0143, mat="phos", bevel=0.0005))
    safety = join("ar_safety", sel, pivot=(0, SP[1], SP[0]))
    kit.node(safety, FAM)
    rel = cyl_x("rel", 0.0044, 0.0112, 0.0152, -0.0068, -0.0315, 16, "phos", 0.0004)
    magrel = join("ar_magrelease", [rel], pivot=(0.012, -0.007, -0.031))
    kit.node(magrel, FAM)
    paddle = [(-0.0385, 0.0098), (-0.0475, 0.0098), (-0.0488, 0.004), (-0.0466, -0.004), (-0.0498, -0.0135),
              (-0.0445, -0.0178), (-0.0392, -0.011), (-0.0392, 0.003)]
    pd = prism("bc", paddle, 0.0026, x=-0.0151, mat="phos", bevel=0.0005)
    catch = join("ar_boltcatch", [pd], pivot=(-0.0135, 0.004, -0.043))
    kit.node(catch, FAM)
    kit.base("sb16", [kit.entry("ar_upper"), kit.entry("ar_lower"), kit.entry("ar_bolt", part="bolt"),
                      kit.entry("ar_dustcover", part="dustCover"), kit.entry("ar_ch", part="chargingHandle"),
                      kit.entry("ar_trigger", part="trigger"), kit.entry("ar_safety", part="safety"),
                      kit.entry("ar_magrelease", part="magRelease"), kit.entry("ar_boltcatch", part="boltCatch"),
                      kit.entry("ar_buffertube")])
    kit.BASES["hb300"] = dict(kit.BASES["sb16"], nodes=list(kit.BASES["sb16"]["nodes"]))

    # ------------------------------------------------------------------ buffer tube
    z0, z1 = RECV_REAR, RECV_REAR + 0.185
    tube = lathe("tube", [(0, z0), (0.0146, z0), (0.0146, z1 - 0.003), (0.0136, z1), (0, z1)], 24, B, 0, "anod", 0.0004)
    nut = lathe("nut", [(0.0146, z0 + 0.0095), (0.0178, z0 + 0.009), (0.0178, z0 + 0.001), (0.0146, z0)], 24, B, 0, "phos", 0.0003)
    plate = lib.rbox("plate", 0.03, 0.036, 0.0025, 0, B - 0.004, z0 + 0.001, mat="phos", bevel=0.001)
    key = box("key", 0.0075, 0.005, z0 + 0.008, z1 + 0.004, 0, B - 0.0148, mat="anod", bevel=0.0006)
    qd = cyl("qd", 0.0062, z0 + 0.0065, z0 - 0.0005, B - 0.012, -0.0135, 14, "phos", 0.0004)
    bt = join("ar_buffertube", [tube, nut, plate, key, qd])
    kit.node(bt, FAM, proxies=[dict(type="capsule", a=[0, B, z0], b=[0, B, z1], r=0.0146)])
    pdw_box = box("pdwbox", 0.026, 0.032, z0 + 0.001, z0 + 0.03, 0, B + 0.002, mat="anod", bevel=0.003)
    pdw_cap = cyl("pdwcap", 0.0145, z0 + 0.03, z0 + 0.04, B + 0.002, 0, 20, "anod", 0.0008)
    pdwh = join("ar_pdwhousing", [pdw_box, pdw_cap])
    kit.node(pdwh, FAM)

    # ------------------------------------------------------------------ grips: lofted rounded sections
    # Sections perpendicular to the grip axis, front/back from the photo A2 outline (finger nub included),
    # superellipse cross-section (A2 ~25 mm wide; the ergonomic grip is fuller and rounder).
    gp = P.outer("grip")
    gz0, gz1, gy0, gy1 = bbox(gp)
    for gid, w, n_se, ang, swell in (("ar_grip_a2", 0.0252, 2.5, 22, 0.0), ("ar_grip_ergo", 0.0275, 2.2, 22, 0.0018)):
        a = math.radians(ang)
        d = (math.sin(a), -math.cos(a))
        nrm = (math.cos(a), math.sin(a))
        top_y = gy1 + 0.004
        hits = line_hits(gp, (0.0, gy1 - 0.003), (1.0, 0.0))
        c0 = ((hits[0] + hits[-1]) / 2 if hits else (gz0 + gz1) / 2, top_y)
        rings = []
        L = (top_y - gy0) / math.cos(a) + 0.01
        steps = 18
        last = None
        for i in range(steps + 1):
            t = L * i / steps
            c = (c0[0] + d[0] * t, c0[1] + d[1] * t)
            hs = line_hits(gp, c, nrm)
            if len(hs) < 2:
                if last is None:
                    continue
                break
            s0, s1 = hs[0], hs[-1]
            if i == 0:
                s0, s1 = s0 - 0.002, s1 + 0.002
            last = (s0, s1)
            mid, half = (s0 + s1) / 2, (s1 - s0) / 2
            ww = w / 2 + swell * math.sin(math.pi * i / steps)
            loop = lib.superellipse(ww, half, n_se, 28)
            rings.append([(u, c[1] + nrm[1] * (mid + v), c[0] + nrm[0] * (mid + v)) for u, v in loop])
        g = lib.loft(gid, rings, mat="polyGrip")
        node = join(gid, [g])
        fit = lib.fit_grip(node, 0.027, 0.043, 22, -0.05)
        print("[ar] %s w×d %.1f×%.1f → %.1f×%.1f mm" % ((gid,) + tuple(x * 1000 for x in fit)))
        kit.node(node, FAM, proxies=lib.obb_proxies(node, 3, angle_deg=22))
        kit.part(gid, kit.entry(gid))
    kit.BASES["sb16"]["sockets"] = {}

    # ------------------------------------------------------------------ stocks (anchor 'butt': rear at z = 0)
    def stock_body(name, pts, w, cheek=0.0):
        s = prism(name, pts, w, mat="poly", bevel=0.0012)
        cut(s, cyl("bore", 0.0149, 0.01, -0.3, B, 0, 24, None, 0))
        # rounded top (cheek weld) and softened bottom/toe line
        lib.round_edges(s, lambda m, a, b: m[1] > B + 0.005 and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), 0.008, 4)
        lib.round_edges(s, lambda m, a, b: m[1] <= B + 0.005 and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), 0.003, 3)
        return s

    # SOPMOD / CTR-style: flat cheek weld, battery tubes either side, toe line, QD cup, lock lever, rubber pad
    sop_pts = [(-0.172, B + 0.0175), (-0.03, B + 0.0215), (-0.004, B + 0.022), (0, B + 0.018), (0, B - 0.088),
               (-0.006, B - 0.094), (-0.022, B - 0.09), (-0.07, B - 0.052), (-0.115, B - 0.033), (-0.172, B - 0.021)]
    st = stock_body("sop", sop_pts, 0.036)
    tubes = [lathe("bt", [(0, -0.02), (0.0092, -0.022), (0.0092, -0.15), (0.0062, -0.162), (0, -0.162)], 20, B + 0.004,
                   s * 0.0175, "poly", 0.0005) for s in (-1, 1)]
    qd = cyl_x("qd", 0.0064, -0.0215, -0.017, B - 0.06, -0.03, 16, "phos", 0.0004)
    lever = box("lev", 0.011, 0.006, -0.12, -0.165, 0, B - 0.023, mat="poly", bevel=0.0015)
    pad = box("pad", 0.0385, 0.112, 0.002, -0.008, 0, B - 0.036, mat="rubber", bevel=0.003)
    sop = join("ar_stock_sopmod", [st, *tubes, qd, lever, pad])
    kit.node(sop, FAM, sockets={"stock": (0, B - 0.03, 0)}, proxy_slices=2)
    kit.part("ar_stock_sopmod", kit.entry("ar_stock_sopmod", anchor="butt"), kit.entry("ar_buffertube"))
    # M4 carbine ("waffle") stock: slimmer, lightening window, sling slot
    cpts = [(-0.152, B + 0.0165), (-0.03, B + 0.0205), (-0.006, B + 0.022), (0, B + 0.019), (0, B - 0.086),
            (-0.007, B - 0.093), (-0.03, B - 0.086), (-0.072, B - 0.048), (-0.1, B - 0.031), (-0.152, B - 0.021)]
    cs = stock_body("car", cpts, 0.036)
    cut(cs, prism("win", [(-0.022, B - 0.07), (-0.022, B - 0.027), (-0.064, B - 0.027)], 0.06, mat=None, bevel=0))
    cut(cs, prism("sl", lib.slot_pts(-0.012, B - 0.065, 0.004, 0.024), 0.06, mat=None, bevel=0))
    cpad = box("cpad", 0.0375, 0.108, 0.0025, -0.008, 0, B - 0.034, mat="rubber", bevel=0.003)
    clever = box("clev", 0.012, 0.006, -0.115, -0.15, 0, B - 0.023, mat="poly", bevel=0.0012)
    car = join("ar_stock_carbine", [cs, cpad, clever])
    kit.node(car, FAM, sockets={"stock": (0, B - 0.03, 0)}, proxy_slices=2)
    kit.part("ar_stock_carbine", kit.entry("ar_stock_carbine", anchor="butt"), kit.entry("ar_buffertube"))
    kit.BASES["sb16"]["nodes"] = [e for e in kit.BASES["sb16"]["nodes"] if e["node"] != "ar_buffertube"]
    kit.BASES["hb300"]["nodes"] = list(kit.BASES["sb16"]["nodes"])
    # PDW (HB-300): twin rods from a short housing, skeletal butt
    rods = [cyl("rod", 0.0042, -0.012, -0.17, B + 0.009, x, 12, "steel", 0.0003) for x in (-0.0115, 0.0115)]
    yoke = box("yoke", 0.036, 0.016, -0.006, -0.032, 0, B + 0.01, mat="anod", bevel=0.002)
    butt = prism("pb", [(0, B + 0.02), (0, B - 0.088), (-0.008, B - 0.094), (-0.016, B - 0.086), (-0.014, B - 0.004),
                        (-0.03, B + 0.004), (-0.03, B + 0.018)], 0.034, mat="poly", bevel=0.0015)
    lib.round_edges(butt, lambda m, a, b: (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), 0.004, 3)
    ppad = box("pp", 0.036, 0.098, 0.002, -0.006, 0, B - 0.04, mat="rubber", bevel=0.003)
    pdw = join("ar_stock_pdw", [*rods, yoke, butt, ppad])
    kit.node(pdw, FAM, sockets={"stock": (0, B - 0.03, 0)}, proxy_slices=2)
    kit.part("hb_stock_pdw", kit.entry("ar_stock_pdw", anchor="butt"), kit.entry("ar_pdwhousing"))
    # arm brace
    bpts = [(-0.165, B + 0.017), (-0.02, B + 0.021), (0, B + 0.017), (0, B - 0.062), (-0.012, B - 0.08),
            (-0.05, B - 0.062), (-0.09, B - 0.03), (-0.165, B - 0.019)]
    br = stock_body("br", bpts, 0.036)
    flaps = [lib.rbox("f", 0.004, 0.06, 0.07, s * 0.02, B - 0.04, -0.04, mat="rubber", bevel=0.0015) for s in (-1, 1)]
    brace = join("ar_brace", [br, *flaps])
    kit.node(brace, FAM, sockets={"stock": (0, B - 0.03, 0)}, proxy_slices=2)
    kit.part("ar_brace", kit.entry("ar_brace", anchor="butt"), kit.entry("ar_buffertube"))

    # ------------------------------------------------------------------ magazines: lofted along the STANAG curve
    # Rear edge: straight from the top, then a gentle forward curve; 61→64 mm deep; stamped side ribs (aluminium) or
    # PMAG-style smooth body with a grip-texture band; separate floor plate.
    def mag_frame(L, t, straight, R, top=(-0.0385, 0.0045)):
        s = t * L
        s0 = straight * L
        z, y = top[0], top[1] - min(s, s0)
        phi = 0.0
        if s > s0:
            phi = (s - s0) / R
            z += R * (math.cos(phi) - 1)
            y -= R * math.sin(phi)
        return (z, y), phi, (-math.cos(phi), math.sin(phi))

    for mid, drop, mat, w, alu in (("ar_mag_s20", 0.09, "phos", 0.0226, True), ("ar_mag_s30", 0.145, "phos", 0.0226, True),
                                   ("ar_mag_s40", 0.195, "phos", 0.0226, True), ("ar_mag_p20", 0.093, "poly", 0.0252, False),
                                   ("ar_mag_p30", 0.148, "poly", 0.0252, False), ("ar_mag_p40", 0.2, "poly", 0.0252, False)):
        L = drop + 0.014  # top sits ~18 mm up inside the well (traced GI 30: 159 mm overall)
        straight, R = (0.5, 0.8) if drop < 0.1 else (0.22, 0.34)
        rings = []
        N = 16
        for i in range(N + 1):
            t = i / N
            (z, y), phi, nn = mag_frame(L, t, straight, R)
            dd = 0.0615 + 0.002 * t
            bumps = ((0.1 * dd, 0.19 * dd, 0.0008), (0.81 * dd, 0.9 * dd, 0.0008)) if alu and 0.08 < t < 0.95 else ()
            loop = lib.rounded_rect_loop(w, dd, 0.0035, 3, bumps)
            rings.append([(u, y + nn[1] * v, z + nn[0] * v) for u, v in loop])
        body = lib.loft("mb", rings, mat=mat)
        (zb, yb), phib, nb = mag_frame(L, 1.0, straight, R)
        tb = (math.sin(phib), -math.cos(phib))  # down the mag
        th = 0.006 if alu else 0.011
        fr = []
        for k, off in enumerate((-0.001, th)):
            ww = w + (0.0016 if alu else 0.004)
            dd = 0.066 if alu else 0.069
            loop = lib.rounded_rect_loop(ww, dd, 0.004)
            fr.append([(u, yb + tb[1] * off + nb[1] * (v - 0.0025), zb + tb[0] * off + nb[0] * (v - 0.0025)) for u, v in loop])
        plate = lib.loft("fp", fr, mat=mat)
        plate["bevel"] = (0.0012, 2, 35)
        parts = [body, plate]
        if not alu:
            # texture band (grip material) on the lower sides
            for sx in (-1, 1):
                (z, y), phi, nn = mag_frame(L, 0.82, straight, R)
                band = lib.rbox("tx", 0.0008, 0.03, 0.04, sx * (w / 2), y, z + nn[0] * 0.03, mat="polyGrip", bevel=0)
                lib.xf(band, lib.Matrix.Translation((0, y, z + nn[0] * 0.03)) @ lib.Matrix.Rotation(phi, 4, "X")
                       @ lib.Matrix.Translation((0, -y, -(z + nn[0] * 0.03))))
                parts.append(band)
        follower = box("fo", w * 0.7, 0.004, -0.044, -0.085, 0, 0.0045 + 0.0015, mat="phos" if alu else "poly", bevel=0.001)
        parts.append(follower)
        mag = join(mid, parts)
        kit.node(mag, FAM, proxy_slices=3)
        kit.part(mid, kit.entry(mid, part="mag"))

    # ------------------------------------------------------------------ barrels (length × profile) + gas block
    profiles = {"ar_prof_pencil": 0.0081, "ar_prof_govt": 0.0093, "ar_prof_heavy": 0.0105}
    for bid, inches in (("ar_b103", 10.3), ("ar_b115", 11.5), ("ar_b125", 12.5), ("ar_b145", 14.5)):
        zm = BOLT_FACE - inches * IN
        for pid, r in profiles.items():
            name = f"{bid}_{pid}"
            L = inches * IN
            gz = BOLT_FACE - min(L - 0.04, 0.24 if L > 0.33 else 0.19)
            r_in = r + 0.0012  # under-handguard section, steps down ahead of the gas block
            b = lathe(name, [(0.0118, -0.09), (0.0118, -0.125), (r_in, -0.132), (r_in, gz + 0.012), (r_in - 0.0004, gz + 0.011),
                             (0.0098, gz + 0.011), (0.0098, gz - 0.013), (r, gz - 0.016), (r, zm + 0.015),
                             (r - 0.0012, zm + 0.013), (0.0074, zm + 0.013), (0.0074, zm), (0.003, zm), (0.003, zm + 0.004)],
                      24, B, 0, "phos", 0.0003)
            kit.node(join(name, [b]), FAM, proxies=[dict(type="capsule", a=[0, B, -0.09], b=[0, B, zm], r=r)])
        kit.part(bid, kit.entry(bid + "_{barrelProfile}"))
    for pid in profiles:
        kit.part(pid)
    for bid, inches in (("hb_b6_int", 6.0), ("hb_b55", 5.5), ("hb_b9", 9.0)):
        zm = BOLT_FACE - inches * IN
        b = lathe(bid, [(0.0118, -0.09), (0.0118, -0.125), (0.0095, -0.13), (0.0095, zm + 0.015), (0.0083, zm + 0.013),
                        (0.0078, zm + 0.013), (0.0078, zm), (0.0035, zm), (0.0035, zm + 0.004)], 24, B, 0, "phos", 0.0003)
        kit.node(join(bid, [b]), FAM)
        kit.part(bid, kit.entry(bid))
    gb = box("gb", 0.021, 0.026, 0.011, -0.011, 0, B + 0.002, mat="phos", bevel=0.002)
    for z in (0.005, -0.005):
        cut(gb, cyl("screw", 0.0018, z + 0.0018, z - 0.0018, B - 0.011, 0, 8, None, 0))
    kit.node(join("ar_gasblock", [gb]), FAM)
    for w in ("sb16", "hb300"):
        kit.BASES[w]["nodes"] = kit.BASES[w]["nodes"] + [kit.entry("ar_gasblock", anchor="gas")]

    # ------------------------------------------------------------------ muzzle devices (anchor 'muzzle': rear at z = 0)
    fh = P.outer("fh")
    fz0, fz1, fy0, fy1 = bbox(fh)
    prof = []
    nsteps = 22
    for i in range(nsteps + 1):
        z = fz1 - (fz1 - fz0) * i / nsteps
        sp_ = span_at_z(fh, z)
        if sp_:
            prof.append((max(0.0045, min(0.0115, sp_[1] - B)), z - fz1))
    a2 = lathe("a2", [(0.0039, 0)] + prof + [(0.0045, fz0 - fz1)], 24, B, 0, "phos", 0.0003)
    for i in range(5):
        a = math.radians(-72 + i * 36)
        c = box("s", 0.0025, 0.012, -0.02, -0.05, 0, B + 0.011, mat=None, bevel=0)
        lib.xf(c, lib.Matrix.Translation((0, B, 0)) @ lib.Matrix.Rotation(-a, 4, "Z") @ lib.Matrix.Translation((0, -B, 0)))
        cut(a2, c)
    tip = fz0 - fz1
    kit.node(join("ar_fh_a2", [a2]), FAM, sockets={"muzzle": (0, B, tip)})
    kit.part("ar_fh_a2", kit.entry("ar_fh_a2", anchor="muzzle"))

    from .devices import device

    device(FAM, "ar_bare", 0.012, 0.0095, "bare")
    device(FAM, "ar_fh_3p", 0.06, 0.0115, "prong")
    device(FAM, "ar_brake", 0.058, 0.0125, "brake")
    device(FAM, "ar_comp", 0.05, 0.012, "comp")
    device(FAM, "ar_supp", 0.165, 0.0195, "can")

    # ------------------------------------------------------------------ handguards (anchor 'hgRear': z0 = 0)
    for hid, L, slotted in (("ar_hg_mlok7", 7 * IN, (2, 3, 4, 5, 6)), ("ar_hg_mlok95", 9.5 * IN, (2, 3, 4, 5, 6)),
                            ("ar_hg_mlok13", 13 * IN, (2, 3, 4, 5, 6)), ("hb_hg_mlok5", 5 * IN, (2, 4, 6)),
                            ("hb_hg_mlok8", 8 * IN, (2, 4, 6))):
        parts = lib.mlok_handguard(hid, -0.001, -L, rail_y=RAIL_Y)
        n = join(hid, parts)
        kit.node(n, FAM, proxies=[dict(type="box", c=[0, B + 0.004, -L / 2], h=[0.0235, 0.027, L / 2])])
        kit.part(hid, kit.entry(hid, anchor="hgRear"))
    for hid, L in (("ar_hg_quad9", 9 * IN), ("ar_hg_quad12", 12 * IN)):
        sq = 0.0225
        body = sweep(hid, [(-sq, -sq + 0.006 + B), (-sq + 0.006, -sq + B), (sq - 0.006, -sq + B), (sq, -sq + 0.006 + B),
                           (sq, sq - 0.006 + B), (sq - 0.006, sq + B), (-sq + 0.006, sq + B), (-sq, sq - 0.006 + B)], 0, -L,
                     "anod", 0.0008)
        cut(body, cyl("in", 0.017, 0.01, -L - 0.01, B, 0, 20, None, 0))
        n_h = int((L - 0.03) / 0.022)
        for sx in (-1, 1):
            c = lib.cyl_x("v", 0.0042, sx * 0.015, sx * 0.03, B, -0.022, 14, None, 0)
            lib.array(c, n_h, (0, 0, -0.022))
            cut(body, c)
        done(body)
        rails = [lib.picatinny("r", -0.002, -L + 0.002, RAIL_Y, roll=a) for a in (0, math.pi / 2, math.pi, -math.pi / 2)]
        n = join(hid, [body, *rails])
        kit.node(n, FAM, proxies=[dict(type="box", c=[0, B, -L / 2], h=[0.031, 0.031, L / 2])])
        kit.part(hid, kit.entry(hid, anchor="hgRear"))
    # HB-300 integral shroud: slim M-LOK body with a rounded nose cap; the can sits inside
    L = 0.31
    parts = lib.mlok_handguard("hb_hg_int", -0.001, -L, R=0.0205, slotted=(2, 4, 6), rail_y=RAIL_Y)
    R = 0.0205
    nose = lathe("nose", [(R * 1.04, -L + 0.004), (R * 1.04, -L), (R * 0.92, -L - 0.008), (R * 0.7, -L - 0.013),
                          (0.0062, -L - 0.0145), (0.006, -L - 0.01), (0, -L - 0.01)], 32, B, 0, "anod", 0.0005)
    hb = join("hb_hg_int", parts + [nose])
    kit.node(hb, FAM, sockets={"muzzle": (0, B, RECV_FRONT - 0.001 - L - 0.0145)},
             proxies=[dict(type="capsule", a=[0, B, 0], b=[0, B, -L - 0.014], r=0.022)])
    kit.part("hb_hg_int", kit.entry("hb_hg_int", anchor="hgRear"))
    can = cyl("hb_can", 0.0165, -0.12, -0.41, B, 0, 20, "can", 0.0005)
    kit.node(join("hb_can_int", [can]), FAM)
    kit.part("hb_can_int", kit.entry("hb_can_int"))
    for gid in ("ar_grip_vert",):
        kit.part(gid, kit.entry("ar_grip_ergo"))
    print("[ar] grip bbox", gz0, gz1, gy0, gy1)
    # CC0 M4A1 base mesh for the receivers, A2 grip, carbine stock, 30-rd mags, birdcage and moving parts.
    from . import m4cc0

    m4cc0.apply(FAM)
