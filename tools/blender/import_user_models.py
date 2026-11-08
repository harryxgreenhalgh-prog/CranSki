"""Prepare the Sketchfab models (CC-BY-4.0) for the web: shrink textures and
triangle counts, then export compact .glb files into public/models.

    blender --background --python tools/blender/import_user_models.py -- <source dir> public/models

Source models (credits in public/models/CREDITS.md and the in-game Credits page):
  snowy_mountain_-_terrain.glb  "Snowy Mountain - Terrain" by artfromheath
  snowy_wooden_hut.glb          "Snowy Wooden Hut" by gecko0307
  finish_line.glb               "Finish Line" by Kemal Colak
"""

import glob
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)


def find(pattern):
    hits = glob.glob(os.path.join(SRC, pattern))
    if not hits:
        raise SystemExit(f"missing {pattern} in {SRC}")
    return hits[0]


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def shrink_images(max_size):
    for img in bpy.data.images:
        if img.size[0] > max_size or img.size[1] > max_size:
            k = max_size / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))


def decimate(meshes, target_tris):
    total = sum(len(o.data.polygons) for o in meshes)
    ratio = min(1.0, target_tris / max(1, total))
    if ratio >= 1:
        return
    for o in meshes:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.select_set(False)


def export(name, image_format="AUTO"):
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_image_format=image_format,
        export_jpeg_quality=82,
    )
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


# Log cabin: Basecamp lodge and start huts.
load(find("*snowy_wooden_hut*.glb"))
shrink_images(1024)
export("hut.glb", "JPEG")

# Finish line arch with its banner.
load(find("*finish_line*.glb"))
shrink_images(1024)
export("finish.glb")

# Mountain terrain for the skyline: far fewer triangles, smaller texture.
meshes = load(find("*snowy_mountain*.glb"))
decimate(meshes, 60000)
shrink_images(2048)
export("mountain.glb", "JPEG")
