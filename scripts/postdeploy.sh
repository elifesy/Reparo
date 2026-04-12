#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Reparo post-deploy verification
#  Call after `fly deploy` completes.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
APP="${FLY_APP:-reparo-app}"
URL="https://${APP}.fly.dev"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
ok()   { echo -e "${GRN}✓${RST}  $*"; }
fail() { echo -e "${RED}✗  $*${RST}"; exit 1; }
info() { echo -e "${YLW}▶${RST}  $*"; }

# ── 4. Machine state ─────────────────────────────────────────
info "Checking machine state…"
for i in $(seq 1 12); do
  STATE=$(fly machine list --app "$APP" 2>/dev/null | awk '/started/{print "started"; exit} /stopped/{print "stopped"; exit}')
  if [ "$STATE" = "started" ]; then
    ok "Machine is running"
    break
  elif [ "$STATE" = "stopped" ]; then
    fail "Machine is stopped — check logs: fly logs --app $APP"
  fi
  sleep 5
done
[ "$STATE" = "started" ] || fail "Machine did not reach started state"

# ── 5. HTTP health check ─────────────────────────────────────
info "HTTP health check on $URL …"
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$URL/api/health" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    ok "Live URL responded HTTP 200"
    break
  fi
  sleep 3
  [ $i -eq 10 ] && fail "Live URL returned HTTP $CODE after 30s"
done

# ── 6. Log crash scan ────────────────────────────────────────
info "Scanning recent logs for crash keywords…"
LOGS=$(fly logs --app "$APP" --no-tail 2>/dev/null | tail -40 || true)
CRASH_PATTERNS="SyntaxError|MODULE_NOT_FOUND|Cannot find module|UnhandledPromiseRejection|exited with code [^0]"
if echo "$LOGS" | grep -qE "$CRASH_PATTERNS"; then
  echo -e "${RED}Crash pattern found in logs:${RST}"
  echo "$LOGS" | grep -E "$CRASH_PATTERNS"
  fail "App may be in a crash loop — investigate before declaring success"
fi
ok "No crash patterns in recent logs"

echo ""
echo -e "${GRN}━━━  Deployment verified successfully  ━━━${RST}"
echo -e "     ${URL}"
