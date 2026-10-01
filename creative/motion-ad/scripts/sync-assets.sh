#!/usr/bin/env bash
# Copies the REAL brand / build assets from the website (main branch checkout)
# into this isolated project. Nothing is edited or regenerated.
set -euo pipefail
SRC="${1:-../../../m1pcs-website-main/public}"
DEST="$(dirname "$0")/../public/brand"
mkdir -p "$DEST/builds"
cp "$SRC/logo.png" "$DEST/logo.png"
cp "$SRC/hero/featured-build.webp" "$DEST/featured-build.webp"
cp "$SRC"/builds/* "$DEST/builds/"
echo "synced brand assets from $SRC"

# The site's own web fonts (latin subsets) from the main build, so composited
# ad copy is set in the same Inter / Space Grotesk / DM Serif Display.
MEDIA="${2:-../../../m1pcs-website-main/.next/static/media}"
FONTS="$(dirname "$0")/../public/fonts"
mkdir -p "$FONTS"
cp "$MEDIA/e4af272ccee01ff0-s.p.woff2" "$FONTS/inter-latin.woff2"
cp "$MEDIA/36966cca54120369-s.p.woff2" "$FONTS/spacegrotesk-latin.woff2"
cp "$MEDIA/fa3e259cafa8f47e-s.p.woff2" "$FONTS/dmserif-latin.woff2"
echo "synced fonts from $MEDIA"
