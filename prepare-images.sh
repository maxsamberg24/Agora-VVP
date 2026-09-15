#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Fill vvps/ from a VVP draft set folder.
#   "VVP #7.png"  →  vvps/vvp-7.jpg
# Converts to web-size JPEGs so 30 ideas load in seconds on a phone
# instead of ~70 MB of PNGs. The number in each filename becomes the
# private VVP number, so make sure config.js lists a { num } for each.
#
#   ./prepare-images.sh "../VVP Draft Set v1 (8.9.2026)"
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SRC="${1:?Usage: ./prepare-images.sh \"path/to/VVP Draft Set folder\"}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/vvps"
mkdir -p "$OUT"
shopt -s nullglob nocaseglob

count=0
for f in "$SRC"/*.png "$SRC"/*.jpg "$SRC"/*.jpeg "$SRC"/*.webp; do
  name="$(basename "$f")"
  num="$(printf '%s' "$name" | grep -oE '[0-9]+' | head -1 || true)"
  if [ -z "$num" ]; then
    echo "  skipped  $name  (no number in the filename)"
    continue
  fi
  num=$((10#$num))
  sips -s format jpeg -s formatOptions 82 --resampleWidth 1024 "$f" --out "$OUT/vvp-$num.jpg" >/dev/null
  printf '  vvp-%-3s  ←  %s\n' "$num.jpg" "$name"
  count=$((count + 1))
done

echo ""
echo "Done: $count images in vvps/ ($(du -sh "$OUT" | cut -f1) total)."
