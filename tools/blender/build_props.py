"""Build CranSki's park props and export them as public/models/props.glb.

Run with:
    blender --background --python tools/blender/build_props.py -- public/models

Original low-poly models, generated from code (no outside assets):
  chalet     BELLEVUE's houses: stone base, plank walls, balcony, snowy gable roof
  floodlight lattice mast with a bank of four lamps (16 m)
  snowcat    a snow groomer: cab, tracks, front blade and rear tiller
  skiRack    a wooden rack with a few pairs of skis and a snowboard
  speakers   a speaker stack on a stage box, for the finish area
  tent       a pop-up event tent (3 x 3 m)
  flag       a feather flag on a pole
  fence      a 4 m section of orange safety fence
  railLeg    a rail support post with a base plate (1 m tall, stretched to fit)
  railPad    a foam pad at the foot of a rail
  snowman    for the base area

Each object is exported as one part; the game (src/render/assets.js) turns it
into one geometry with a material per group and recolours some materials
(the chalet's walls and roof take each house's colours).

Coordinates are written in three.js space (x right, y up, -z forward); origin
on the ground at the middle of each prop unless noted.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models"
os.makedirs(OUT, exist_ok=True)


def hexc(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


MATS = {}


def mat(name, color, rough=0.8, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hexc(color), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*hexc(color), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


def to_blender(m):
    """A transform written in three.js axes -> Blender axes."""
    C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    return C @ m @ C.inverted()


class Part:
    def __init__(self, name, materials):
        self.name = name
        self.bm = bmesh.new()
        self.mats = list(materials)

    def mi(self, m):
        return self.mats.index(m)

    def _add(self, geom_verts, faces, m, transform, smooth=False):
        bmesh.ops.transform(self.bm, matrix=to_blender(transform), verts=geom_verts)
        for f in faces:
            f.material_index = self.mi(m)
            f.smooth = smooth

    def box(self, m, size, at=(0, 0, 0), rot=(0, 0, 0)):
        """size = (x, y, z) in metres, centred at `at`, rotated (x, y, z) radians."""
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = r["verts"]
        faces = list({f for v in verts for f in v.link_faces})
        T = Matrix.Translation(at) @ euler(rot) @ Matrix.Diagonal((*size, 1))
        self._add(verts, faces, m, T)

    def cyl(self, m, r1, r2, h, at=(0, 0, 0), rot=(0, 0, 0), segs=10, smooth=True):
        """A cylinder / cone along y, centred at `at`."""
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
        verts = r["verts"]
        faces = list({f for v in verts for f in v.link_faces})
        # create_cone builds along Blender z, which is three.js y: no pre-rotation needed.
        T = Matrix.Translation(at) @ euler(rot)
        self._add(verts, faces, m, T, smooth)

    def ball(self, m, r, at=(0, 0, 0), scale=(1, 1, 1), segs=12, rings=8):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r)
        verts = res["verts"]
        faces = list({f for v in verts for f in v.link_faces})
        T = Matrix.Translation(at) @ Matrix.Diagonal((*scale, 1))
        self._add(verts, faces, m, T, True)

    def prism(self, m, w, h, l, at=(0, 0, 0), rot=(0, 0, 0)):
        """A triangular prism (a gable): width w across x, apex height h, length l along z."""
        bm = self.bm
        pts = [(-w / 2, 0), (w / 2, 0), (0, h)]
        vs = []
        for z in (-l / 2, l / 2):
            vs.append([bm.verts.new((x, -z, y)) for x, y in pts])  # three.js (x, y, z) -> Blender
        faces = [bm.faces.new(vs[0][::-1]), bm.faces.new(vs[1])]
        for k in range(3):
            a, b = vs[0][k], vs[0][(k + 1) % 3]
            c, d = vs[1][(k + 1) % 3], vs[1][k]
            faces.append(bm.faces.new((a, b, c, d)))
        verts = vs[0] + vs[1]
        # verts were written in three.js axes directly: convert with the rest of the transform
        T = Matrix.Translation(at) @ euler(rot)
        bmesh.ops.transform(bm, matrix=to_blender(T), verts=verts)
        for f in faces:
            f.material_index = self.mi(m)

    def done(self):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def euler(rot):
    return Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z")


# ----------------------------------------------------------------- materials
def materials():
    return dict(
        wall=mat("wall", 0xC98B5A, 0.9),
        roof=mat("roof", 0x8C2F2F, 0.8),
        wood=mat("wood", 0x8A5A36, 0.9),
        woodDark=mat("woodDark", 0x4E3220, 0.9),
        stone=mat("stone", 0x8D8A86, 0.95),
        snow=mat("snow", 0xF4F7FB, 0.9),
        glass=mat("glass", 0xBFD8EE, 0.15, 0.2),
        steel=mat("steel", 0xC9D0D8, 0.3, 0.8),
        dark=mat("dark", 0x2B2F36, 0.6, 0.3),
        rubber=mat("rubber", 0x16181B, 0.95),
        lamp=mat("lamp", 0xFFF2C4, 0.3, 0.0, 2.0),
        catBody=mat("catBody", 0xD9362B, 0.5),
        catTrim=mat("catTrim", 0xF2F2F2, 0.5),
        brand=mat("brand", 0x1E7BFF, 0.6),
        orange=mat("orange", 0xFF6A1A, 0.7),
        white=mat("white", 0xF7F9FC, 0.6),
        carrot=mat("carrot", 0xF07A20, 0.7),
        skiA=mat("skiA", 0xFFD23F, 0.4),
        skiB=mat("skiB", 0x22B07D, 0.4),
        skiC=mat("skiC", 0xE0406B, 0.4),
    )


# ----------------------------------------------------------------- props
def chalet(M):
    # Unit chalet: 8 m wide (x), 10 m long (z), walls 4.5 m to the eaves.
    p = Part("chalet", [M[k] for k in ("stone", "wall", "woodDark", "roof", "snow", "glass", "wood")])
    W, L, H = 8.0, 10.0, 4.5
    p.box(M["stone"], (W + 0.3, 0.9, L + 0.3), (0, 0.45, 0))
    p.box(M["wall"], (W, H - 0.9, L), (0, 0.9 + (H - 0.9) / 2, 0))
    # Plank lines on the long walls and corner posts.
    for k in range(1, 6):
        y = 0.9 + k * (H - 0.9) / 6
        for sx in (-1, 1):
            p.box(M["woodDark"], (0.06, 0.06, L + 0.04), (sx * (W / 2 + 0.02), y, 0))
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.box(M["woodDark"], (0.35, H - 0.9, 0.35), (sx * (W / 2 - 0.1), 0.9 + (H - 0.9) / 2, sz * (L / 2 - 0.1)))
    # Gable ends and the roof: two slabs overhanging, a thick snow layer on top.
    for sz in (-1, 1):
        p.prism(M["wall"], W, 2.6, 0.3, (0, H, sz * (L / 2 - 0.15)))
    pitch = math.atan2(2.6, W / 2)
    slab = math.hypot(W / 2, 2.6) + 0.8
    for sx in (-1, 1):
        cx = sx * (W / 4 + 0.15)
        p.box(M["roof"], (slab, 0.28, L + 1.4), (cx, H + 1.3 + 0.05, 0), (0, 0, -sx * pitch))
        p.box(M["snow"], (slab - 0.2, 0.32, L + 1.2), (cx - sx * 0.05, H + 1.3 + 0.32, 0), (0, 0, -sx * pitch))
    # Chimney.
    p.box(M["stone"], (0.8, 2.2, 0.8), (1.6, H + 2.2, -2.0))
    p.box(M["snow"], (0.95, 0.2, 0.95), (1.6, H + 3.35, -2.0))
    # Windows (frame, glass, shutters) on the long sides; door and balcony at the front (-z).
    for sx in (-1, 1):
        for z in (-2.5, 2.5):
            x = sx * (W / 2 + 0.03)
            p.box(M["woodDark"], (0.08, 1.4, 1.3), (x, 2.6, z))
            p.box(M["glass"], (0.1, 1.1, 1.0), (x + sx * 0.01, 2.6, z))
            for s in (-1, 1):
                p.box(M["roof"], (0.06, 1.3, 0.45), (x + sx * 0.02, 2.6, z + s * 0.9))
    p.box(M["woodDark"], (1.4, 2.4, 0.1), (-1.6, 2.1, -L / 2 - 0.03))
    p.box(M["glass"], (1.1, 1.0, 0.12), (1.8, 2.7, -L / 2 - 0.03))
    p.box(M["wood"], (W + 0.4, 0.18, 1.4), (0, 3.4, -L / 2 - 0.7))
    for k in range(9):
        p.box(M["wood"], (0.08, 0.9, 0.08), (-W / 2 + k * W / 8, 3.9, -L / 2 - 1.35))
    p.box(M["wood"], (W + 0.4, 0.1, 0.1), (0, 4.35, -L / 2 - 1.35))
    return p.done()


def floodlight(M):
    p = Part("floodlight", [M[k] for k in ("dark", "steel", "lamp", "stone")])
    H = 16.0
    p.box(M["stone"], (1.4, 0.4, 1.4), (0, 0.2, 0))
    # Three-legged lattice mast.
    legs = [(math.cos(a) * 0.45, math.sin(a) * 0.45) for a in (0, 2 * math.pi / 3, 4 * math.pi / 3)]
    for x, z in legs:
        p.cyl(M["dark"], 0.06, 0.05, H, (x, H / 2, z), segs=6)
    for k in range(1, 15):
        y = k * H / 15
        for i in range(3):
            (x1, z1), (x2, z2) = legs[i], legs[(i + 1) % 3]
            mx, mz = (x1 + x2) / 2, (z1 + z2) / 2
            ang = math.atan2(x2 - x1, z2 - z1)
            p.box(M["dark"], (0.04, 0.04, math.hypot(x2 - x1, z2 - z1)), (mx, y, mz), (0, ang, 0))
    # Lamp bank: a frame with four lamps facing -x (towards the run).
    p.box(M["dark"], (0.3, 1.6, 2.6), (-0.2, H + 0.6, 0))
    for yy in (H + 0.2, H + 1.0):
        for zz in (-0.65, 0.65):
            p.box(M["steel"], (0.5, 0.65, 0.95), (-0.5, yy, zz), (0, 0, -0.35))
            p.box(M["lamp"], (0.06, 0.55, 0.85), (-0.78, yy - 0.08, zz), (0, 0, -0.35))
    return p.done()


def snowcat(M):
    p = Part("snowcat", [M[k] for k in ("catBody", "catTrim", "rubber", "glass", "dark", "steel", "lamp")])
    # Tracks.
    for sx in (-1, 1):
        p.box(M["rubber"], (0.9, 1.0, 5.2), (sx * 1.55, 0.55, 0))
        for z in (-1.8, -0.6, 0.6, 1.8):
            p.cyl(M["dark"], 0.38, 0.38, 0.92, (sx * 1.55, 0.5, z), (0, 0, math.pi / 2), segs=10)
    # Body and cab.
    p.box(M["catBody"], (2.3, 1.1, 4.6), (0, 1.45, 0.2))
    p.box(M["catTrim"], (2.32, 0.18, 4.62), (0, 1.1, 0.2))
    p.box(M["catBody"], (2.0, 1.5, 2.0), (0, 2.75, -0.9))
    p.box(M["glass"], (2.02, 0.9, 1.6), (0, 2.85, -0.9))
    p.box(M["glass"], (1.7, 0.9, 0.05), (0, 2.85, -1.92), (0.15, 0, 0))
    p.box(M["catBody"], (2.1, 0.12, 2.1), (0, 3.55, -0.9))
    p.box(M["dark"], (1.6, 0.18, 0.25), (0, 3.7, -0.9))
    for x in (-0.55, -0.18, 0.18, 0.55):
        p.box(M["lamp"], (0.22, 0.12, 0.05), (x, 3.7, -1.04))
    # Front blade and arms.
    p.box(M["steel"], (4.2, 1.1, 0.15), (0, 0.75, -3.35), (-0.2, 0, 0))
    for sx in (-1, 1):
        p.box(M["dark"], (0.15, 0.15, 1.1), (sx * 0.8, 1.0, -2.75))
    # Rear tiller and its flap.
    p.box(M["dark"], (3.6, 0.6, 0.9), (0, 0.55, 3.25))
    p.box(M["catTrim"], (3.6, 0.08, 0.9), (0, 0.9, 3.3))
    p.box(M["rubber"], (3.6, 0.5, 0.06), (0, 0.3, 3.75))
    return p.done()


def ski_rack(M):
    p = Part("skiRack", [M[k] for k in ("wood", "woodDark", "skiA", "skiB", "skiC", "rubber", "snow")])
    p.box(M["wood"], (3.2, 0.12, 0.12), (0, 1.2, 0))
    p.box(M["wood"], (3.2, 0.12, 0.12), (0, 0.35, 0.35))
    for sx in (-1, 1):
        p.box(M["woodDark"], (0.12, 1.3, 0.12), (sx * 1.5, 0.65, 0))
        p.box(M["woodDark"], (0.12, 0.12, 0.8), (sx * 1.5, 0.06, 0.2))
    p.box(M["snow"], (3.4, 0.08, 0.3), (0, 1.3, 0))
    cols = ["skiA", "skiB", "skiC", "skiA", "skiB"]
    for k, x in enumerate((-1.2, -0.75, -0.3, 0.2, 0.65)):
        for dx in (-0.06, 0.06):
            p.box(M[cols[k]], (0.09, 1.7, 0.03), (x + dx, 0.85, 0.22), (-0.22, 0, 0))
    p.box(M["skiC"], (0.3, 1.45, 0.04), (1.15, 0.75, 0.22), (-0.2, 0, 0))
    return p.done()


def speakers(M):
    p = Part("speakers", [M[k] for k in ("dark", "rubber", "steel", "brand", "white")])
    p.box(M["dark"], (3.0, 0.8, 2.0), (0, 0.4, 0))
    p.box(M["brand"], (3.02, 0.25, 2.02), (0, 0.62, 0))
    for sx in (-1, 1):
        for k in range(3):
            y = 1.25 + k * 0.85
            p.box(M["dark"], (0.9, 0.8, 0.8), (sx * 0.95, y, 0))
            p.cyl(M["rubber"], 0.28, 0.2, 0.06, (sx * 0.95, y, -0.41), (math.pi / 2, 0, 0), segs=14)
            p.cyl(M["steel"], 0.06, 0.06, 0.07, (sx * 0.95, y, -0.43), (math.pi / 2, 0, 0), segs=8)
    # Decks table between the stacks.
    p.box(M["white"], (1.0, 0.1, 0.7), (0, 1.25, 0))
    p.box(M["dark"], (0.9, 0.08, 0.5), (0, 1.33, 0))
    return p.done()


def tent(M):
    p = Part("tent", [M[k] for k in ("steel", "brand", "white")])
    S, H = 3.0, 2.3
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.cyl(M["steel"], 0.035, 0.035, H, (sx * S / 2, H / 2, sz * S / 2), segs=6)
    # Peaked canopy in four panels (blue and white), with a valance.
    p.cyl(M["brand"], S * 0.74, 0.08, 0.9, (0, H + 0.45, 0), (0, math.pi / 4, 0), segs=4, smooth=False)
    for sx, sz, ry in ((0, -1, 0), (0, 1, 0), (-1, 0, math.pi / 2), (1, 0, math.pi / 2)):
        p.box(M["white"], (S, 0.25, 0.02), (sx * S / 2, H - 0.1, sz * S / 2), (0, ry, 0))
    return p.done()


def flag(M):
    p = Part("flag", [M[k] for k in ("steel", "brand", "white", "dark")])
    p.cyl(M["steel"], 0.03, 0.025, 3.6, (0, 1.8, 0), segs=6)
    p.box(M["dark"], (0.5, 0.06, 0.5), (0, 0.03, 0))
    # Feather flag: a tall curved strip, built from slices.
    n = 8
    for k in range(n):
        y0 = 0.9 + k * 2.6 / n
        w = 0.75 * math.sin(math.pi * (0.25 + 0.75 * (k + 0.5) / n)) + 0.1
        bend = 0.08 * math.sin(k * 0.9)
        m = "brand" if k < n - 2 else "white"
        p.box(M[m], (w, 2.6 / n + 0.01, 0.02), (w / 2 + 0.03, y0 + 1.3 / n, bend))
    return p.done()


def fence(M):
    p = Part("fence", [M[k] for k in ("orange", "dark")])
    for sx in (-1, 1):
        p.cyl(M["dark"], 0.03, 0.03, 1.4, (sx * 2.0, 0.6, 0), segs=6)
    for k in range(6):
        p.box(M["orange"], (4.0, 0.035, 0.015), (0, 0.15 + k * 0.17, 0))
    for k in range(17):
        p.box(M["orange"], (0.03, 0.9, 0.015), (-2.0 + k * 0.25, 0.58, 0))
    return p.done()


def rail_leg(M):
    p = Part("railLeg", [M[k] for k in ("dark", "steel")])
    p.cyl(M["dark"], 0.045, 0.05, 1.0, (0, 0.5, 0), segs=8)
    p.box(M["steel"], (0.42, 0.04, 0.28), (0, 0.02, 0))
    for sx in (-1, 1):
        p.box(M["dark"], (0.03, 0.18, 0.2), (sx * 0.06, 0.1, 0))
    return p.done()


def rail_pad(M):
    p = Part("railPad", [M[k] for k in ("brand", "white")])
    p.box(M["brand"], (0.7, 0.35, 0.5), (0, 0.18, 0))
    p.box(M["white"], (0.72, 0.06, 0.52), (0, 0.3, 0))
    return p.done()


def snowman(M):
    p = Part("snowman", [M[k] for k in ("snow", "dark", "carrot", "brand")])
    p.ball(M["snow"], 0.55, (0, 0.5, 0), (1, 0.9, 1))
    p.ball(M["snow"], 0.4, (0, 1.25, 0))
    p.ball(M["snow"], 0.28, (0, 1.82, 0))
    p.cyl(M["carrot"], 0.05, 0.005, 0.28, (0, 1.82, -0.38), (math.pi / 2, 0, 0), segs=8)
    for sx in (-1, 1):
        p.ball(M["dark"], 0.035, (sx * 0.1, 1.9, -0.24), segs=6, rings=4)
    p.cyl(M["dark"], 0.2, 0.2, 0.3, (0, 2.18, 0), segs=12)
    p.cyl(M["dark"], 0.3, 0.3, 0.04, (0, 2.04, 0), segs=12)
    p.box(M["brand"], (0.62, 0.1, 0.62), (0, 1.58, 0))
    for y in (1.15, 1.35):
        p.ball(M["dark"], 0.04, (0, y, -0.39), segs=6, rings=4)
    return p.done()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = materials()
    objs = [chalet(M), floodlight(M), snowcat(M), ski_rack(M), speakers(M), tent(M), flag(M), fence(M), rail_leg(M), rail_pad(M), snowman(M)]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, "props.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
    )
    print("wrote", path, "bytes", os.path.getsize(path))


main()
