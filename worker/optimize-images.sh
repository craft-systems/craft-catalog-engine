#!/usr/bin/env bash
# Optimiza imágenes para R2 (recompresión + resize + strip metadata) EN LOCAL (usa ImageMagick).
# Preserva nombre y formato (jpg→jpg, png→png, webp→webp) para NO romper URLs/refs existentes,
# y solo reemplaza si el resultado queda más chico (nunca infla). Idempotente en la práctica.
#
#   optimize-images.sh <src_dir> <dst_dir> [maxedge=1920] [quality=82]
#   dst_dir == src_dir  → optimiza in-place.
#
# Se usa SOLO al onboardear desde local (tienda/menú nuevo) o para comprimir el lote existente.
# Las ediciones del cliente por la UI van directo a R2 sin pasar por aquí.
set -euo pipefail
SRC="${1:?uso: <src_dir> <dst_dir> [maxedge] [quality]}"; SRC="${SRC%/}"
DST="${2:?falta dst_dir}"; DST="${DST%/}"; MAX="${3:-1920}"; Q="${4:-82}"
command -v magick >/dev/null || { echo "falta ImageMagick (magick)"; exit 1; }

before=0; after=0; n=0
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"; out="$DST/$rel"; mkdir -p "$(dirname "$out")"
  tmp="$(mktemp --suffix=".${f##*.}")"
  # -resize NxN>  = solo achica si excede el borde máximo · -strip quita metadata · quality→jpg/webp
  if ! magick "$f" -auto-orient -strip -resize "${MAX}x${MAX}>" -quality "$Q" "$tmp" 2>/dev/null; then
    cp -f "$f" "$out"; rm -f "$tmp"; continue
  fi
  os=$(stat -c%s "$f"); ns=$(stat -c%s "$tmp")
  if [ "$ns" -lt "$os" ]; then mv -f "$tmp" "$out"; else cp -f "$f" "$out"; rm -f "$tmp"; ns=$os; fi
  before=$((before+os)); after=$((after+ns)); n=$((n+1))
done < <(find "$SRC" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0)

pct=0; [ "$before" -gt 0 ] && pct=$(((before-after)*100/before))
echo "optimizadas $n imágenes: $(numfmt --to=iec "$before") → $(numfmt --to=iec "$after") (${pct}% menos) → $DST"
