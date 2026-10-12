#!/usr/bin/env bash
# Guard: fail if any harness script contains an HTTP write verb.
#
# The production stress test is read-only by contract. This scans the k6
# scripts, shared config and libs for write methods so a stray POST/PUT/PATCH/
# DELETE can never reach production.
#
# Usage: loadtest/scripts/guard_no_writes.sh   (exit 1 on any match)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILES=()
while IFS= read -r file; do
  FILES+=("$file")
done < <(find "$ROOT/k6" "$ROOT/lib" -type f -name '*.js' 2>/dev/null; printf '%s\n' "$ROOT/config.js")

PATTERN="http\.(post|put|patch|del|delete)\(|method[[:space:]]*:|[\"'](POST|PUT|PATCH|DELETE)[\"']"

fail=0
for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  if matches="$(grep -En "$PATTERN" "$file")"; then
    printf 'WRITE VERB DETECTED in %s\n%s\n' "$file" "$matches" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "guard failed: harness must be read-only" >&2
  exit 1
fi

echo "OK: no write verbs in loadtest scripts"
