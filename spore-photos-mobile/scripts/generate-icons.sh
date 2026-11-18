#!/usr/bin/env bash
# Regenerate the Android launcher bitmaps.
#
#   ./scripts/generate-icons.sh
#
# The mark is the lucide "camera" from spore-photos-client/public/logo.svg — the
# same artwork the web UI uses, read out of that file at run time so there is one
# source for it. Nothing here is traced or drawn: logo.svg is stroke art (a 24x24
# viewBox with fill="none" stroke-width="2"), so it is rendered at an explicit size
# and colour and rasterised. That is the entire job.
#
# Only the *bitmaps* are generated. The adaptive-icon layers — the foreground
# vector in res/drawable-v24/ and the two mipmap-anydpi-v26/ic_launcher*.xml files —
# are source, hand-maintained, and checked against the two constants below so the
# generated set and the vector set cannot drift apart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/.." && pwd)"
RES="$MOBILE_DIR/android/app/src/main/res"
LOGO="$REPO_ROOT/spore-photos-client/public/logo.svg"

BG="#ead4ab"            # retro-cream: the icon background
FG="#066176"            # retro-navy: the mark
MARK_FRACTION="0.62"    # how much of a legacy square the mark spans — see below

# A legacy icon (API 24-25) is shown whole, so the mark is sized against the full
# square. An adaptive foreground is cropped by the launcher to roughly the centre
# two-thirds, so the vector uses a smaller fraction; that number lives with the
# vector, not here.
DENSITIES="mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192"

die() { printf '  ERROR: %s\n' "$*" >&2; exit 1; }

command -v rsvg-convert >/dev/null 2>&1 || die "rsvg-convert is required (librsvg).
    Arch/CachyOS: sudo pacman -S librsvg
    Debian/Ubuntu: sudo apt install librsvg2-bin
    Fedora: sudo dnf install librsvg2-tools"
command -v awk >/dev/null 2>&1 || die "awk is required"

[ -f "$LOGO" ] || die "no brand mark at $LOGO"
MARK_PATH="$(sed -n 's/.*<path d="\([^"]*\)".*/\1/p' "$LOGO" | head -n1)"
[ -n "$MARK_PATH" ] || die "no <path d=\"...\"> found in $LOGO"

# The layers an adaptive icon actually uses have to agree with what is drawn here.
grep -q "$BG" "$RES/values/ic_launcher_background.xml" \
  || die "res/values/ic_launcher_background.xml is not $BG — keep the adaptive background and this script in step"
grep -q "$FG" "$RES/drawable-v24/ic_launcher_foreground.xml" \
  || die "res/drawable-v24/ic_launcher_foreground.xml does not use $FG — keep the adaptive foreground and this script in step"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The mark is not centred inside its own 24-unit viewBox, so centring it means
# centring the artwork's measured visual box — including the 2-unit stroke it runs
# x 0.9-22.9, y 2.8-21.0, a centre of (11.9, 11.9). Hence one expression for both
# offsets: half the canvas minus 12 units, scaled. (Centring the viewBox instead
# leaves the mark visibly high.)
svg_for() { # svg_for <size> <round:yes|no> > file
  local size="$1" round="$2" s tx ty shape
  read -r s tx ty < <(awk -v n="$size" -v f="$MARK_FRACTION" \
    'BEGIN { s = n * f / 22; t = n / 2 - 12 * s; printf "%.4f %.4f %.4f\n", s, t, t }')

  if [ "$round" = yes ]; then
    # A real circle with transparent corners, not a square with rounded ones. The
    # background *is* the circle, so no clipping is involved — the mark spans 62% of
    # the canvas and the circle inscribes 70.7%, so it cannot poke out.
    shape="<circle cx=\"$((size / 2))\" cy=\"$((size / 2))\" r=\"$((size / 2))\" fill=\"$BG\"/>"
  else
    shape="<rect width=\"$size\" height=\"$size\" fill=\"$BG\"/>"
  fi

  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">\n' "$size" "$size" "$size" "$size"
  printf '  %s\n' "$shape"
  printf '  <g transform="translate(%s,%s) scale(%s)" fill="none" stroke="%s" stroke-width="2"' "$tx" "$ty" "$s" "$FG"
  printf ' stroke-linecap="round" stroke-linejoin="round">\n'
  printf '    <path d="%s"/>\n' "$MARK_PATH"
  printf '    <circle cx="12" cy="13" r="3"/>\n'
  printf '  </g>\n'
  printf '</svg>\n'
}

for entry in $DENSITIES; do
  dir="mipmap-${entry%%:*}"
  size="${entry##*:}"
  for variant in square round; do
    name="ic_launcher"; [ "$variant" = round ] && name="ic_launcher_round"
    round=no; [ "$variant" = round ] && round=yes
    svg="$TMP/$name-$size.svg"
    svg_for "$size" "$round" > "$svg"
    rsvg-convert -w "$size" -h "$size" "$svg" -o "$RES/$dir/$name.png"
    printf '  %-14s %-18s %sx%s\n' "$dir" "$name.png" "$size" "$size"
  done
done

cat <<EOF

  Mark:    $(basename "$LOGO") (lucide camera), drawn at $MARK_FRACTION of a legacy square
  Colours: background $BG, mark $FG
  Layers:  res/drawable-v24/ic_launcher_foreground.xml + res/mipmap-anydpi-v26/*.xml
           are source; if you changed a colour here, change it there too.
EOF
