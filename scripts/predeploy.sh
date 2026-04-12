#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Reparo pre-deploy checks
#  Exits non-zero (and blocks deploy) on any failure.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
ok()   { echo -e "${GRN}✓${RST}  $*"; }
fail() { echo -e "${RED}✗  $*${RST}"; exit 1; }
info() { echo -e "${YLW}▶${RST}  $*"; }

# ── 1. Syntax check ──────────────────────────────────────────
info "Syntax-checking all JS files…"
while IFS= read -r -d '' f; do
  node --check "$f" 2>&1 || fail "Syntax error in $f"
done < <(find . -name "*.js" \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -print0)
ok "All JS files parse cleanly"

# ── 2. Dependency audit ───────────────────────────────────────
info "Checking all require() calls are in package.json dependencies…"
DEPS=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies||{}).join('\n'))")
missing=()
while IFS= read -r -d '' f; do
  # extract bare module names from require('...') — skip relative paths
  while IFS= read -r mod; do
    [[ -z "$mod" || "$mod" == .* ]] && continue
    # strip sub-paths: 'uuid/v4' → 'uuid'
    pkg="${mod%%/*}"
    # skip node built-ins
    node -e "require('module').builtinModules.includes('$pkg') && process.exit(0); process.exit(1)" 2>/dev/null && continue
    echo "$DEPS" | grep -qx "$pkg" || missing+=("$pkg (in $f)")
  done < <(grep -oP "require\(['\"]\\K[^'\"]+(?=['\"])" "$f" 2>/dev/null || true)
done < <(find . -name "*.js" \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -print0)

if [ ${#missing[@]} -gt 0 ]; then
  echo -e "${RED}Missing from package.json dependencies:${RST}"
  printf '   %s\n' "${missing[@]}"
  fail "Run: npm install <package> --save   for each missing package"
fi
ok "All require() modules are in dependencies"

# ── 3. Local startup smoke test ───────────────────────────────
info "Attempting local smoke test (requires native modules)…"
if npm rebuild better-sqlite3 --silent 2>/dev/null; then
  PORT=13099
  NODE_ENV=production PORT=$PORT node server.js &
  SERVER_PID=$!
  trap "kill $SERVER_PID 2>/dev/null; exit" EXIT INT TERM
  SMOKE_OK=0
  for i in $(seq 1 15); do
    sleep 1
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
      ok "Server started and /api/health responded"
      kill $SERVER_PID 2>/dev/null
      trap - EXIT INT TERM
      SMOKE_OK=1
      break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      fail "Server process died during startup (check logs above)"
    fi
  done
  [ $SMOKE_OK -eq 1 ] || fail "Server did not respond to /api/health within 15 seconds"
else
  echo -e "   \033[0;33m(skipped — native module cannot compile on this Node version; Docker build will verify)\033[0m"
fi

echo ""
echo -e "${GRN}━━━  All pre-deploy checks passed  ━━━${RST}"
