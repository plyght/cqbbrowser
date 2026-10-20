"""Helpers for the CC-BY BURNER source guns (Krinkov, Beretta): import the un-skinned cache GLB (extract_sources.ts),
shift it onto our bore axis, and split meshes into kit pieces by connected component, keeping the artist's UVs,
custom normals and textures."""
import os

import bpy
from mathutils import Matrix, Vector

from . import kit, lib

CACHE = kit.CACHE


def import_src(pack, dy):
    """Import .cache/src_<pack>.glb; bake transforms; move by dy (three y). Returns {name: obj}."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, f"src_{pack}.glb"))
    out = {}
    for o in set(bpy.data.objects) - before:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(Matrix.Translation(lib.T(0, dy, 0)))
        for c in o.users_collection:
            c.objects.unlink(o)
        lib._coll.objects.link(o)
        out[o.name.split(".")[0]] = o
    return out


def components(o, tol=1e-5):
    """Connected-component label per polygon (vertices at the same position count as connected)."""
    me = o.data
    n = len(me.vertices)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    key = {}
    for v in me.vertices:
        k = (round(v.co.x / tol), round(v.co.y / tol), round(v.co.z / tol))
        if k in key:
            union(v.index, key[k])
        else:
            key[k] = v.index
    for e in me.edges:
        union(e.vertices[0], e.vertices[1])
    return [find(p.vertices[0]) for p in me.polygons]


def comp_boxes(o, labels):
    """label -> (min3, max3) in the three frame."""
    me = o.data
    boxes = {}
    for p, lab in zip(me.polygons, labels):
        for vi in p.vertices:
            c = me.vertices[vi].co
            t = (c.x, c.z, -c.y)
            b = boxes.get(lab)
            if b is None:
                boxes[lab] = [list(t), list(t)]
            else:
                for k in range(3):
                    b[0][k] = min(b[0][k], t[k])
                    b[1][k] = max(b[1][k], t[k])
    return boxes


def split(o, classify):
    """Split o by classify(min3, max3) -> group name (per connected component) into new objects that keep the
    source UVs, custom (corner) normals and materials. Returns {group: obj}; o is deleted."""
    me = o.data
    labels = components(o)
    boxes = comp_boxes(o, labels)
    group_of = {lab: classify(*boxes[lab]) for lab in boxes}
    cn = [tuple(c.vector) for c in me.corner_normals]
    uvl = me.uv_layers.active.data if me.uv_layers else None
    groups = {}
    for p, lab in zip(me.polygons, labels):
        groups.setdefault(group_of[lab], []).append(p)
    out = {}
    for g, polys in groups.items():
        vmap = {}
        verts, faces, loops = [], [], []
        mats = []
        for p in polys:
            f = []
            for li, vi in zip(p.loop_indices, p.vertices):
                if vi not in vmap:
                    vmap[vi] = len(verts)
                    verts.append(tuple(me.vertices[vi].co))
                f.append(vmap[vi])
                loops.append(li)
            faces.append(f)
            mats.append(p.material_index)
        nm = bpy.data.meshes.new(f"{o.name}_{g}")
        nm.from_pydata(verts, [], faces)
        for m in me.materials:
            nm.materials.append(m)
        for p, mi in zip(nm.polygons, mats):
            p.material_index = mi
        if uvl is not None:
            uv = nm.uv_layers.new(name="UVMap")
            for i, li in enumerate(loops):
                uv.data[i].uv = uvl[li].uv
        nm.normals_split_custom_set([cn[li] for li in loops])
        nm.update()
        ob = bpy.data.objects.new(f"{o.name}_{g}", nm)
        lib._coll.objects.link(ob)
        out[g] = ob
    bpy.data.objects.remove(o, do_unlink=True)
    return out


def set_pivot(o, pivot3, name):
    """Rename and put the object origin at pivot3 (three frame) without moving the mesh."""
    p = lib.T(*pivot3)
    o.data.transform(Matrix.Translation(-p))
    o.location = p
    o.name = name
    o.data.name = name
    return o


def bbox3(o):
    """Weapon-frame AABB from the vertices (bound_box can be stale right after data.transform)."""
    t = verts3(o)
    return [min(q[k] for q in t) for k in range(3)], [max(q[k] for q in t) for k in range(3)]


def verts3(o):
    mw = o.matrix_world
    return [((mw @ v.co).x, (mw @ v.co).z, -(mw @ v.co).y) for v in o.data.vertices]


def join_objs(objs, name):
    objs = [x for x in objs if x is not None]
    base = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base
