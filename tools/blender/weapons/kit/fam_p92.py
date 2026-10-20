"""P-92 family = the CC-BY BURNER "Beretta Pistol FPS ANIMATION" pistol (assets/ATTRIBUTION.md), un-skinned in our
weapon frame by extract_sources.ts (the frame the pistol clips' gun track uses), moved up so the bore sits on
BORE_Y, split into: p92_frame (static), p92_slide (`CORREDERA`, part `slide`), p92_trigger (`GATILLO`),
p92_hammer (`PALANCA`, part `hammer`), p92_mag (`CARGADOR`, part `mag`), p92_slidestop (part `boltCatch`) and
p92_magrelease (part `magRelease`). Keeps the source textures.
"""
import json
import os

from . import kit, lib, src

FAM = "p92"
BAKE = False
DY = 0.03 - 0.0081  # Beretta bore (front-view measurement) → BORE_Y
BER = "assets/models/beretta/"


def build():
    lib.set_collection(FAM)
    objs = src.import_src("beretta", DY)
    piv = json.load(open(os.path.join(src.CACHE, "src_beretta.json")))["pivots"]
    P = {k: (v["pos"][0], v["pos"][1] + DY, v["pos"][2]) for k, v in piv.items()}

    def classify(mn, mx):
        if mx[0] < -0.009 and mn[2] > 0.012 and mx[2] < 0.056 and mx[2] - mn[2] > 0.025:
            return "slidestop"
        if mx[0] < -0.005 and mn[1] < -0.035 + DY and mx[1] > -0.05 + DY and 0.035 < mn[2] and mx[2] < 0.056 \
                and mx[2] - mn[2] < 0.02:
            return "magrelease"
        return "frame"

    g = src.split(objs["static"], classify)
    frame = src.set_pivot(g["frame"], (0, 0, 0), "p92_frame")
    smn, smx = src.bbox3(g["slidestop"])
    stop = src.set_pivot(g["slidestop"], (smx[0], (smn[1] + smx[1]) / 2, smx[2] - 0.003), "p92_slidestop")
    rmn, rmx = src.bbox3(g["magrelease"])
    rel = src.set_pivot(g["magrelease"], tuple((a + b) / 2 for a, b in zip(rmn, rmx)), "p92_magrelease")
    slide = src.set_pivot(objs["slide"], (0, 0, 0), "p92_slide")
    mag = src.set_pivot(objs["mag"], (0, 0, 0), "p92_mag")
    trig = src.set_pivot(objs["trigger"], P["trigger"], "p92_trigger")
    ham = src.set_pivot(objs["hammer"], P["hammer"], "p92_hammer")

    sv = src.verts3(slide)
    zmin = min(v[2] for v in sv)
    zmax = max(v[2] for v in sv)
    top = max(v[1] for v in sv if zmin + 0.03 < v[2] < zmax - 0.03)
    front_tip = max(v[1] for v in sv if v[2] < zmin + 0.015)
    rear_z = [v for v in sv if v[2] > zmax - 0.015]
    rear_top = max(v[1] for v in rear_z)
    rear_sight_z = sum(v[2] for v in rear_z if v[1] > rear_top - 0.001) / max(1, sum(1 for v in rear_z if v[1] > rear_top - 0.001))
    mv = src.verts3(mag)
    mbot = min(v[1] for v in mv)
    base_pts = [v for v in mv if v[1] < mbot + 0.004]
    mag_base = (0, sum(v[1] for v in base_pts) / len(base_pts), sum(v[2] for v in base_pts) / len(base_pts))
    fv = src.verts3(frame)
    ffront = min(v[2] for v in fv)
    muzzle_z = zmin + 0.001
    # grip: frame verts below the trigger guard, centre line 35 mm under the web
    gv = [v for v in fv if v[1] < -0.035 + DY and v[2] > 0.02]
    gy = -0.035 + DY - 0.01
    row = [v[2] for v in gv if abs(v[1] - gy) < 0.003]
    grip_mid = (min(row) + max(row)) / 2 if row else 0.06
    rail_bottom = min(v[1] for v in fv if v[2] < ffront + 0.03)

    # firing-hand band (grip socket ± the palm) to 24.5 mm wide (true-mesh audit: the palm sank into the 27 mm
    # panels); x only (socket, centreline, rake, depth unchanged), feathered into the frame and the mag well
    nb = lib.narrow_grip(frame, 0.0245, gy, 0.040, 0.030, 0.010, lambda p: p[1] < -0.035 + DY and p[2] > 0.02)
    print("[p92] hand-band width %.1f → %.1f mm" % (nb[0] * 1000, nb[1] * 1000))
    kit.node(frame, FAM, proxy_slices=3)
    kit.node(slide, FAM, proxy_slices=2)
    kit.node(mag, FAM, sockets={"magwell": mag_base}, proxy_slices=2)
    kit.node(trig, FAM)
    kit.node(ham, FAM)
    kit.node(stop, FAM)
    kit.node(rel, FAM)
    kit.FAMILIES[FAM]["materials"] = {
        "beretta": dict(kind="source", map=BER + "berettaColor.webp", normal=BER + "berettaNormal.webp",
                        rough=BER + "berettaRoughness.webp", metal=BER + "berettaMetallic.webp", ao=BER + "berettaAO.webp"),
    }
    kit.base("p92", [kit.entry("p92_frame"), kit.entry("p92_trigger", part="trigger"),
                     kit.entry("p92_hammer", part="hammer"), kit.entry("p92_slidestop", part="boltCatch"),
                     kit.entry("p92_magrelease", part="magRelease")],
             sockets={
                 "muzzle": (0, lib.B, muzzle_z),
                 "gripRight": (0, gy, grip_mid),
                 "chargingHandle": (0, lib.B + 0.004, zmax - 0.018),
                 "ejectionPort": (0.006, top - 0.004, (zmin + zmax) / 2 + 0.01),
                 "optic": (0, top, zmax - 0.03),
                 "underRail": (0, rail_bottom, ffront + 0.02),
             },
             anchors={"pistolRail": (0, rail_bottom, 0)},
             frame=dict(boltFaceZ=muzzle_z + 0.125, receiverFrontZ=ffront, receiverRearZ=zmax, railY=top,
                        ironRear=dict(z=rear_sight_z, y=(rear_top + front_tip) / 2), magwellZ=mag_base[2], magTopY=0.0))
    kit.part("p92_slide", kit.entry("p92_slide", part="slide"))
    kit.part("p92_b_std")
    kit.part("p92_bare")
    kit.part("p92_irons")
    kit.part("p92_mag15", kit.entry("p92_mag", part="mag"))
    print("[p92] frame", json.dumps(kit.BASES["p92"]["frame"]), "rear sight top", rear_top, "front tip", front_tip)
