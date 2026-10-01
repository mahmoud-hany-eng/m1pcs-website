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
