"""Trace side-view part profiles from a scaled reference photo (white background, square-on).

    <venv with opencv>/python tools/blender/weapons/ref/trace.py <gun> <photo-dir>

Reference photos are NOT committed (see ref/README.md for their sources). This writes the traced outlines in the
weapon frame (metres; z rearward, y up, origin at the grip web, bore at y = BORE_Y) to profiles/<gun>.json, which the
Blender build reads, plus the photo's silhouette mask + its pixel→frame transform for the IoU check (ref/iou.py).
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from guns import GUNS  # noqa: E402

BORE_Y = 0.03


def mask_of(img, thr):
    m = (img.min(axis=2) < thr).astype(np.uint8)
    k = np.ones((3, 3), np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    # keep the biggest connected blob(s) (drop specks / shadows)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        big = np.argmax(st[1:, cv2.CC_STAT_AREA]) + 1
        keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 0.02 * st[big, cv2.CC_STAT_AREA]]
        m = np.isin(lab, keep).astype(np.uint8)
    return m


def poly_mask(shape, pts):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m


def chaikin(pts, it=2):
    for _ in range(it):
        out = []
        n = len(pts)
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        pts = out
    return pts


def contours(m, eps_px):
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1:
            continue  # holes handled with their parent
        if cv2.contourArea(c) < 30:
            continue
        outer = cv2.approxPolyDP(c, eps_px, True)[:, 0, :].tolist()
        holes = []
        j = hier[i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) > 60:
                holes.append(cv2.approxPolyDP(cs[j], eps_px, True)[:, 0, :].tolist())
            j = hier[j][0]
        out.append({"outer": outer, "holes": holes})
    return out


def main(gun, photo_dir):
    g = GUNS[gun]
    img = cv2.imread(os.path.join(photo_dir, g["photo"]))[:, :, ::-1]
    if g.get("flip"):
        img = img[:, ::-1].copy()
    m = mask_of(img, g.get("thr", 215))
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    s = g["pxPerM"] if "pxPerM" in g else (x1 - x0) / g["length"]  # px per metre
    W = m.shape[1]
    cs = g.get("cs", 1.0)

    def P(pt):
        """Config point (display coords of the unflipped photo when cs/flip are set) → working pixels."""
        x, y = pt[0] * cs, pt[1] * cs
        return (W - 1 - x if g.get("flip") else x, y)

    g["regions"] = {k: (v if v == "rest" else [P(q) for q in v]) for k, v in g["regions"].items()}
    g["marks"] = {k: P(v) for k, v in g.get("marks", {}).items()}
    bore_row = int(round(g["boreRow"] * cs))
    if "webPx" in g:
        wx, wy = P(g["webPx"])
        web_px = (wx, wy)
        bore_row = int(round(g["boreRow"] * cs))
    elif "origin" in g:
        # origin by a known frame z at a pixel column (e.g. AR receiver rear at z = 0.085)
        ox = P((g["origin"]["px"], 0))[0]
        web_px = (ox - g["origin"]["z"] * s, bore_row + BORE_Y * s)
    else:
        # grip web: deepest backstrap point under the tang (min rightmost-x over the band)
        a, b = g["webBand"]
        best = None
        for y in range(a, b):
            row = np.nonzero(m[y])[0]
            if row.size == 0:
                continue
            r = row.max()
            if best is None or r < best[0]:
                best = (r, y)
        web_px = (best[0] + g.get("webInset", 0) * s, best[1])

    def to3(p):
        """Pixels → weapon frame: z from the grip web column, y from the bore row (bore at BORE_Y)."""
        px, py = p
        return [round((px - web_px[0]) / s, 5), round(BORE_Y + (bore_row - py) / s, 5)]

    regions = {}
    used = np.zeros_like(m)
    for name, r in g["regions"].items():
        if r == "rest":
            continue
        rm = m & poly_mask(m.shape, r)
        used |= rm
        regions[name] = rm
    for name, r in g["regions"].items():
        if r == "rest":
            regions[name] = m & (1 - used)
    eps_of = lambda name: g.get("eps", {}).get(name, 0.00025) * s  # noqa: E731
    out = {
        "gun": gun,
        "photo": g["photo"],
        "source": g["source"],
        "pxPerM": s,
        "flip": bool(g.get("flip")),
        "webPx": web_px,
        "boreRow": bore_row,
        "size": [int(m.shape[1]), int(m.shape[0])],
        "bbox": [to3((x0, y1)), to3((x1, y0))],
        "regions": {},
        "marks": {k: to3(v) for k, v in g.get("marks", {}).items()},
    }
    for name, rm in regions.items():
        cs = contours(rm, eps_of(name))
        if name in g.get("smooth", []):
            cs = [{"outer": chaikin(c["outer"]), "holes": [chaikin(h) for h in c["holes"]]} for c in cs]
        out["regions"][name] = [
            {"outer": [to3(p) for p in c["outer"]], "holes": [[to3(p) for p in h] for h in c["holes"]]}
            for c in cs
        ]
    os.makedirs(os.path.join(HERE, "..", "profiles"), exist_ok=True)
    with open(os.path.join(HERE, "..", "profiles", f"{gun}.json"), "w") as f:
        json.dump(out, f, indent=1)
    cache = os.path.join(HERE, "..", ".cache")
    os.makedirs(cache, exist_ok=True)
    cv2.imwrite(os.path.join(cache, f"mask_{gun}.png"), m * 255)
    cv2.imwrite(os.path.join(cache, f"photo_{gun}.png"), img[:, :, ::-1])
    # debug: regions coloured
    dbg = img.copy() // 2 + 64
    cols = [(255, 60, 60), (60, 200, 60), (60, 90, 255), (240, 200, 40), (200, 60, 220), (40, 220, 220)]
    for i, (name, rm) in enumerate(regions.items()):
        dbg[rm > 0] = (dbg[rm > 0] * 0.4 + np.array(cols[i % len(cols)]) * 0.6).astype(np.uint8)
    cv2.circle(dbg, (int(web_px[0]), int(web_px[1])), 8, (255, 0, 255), -1)
    cv2.line(dbg, (0, bore_row), (dbg.shape[1], bore_row), (255, 0, 0), 1)
    for k, v in g["marks"].items():
        cv2.circle(dbg, (int(v[0]), int(v[1])), 6, (0, 0, 0), 2)
    cv2.imwrite(os.path.join(cache, f"regions_{gun}.png"), dbg[:, :, ::-1])
    print(gun, "px/mm", round(s / 1000, 3), "web", web_px, "bbox", out["bbox"],
          {k: len(v) for k, v in out["regions"].items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
