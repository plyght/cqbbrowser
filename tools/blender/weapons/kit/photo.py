"""Photo-traced side profiles (profiles/<gun>.json from ref/trace.py) for the parametric families."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def poly_area(p):
    a = 0.0
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % len(p)]
        a += x0 * y1 - x1 * y0
    return a / 2


class Profile:
    def __init__(self, gun):
        with open(os.path.join(HERE, "..", "profiles", f"{gun}.json")) as f:
            self.d = json.load(f)
        self.marks = {k: tuple(v) for k, v in self.d["marks"].items()}

    def outer(self, region, i=None):
        """Largest (or i-th) outer contour of a region as [(z, y), ...]."""
        cs = self.d["regions"][region]
        cs = sorted(cs, key=lambda c: -abs(poly_area(c["outer"])))
        c = cs[i or 0]
        return [tuple(p) for p in c["outer"]]

    def holes(self, region, min_area=4e-6):
        cs = sorted(self.d["regions"][region], key=lambda c: -abs(poly_area(c["outer"])))
        return [[tuple(p) for p in h] for h in cs[0]["holes"] if abs(poly_area(h)) > min_area]

    def m(self, k):
        return self.marks[k]


def span_at_y(poly, y):
    """z extent of a polygon along the horizontal line y (min, max) or None."""
    zs = []
    for i in range(len(poly)):
        z0, y0 = poly[i]
        z1, y1 = poly[(i + 1) % len(poly)]
        if (y0 - y) * (y1 - y) <= 0 and y0 != y1:
            zs.append(z0 + (y - y0) * (z1 - z0) / (y1 - y0))
    return (min(zs), max(zs)) if zs else None


def span_at_z(poly, z):
    ys = []
    for i in range(len(poly)):
        z0, y0 = poly[i]
        z1, y1 = poly[(i + 1) % len(poly)]
        if (z0 - z) * (z1 - z) <= 0 and z0 != z1:
            ys.append(y0 + (z - z0) * (y1 - y0) / (z1 - z0))
    return (min(ys), max(ys)) if ys else None


def bbox(poly):
    zs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(zs), max(zs), min(ys), max(ys)


def line_hits(poly, c, d):
    """Parameters s where the line c + s·d crosses the polygon edges (2D, (z, y))."""
    out = []
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = x1 - x0, y1 - y0
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        wx, wy = x0 - c[0], y0 - c[1]
        s = (wx * ey - wy * ex) / den
        u = (wx * d[1] - wy * d[0]) / den
        if 0 <= u <= 1:
            out.append(s)
    return sorted(out)
