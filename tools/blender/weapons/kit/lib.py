"""Hard-surface modelling helpers for the weapon kit.

Every helper takes coordinates in the three.js WEAPON frame (metres): x = shooter's right, y = up, z = rearward
(-z is the muzzle), origin at the grip. They convert to Blender (Z up) with T(x, y, z) = (x, -z, y), which is
exactly what the glTF exporter undoes, so exported nodes come back in the weapon frame.

Workflow per piece: build closed primitives (profile prisms, sweeps, lathes, boxes) → boolean cuts (exact solver;
arrays of cutters for rail teeth, M-LOK slots, serrations, vents) → `finish()` = bevel (limit by angle, harden
normals) + weighted normals + smooth-by-angle, modifiers applied → `join()` pieces into one kit node.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

B = 0.03  # bore axis height (BORE_Y)

# three frame -> blender frame
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Ci = C.inverted()


def T(x, y, z):
    return Vector((x, -z, y))


def m3(mt):
    """A 4x4 matrix in three space -> the same transform in blender space."""
    return C @ mt @ Ci


def rot3(rx=0.0, ry=0.0, rz=0.0, pos=(0, 0, 0)):
    """three.js Euler XYZ rotation + translation, as a three-space matrix."""
    rot = Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rz, 4, "Z")
    return Matrix.Translation(Vector(pos)) @ rot


def xf(o, mt):
    """Apply a three-space transform to an object's mesh data."""
    o.data.transform(m3(mt))
    o.data.update()
    return o


def move(o, dx=0.0, dy=0.0, dz=0.0):
    return xf(o, Matrix.Translation(Vector((dx, dy, dz))))


# ------------------------------------------------------------------ scene / objects

_coll = None


def set_collection(name):
    global _coll
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    _coll = c
    return c


def obj_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    (_coll or bpy.context.scene.collection).objects.link(o)
    if mat is not None:
        from . import mats

        me.materials.append(mats.get(mat))
    return o


def delete(o):
    me = o.data if o.type == "MESH" else None
    bpy.data.objects.remove(o, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


# ------------------------------------------------------------------ primitives


def prism(name, pts, width, x=0.0, mat="anod", bevel=0.0008, seg=2, angle=30):
    """Side profile pts [(z, y), ...] extruded along x, centred on x. Bevel applied later by finish()."""
    bm = bmesh.new()
    vs = [bm.verts.new(T(x - width / 2, y, z)) for z, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=Vector((width, 0, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o["bevel"] = (bevel, seg, angle)
    return o


def sweep(name, pts, z0, z1, mat="anod", bevel=0.0006, seg=2, angle=30):
    """Cross-section pts [(x, y), ...] extruded along z from z0 to z1."""
    bm = bmesh.new()
    vs = [bm.verts.new(T(px, py, z0)) for px, py in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=T(0, 0, z1 - z0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o["bevel"] = (bevel, seg, angle)
    return o


def lathe(name, pts, segs=24, y=B, x=0.0, mat="steel", bevel=0.0, seg=2, angle=30, phase=0.0):
    """Revolve pts [(r, z), ...] (open polyline, r >= 0) around the axis parallel to z through (x, y)."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = phase + 2 * math.pi * i / segs
        ring = []
        for r, z in pts:
            ring.append(bm.verts.new(T(x + math.sin(a) * r, y + math.cos(a) * r, z)))
        rings.append(ring)
    n = len(pts)
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for k in range(n - 1):
            quad = [a[k], b[k], b[k + 1], a[k + 1]]
            if pts[k][0] < 1e-7 and pts[k + 1][0] < 1e-7:
                continue
            try:
                bm.faces.new(quad)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    # cap open ends (first/last profile point with r > 0)
    bm.verts.ensure_lookup_table()
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o["bevel"] = (bevel, seg, angle)
    o["smooth"] = 1
    return o


def cyl(name, r, z0, z1, y=B, x=0.0, segs=16, mat="steel", bevel=0.0003):
    return lathe(name, [(0, z0), (r, z0), (r, z1), (0, z1)], segs, y, x, mat, bevel)


def box(name, w, h, z0, z1, x=0.0, y=0.0, mat="anod", bevel=0.0008, seg=2):
    """Axis box: width w (x) × height h (y) centred on (x, y), from z0 to z1 (like boxZ in geom.ts)."""
    hw, hh = w / 2, h / 2
    return sweep(name, [(x - hw, y - hh), (x + hw, y - hh), (x + hw, y + hh), (x - hw, y + hh)], z0, z1, mat, bevel, seg)


def rbox(name, w, h, d, x=0.0, y=0.0, z=0.0, mat="anod", bevel=0.001, seg=2):
    return box(name, w, h, z + d / 2, z - d / 2, x, y, mat, bevel, seg)


def cyl_x(name, r, x0, x1, y, z, segs=14, mat="steel", bevel=0.0003):
    """Cylinder along x (pins, buttons, screws)."""
    o = lathe(name, [(0, 0), (r, 0), (r, x1 - x0), (0, x1 - x0)], segs, 0, 0, mat, bevel)
    # lathe axis is +z(three) from 0 → (x1-x0); rotate so it runs along +x
    xf(o, Matrix.Translation(Vector((x0, y, z))) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    return o


def cyl_y(name, r, y0, y1, x, z, segs=16, mat="anod", bevel=0.0004):
    """Cylinder along y (turrets, knobs)."""
    o = lathe(name, [(0, 0), (r, 0), (r, y1 - y0), (0, y1 - y0)], segs, 0, 0, mat, bevel)
    xf(o, Matrix.Translation(Vector((x, y0, z))) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    return o


def slot_pts(cx, cy, length, w, n=6):
    """Rounded slot outline in a 2D plane (along the first axis)."""
    r = w / 2
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((cx + length / 2 - r + math.cos(a) * r, cy + math.sin(a) * r))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((cx - length / 2 + r + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def circle_pts(cx, cy, r, n=16, a0=0.0):
    return [(cx + math.cos(a0 + 2 * math.pi * i / n) * r, cy + math.sin(a0 + 2 * math.pi * i / n) * r) for i in range(n)]


def round_rect(cx, cy, w, h, r, seg=3):
    out = []
    corners = [(cx + w / 2 - r, cy + h / 2 - r, 0), (cx - w / 2 + r, cy + h / 2 - r, math.pi / 2),
               (cx - w / 2 + r, cy - h / 2 + r, math.pi), (cx + w / 2 - r, cy - h / 2 + r, 1.5 * math.pi)]
    for x, y, a0 in corners:
        for i in range(seg + 1):
            a = a0 + (i / seg) * math.pi / 2
            out.append((x + math.cos(a) * r, y + math.sin(a) * r))
    return out


# ------------------------------------------------------------------ modifiers


def array(o, count, step3, apply=True):
    """Array the object along a three-space step vector."""
    m = o.modifiers.new("arr", "ARRAY")
    m.count = count
    m.use_relative_offset = False
    m.use_constant_offset = True
    m.constant_offset_displace = m3(Matrix.Translation(Vector(step3))).to_translation()
    if apply:
        apply_mods(o)
    return o


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=m.name)


def cut(o, *cutters, solver="EXACT", keep=False):
    """Boolean difference of every cutter from o (applied); cutters deleted unless keep."""
    for c in cutters:
        if c is None:
            continue
        m = o.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = solver
        m.object = c
        apply_mods(o)
        if not keep:
            delete(c)
    return o


def union(o, *others, solver="EXACT"):
    for c in others:
        m = o.modifiers.new("uni", "BOOLEAN")
        m.operation = "UNION"
        m.solver = solver
        m.object = c
        apply_mods(o)
        delete(c)
    return o


def finish(o, bevel=None, seg=None, angle=None, weighted=True):
    """Bevel (limit by angle, harden normals) + weighted normals + smooth-by-angle; modifiers applied."""
    bw, bs, ba = o.get("bevel", (0.0008, 2, 30))
    bw = bw if bevel is None else bevel
    bs = bs if seg is None else seg
    ba = ba if angle is None else angle
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40 if o.get("smooth") else 30))
    if bw > 0:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bw
        m.segments = int(bs)
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(ba)
        m.harden_normals = True
        m.use_clamp_overlap = True
        m.miter_outer = "MITER_ARC"
    t = o.modifiers.new("tri", "TRIANGULATE")
    t.min_vertices = 5
    t.quad_method = "BEAUTY"
    t.ngon_method = "BEAUTY"
    t.keep_custom_normals = True
    if weighted:
        w = o.modifiers.new("wn", "WEIGHTED_NORMAL")
        w.keep_sharp = True
        w.weight = 50
    apply_mods(o)
    return o


def join(name, objs, pivot=(0, 0, 0)):
    """Finish (if not yet) and join objects into one kit node with its origin at `pivot` (three frame)."""
    objs = [o for o in objs if o is not None]
    for o in objs:
        if not o.get("done"):
            finish(o)
            o["done"] = 1
    base = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    # origin at pivot: move mesh by -pivot, object location = pivot
    p = T(*pivot)
    base.data.transform(Matrix.Translation(-p))
    base.location = p
    for k in ("bevel", "smooth", "done"):
        if k in base:
            del base[k]
    return base


def done(o):
    """Finish now (so later booleans/joins don't re-bevel)."""
    finish(o)
    o["done"] = 1
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def round_edges(o, pick, offset, segments=3, profile=0.5):
    """Bevel the edges for which pick(mid3, n0, n1) is true (mid3 = three-frame midpoint, n = three-frame face
    normals) — big radii for rounded grips/guards that the angle-limited finish bevel shouldn't touch."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    sel = []
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a, b = e.verts
        m = (a.co + b.co) / 2
        mid = (m.x, m.z, -m.y)
        n0, n1 = (tuple((f.normal.x, f.normal.z, -f.normal.y)) for f in e.link_faces)
        if pick(mid, n0, n1):
            sel.append(e)
    if sel:
        bmesh.ops.bevel(bm, geom=sel + list({v for e in sel for v in e.verts}), offset=offset, offset_type="OFFSET",
                        segments=segments, profile=profile, affect="EDGES", clamp_overlap=True)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return len(sel)


# ------------------------------------------------------------------ rails & handguards


def picatinny(name, z0, z1, ytop, mat="anod", x=0.0, base=0.0064, roll=0.0, axis_y=None):
    """MIL-STD-1913 rail from z0 (rear) to z1 (front), top surface at ytop: dovetail cross-section swept along z,
    recoil slots cut by an arrayed cutter (5.23 mm slots on a 10.01 mm pitch). `roll` rotates it about the bore
    (axis_y) for side/bottom rails."""
    t = ytop
    sec = [(-0.0084, t - base), (0.0084, t - base), (0.0084, t - 0.0046), (0.0106, t - 0.0029), (0.0106, t - 0.0012),
           (0.0094, t), (-0.0094, t), (-0.0106, t - 0.0012), (-0.0106, t - 0.0029), (-0.0084, t - 0.0046)]
    sec = [(px + x, py) for px, py in sec]
    r = sweep(name, sec, z0, z1, mat, bevel=0.0003, seg=1, angle=40)
    n = int((z0 - z1 - 0.004) / 0.01001)
    if n > 0:
        start = z0 - ((z0 - z1) - (n - 1) * 0.01001) / 2
        c = box("slot", 0.03, 0.0032, start + 0.00262, start - 0.00262, x, t, mat=None, bevel=0)
        array(c, n, (0, 0, -0.01001))
        cut(r, c)
    if roll:
        ay = B if axis_y is None else axis_y
        xf(r, Matrix.Translation((0, ay, 0)) @ Matrix.Rotation(roll, 4, "Z") @ Matrix.Translation((0, -ay, 0)))
    return r


def oct_pts(R, a0=math.pi / 8, y=B):
    """Octagon with apothem R around (0, y)."""
    k = R / math.cos(math.pi / 8)
    return [(math.sin(a0 + i * math.pi / 4) * k, y + math.cos(a0 + i * math.pi / 4) * k) for i in range(8)]


def mlok_handguard(name, z0, z1, R=0.0200, wall=0.0022, mat="anod", slotted=(2, 3, 4, 5, 6), rail_y=0.061):
    """Octagonal free-float M-LOK handguard (apothem R) from z0 (receiver face) to z1, slots on the given faces
    (k × 45°, 0 = top), full-length top rail, chamfered front ring."""
    outer = sweep(name, oct_pts(R), z0, z1, mat, bevel=0.0007, seg=2, angle=30)
    inner = sweep("in", oct_pts(R - wall), z0 + 0.01, z1 - 0.01, None, bevel=0)
    cut(outer, inner)
    L = z0 - z1
    n = max(1, int((L - 0.03) / 0.04))
    start = z0 - (L - (n - 1) * 0.04) / 2
    for k in slotted:
        c = prism("ml", slot_pts(start, B, 0.032, 0.0076), 0.012, x=R, mat=None, bevel=0)
        array(c, n, (0, 0, -0.04))
        a = k * math.pi / 4
        xf(c, Matrix.Translation((0, B, 0)) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Z") @ Matrix.Translation((0, -B, 0)))
        cut(outer, c)
    # front ring chamfer + rear clamp
    done(outer)
    rail = picatinny(name + "_rail", z0 - 0.001, z1 + 0.002, rail_y, mat)
    standoff = box(name + "_so", 0.014, rail_y - 0.0064 - (B + R) + 0.001, z0, z1 + 0.002, 0, (rail_y - 0.0064 + B + R) / 2,
                   mat, bevel=0.0004)
    return [outer, rail, standoff]


def loft(name, rings, mat="poly", cap=True, bevel=0.0, smooth=True):
    """Skin a list of closed rings (each a list of three-frame (x, y, z) points, equal counts) into a solid:
    quads between consecutive rings, n-gon caps at both ends. For rounded grips, curved mags, stock bodies."""
    bm = bmesh.new()
    vr = [[bm.verts.new(T(*p)) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap:
        bm.faces.new(list(reversed(vr[0])))
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o["bevel"] = (bevel, 2, 35)
    if smooth:
        o["smooth"] = 1
    return o


def superellipse(a, b, n=2.6, segs=24, a0=0.0):
    """Closed superellipse |u/a|^n + |v/b|^n = 1 as [(u, v)] (n = 2 ellipse, larger = boxier)."""
    out = []
    for i in range(segs):
        t = a0 + 2 * math.pi * i / segs
        c, s = math.cos(t), math.sin(t)
        out.append((a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s)))
    return out


def rounded_rect_loop(w, d, r, seg=3, bumps=()):
    """Rounded rectangle loop in (u = across, v = depth 0..d), u in [-w/2, w/2]; `bumps` = [(v0, v1, h)] raised
    bands on both long sides (stamped mag ribs). Counter-clockwise, constant point count for lofting."""
    pts = []

    def side(u_sign, v_from, v_to, k=10):
        for i in range(k + 1):
            v = v_from + (v_to - v_from) * i / k
            h = 0.0
            for v0, v1, hh in bumps:
                if v0 <= v <= v1:
                    t = (v - v0) / (v1 - v0)
                    h = max(h, hh * math.sin(math.pi * min(1.0, max(0.0, t))) ** 0.5)
            pts.append((u_sign * (w / 2 + h), v))

    def arc(cx, cv, a0):
        for i in range(1, seg):
            a = a0 + (i / seg) * math.pi / 2
            pts.append((cx + math.cos(a) * r, cv + math.sin(a) * r))

    side(1, r, d - r)
    arc(w / 2 - r, d - r, 0)
    pts += [(w / 2 - r, d), (-w / 2 + r, d)]
    arc(-w / 2 + r, d - r, math.pi / 2)
    side(-1, d - r, r)
    arc(-w / 2 + r, r, math.pi)
    pts += [(-w / 2 + r, 0), (w / 2 - r, 0)]
    arc(w / 2 - r, r, 1.5 * math.pi)
    return pts


# ------------------------------------------------------------------ grip envelope (hand fit)


def _pts3(o):
    mw = o.matrix_world
    return [((mw @ v.co).x, (mw @ v.co).z, -(mw @ v.co).y) for v in o.data.vertices]


def grip_axis(pts):
    """Principal axis of points in the side (z, y) plane → (centre (z, y), unit down-axis d, depth dir n)."""
    n = len(pts)
    cz = sum(p[2] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    szz = sum((p[2] - cz) ** 2 for p in pts) / n
    syy = sum((p[1] - cy) ** 2 for p in pts) / n
    szy = sum((p[2] - cz) * (p[1] - cy) for p in pts) / n
    ang = 0.5 * math.atan2(2 * szy, szz - syy)
    dz, dy = math.cos(ang), math.sin(ang)
    if abs(dy) < abs(dz):  # pick the long (down) axis
        dz, dy = -dy, dz
    if dy > 0:
        dz, dy = -dz, -dy
    return (cz, cy), (dz, dy), (-dy, dz) if -dy >= 0 else (dy, -dz)


def grip_section(o, angle_deg, y_hand, pred=lambda p: True):
    """Cross-section of o's grip perpendicular to the grip axis (rake angle_deg back from vertical) at the hand
    height y_hand: returns (width, depth, centre (z, y), down-axis d, depth dir n, x_mid, s_mid)."""
    a = math.radians(angle_deg)
    d = (math.sin(a), -math.cos(a))  # (z, y) down the grip, raked back
    n = (math.cos(a), math.sin(a))
    def bisect(co, no):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
        out = [(v.co.x, v.co.z, -v.co.y) for v in r["geom_cut"] if isinstance(v, bmesh.types.BMVert)]
        bm.free()
        return [p for p in out if pred(p)]

    row = bisect(T(0, y_hand, 0), T(0, 1, 0) - T(0, 0, 0))
    if not row:
        return None
    zc = (min(p[2] for p in row) + max(p[2] for p in row)) / 2
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=T(0, y_hand, zc),
                                 plane_no=T(0, d[1], d[0]))
    cut = [g for g in res["geom_cut"] if isinstance(g, bmesh.types.BMVert)]
    sec = [(v.co.x, v.co.z, -v.co.y) for v in cut]
    bm.free()
    sec = [p for p in sec if pred(p)]
    if not sec:
        return None
    ss = [(p[2] - zc) * n[0] + (p[1] - y_hand) * n[1] for p in sec]
    xs = [p[0] for p in sec]
    return (max(xs) - min(xs), max(ss) - min(ss), (zc, y_hand), d, n, (max(xs) + min(xs)) / 2, (max(ss) + min(ss)) / 2)


def fit_grip(o, max_w, max_d, angle_deg, y_hand, pred=lambda p: True, blend=None):
    """Thin a grip around its own centreline (location and angle unchanged) to max width/depth at the hand
    height. `pred(p3)` selects the grip vertices; `blend(p3)` (0..1) feathers the change into the rest of the part.
    Returns (w, d, w', d') in metres."""
    sec = grip_section(o, angle_deg, y_hand, pred)
    if sec is None:
        return 0, 0, 0, 0
    w, dd, c, d, n, x_mid, s_mid = sec
    kx = min(1.0, max_w / w) if w else 1.0
    kd = min(1.0, max_d / dd) if dd else 1.0
    if kx < 1 or kd < 1:
        mw = o.matrix_world
        inv = mw.inverted()
        for v in o.data.vertices:
            g = mw @ v.co
            p = (g.x, g.z, -g.y)
            f = 1.0 if pred(p) else (blend(p) if blend else 0.0)
            if f <= 0:
                continue
            s = (p[2] - c[0]) * n[0] + (p[1] - c[1]) * n[1] - s_mid
            ks = 1 + (kd - 1) * f
            kxx = 1 + (kx - 1) * f
            z = p[2] + (ks - 1) * s * n[0]
            y = p[1] + (ks - 1) * s * n[1]
            x = x_mid + (p[0] - x_mid) * kxx
            v.co = inv @ T(x, y, z)
        o.data.update()
    sec2 = grip_section(o, angle_deg, y_hand, pred)
    return w, dd, sec2[0], sec2[1]


def obb_proxies(o, slices=3, pred=lambda p: True, angle_deg=None):
    """Boxes along the grip's own axis (rotated about x by `rx`), node-local; for raked grips."""
    mw = o.matrix_world
    loc = mw.to_translation()
    p0 = (loc.x, loc.z, -loc.y)
    pts = [p for p in _pts3(o) if pred(p)]
    c, d, n = grip_axis(pts)
    if angle_deg is not None:
        a = math.radians(angle_deg)
        d, n = (math.sin(a), -math.cos(a)), (math.cos(a), math.sin(a))
    ts = [(p[2] - c[0]) * d[0] + (p[1] - c[1]) * d[1] for p in pts]
    ss = [(p[2] - c[0]) * n[0] + (p[1] - c[1]) * n[1] for p in pts]
    t0, t1 = min(ts), max(ts)
    rx = math.atan2(-d[0], -d[1])  # rotation about +x taking local -y onto the down axis
    out = []
    for i in range(slices):
        a, b = t0 + (t1 - t0) * i / slices, t0 + (t1 - t0) * (i + 1) / slices
        sel = [(p, s) for p, t, s in zip(pts, ts, ss) if a <= t <= b]
        if len(sel) < 3:
            continue
        xs = [p[0] for p, _ in sel]
        s_ = [s for _, s in sel]
        tm, sm = (a + b) / 2, (max(s_) + min(s_)) / 2
        cz = c[0] + d[0] * tm + n[0] * sm - p0[2]
        cy = c[1] + d[1] * tm + n[1] * sm - p0[1]
        out.append(dict(type="box", c=[round((max(xs) + min(xs)) / 2 - p0[0], 5), round(cy, 5), round(cz, 5)],
                        h=[round((max(xs) - min(xs)) / 2, 5), round((b - a) / 2, 5), round((max(s_) - min(s_)) / 2, 5)],
                        rx=round(rx, 4)))
    return out


def thin_x(o, z0, z1, y0, y1, half, feather=0.006):
    """Squeeze |x| to at most `half` inside the weapon-frame window z0..z1 × y0..y1 (feathered over `feather`),
    keeping the centreline. For the receiver side where the trigger finger rests. Returns the max |x| before."""
    mw = o.matrix_world
    inv = mw.inverted()
    xs = []
    for v in o.data.vertices:
        g = mw @ v.co
        x, y, z = g.x, g.z, -g.y
        dz = max(z0 - z, z - z1, 0.0)
        dy = max(y0 - y, y - y1, 0.0)
        f = max(0.0, 1.0 - max(dz, dy) / feather)
        if f <= 0:
            continue
        if dz == 0 and dy == 0:
            xs.append(abs(x))
        if abs(x) <= half:
            continue
        lim = abs(x) + (half - abs(x)) * f
        # compress the outer shell onto the limit, keep inner detail order
        nx = math.copysign(lim, x)
        v.co = inv @ T(nx, y, z)
    o.data.update()
    return max(xs) if xs else 0.0
