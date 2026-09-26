#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required (https://nodejs.org)." >&2
  exit 1
fi
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 20) { console.error("Node.js 20+ required, found " + process.versions.node); process.exit(1); }'

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Running unit tests"
npm run test:quick

echo "==> Building AppImage"
npm run dist:linux

if [[ "${1:-}" == "--deb" ]]; then
  echo "==> Building .deb"
  npm run dist:linux:deb
fi

echo "==> Done:"
ls -la dist/*.AppImage dist/*.deb 2>/dev/null || true
