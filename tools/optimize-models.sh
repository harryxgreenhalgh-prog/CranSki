#!/usr/bin/env bash
# Shrinks public/models/*.glb for the web with glTF Transform
# (https://gltf-transform.dev, MIT): meshopt-compressed geometry, WebP textures,
# and simplified meshes for the big scenery models. The game decodes meshopt
# with three.js's bundled decoder.
#
# Run after rebuilding models with the Blender scripts in tools/blender/:
#   bash tools/optimize-models.sh
# Files that are already compressed are skipped (simplifying twice would lose detail).
set -euo pipefail
cd "$(dirname "$0")/../public/models"
G="npx --yes @gltf-transform/cli@4"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
done_already() { grep -q "EXT_meshopt_compression" "$1"; }

# Our own models: compress the geometry only. (Not `optimize`: it merges
# look-alike materials, and the game finds materials by name.)
for f in rider rider-body props trees lift; do
  done_already "$f.glb" && { echo "skip $f.glb (already compressed)"; continue; }
  $G meshopt "$f.glb" "$tmp/$f.glb"
  mv "$tmp/$f.glb" "$f.glb"
done

# Scenery (CC BY models, see CREDITS.md): smaller WebP textures, simplified and compressed meshes.
scenery() { # file max-texture simplify-ratio normal-quality
  local f=$1
  done_already "$f.glb" && { echo "skip $f.glb (already compressed)"; return; }
  $G resize "$f.glb" "$tmp/a.glb" --width "$2" --height "$2"
  $G webp "$tmp/a.glb" "$tmp/b.glb" --slots "normalTexture" --quality "$4"
  $G webp "$tmp/b.glb" "$tmp/c.glb" --quality 75
  $G optimize "$tmp/c.glb" "$f.glb" --compress meshopt --simplify true --simplify-ratio "$3" --simplify-error 0.002 --texture-compress false
}
scenery mountain 1024 0.45 60
scenery finish 512 0.3 60
scenery hut 512 0.9 55

# Performance mode's skyline: the mountain again with a third of the triangles
# and a 512 px texture (made from the compressed mountain.glb).
if [ ! -f mountain-lo.glb ]; then
  $G dequantize mountain.glb "$tmp/a.glb"
  $G simplify "$tmp/a.glb" "$tmp/b.glb" --ratio 0.3 --error 0.01
  $G resize "$tmp/b.glb" "$tmp/c.glb" --width 512 --height 512
  $G webp "$tmp/c.glb" "$tmp/d.glb" --quality 70
  $G meshopt "$tmp/d.glb" mountain-lo.glb
fi
ls -l *.glb
