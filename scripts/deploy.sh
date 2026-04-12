#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Reparo full deploy pipeline
#  Usage: ./scripts/deploy.sh [fly-app-name]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export FLY_APP="${1:-reparo-app}"

echo "═══════════════════════════════════════"
echo "  Reparo Deploy → ${FLY_APP}.fly.dev"
echo "═══════════════════════════════════════"
echo ""

bash "$ROOT/scripts/predeploy.sh"
echo ""

echo -e "\033[1;33m▶\033[0m  Deploying to Fly.io…"
fly deploy --app "$FLY_APP"
echo ""

bash "$ROOT/scripts/postdeploy.sh"
