"""Build CranSki's 3D assets in Blender and export them as .glb files.

Run with:
    blender --background --python tools/blender/build_assets.py -- public/models

Everything here is original, generated from code: the rider (jacket, pants,
boots, helmet, goggles, mittens, skis, poles, snowboard), pine trees, the
gondola cabin and lift tower, and inflatable start/finish arches.

Coordinates are written in three.js space (x right, y up, -z forward) and
converted to Blender's z-up on the way in; the glTF exporter converts back.
"""

import math
import os
import sys

import bmesh
import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models"
os.makedirs(OUT, exist_ok=True)


# ----------------------------------------------------------------- helpers
def B(x, y, z):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return (x, -z, y)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATS = {}


def mat(name, color, rough=0.8, metal=0.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    MATS[name] = m
    return m


def hexc(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


def new_object(name, bm, materials, smooth=True):
    if smooth:
        for f in bm.faces:
            f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def superellipse(t, rx, rz, p):
    c, s = math.cos(t), math.sin(t)
    x = rx * math.copysign(abs(c) ** (2.0 / p), c)
    z = rz * math.copysign(abs(s) ** (2.0 / p), s)
    return x, z


def rings_mesh(bm, rings, segs, mat_of_band=lambda i: 0, cap_bottom=True, cap_top=True, uv=None):
    """Stack of rings along y. Each ring: dict(y, rx, rz, cx=0, cz=0, p=2).
    Faces between ring i and i+1 get material mat_of_band(i)."""
    loops = []
    for r in rings:
        loop = []
        for k in range(segs):
            t = 2 * math.pi * k / segs
            x, z = superellipse(t, r["rx"], r["rz"], r.get("p", 2.0))
            loop.append(bm.verts.new(B(x + r.get("cx", 0.0), r["y"], z + r.get("cz", 0.0))))
        loops.append(loop)
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            f.material_index = mat_of_band(i)
    if cap_bottom:
        r = rings[0]
        c = bm.verts.new(B(r.get("cx", 0.0), r["y"] - r.get("capDepth", 0.0), r.get("cz", 0.0)))
        for k in range(segs):
            f = bm.faces.new((loops[0][(k + 1) % segs], loops[0][k], c))
            f.material_index = mat_of_band(-1)
    if cap_top:
        r = rings[-1]
        c = bm.verts.new(B(r.get("cx", 0.0), r["y"] + r.get("capDepth", 0.0), r.get("cz", 0.0)))
        for k in range(segs):
            f = bm.faces.new((loops[-1][k], loops[-1][(k + 1) % segs], c))
            f.material_index = mat_of_band(len(rings) - 1)
    return loops


def lathe(name, profile, segs, materials, mat_of_band=lambda i: 0, p=2.0, squash=1.0, caps=(True, True)):
    """Round part along +y: profile is [(y, r), ...] from -y end to +y end."""
    bm = bmesh.new()
    rings = [dict(y=y, rx=r, rz=r * squash, p=p) for (y, r) in profile]
    rings_mesh(bm, rings, segs, mat_of_band, cap_bottom=caps[0], cap_top=caps[1])
    return new_object(name, bm, materials)


def rounded_box(bm, cx, cy, cz, sx, sy, sz, mi=0, segs=12, p=4.0, layers=6):
    """A pillowy box (superellipsoid) centred at (cx, cy, cz) with half-sizes."""
    rings = []
    for i in range(layers + 1):
        v = -1 + 2 * i / layers
        k = (1 - abs(v) ** p) ** (1 / p) if abs(v) < 1 else 0.001
        rings.append(dict(y=cy + v * sy, rx=max(0.002, sx * k), rz=max(0.002, sz * k), cx=cx, cz=cz, p=p))
    rings_mesh(bm, rings, segs, lambda i: mi)


def subdivide(ob, levels=1):
    mod = ob.modifiers.new("sub", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)


def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
    )
    print("wrote", path)


# ----------------------------------------------------------------- materials
def rider_materials():
    return dict(
        top=mat("top", hexc(0xFF7A2F)),
        trim=mat("trim", hexc(0xD95C17)),
        pants=mat("pants", hexc(0x2F3B4C), rough=0.9),
        skin=mat("skin", hexc(0xE2B38F), rough=0.6),
        helmet=mat("helmet", hexc(0x161616), rough=0.7),
        helmetTrim=mat("helmetTrim", hexc(0x2A2E33), rough=0.5),
        gogFrame=mat("gogFrame", hexc(0xF2F4F7), rough=0.45),
        lens=mat("lens", hexc(0xFFB02E), rough=0.08, metal=0.9),
        beanie=mat("beanie", hexc(0x1E7BFF), rough=0.95),
        mitt=mat("mitt", hexc(0x202830), rough=0.85),
        skiTop=mat("skiTop", hexc(0x1E7BFF), rough=0.35),
        skiBase=mat("skiBase", hexc(0x1A1C20), rough=0.4),
        binding=mat("binding", hexc(0x222222), rough=0.4, metal=0.3),
        boot=mat("boot", hexc(0x2A2A2A), rough=0.35),
        buckle=mat("buckle", hexc(0xC9CED6), rough=0.25, metal=0.9),
        pole=mat("pole", hexc(0xC8CCD2), rough=0.3, metal=0.8),
        grip=mat("grip", hexc(0x1B1D21), rough=0.9),
        board=mat("board", hexc(0x22B07D), rough=0.35),
    )


# ----------------------------------------------------------------- rider
def build_rider():
    M = rider_materials()
    objs = []

    # Jacket: an oversized anorak. Hem band, shoulder yoke and collar in the trim colour.
    rings = [
        dict(y=-0.15, rx=0.268, rz=0.19, p=2.6),
        dict(y=-0.105, rx=0.274, rz=0.195, p=2.6),
        dict(y=-0.095, rx=0.27, rz=0.19, p=2.6),
        dict(y=0.04, rx=0.262, rz=0.182, p=2.6),
        dict(y=0.2, rx=0.256, rz=0.176, p=2.6),
        dict(y=0.34, rx=0.266, rz=0.178, p=2.6),
        dict(y=0.43, rx=0.276, rz=0.172, p=2.6),
        dict(y=0.52, rx=0.282, rz=0.162, p=2.4),
        dict(y=0.585, rx=0.25, rz=0.15, p=2.2),
        dict(y=0.63, rx=0.17, rz=0.125, p=2.0),
        dict(y=0.66, rx=0.105, rz=0.095, p=2.0),
        dict(y=0.715, rx=0.092, rz=0.09, p=2.0),
    ]

    def jacket_band(i):
        if i < 0 or i in (0,):
            return 1  # hem band
        if i >= 9:
            return 1  # collar
        if i >= 6:
            return 1  # shoulder yoke
        return 0

    bm = bmesh.new()
    rings_mesh(bm, rings, 36, jacket_band, cap_bottom=True, cap_top=False)
    jacket = new_object("jacket", bm, [M["top"], M["trim"]])
    subdivide(jacket, 1)
    objs.append(jacket)

    # Front zip and chest pocket flap (shell), kangaroo pocket (hoodie).
    bm = bmesh.new()
    rounded_box(bm, 0, 0.27, -0.183, 0.012, 0.3, 0.008, 0, segs=8)
    objs.append(new_object("zip", bm, [M["trim"]]))
    bm = bmesh.new()
    rounded_box(bm, 0, 0.06, -0.182, 0.17, 0.075, 0.018, 0, segs=12)
    objs.append(new_object("pocket", bm, [M["trim"]]))

    # Hood: bunched behind the neck.
    bm = bmesh.new()
    rounded_box(bm, 0, 0.63, 0.12, 0.17, 0.09, 0.1, 0, segs=16, p=2.4)
    hood = new_object("hood", bm, [M["top"]])
    subdivide(hood, 1)
    objs.append(hood)
    # Small rolled collar for the shell.
    bm = bmesh.new()
    rings_mesh(bm, [dict(y=0.655, rx=0.12, rz=0.11), dict(y=0.7, rx=0.112, rz=0.104), dict(y=0.735, rx=0.1, rz=0.094)], 24, lambda i: 0, False, False)
    objs.append(new_object("collar", bm, [M["trim"]]))

    # Seat of the baggy pants.
    bm = bmesh.new()
    rounded_box(bm, 0, -0.03, 0.01, 0.225, 0.12, 0.17, 0, segs=24, p=2.6)
    objs.append(new_object("pelvis", bm, [M["pants"]]))

    # Thigh: baggy with a couple of soft folds (+y end = knee).
    L = 0.46
    prof = [(-L / 2, 0.128), (-0.17, 0.134), (-0.08, 0.13), (-0.03, 0.134), (0.06, 0.127), (0.12, 0.131), (0.19, 0.122), (L / 2, 0.118)]
    objs.append(lathe("thigh", prof, 20, [M["pants"]], caps=(True, True)))
    # Shin: pant leg that flares over the boot (+y end = ankle).
    prof = [(-L / 2, 0.118), (-0.12, 0.12), (-0.02, 0.124), (0.08, 0.13), (0.15, 0.138), (0.2, 0.146), (0.222, 0.148), (L / 2, 0.14)]
    objs.append(lathe("shin", prof, 20, [M["pants"]], caps=(True, True)))

    # Sleeves: puffy upper arm (+y = elbow), forearm with a trim cuff (+y = wrist).
    A = 0.3
    prof = [(-A / 2, 0.092), (-0.1, 0.095), (-0.04, 0.09), (0.02, 0.093), (0.08, 0.086), (A / 2, 0.082)]
    objs.append(lathe("upperArm", prof, 18, [M["top"]]))
    prof = [(-A / 2, 0.082), (-0.08, 0.084), (0.0, 0.08), (0.07, 0.077), (0.1, 0.079), (0.115, 0.08), (A / 2, 0.078)]
    objs.append(lathe("foreArm", prof, 18, [M["top"], M["trim"]], mat_of_band=lambda i: 1 if i >= 4 else 0))

    # Mitten: puffy, with a thumb (+y = fingertips).
    bm = bmesh.new()
    rounded_box(bm, 0, 0.045, 0, 0.058, 0.085, 0.045, 0, segs=16, p=2.3)
    rounded_box(bm, -0.05, 0.02, -0.01, 0.022, 0.04, 0.022, 0, segs=10, p=2.0)
    rounded_box(bm, 0, -0.04, 0, 0.05, 0.03, 0.042, 0, segs=14, p=2.0)
    objs.append(new_object("mitt", bm, [M["mitt"]]))

    # Head with a hint of nose and chin (origin = head centre).
    rings = [
        dict(y=-0.2, rx=0.05, rz=0.05),
        dict(y=-0.1, rx=0.055, rz=0.055),
        dict(y=-0.085, rx=0.075, rz=0.08, cz=-0.01),
        dict(y=-0.05, rx=0.098, rz=0.11, cz=-0.008),
        dict(y=0.0, rx=0.112, rz=0.122),
        dict(y=0.06, rx=0.11, rz=0.12),
        dict(y=0.11, rx=0.085, rz=0.095),
        dict(y=0.135, rx=0.045, rz=0.05),
    ]
    bm = bmesh.new()
    rings_mesh(bm, rings, 24, lambda i: 0)
    rounded_box(bm, 0, 0.0, -0.122, 0.016, 0.026, 0.02, 0, segs=8)
    head = new_object("head", bm, [M["skin"]])
    subdivide(head, 1)
    objs.append(head)

    # Helmet: rounded shell with a short brim, three vents and ear pads.
    rings = [
        dict(y=-0.06, rx=0.158, rz=0.166, cz=0.01),
        dict(y=0.0, rx=0.163, rz=0.172, cz=0.005),
        dict(y=0.06, rx=0.158, rz=0.166),
        dict(y=0.11, rx=0.135, rz=0.145),
        dict(y=0.15, rx=0.095, rz=0.105),
        dict(y=0.172, rx=0.045, rz=0.05),
    ]
    bm = bmesh.new()
    rings_mesh(bm, rings, 32, lambda i: 0, cap_bottom=False)
    rounded_box(bm, 0, 0.075, -0.168, 0.11, 0.012, 0.025, 0, segs=12)
    for x in (-0.05, 0.0, 0.05):
        rounded_box(bm, x, 0.155, -0.04, 0.012, 0.012, 0.05, 1, segs=8)
    for x in (-0.158, 0.158):
        rounded_box(bm, x, -0.06, 0.02, 0.02, 0.05, 0.05, 1, segs=10)
    objs.append(new_object("helmetShell", bm, [M["helmet"], M["helmetTrim"]]))

    # Oversized wraparound goggles: white frame and a mirror lens.
    def wrap(bm, r, h, y, t0, t1, mi, thick):
        segs = 24
        top, bot, top2, bot2 = [], [], [], []
        for k in range(segs + 1):
            t = t0 + (t1 - t0) * k / segs
            sx, sz = math.sin(t), -math.cos(t)
            bulge = 1 + 0.06 * math.cos((k / segs - 0.5) * math.pi)
            for lst, rr, yy in ((top, r * bulge, y + h / 2), (bot, r * bulge, y - h / 2), (top2, (r - thick) * bulge, y + h / 2), (bot2, (r - thick) * bulge, y - h / 2)):
                lst.append(bm.verts.new(B(sx * rr, yy, sz * rr)))
        for k in range(segs):
            for a, b in ((top, bot), (bot, bot2), (bot2, top2), (top2, top)):
                f = bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
                f.material_index = mi
        for lst in ((top, bot, bot2, top2),):
            for k in (0, segs):
                f = bm.faces.new((lst[0][k], lst[1][k], lst[2][k], lst[3][k]))
                f.material_index = mi

    bm = bmesh.new()
    wrap(bm, 0.168, 0.1, 0.025, -1.25, 1.25, 0, 0.02)
    wrap(bm, 0.172, 0.074, 0.025, -1.1, 1.1, 1, 0.006)
    objs.append(new_object("goggles", bm, [M["gogFrame"], M["lens"]]))

    # Beanie with a folded cuff and a pom.
    rings = [
        dict(y=-0.035, rx=0.152, rz=0.16),
        dict(y=0.02, rx=0.156, rz=0.164),
        dict(y=0.03, rx=0.148, rz=0.156),
        dict(y=0.1, rx=0.14, rz=0.148),
        dict(y=0.16, rx=0.105, rz=0.112),
        dict(y=0.2, rx=0.05, rz=0.055),
    ]
    bm = bmesh.new()
    rings_mesh(bm, rings, 28, lambda i: 0, cap_bottom=False)
    rounded_box(bm, 0, 0.235, 0, 0.05, 0.045, 0.05, 0, segs=12, p=2.0)
    objs.append(new_object("beanieHat", bm, [M["beanie"]]))

    # Twin-tip ski with sidecut, rocker at both ends, binding (tip at -z).
    def build_ski():
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        n = 70
        half_len = 0.86
        cols = 6
        top, bot = [], []
        for i in range(n + 1):
            v = i / n
            z = -half_len + 2 * half_len * v
            az = abs(z)
            width = 0.086 + 0.012 * (az / half_len) ** 2
            if az > half_len - 0.07:
                k = (az - (half_len - 0.07)) / 0.07
                width *= math.sqrt(max(0.0, 1 - k * k)) * 0.85 + 0.15
            rise = 0.075 * ((az - 0.6) / 0.26) ** 2 if az > 0.6 else 0.0
            t = 0.016 if az < 0.6 else 0.016 - 0.008 * (az - 0.6) / 0.26
            rt, rb = [], []
            for j in range(cols + 1):
                x = -width / 2 + width * j / cols
                rt.append(bm.verts.new(B(x, rise + t, z)))
                rb.append(bm.verts.new(B(x, rise, z)))
            top.append(rt)
            bot.append(rb)
        for i in range(n):
            for j in range(cols):
                f = bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
                f.material_index = 0
                for loop in f.loops:
                    co = loop.vert.co
                    loop[uv].uv = ((co.x / 0.1) + 0.5, (-co.y + half_len) / (2 * half_len))
                f = bm.faces.new((bot[i][j + 1], bot[i][j], bot[i + 1][j], bot[i + 1][j + 1]))
                f.material_index = 1
            for j in (0, cols):
                a, b = (top, bot) if j == 0 else (bot, top)
                f = bm.faces.new((a[i][j], b[i][j], b[i + 1][j], a[i + 1][j]))
                f.material_index = 1
        for i in (0, n):
            for j in range(cols):
                f = bm.faces.new((top[i][j], bot[i][j], bot[i][j + 1], top[i][j + 1]))
                f.material_index = 1
        # Binding: toe piece, heel piece and plate.
        rounded_box(bm, 0, 0.03, -0.17, 0.042, 0.022, 0.05, 2, segs=10)
        rounded_box(bm, 0, 0.038, 0.19, 0.045, 0.03, 0.065, 2, segs=10)
        rounded_box(bm, 0, 0.02, 0.01, 0.04, 0.006, 0.2, 2, segs=8)
        return new_object("ski", bm, [M["skiTop"], M["skiBase"], M["binding"]])

    objs.append(build_ski())

    # Ski boot: shell, cuff, buckles and sole (origin = sole on the ski).
    bm = bmesh.new()
    rounded_box(bm, 0, 0.025, 0.02, 0.06, 0.022, 0.165, 2, segs=12)  # sole
    rounded_box(bm, 0, 0.085, 0.0, 0.066, 0.055, 0.15, 0, segs=16, p=3.0)  # lower shell
    rounded_box(bm, 0, 0.16, 0.035, 0.068, 0.075, 0.082, 0, segs=16, p=3.0)  # cuff
    for y in (0.12, 0.17, 0.215):
        rounded_box(bm, 0.068, y, 0.03, 0.006, 0.01, 0.04, 1, segs=8)
    rounded_box(bm, 0.07, 0.07, -0.06, 0.005, 0.01, 0.035, 1, segs=8)
    objs.append(new_object("boot", bm, [M["boot"], M["buckle"], M["skiBase"]]))

    # Pole: shaft, grip and basket (+y = tip, so the grip sits at -y).
    bm = bmesh.new()
    rings_mesh(bm, [dict(y=-0.5, rx=0.009, rz=0.009), dict(y=0.48, rx=0.006, rz=0.006), dict(y=0.5, rx=0.002, rz=0.002)], 8, lambda i: 0)
    rings_mesh(bm, [dict(y=-0.52, rx=0.022, rz=0.022), dict(y=-0.5, rx=0.024, rz=0.024), dict(y=-0.4, rx=0.019, rz=0.019), dict(y=-0.38, rx=0.022, rz=0.022)], 12, lambda i: 1)
    rings_mesh(bm, [dict(y=0.43, rx=0.045, rz=0.045), dict(y=0.445, rx=0.045, rz=0.045)], 16, lambda i: 1)
    objs.append(new_object("pole", bm, [M["pole"], M["grip"]]))

    # Snowboard with rocker and two bindings, and soft board boots.
    bm = bmesh.new()
    n, cols, half = 50, 8, 0.76
    top, bot = [], []
    for i in range(n + 1):
        z = -half + 2 * half * i / n
        az = abs(z)
        width = 0.25 + 0.03 * (az / half) ** 2
        if az > half - 0.12:
            k = (az - (half - 0.12)) / 0.12
            width *= math.sqrt(max(0.0, 1 - k * k)) * 0.75 + 0.25
        rise = 0.08 * ((az - 0.55) / 0.21) ** 2 if az > 0.55 else 0.0
        rt, rb = [], []
        for j in range(cols + 1):
            x = -width / 2 + width * j / cols
            rt.append(bm.verts.new(B(x, rise + 0.014, z)))
            rb.append(bm.verts.new(B(x, rise, z)))
        top.append(rt)
        bot.append(rb)
    for i in range(n):
        for j in range(cols):
            bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j])).material_index = 0
            bm.faces.new((bot[i][j + 1], bot[i][j], bot[i + 1][j], bot[i + 1][j + 1])).material_index = 1
        for j in (0, cols):
            a, b = (top, bot) if j == 0 else (bot, top)
            bm.faces.new((a[i][j], b[i][j], b[i + 1][j], a[i + 1][j])).material_index = 1
    for z in (-0.24, 0.24):
        rounded_box(bm, 0, 0.035, z, 0.13, 0.02, 0.07, 2, segs=12)
        rounded_box(bm, 0, 0.12, z + 0.04, 0.11, 0.08, 0.02, 2, segs=10)
    objs.append(new_object("board", bm, [M["board"], M["skiBase"], M["binding"]]))
    bm = bmesh.new()
    rounded_box(bm, 0, 0.1, 0, 0.14, 0.1, 0.075, 0, segs=16, p=2.6)
    rounded_box(bm, 0, 0.025, 0, 0.15, 0.022, 0.08, 1, segs=12)
    objs.append(new_object("boardBoot", bm, [M["boot"], M["skiBase"]]))

    export(os.path.join(OUT, "rider.glb"), objs)


# ----------------------------------------------------------------- trees
def build_trees():
    bark = mat("bark", hexc(0x4A3324), rough=0.95)
    needles = mat("needles", hexc(0x1B4A31), rough=0.9)
    needlesDark = mat("needlesDark", hexc(0x123524), rough=0.95)
    snow = mat("snow", hexc(0xEEF3FA), rough=0.8)
    objs = []

    def pine(name, layers, height, radius, snowy, segs):
        bm = bmesh.new()
        rings_mesh(bm, [dict(y=0, rx=radius * 0.1, rz=radius * 0.1), dict(y=height * 0.35, rx=radius * 0.06, rz=radius * 0.06), dict(y=height * 0.95, rx=0.03, rz=0.03)], 8, lambda i: 0)
        for L in range(layers):
            f = L / layers
            y0 = height * (0.16 + 0.78 * f)
            h = height * (0.3 - 0.13 * f)
            R = radius * (1.0 - 0.82 * f) * (1 + 0.06 * math.sin(L * 2.3))
            apex = bm.verts.new(B(0, y0 + h, 0))
            mid, outer, under = [], [], []
            n = segs
            for k in range(n):
                t = 2 * math.pi * (k + 0.5 * (L % 2)) / n
                spike = 1.0 if k % 2 == 0 else 0.78
                ro = R * spike
                rm = R * 0.55
                mid.append(bm.verts.new(B(math.cos(t) * rm, y0 + h * 0.42, math.sin(t) * rm)))
                outer.append(bm.verts.new(B(math.cos(t) * ro, y0 - h * (0.12 if spike == 1 else 0.02), math.sin(t) * ro)))
                under.append(bm.verts.new(B(math.cos(t) * R * 0.3, y0 + h * 0.08, math.sin(t) * R * 0.3)))
            for k in range(n):
                k2 = (k + 1) % n
                fa = bm.faces.new((mid[k], mid[k2], apex))
                fa.material_index = 3 if snowy else 1
                fb = bm.faces.new((outer[k], outer[k2], mid[k2], mid[k]))
                # Snow sits on the upper half of each branch skirt, unevenly.
                fb.material_index = 3 if (snowy and (k % 3 != 1)) else 1
                fc = bm.faces.new((under[k], under[k2], outer[k2], outer[k]))
                fc.material_index = 2
        return new_object(name, bm, [bark, needles, needlesDark, snow], smooth=False)

    objs.append(pine("pineSnowy", 7, 11.0, 3.0, True, 12))
    objs.append(pine("pineGreen", 7, 11.5, 2.8, False, 12))
    objs.append(pine("pineFar", 5, 11.0, 3.0, True, 8))
    export(os.path.join(OUT, "trees.glb"), objs)


# ----------------------------------------------------------------- lift + arches
def build_lift():
    body = mat("cabinBody", hexc(0xFF5A36), rough=0.35, metal=0.1)
    glass = mat("cabinGlass", hexc(0x9FD0FF), rough=0.05, metal=0.3, alpha=0.3)
    frame = mat("cabinFrame", hexc(0xF2F4F7), rough=0.35, metal=0.4)
    steel = mat("steel", hexc(0x8A939C), rough=0.35, metal=0.8)
    dark = mat("darkSteel", hexc(0x3A3F46), rough=0.45, metal=0.6)
    objs = []

    # Gondola cabin: rounded body, a wide glass band, roof, hanger arm and grip
    # (origin = middle of the floor).
    bm = bmesh.new()
    rounded_box(bm, 0, 0.35, 0, 1.08, 0.38, 1.08, 0, segs=24, p=3.5)  # lower body
    rounded_box(bm, 0, 1.2, 0, 1.06, 0.55, 1.06, 1, segs=24, p=3.5)  # glass band
    rounded_box(bm, 0, 1.88, 0, 1.1, 0.2, 1.1, 0, segs=24, p=3.5)  # roof
    for sx in (-1, 1):
        for sz in (-1, 1):
            rounded_box(bm, sx * 0.92, 1.2, sz * 0.92, 0.07, 0.56, 0.07, 2, segs=8)
    rounded_box(bm, 0, 2.6, 0, 0.06, 0.65, 0.06, 3, segs=8)  # hanger
    rounded_box(bm, 0, 3.28, 0, 0.18, 0.12, 0.35, 3, segs=10)  # grip
    rounded_box(bm, 0, 0.32, -1.1, 0.4, 0.05, 0.01, 2, segs=8)  # logo strip
    objs.append(new_object("cabin", bm, [body, glass, frame, dark]))

    # Lift tower: tapered steel column with a crossarm and sheave trains (16 m).
    bm = bmesh.new()
    rings_mesh(bm, [dict(y=0, rx=0.55, rz=0.55), dict(y=0.6, rx=0.5, rz=0.5), dict(y=15.4, rx=0.32, rz=0.32), dict(y=15.8, rx=0.36, rz=0.36)], 12, lambda i: 0)
    rounded_box(bm, 0, 16.0, 0, 2.6, 0.22, 0.28, 0, segs=10)
    for x in (-2.25, 2.25):
        rounded_box(bm, x, 15.85, 0, 0.12, 0.16, 0.9, 1, segs=8)
        for zz in (-0.6, -0.2, 0.2, 0.6):
            rings_mesh(bm, [dict(y=15.62, rx=0.17, rz=0.17, cx=x, cz=zz), dict(y=15.72, rx=0.17, rz=0.17, cx=x, cz=zz)], 12, lambda i: 1)
    # Ladder rails.
    for x in (-0.18, 0.18):
        rounded_box(bm, x, 8, 0.5, 0.02, 7.5, 0.02, 1, segs=6)
    objs.append(new_object("tower", bm, [steel, dark], smooth=True))

    # Inflatable arch for the start gate and finish line: 10 m wide, 6 m tall.
    blue = mat("archBlue", hexc(0x1E7BFF), rough=0.6)
    white = mat("archWhite", hexc(0xF7F9FC), rough=0.6)
    bm = bmesh.new()
    segs = 40
    tube = 16
    path = []
    for i in range(segs + 1):
        t = i / segs
        a = math.pi * t
        path.append((-5.0 * math.cos(a), 6.0 * math.sin(a) ** 0.8))
    rings = []
    for i, (x, y) in enumerate(path):
        x0, y0 = path[max(0, i - 1)]
        x1, y1 = path[min(segs, i + 1)]
        tx, ty = x1 - x0, y1 - y0
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln, tx / ln
        loop = []
        r = 0.55
        for k in range(tube):
            t = 2 * math.pi * k / tube
            px = x + nx * math.cos(t) * r
            py = y + ny * math.cos(t) * r
            pz = math.sin(t) * r
            loop.append(bm.verts.new(B(px, py, pz)))
        rings.append(loop)
    for i in range(segs):
        for k in range(tube):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % tube], rings[i + 1][(k + 1) % tube], rings[i + 1][k]))
            f.material_index = 1 if (i // 5) % 2 else 0
    objs.append(new_object("arch", bm, [blue, white]))

    export(os.path.join(OUT, "lift.glb"), objs)


reset()
build_rider()
reset()
MATS.clear()
build_trees()
reset()
MATS.clear()
build_lift()
