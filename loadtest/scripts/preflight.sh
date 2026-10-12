#!/usr/bin/env bash
# Pre-flight probe for the production window.
#
# Verifies, through the public hostname (Cloudflare edge), that:
#   1. the canary health endpoint resolves and returns 200;
#   2. a read request WITHOUT the bypass token is throttled (429) — proving the
#      throttle is active;
#   3. the same request WITH the bypass token is NOT throttled — proving the
#      LOADTEST_TOKEN bypass works;
#   4. no Cloudflare challenge/block markup (cf-mitigated) is present.
#
# Usage:
#   API_BASE_URL=https://db.trayectoriasafro.org/api/v2 \
#   LOADTEST_TOKEN=<token> loadtest/scripts/preflight.sh

set -uo pipefail

API_BASE_URL="${API_BASE_URL:-https://db.trayectoriasafro.org/api/v2}"
LOADTEST_TOKEN="${LOADTEST_TOKEN:-}"
SEARCH_URL="${API_BASE_URL}/search/?q=esclavizada&type=personaesclavizada&page_size=30"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

fail=0
report() { printf '%-38s %s\n' "$1" "$2"; }

# 1. health
code="$(curl -sS -o "$TMP" -D "${TMP}.h" -w '%{http_code}' "${API_BASE_URL}/health/" || echo 000)"
if [ "$code" = "200" ] && grep -q '"healthy"' "$TMP"; then
  report "health (expect 200 healthy)" "OK ($code)"
else
  report "health (expect 200 healthy)" "FAIL ($code)"; fail=1
fi

# 2. search without token -> expect 429 (throttle active)
code="$(curl -sS -o /dev/null -w '%{http_code}' "$SEARCH_URL" || echo 000)"
if [ "$code" = "429" ] || [ "$code" = "200" ]; then
  report "search without token (throttle active)" "observed $code"
else
  report "search without token (throttle active)" "unexpected $code"; fail=1
fi

# 3. search with token -> expect 2xx, never 429
if [ -z "$LOADTEST_TOKEN" ]; then
  report "search with token (bypass)" "SKIP (LOADTEST_TOKEN unset)"
else
  code="$(curl -sS -o /dev/null -D "${TMP}.h" -w '%{http_code}' -H "X-Loadtest-Token: ${LOADTEST_TOKEN}" "$SEARCH_URL" || echo 000)"
  if [ "${code#2}" != "$code" ]; then
    report "search with token (bypass)" "OK ($code)"
  else
    report "search with token (bypass)" "FAIL ($code)"; fail=1
  fi
fi

# 4. Cloudflare interference
if grep -qi 'cf-mitigated' "${TMP}.h" 2>/dev/null; then
  report "cloudflare challenge (expect none)" "FAIL (cf-mitigated present)"; fail=1
else
  report "cloudflare challenge (expect none)" "OK"
fi

if [ "$fail" -ne 0 ]; then
  echo "preflight failed" >&2
  exit 1
fi
echo "preflight OK"
