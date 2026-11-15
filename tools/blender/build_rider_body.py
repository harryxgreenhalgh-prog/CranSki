"""Build CranSki's skinned rider body and export it as public/models/rider-body.glb.

Run with:
    blender --background --python tools/blender/build_rider_body.py -- public/models

One low-poly body on one skeleton, so arms and legs bend smoothly at the joints
instead of being separate pieces. Original work, generated from code:
  - torso_man / torso_woman   the jacket body (top colour, trim-colour hem and yoke)
  - sleeves                   long sleeves with trim cuffs (shell, hoodie, long sleeve)
  - sleevesTee + arms         short sleeves and bare forearms (tee)
  - shellBits                 the shell's rolled collar and front zip
  - hoodBunch                 the shell's packed-away hood
  - bigHood + pocket          the hoodie's big hood and kangaroo pocket
  - pants                     baggy pants that flare over the boots

The skeleton (hips, spine, chest, neck, head, upperArm/foreArm, thigh/shin on
each side) is posed by the game every frame from the same joint positions it
has always worked out (src/render/riderModel.js), so the rest pose here only
has to have the same bone lengths: thigh and shin 0.46 m, upper arm and
forearm 0.30 m, hip joints 0.12 m either side and 0.05 m below the hips centre,
shoulders 0.56 m above it. Weights are set here, joint by joint, so the bends
are predictable.

Coordinates are written in three.js space (x right, y up, -z forward) and
converted to Blender's z-up on the way in; the glTF exporter converts back.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models"
os.makedirs(OUT, exist_ok=True)


def B(v):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


def hexc(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


MATS = {}


def mat(name, color, rough=0.85):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hexc(color), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    MATS[name] = m
    return m


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------- rest pose
P = Vector((0.0, 1.15, 0.0))  # hips centre
SHOULDER = 0.27
ARM_DOWN = math.radians(38)  # A-pose: arms out and down
HIP_X, HIP_DROP = 0.12, 0.05
THIGH = SHIN = 0.46
UPPER = FORE = 0.30


def side_vec(sx):
    return Vector((sx * math.sin(ARM_DOWN), -math.cos(ARM_DOWN), 0.0))


JOINTS = {}
for sx, s in ((-1, "L"), (1, "R")):
    sh = P + Vector((sx * SHOULDER, 0.56, 0.0))
    d = side_vec(sx)
    JOINTS["sh" + s] = sh
    JOINTS["el" + s] = sh + d * UPPER
    JOINTS["wr" + s] = sh + d * (UPPER + FORE)
    hip = P + Vector((sx * HIP_X, -HIP_DROP, 0.0))
    JOINTS["hip" + s] = hip
    JOINTS["kn" + s] = hip + Vector((0, -THIGH, 0))
    JOINTS["an" + s] = hip + Vector((0, -THIGH - SHIN, 0))

BONES = [
    # name, head, tail, parent
    ("hips", P, P + Vector((0, 0.2, 0)), None),
    ("spine", P + Vector((0, 0.2, 0)), P + Vector((0, 0.42, 0)), "hips"),
    ("chest", P + Vector((0, 0.42, 0)), P + Vector((0, 0.62, 0)), "spine"),
    ("neck", P + Vector((0, 0.62, 0)), P + Vector((0, 0.7, 0)), "chest"),
    ("head", P + Vector((0, 0.7, 0)), P + Vector((0, 0.95, 0)), "neck"),
]
for s in ("L", "R"):
    BONES += [
        ("upperArm." + s, JOINTS["sh" + s], JOINTS["el" + s], "chest"),
        ("foreArm." + s, JOINTS["el" + s], JOINTS["wr" + s], "upperArm." + s),
        ("thigh." + s, JOINTS["hip" + s], JOINTS["kn" + s], "hips"),
        ("shin." + s, JOINTS["kn" + s], JOINTS["an" + s], "thigh." + s),
    ]


def build_armature():
    arm = bpy.data.armatures.new("riderSkeleton")
    ob = bpy.data.objects.new("riderBody", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head = B(head)
        b.tail = B(tail)
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


# ----------------------------------------------------------------- geometry helpers
class Skinned:
    """A mesh under construction with per-vertex bone weights."""

    def __init__(self, name, materials):
        self.name = name
        self.bm = bmesh.new()
        self.materials = materials
        self.weights = []  # per vertex: {bone: w}

    def vert(self, p, w):
        v = self.bm.verts.new(B(p))
        self.weights.append(w)
        return v

    def face(self, verts, mi=0):
        f = self.bm.faces.new(verts)
        f.material_index = mi
        f.smooth = True
        return f


def frame(d):
    """Two unit vectors perpendicular to direction d."""
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a = d.cross(up).normalized()
    b = d.cross(a).normalized()
    return a, b


def ring_points(c, d, rx, rz, segs, p=2.0, a_axis=None):
    a, b = frame(d)
    if a_axis is not None:
        a = (a_axis - d * a_axis.dot(d)).normalized()
        b = d.cross(a).normalized()
    pts = []
    for k in range(segs):
        t = 2 * math.pi * k / segs
        cs, sn = math.cos(t), math.sin(t)
        x = rx * math.copysign(abs(cs) ** (2.0 / p), cs)
        z = rz * math.copysign(abs(sn) ** (2.0 / p), sn)
        pts.append(c + a * x + b * z)
    return pts


def loft(sk, rings, segs, mat_of_band=lambda i: 0, cap0=True, cap1=True):
    """rings: list of (points, weights) with the same point count."""
    loops = [[sk.vert(p, w) for p in pts] for pts, w in rings]
    for i in range(len(loops) - 1):
        a, bb = loops[i], loops[i + 1]
        for k in range(segs):
            sk.face((a[k], a[(k + 1) % segs], bb[(k + 1) % segs], bb[k]), mat_of_band(i))
    for cap, loop, rev in ((cap0, loops[0], True), (cap1, loops[-1], False)):
        if not cap:
            continue
        pts = [v.co for v in loop]
        c = sum(pts, Vector()) / len(pts)
        idx = 0 if rev else len(rings) - 1
        cv = sk.bm.verts.new(c)
        sk.weights.append(rings[idx][1])
        for k in range(segs):
            tri = (loop[(k + 1) % segs], loop[k], cv) if rev else (loop[k], loop[(k + 1) % segs], cv)
            sk.face(tri, mat_of_band(-1 if rev else len(rings) - 2))


def blob(sk, c, sx, sy, sz, w, segs=14, layers=6, p=2.4, mi=0):
    """A pillowy rounded box (superellipsoid) centred at c."""
    rings = []
    for i in range(layers + 1):
        v = -1 + 2 * i / layers
        k = (1 - abs(v) ** p) ** (1 / p) if abs(v) < 1 else 0.001
        cc = c + Vector((0, v * sy, 0))
        pts = ring_points(cc, Vector((0, 1, 0)), max(0.002, sx * k), max(0.002, sz * k), segs, p, a_axis=Vector((1, 0, 0)))
        rings.append((pts, w(cc) if callable(w) else w))
    loft(sk, rings, segs, lambda i: mi, cap0=False, cap1=False)


# ----------------------------------------------------------------- weights
def torso_weights(y):
    """y above the hips centre -> hips / spine / chest / neck."""
    w = {}
    a = smoothstep(0.08, 0.3, y)  # hips -> spine
    b = smoothstep(0.32, 0.5, y)  # spine -> chest
    c = smoothstep(0.62, 0.7, y)  # chest -> neck
    w["hips"] = 1 - a
    w["spine"] = a * (1 - b)
    w["chest"] = a * b * (1 - c)
    w["neck"] = a * b * c
    return w


def arm_weights(s, t):
    """t = distance along the arm from the shoulder."""
    sh = smoothstep(-0.06, 0.08, t)  # chest -> upper arm
    el = smoothstep(UPPER - 0.06, UPPER + 0.06, t)  # upper arm -> forearm
    return {"chest": 1 - sh, "upperArm." + s: sh * (1 - el), "foreArm." + s: sh * el}


def leg_weights(s, t):
    """t = distance down the leg from the hip joint."""
    hp = smoothstep(-0.08, 0.1, t)  # hips -> thigh
    kn = smoothstep(THIGH - 0.07, THIGH + 0.07, t)  # thigh -> shin
    return {"hips": 1 - hp, "thigh." + s: hp * (1 - kn), "shin." + s: hp * kn}


def clean(w):
    w = {k: v for k, v in w.items() if v > 0.002}
    t = sum(w.values()) or 1
    return {k: v / t for k, v in w.items()}


# ----------------------------------------------------------------- parts
JACKET_RINGS = [  # (y above hips centre, half width, half depth, squareness)
    (-0.15, 0.268, 0.19, 2.6),
    (-0.105, 0.274, 0.195, 2.6),
    (-0.095, 0.27, 0.19, 2.6),
    (0.04, 0.262, 0.182, 2.6),
    (0.2, 0.256, 0.176, 2.6),
    (0.34, 0.266, 0.178, 2.6),
    (0.43, 0.276, 0.172, 2.6),
    (0.52, 0.282, 0.162, 2.4),
    (0.585, 0.25, 0.15, 2.2),
    (0.63, 0.17, 0.125, 2.0),
    (0.66, 0.105, 0.095, 2.0),
    (0.715, 0.092, 0.09, 2.0),
]


def build_torso(name, M, kx=1.0, ky=1.0, kz=1.0):
    sk = Skinned(name, [M["top"], M["trim"]])
    rings = []
    for y, rx, rz, p in JACKET_RINGS:
        yy = y * ky
        c = P + Vector((0, yy, 0))
        rings.append((ring_points(c, Vector((0, 1, 0)), rx * kx, rz * kz, 36, p, a_axis=Vector((1, 0, 0))), clean(torso_weights(yy))))

    def band(i):
        return 1 if i <= 0 or i >= 6 else 0  # hem band, shoulder yoke and collar in the trim colour

    loft(sk, rings, 36, band, cap0=True, cap1=False)
    return sk


def sleeve_rings(s, profile, segs=16):
    """profile: [(t along the arm, radius)]."""
    sh = JOINTS["sh" + s]
    d = (JOINTS["wr" + s] - sh).normalized()
    back = Vector((0, 0, 1))
    out = []
    for t, r in profile:
        c = sh + d * t
        out.append((ring_points(c, d, r, r * 0.94, segs, 2.0, a_axis=back), clean(arm_weights(s, t))))
    return out


LONG_SLEEVE = [(-0.07, 0.07), (-0.03, 0.094), (0.04, 0.096), (0.12, 0.092), (0.2, 0.094), (0.27, 0.088), (0.33, 0.086), (0.4, 0.083), (0.47, 0.08), (0.52, 0.078), (0.54, 0.084), (0.585, 0.084), (0.6, 0.07)]
TEE_SLEEVE = [(-0.07, 0.07), (-0.03, 0.098), (0.05, 0.1), (0.12, 0.098), (0.15, 0.096), (0.16, 0.08)]
ARM_SKIN = [(0.1, 0.058), (0.2, 0.056), (0.27, 0.05), (0.33, 0.049), (0.45, 0.044), (0.56, 0.04), (0.6, 0.036)]


def build_sleeves(name, M, profile, cuff_from=None, material="top"):
    sk = Skinned(name, [M[material], M["trim"]])
    for s in ("L", "R"):
        rings = sleeve_rings(s, profile)
        band = (lambda i: 1 if cuff_from is not None and i >= cuff_from else 0)
        loft(sk, rings, 16, band, cap0=True, cap1=True)
    return sk


def build_pants(M):
    sk = Skinned("pants", [M["pants"]])
    # Seat: a pillowy block across both hips.
    def seat_w(c):
        return clean({"hips": 1.0})

    blob(sk, P + Vector((0, -0.03, 0.01)), 0.225, 0.12, 0.17, seat_w, segs=24, layers=6, p=2.6)
    # Legs: baggy, a couple of soft folds, flaring over the boot at the hem.
    prof = [(-0.12, 0.13), (-0.04, 0.132), (0.06, 0.134), (0.16, 0.13), (0.26, 0.133), (0.36, 0.126), (0.44, 0.12), (0.5, 0.118), (0.6, 0.12), (0.7, 0.124), (0.78, 0.132), (0.85, 0.142), (0.9, 0.148), (0.93, 0.146)]
    for s in ("L", "R"):
        hip = JOINTS["hip" + s]
        d = Vector((0, -1, 0))
        rings = [(ring_points(hip + d * t, d, r, r * 1.05, 20, 2.0, a_axis=Vector((1, 0, 0))), clean(leg_weights(s, t))) for t, r in prof]
        loft(sk, rings, 20, cap0=True, cap1=True)
    return sk


def build_bits(M, kx=1.0):
    """The shell's collar, zip and packed hood; the hoodie's big hood and pocket."""
    parts = []
    chest = lambda c: clean(torso_weights(c.y - P.y))
    # Rolled collar and the front zip (shell).
    sk = Skinned("shellBits", [M["trim"]])
    rings = []
    for y, rx, rz in ((0.655, 0.12, 0.11), (0.7, 0.112, 0.104), (0.735, 0.1, 0.094)):
        c = P + Vector((0, y, 0))
        rings.append((ring_points(c, Vector((0, 1, 0)), rx, rz, 24, 2.0, a_axis=Vector((1, 0, 0))), clean(torso_weights(y))))
    loft(sk, rings, 24, cap0=False, cap1=False)
    blob(sk, P + Vector((0, 0.27, -0.183)), 0.012, 0.3, 0.008, chest, segs=8, layers=6)
    parts.append(sk)
    # Hood packed behind the neck (shell).
    sk = Skinned("hoodBunch", [M["top"]])
    blob(sk, P + Vector((0, 0.63, 0.12)), 0.17, 0.09, 0.1, chest, segs=16, layers=6)
    parts.append(sk)
    # Big hood down the back (hoodie).
    sk = Skinned("bigHood", [M["top"]])
    blob(sk, P + Vector((0, 0.6, 0.15)), 0.19 * kx, 0.13, 0.11, chest, segs=18, layers=7, p=2.2)
    parts.append(sk)
    # Kangaroo pocket (hoodie).
    sk = Skinned("pocket", [M["trim"]])
    blob(sk, P + Vector((0, 0.06, -0.182)), 0.17, 0.075, 0.018, chest, segs=12, layers=5)
    parts.append(sk)
    return parts


# ----------------------------------------------------------------- assembly
def to_object(sk, armature):
    me = bpy.data.meshes.new(sk.name)
    sk.bm.normal_update()
    sk.bm.to_mesh(me)
    sk.bm.free()
    for m in sk.materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(sk.name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {}
    for i, w in enumerate(sk.weights):
        for bone, value in w.items():
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], value, "REPLACE")
    ob.parent = armature
    mod = ob.modifiers.new("skin", "ARMATURE")
    mod.object = armature
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = dict(
        top=mat("top", 0xFF7A2F),
        trim=mat("trim", 0xD95C17),
        pants=mat("pants", 0x2F3B4C, 0.9),
        skin=mat("skin", 0xE2B38F, 0.6),
    )
    armature = build_armature()
    parts = [
        build_torso("torso_man", M),
        build_torso("torso_woman", M, kx=0.9, ky=0.97, kz=0.93),
        build_sleeves("sleeves", M, LONG_SLEEVE, cuff_from=len(LONG_SLEEVE) - 4),
        build_sleeves("sleevesTee", M, TEE_SLEEVE),
        build_sleeves("arms", M, ARM_SKIN, material="skin"),
        build_pants(M),
        *build_bits(M),
    ]
    objs = [to_object(sk, armature) for sk in parts]
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, "rider-body.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_def_bones=False,
    )
    print("wrote", path, "bytes", os.path.getsize(path))


main()
