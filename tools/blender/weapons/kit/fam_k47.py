"""K-47S family = the CC-BY BURNER "AK74U" Krinkov (assets/ATTRIBUTION.md), un-skinned in our weapon frame by
extract_sources.ts (the same frame the AK animation clips' gun track uses), moved down 13.5 mm so its bore sits
on BORE_Y, and split into kit pieces with its own textures:

  k47_receiver (static), k47_handguard, k47_booster, k47_grip, k47_stock (part `stock`, fold hinge pivot),
  k47_mag (part `mag`), k47_bolt (carrier + handle, bone `recam`), k47_trigger (`gatillo`),
  k47_magcatch (`seg` — the clips move it during reloads: it is the mag catch → part `magRelease`),
  k47_selector (the right-side safety lever, part `safety`, pivot at its rear).

The rear-sight leaf is lowered 5 mm so the notch sits level with the front post tip (the source leaf is raised).
"""
import json
import os

from . import kit, lib, src

FAM = "k47"
BAKE = True  # only the parametric alternates (muzzle devices) are baked; the Krinkov keeps its textures
DY = 0.03 - 0.0435  # Krinkov bore (muzzle centre) → BORE_Y
AK = "assets/models/ak74u/"


def build():
    lib.set_collection(FAM)
    objs = src.import_src("ak", DY)
    piv = json.load(open(os.path.join(src.CACHE, "src_ak.json")))["pivots"]
    P = {k: (v["pos"][0], v["pos"][1] + DY, v["pos"][2]) for k, v in piv.items()}

    def classify(mn, mx):
        y = DY
        cx = [(a + b) / 2 for a, b in zip(mn, mx)]
        if cx[2] < -0.27:
            return "muzzle"
        if mn[2] > -0.24 and mx[2] < -0.12 and mx[2] - mn[2] > 0.08:
            return "handguard"
        if mn[2] > 0.126:
            return "stock"
        if mn[1] < -0.05 + y and mn[2] > 0.03 and mx[1] < 0.02 + y:
            return "grip"
        if abs(cx[0]) < 0.003 and -0.062 < cx[2] < -0.035 and mn[1] > 0.079 + y:
            return "leaf"
        if mn[0] > 0.013 and mn[2] < -0.03 and mx[2] > 0.05:
            return "selector"
        return "receiver"

    g = src.split(objs["static"], classify)
    lib.move(g["leaf"], dy=-0.005)
    recv = src.join_objs([g["receiver"], g["leaf"]], "k47_receiver")
    src.set_pivot(recv, (0, 0, 0), "k47_receiver")
    print("[k47] receiver half-width at the finger rest %.1f mm → 13.0" % (lib.thin_x(recv, 0.035, 0.068, 0.0, 0.011, 0.013) * 1000))
    hg = src.set_pivot(g["handguard"], (0, 0, 0), "k47_handguard")
    booster = src.set_pivot(g["muzzle"], (0, 0, 0), "k47_booster")
    grip = src.set_pivot(g["grip"], (0, 0, 0), "k47_grip")
    hinge = (-0.0185, lib.B, 0.127)
    stock = src.set_pivot(g["stock"], hinge, "k47_stock")
    smn, smx = src.bbox3(g["selector"])
    sel = src.set_pivot(g["selector"], (smx[0] - 0.002, (smn[1] + smx[1]) / 2, smx[2] - 0.004), "k47_selector")
    mag = src.set_pivot(objs["mag"], (0, 0, 0), "k47_mag")
    bolt = src.set_pivot(objs["bolt"], P["bolt"], "k47_bolt")
    trig = src.set_pivot(objs["trigger"], P["trigger"], "k47_trigger")
    catch = src.set_pivot(objs["safety"], P["safety"], "k47_magcatch")

    bmn, bmx = src.bbox3(booster)
    muzzle = (0, lib.B, bmn[2])
    bl_mn, bl_mx = src.bbox3(bolt)
    gmn, gmx = src.bbox3(grip)
    stmn, stmx = src.bbox3(stock)
    hmn, hmx = src.bbox3(hg)
    mmn, mmx = src.bbox3(mag)
    # magwell mouth = receiver bottom over the mag (the procedural convention: 4 cm below the mouth)
    recv_bottom = 0.0176 + DY
    kit.node(recv, FAM, proxy_slices=4)
    kit.node(hg, FAM, proxies=[dict(type="capsule", a=kit.r5((0, lib.B - 0.002, hmx[2])), b=kit.r5((0, lib.B - 0.002, hmn[2])),
                                    r=round((hmx[0] - hmn[0]) / 2, 5))])
    kit.node(booster, FAM, sockets={"muzzle": muzzle})
    fit = lib.fit_grip(grip, 0.027, 0.043, 22, -0.045)
    print("[k47] grip w×d %.1f×%.1f → %.1f×%.1f mm" % tuple(x * 1000 for x in fit))
    kit.node(grip, FAM, proxies=lib.obb_proxies(grip, 3, angle_deg=22))
    kit.node(stock, FAM, sockets={"stock": (0, (stmn[1] + stmx[1]) / 2, stmx[2])}, proxy_slices=3)
    kit.node(sel, FAM)
    kit.node(mag, FAM, proxy_slices=3)
    kit.node(bolt, FAM, sockets={"chargingHandle": (bl_mx[0] - 0.003, (bl_mn[1] + bl_mx[1]) / 2 + 0.004, bl_mn[2] + 0.005)})
    kit.node(trig, FAM)
    kit.node(catch, FAM)

    kit.FAMILIES[FAM]["materials"] = {
        "Krinkov": dict(kind="source", map=AK + "Krinkov_Color.webp", normal=AK + "Krinkov_NRM.webp",
                        rough=AK + "Krinkov_Rough.webp", metal=AK + "Krinkov_Metal.webp", ao=AK + "Krinkov_AO.webp"),
        "Magazine": dict(kind="source", map=AK + "Magazine_Color.webp", normal=AK + "Magazine_NRM.webp",
                         rough=AK + "Magazine_Rough.webp", metal=AK + "Magazine_Metal.webp"),
    }
    kit.base("k47s", [kit.entry("k47_receiver"), kit.entry("k47_bolt", part="bolt"),
                      kit.entry("k47_trigger", part="trigger"), kit.entry("k47_magcatch", part="magRelease"),
                      kit.entry("k47_selector", part="safety")],
             sockets={
                 "muzzle": muzzle,
                 "magwell": (0, recv_bottom - 0.04, (mmn[2] + mmx[2]) / 2 + 0.012),
                 "ejectionPort": (0.016, 0.055 + DY, -0.07),
                 "gripRight": (0, gmn[1] + 0.045, (gmn[2] + gmx[2]) / 2 - 0.004),
                 "gripLeft": (-0.008, lib.B - 0.022, (hmn[2] + hmx[2]) / 2),
             },
             anchors={"muzzle": (0, 0, -0.262), "hgRear": (0, 0, hmx[2]), "hgFront": (0, 0, hmn[2])},
             fold=dict(pivot=kit.r5(hinge), angle=3.0944, shift=[-0.019, 0, 0]),
             frame=dict(ironRear=dict(z=-0.047, y=0.0870 + DY)))
    kit.part("ak_b85")
    kit.part("ak_booster", kit.entry("k47_booster"))
    kit.part("ak_hg_wood", kit.entry("k47_handguard"))
    kit.part("ak_mount_none")
    kit.part("ak_stock_triangle", kit.entry("k47_stock", part="stock"))
    kit.part("ak_grip_poly", kit.entry("k47_grip"))
    # the Krinkov art has one grip and one (plum) handguard: the other material choices reuse them
    for pid in ("ak_grip_wood", "ak_grip_ergo"):
        kit.part(pid, kit.entry("k47_grip"))
    for pid in ("ak_hg_plum", "ak_hg_poly"):
        kit.part(pid, kit.entry("k47_handguard"))
    kit.part("ak_mag_steel30", kit.entry("k47_mag", part="mag"))
    # same Krinkov mag mesh + texture for the other 30-rd materials (no separate source art)
    kit.part("ak_mag_bake30", kit.entry("k47_mag", part="mag"))
    kit.part("ak_mag_poly30", kit.entry("k47_mag", part="mag"))
    from .devices import device

    device(FAM, "ak_slant", 0.04, 0.0115, "brake", "blued")
    device(FAM, "ak_fh", 0.058, 0.012, "prong", "blued")
    device(FAM, "ak_brake", 0.062, 0.014, "brake", "blued")
    device(FAM, "ak_supp", 0.175, 0.0205, "can", "blued")
