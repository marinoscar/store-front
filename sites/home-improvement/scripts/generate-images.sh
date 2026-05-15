#!/usr/bin/env bash
# generate-images.sh — generate every marketing image referenced by index.astro
# by calling OpenAI's gpt-image-1 via the `claude-image` CLI. Prompts and
# specs live in ../IMAGE_CREATION.md (source of truth). This script just
# parses that file and orchestrates the calls.
#
# Usage:
#   ./generate-images.sh                   only fill in images that don't exist yet
#   ./generate-images.sh --force           regenerate every image
#   ./generate-images.sh --only hero,owner regenerate just these (filename stems)
#   ./generate-images.sh --quality medium  override default quality (default: high)
#   ./generate-images.sh --dry-run         print prompts, don't call the API
#   ./generate-images.sh --help            this message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MD="$SITE_DIR/IMAGE_CREATION.md"
PUBLIC="$SITE_DIR/public"

QUALITY="high"
FORCE=0
DRY_RUN=0
ONLY=""

usage() {
  sed -n '2,12p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)   FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --quality) QUALITY="${2:?--quality requires a value}"; shift 2 ;;
    --only)    ONLY="${2:?--only requires a comma-separated list}"; shift 2 ;;
    --help|-h) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

# --- Tool checks ---
if ! command -v claude-image >/dev/null 2>&1; then
  echo "✗ claude-image not found in PATH. Install it first (~/.local/bin/claude-image)." >&2
  exit 1
fi
if [[ ! -f "$MD" ]]; then
  echo "✗ Missing $MD" >&2
  exit 1
fi

CONVERTER=""
for tool in magick convert ffmpeg; do
  if command -v "$tool" >/dev/null 2>&1; then
    CONVERTER="$tool"
    break
  fi
done
if [[ -z "$CONVERTER" ]]; then
  echo "⚠  No PNG→JPG converter found (magick / convert / ffmpeg). Images will be saved as .png." >&2
fi

# --- Extract the shared preamble + negatives blocks ---
PREAMBLE="$(awk '/^```preamble$/{f=1;next} /^```$/{if(f){exit}} f' "$MD")"
NEGATIVES="$(awk '/^```negatives$/{f=1;next} /^```$/{if(f){exit}} f' "$MD")"

if [[ -z "$PREAMBLE" || -z "$NEGATIVES" ]]; then
  echo "✗ Could not find ```preamble or ```negatives blocks in $MD" >&2
  exit 1
fi

# --- Image registry (stem  →  output path, size) ---
# Single source of truth for the spec table in IMAGE_CREATION.md; keep in sync.
declare -a STEMS=(
  hero
  og-image
  interior-paint
  deck-rebuild
  flooring
  deck-before
  deck-after
  kitchen-before
  kitchen-after
  floor-before
  floor-after
  owner
  foreman
  painter
)

# stem → output path (relative to public/)
declare -A OUT_PATH=(
  [hero]="images/hero.jpg"
  [og-image]="images/og-image.jpg"
  [interior-paint]="images/services/interior-paint.jpg"
  [deck-rebuild]="images/services/deck-rebuild.jpg"
  [flooring]="images/services/flooring.jpg"
  [deck-before]="images/before-after/deck-before.jpg"
  [deck-after]="images/before-after/deck-after.jpg"
  [kitchen-before]="images/before-after/kitchen-before.jpg"
  [kitchen-after]="images/before-after/kitchen-after.jpg"
  [floor-before]="images/before-after/floor-before.jpg"
  [floor-after]="images/before-after/floor-after.jpg"
  [owner]="images/crew/owner.jpg"
  [foreman]="images/crew/foreman.jpg"
  [painter]="images/crew/painter.jpg"
)

# stem → image size (gpt-image-1 only supports these three)
declare -A SIZE=(
  [hero]="1536x1024"
  [og-image]="1536x1024"
  [interior-paint]="1536x1024"
  [deck-rebuild]="1536x1024"
  [flooring]="1536x1024"
  [deck-before]="1536x1024"
  [deck-after]="1536x1024"
  [kitchen-before]="1536x1024"
  [kitchen-after]="1536x1024"
  [floor-before]="1536x1024"
  [floor-after]="1536x1024"
  [owner]="1024x1536"
  [foreman]="1024x1536"
  [painter]="1024x1536"
)

# --- Extract the prompt body for one stem ---
# Looks for a `### \`<stem>\`` heading then captures the contents of the
# following ```prompt fenced block.
extract_prompt_body() {
  local stem="$1"
  awk -v stem="$stem" '
    $0 ~ "^### `" stem "`" {found=1; next}
    found && /^```prompt$/ {capturing=1; next}
    capturing && /^```$/ {exit}
    capturing {print}
  ' "$MD"
}

# --- Build the final prompt for one stem ---
build_full_prompt() {
  local stem="$1"
  local body
  body="$(extract_prompt_body "$stem")"
  if [[ -z "$body" ]]; then
    echo "✗ No prompt body found for stem '$stem' in $MD" >&2
    return 1
  fi
  printf "%s\n\n%s\n\n%s\n" "$PREAMBLE" "$body" "$NEGATIVES"
}

# --- Convert PNG → JPG using whatever converter we found ---
convert_png_to_jpg() {
  local png="$1" jpg="$2"
  case "$CONVERTER" in
    magick)  magick "$png" -quality 90 "$jpg" ;;
    convert) convert "$png" -quality 90 "$jpg" ;;
    ffmpeg)  ffmpeg -y -i "$png" -q:v 2 "$jpg" >/dev/null 2>&1 ;;
    *)       mv "$png" "${jpg%.jpg}.png"; return 0 ;;
  esac
  rm -f "$png"
}

# --- Generate one stem ---
generate_one() {
  local stem="$1"
  local out_rel="${OUT_PATH[$stem]}"
  local size="${SIZE[$stem]}"
  local final="$PUBLIC/$out_rel"
  local tmp_png="${final%.jpg}.png"

  if [[ -f "$final" && $FORCE -eq 0 ]]; then
    printf "  ↷ skip   %-32s (exists; use --force to regenerate)\n" "$stem"
    return 0
  fi

  mkdir -p "$(dirname "$final")"

  local prompt
  prompt="$(build_full_prompt "$stem")"

  if [[ $DRY_RUN -eq 1 ]]; then
    printf "\n=== %s → %s (%s, %s) ===\n%s\n" "$stem" "$out_rel" "$size" "$QUALITY" "$prompt"
    return 0
  fi

  local start_ts end_ts
  start_ts=$(date +%s)
  printf "  ▶ start  %-32s (size=%s quality=%s)\n" "$stem" "$size" "$QUALITY"

  if ! claude-image -p "$prompt" -o "$tmp_png" --size "$size" --quality "$QUALITY" >/dev/null; then
    echo "  ✗ failed: $stem" >&2
    return 1
  fi

  convert_png_to_jpg "$tmp_png" "$final"

  end_ts=$(date +%s)
  printf "  ✓ wrote  %-32s in %ss\n" "$out_rel" "$((end_ts - start_ts))"
}

# --- Resolve target list ---
TARGETS=()
if [[ -n "$ONLY" ]]; then
  IFS=',' read -r -a requested <<<"$ONLY"
  for stem in "${requested[@]}"; do
    stem="${stem// /}"
    if [[ -n "${OUT_PATH[$stem]:-}" ]]; then
      TARGETS+=("$stem")
    else
      echo "✗ Unknown image stem: $stem" >&2
      echo "  Known: ${STEMS[*]}" >&2
      exit 1
    fi
  done
else
  TARGETS=("${STEMS[@]}")
fi

echo "Generating ${#TARGETS[@]} image(s) at quality=$QUALITY"
[[ $FORCE -eq 1 ]]   && echo "  --force enabled (will overwrite existing files)"
[[ $DRY_RUN -eq 1 ]] && echo "  --dry-run enabled (no API calls)"
echo ""

FAILED=()
for stem in "${TARGETS[@]}"; do
  if ! generate_one "$stem"; then
    FAILED+=("$stem")
  fi
done

echo ""
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "✓ done"
else
  echo "✗ failures: ${FAILED[*]}" >&2
  exit 1
fi
