"""KP-9 (MP5-pattern) family, modelled over the traced HK MP5 right-side photo (profiles/kp9.json).

The photo is the truth for positions (the procedural KP-9 frame is compressed), so this family is authored in
place and the base carries socket/anchor overrides measured on it: muzzle, magwell, grips, charging handle.
Receiver (stamped steel, cocking tube), trigger group + grip (polymer), slim handguard, A3 retractable stock and
the curved 30-rd mag come from the photo; drum rear sight, hooded front sight, controls and the 15-rd mag are
parametric.
"""
import math

from . import kit, lib
from .lib import B, box, cut, cyl, cyl_x, done, join, lathe, prism
from .photo import Profile, bbox, span_at_y

FAM = "kp9"
GRIP_ANGLE = math.radians(17)


def build():
    lib.set_collection(FAM)
    P = Profile("kp9")
    mk = P.m
    big = 1.0

    def clip_y(o, y1):
        cut(o, box("c", big, big, big, -big, 0, y1 + big / 2, mat=None, bevel=0))

    def sround(o, r, seg=3, where=lambda m: True):
        lib.round_edges(o, lambda m, a, b: where(m) and (abs(a[0]) > 0.9) != (abs(b[0]) > 0.9), r, seg)

    # receiver + cocking tube + front sight block (sights replaced by parametric ones)
    rcv = prism("rcv", P.outer("receiver"), 0.031, mat="blued", bevel=0.001)
    clip_y(rcv, 0.0745)
    sround(rcv, 0.004, 3)
    done(rcv)
    front = prism("front", P.outer("front"), 0.025, mat="blued", bevel=0.0008)
    clip_y(front, 0.0745)
    fz0, fz1, fy0, fy1 = bbox(P.outer("front"))
    rz, ry = mk("rearSight")
    drum = cyl_x("drum", 0.0105, -0.011, 0.011, ry, rz, 24, "blued", 0.0006)
    for k in range(4):
        a = k * math.pi / 2
        cut(drum, cyl_x("ap", 0.0016, -0.02, 0.02, ry + math.cos(a) * 0.0068, rz + math.sin(a) * 0.0068, 10, None, 0))
    drum_base = box("db", 0.022, 0.012, rz + 0.017, rz - 0.017, 0, 0.0745 + 0.004, mat="blued", bevel=0.0015)
    ears = [box("e", 0.003, 0.018, rz + 0.012, rz - 0.012, x, ry - 0.004, mat="blued", bevel=0.0008) for x in (-0.0125, 0.0125)]
    fz, fy = mk("frontSight")
    hood = lathe("hood", [(0.0085, fz + 0.006), (0.0108, fz + 0.006), (0.0108, fz - 0.006), (0.0085, fz - 0.006)], 28,
                 fy, 0, "blued", 0.0004)
    hbase = box("hb", 0.016, fy - 0.0745 + 0.002, fz + 0.01, fz - 0.01, 0, (fy + 0.0745) / 2 - 0.004, mat="blued", bevel=0.0015)
    post = box("post", 0.0018, 0.009, fz + 0.0015, fz - 0.0015, 0, fy - 0.004, mat="blued", bevel=0.0003)
    port = box("port", 0.004, 0.012, -0.06, -0.105, 0.0155, 0.03, mat="dark", bevel=0)
    receiver = join("kp9_receiver", [rcv, front, drum, drum_base, *ears, hood, hbase, post, port])
    kit.node(receiver, FAM, proxy_slices=4)

    lo = prism("lower", P.outer("lower"), 0.03, mat="poly", bevel=0.0012)
    for h in P.holes("lower", min_area=1.5e-4):
        cut(lo, prism("h", h, 0.06, mat=None, bevel=0))
    sround(lo, 0.0055, 4, lambda m: m[1] < -0.03 and m[2] > -0.045)
    sround(lo, 0.002, 2, lambda m: m[1] >= -0.03 or m[2] <= -0.045)
    done(lo)
    pins = [cyl_x("pp", 0.003, -0.0165, 0.0165, mk(k)[1], mk(k)[0], 14, "steel", 0.0003) for k in ("pushPinRear", "pushPinFront")]
    lower = join("kp9_lower", [lo, *pins])
    print("[kp9] lower half-width at the finger rest %.1f mm → 12.5" % (lib.thin_x(lower, 0.035, 0.068, 0.0, 0.011, 0.0125) * 1000))
    in_grip = lambda p: p[1] < -0.055 and p[2] > -0.07  # noqa: E731
    feather = lambda p: max(0.0, min(1.0, (-0.04 - p[1]) / 0.015)) if p[2] > -0.07 else 0.0  # noqa: E731
    fit = lib.fit_grip(lower, 0.027, 0.043, 17, -0.08, in_grip, feather)
    print("[kp9] grip w×d %.1f×%.1f → %.1f×%.1f mm" % tuple(x * 1000 for x in fit))
    prox = lib.obb_proxies(lower, 3, in_grip, 17) + kit.auto_proxies_where(lower, lambda p: not in_grip(p), 2)
    kit.node(lower, FAM, proxies=prox)

    hgp = P.outer("handguard")
    hz0, hz1, hy0, hy1 = bbox(hgp)
    hg = prism("hg", hgp, 0.040, mat="polyGrip", bevel=0.001)
    sround(hg, 0.008, 4)
    handguard = join("kp9_hg_slim", [hg])
    kit.node(handguard, FAM, proxies=[dict(type="box", c=kit.r5((0, (hy0 + hy1) / 2, (hz0 + hz1) / 2)),
                                           h=kit.r5((0.021, (hy1 - hy0) / 2, (hz1 - hz0) / 2)))])
    kit.part("kp_hg_slim", kit.entry("kp9_hg_slim"))

    # A3 retractable stock (photo, extended) — anchor 'butt' (rear at z = 0)
    sp = P.outer("stock")
    sz0, sz1, sy0, sy1 = bbox(sp)
    st = prism("st", [(z - sz1, y) for z, y in sp], 0.04, mat="blued", bevel=0.001)
    sround(st, 0.003, 2)
    pad = box("pad", 0.042, 0.1, 0.002, -0.006, 0, (sy0 + sy1) / 2 - 0.01, mat="rubber", bevel=0.003)
    stock = join("kp9_stock_a3", [st, pad])
    kit.node(stock, FAM, sockets={"stock": (0, (sy0 + sy1) / 2, 0)}, proxy_slices=2)
    kit.part("kp_stock_a3", kit.entry("kp9_stock_a3", anchor="butt"))

    # magazines: photo 30-rd; 15-rd = the same curve, shorter
    mp = P.outer("mag")
    mz0, mz1, my0, my1 = bbox(mp)
    lip = my1
    for mid, drop in (("kp_mag30", 0.17), ("kp_mag15", 0.1)):
        k = drop / 0.17
        pts = [(z, lip + (y - lip) * k) for z, y in mp]
        body = prism("m", pts, 0.022, mat="blued", bevel=0.0008)
        za, zb = span_at_y(mp, lip - 0.002)
        topb = box("mt", 0.021, 0.012, zb, za, 0, lip + 0.005, mat="blued", bevel=0.0006)
        rib = prism("rib", [(z * 1.0, y) for z, y in pts[: len(pts) // 2]], 0.0005, mat="blued", bevel=0)
        lib.delete(rib)
        sround(body, 0.0015, 2)
        mag = join(mid, [body, topb])
        kit.node(mag, FAM, proxy_slices=3)
        kit.part(mid, kit.entry(mid, part="mag"))

    # controls: trigger, selector (left), mag catch paddle, charging handle (left, on the cocking tube)
    tz, ty = mk("triggerPin")
    trig = prism("t", [(tz + 0.006, ty - 0.003), (tz, ty - 0.004), (tz - 0.004, ty - 0.013), (tz - 0.002, ty - 0.024),
                       (tz + 0.001, ty - 0.024), (tz + 0.002, ty - 0.013), (tz + 0.006, ty - 0.008)], 0.005, mat="blued",
                 bevel=0.0006)
    kit.node(join("kp9_trigger", [trig], pivot=(0, ty, tz)), FAM)
    sz_, sy_ = -0.037, -0.014
    sel = [cyl_x("sd", 0.0065, -0.0168, -0.015, sy_, sz_, 18, "poly", 0.0005),
           lib.rbox("sl", 0.003, 0.004, 0.02, -0.0172, sy_ + 0.006, sz_ - 0.006, mat="poly", bevel=0.001)]
    kit.node(join("kp9_safety", sel, pivot=(-0.0155, sy_, sz_)), FAM)
    cz, cy = mk("magCatch")
    paddle = box("pad", 0.024, 0.008, cz + 0.004, cz - 0.004, 0, cy, mat="blued", bevel=0.0015)
    kit.node(join("kp9_magrelease", [paddle], pivot=(0, cy, cz)), FAM)
    chz, chy = -0.26, 0.052
    slot = box("slot", 0.0008, 0.004, chz + 0.07, chz - 0.01, -0.0158, chy, mat="dark", bevel=0)
    arm = box("arm", 0.016, 0.006, chz + 0.004, chz - 0.004, -0.023, chy, mat="blued", bevel=0.0015)
    knob = cyl("knob", 0.0055, chz + 0.007, chz - 0.007, chy, -0.033, 16, "poly", 0.0008)
    ch = join("kp9_ch", [arm, knob], pivot=(-0.013, chy, chz))
    kit.node(ch, FAM, sockets={"chargingHandle": (-0.033, chy, chz)})
    receiver_slot = slot
    lib.delete(receiver_slot)

    gx = math.sin(GRIP_ANGLE), -math.cos(GRIP_ANGLE)
    grip_pt = (0, gx[1] * 0.035 - 0.004, gx[0] * 0.035 - 0.02)
    kit.base("kp9", [kit.entry("kp9_receiver"), kit.entry("kp9_lower"), kit.entry("kp9_trigger", part="trigger"),
                     kit.entry("kp9_safety", part="safety"), kit.entry("kp9_magrelease", part="magRelease"),
                     kit.entry("kp9_ch", part="chargingHandle")],
             sockets={
                 "muzzle": (0, B, fz0),
                 "magwell": (0, lip - 0.04, (mz0 + mz1) / 2 + 0.01),
                 "gripRight": grip_pt,
                 "gripLeft": (-0.008, B - 0.022, (hz0 + hz1) / 2),
                 "ejectionPort": (0.016, 0.03, -0.085),
             },
             anchors={"muzzle": (0, 0, fz0 + 0.002), "hgRear": (0, 0, hz1), "hgFront": (0, 0, hz0)})
    from .devices import device

    device(FAM, "kp_fh", 0.045, 0.0115, "prong", "blued")
    device(FAM, "kp_supp", 0.18, 0.019, "can", "blued")
    kit.part("kp_b89")
    kit.part("kp_trilug")
    kit.part("kp_mount_none")
    print("[kp9] muzzle", fz0, "handguard", hz0, hz1, "mag", mz0, mz1, lip)
