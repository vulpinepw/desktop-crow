#!/usr/bin/env bash
set -euo pipefail
SRC="$1"
shift || true
WORK="${HOME}/desktop-crow-build"
mkdir -p "$WORK"
echo "==> Syncing sources to $WORK"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude qa/out --exclude '.git' "$SRC/" "$WORK/"
else
  (cd "$SRC" && tar --exclude=./node_modules --exclude=./dist --exclude=./qa/out -cf - .) | (rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK" && tar -xf -)
fi
cd "$WORK"
chmod +x scripts/*.sh
bash scripts/build-linux.sh "$@"
mkdir -p "$SRC/dist"
cp -f dist/*.AppImage "$SRC/dist/"
cp -f dist/*.deb "$SRC/dist/" 2>/dev/null || true
echo "==> Copied Linux artifacts to $SRC/dist"
