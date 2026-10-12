#!/usr/bin/env bash
# Read-only production telemetry snapshot for the stress-test timeline.
#
# Run this ON the production host (it shells out to `docker` and the running
# containers). It appends one timestamped section per invocation to the output
# file so the baseline / during-run / recovery timeline is reconstructable.
#
# Usage:
#   loadtest/scripts/snapshot.sh baseline
#   loadtest/scripts/snapshot.sh during
#   loadtest/scripts/snapshot.sh recovery
#
# Overridable via environment:
#   WEB_CONTAINER      (default trayectorias_web)
#   PG_CONTAINER       (default trayectorias_postgres)
#   FRONTEND_CONTAINER (default trayectorias_frontend)
#   REDIS_CONTAINER    (default trayectorias_redis; skipped if absent)
#   POSTGRES_USER      (default trayectorias_user)
#   POSTGRES_DB        (default trayectorias)
#   SNAPSHOT_DIR       (default loadtest/results)

set -uo pipefail

LABEL="${1:-snapshot}"
WEB_CONTAINER="${WEB_CONTAINER:-trayectorias_web}"
PG_CONTAINER="${PG_CONTAINER:-trayectorias_postgres}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-trayectorias_frontend}"
REDIS_CONTAINER="${REDIS_CONTAINER:-trayectorias_redis}"
POSTGRES_USER="${POSTGRES_USER:-trayectorias_user}"
POSTGRES_DB="${POSTGRES_DB:-trayectorias}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-loadtest/results}"

mkdir -p "$SNAPSHOT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$SNAPSHOT_DIR/${LABEL}-${STAMP}.txt"

section() { printf '\n===== %s =====\n' "$1" >>"$OUT"; }
capture() { printf '\n$ %s\n' "$*" >>"$OUT"; "$@" >>"$OUT" 2>&1 || echo "[command failed: $*]" >>"$OUT"; }

{
  printf 'snapshot label=%s\n' "$LABEL"
  printf 'timestamp_utc=%s\n' "$STAMP"
  printf 'host=%s\n' "$(hostname 2>/dev/null || echo unknown)"
} >"$OUT"

section "host load / memory"
capture uptime
if [ -r /proc/loadavg ]; then capture cat /proc/loadavg; fi
if command -v free >/dev/null 2>&1; then capture free -m; fi
if command -v vmstat >/dev/null 2>&1; then capture vmstat 1 3; fi

section "docker stats"
if command -v docker >/dev/null 2>&1; then
  printf '\n$ docker stats --no-stream\n' >>"$OUT"
  docker stats --no-stream \
    "$WEB_CONTAINER" "$PG_CONTAINER" "$FRONTEND_CONTAINER" \
    >>"$OUT" 2>&1 || echo "[docker stats failed]" >>"$OUT"
else
  echo "[docker not found]" >>"$OUT"
fi

section "postgres connections / activity"
printf '\n$ pg max_connections + state counts\n' >>"$OUT"
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max_connections, count(*) AS total, count(*) FILTER (WHERE state='active') AS active, count(*) FILTER (WHERE state='idle') AS idle, count(*) FILTER (WHERE state='idle in transaction') AS idle_in_txn FROM pg_stat_activity;" \
  >>"$OUT" 2>&1 || echo "[pg activity failed]" >>"$OUT"

section "postgres slow queries (pg_stat_statements)"
printf '\n$ top queries by total_exec_time\n' >>"$OUT"
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT calls, round(total_exec_time)::bigint AS total_ms, round(mean_exec_time,1) AS mean_ms, left(query, 80) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;" \
  >>"$OUT" 2>&1 || echo "[pg_stat_statements unavailable]" >>"$OUT"

section "postgres disk / wal"
capture docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;"

section "redis info"
if command -v docker >/dev/null 2>&1 && docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
  capture docker exec "$REDIS_CONTAINER" redis-cli INFO stats
  capture docker exec "$REDIS_CONTAINER" redis-cli INFO memory
else
  echo "[redis container '$REDIS_CONTAINER' not found; using REDIS_URL if set]" >>"$OUT"
  if [ -n "${REDIS_URL:-}" ] && command -v redis-cli >/dev/null 2>&1; then
    capture redis-cli -u "$REDIS_URL" INFO stats
  fi
fi

section "nginx container (frontend)"
if command -v docker >/dev/null 2>&1; then
  capture docker exec "$FRONTEND_CONTAINER" nginx -T
fi

section "notes"
cat >>"$OUT" <<'EOF'
Cloudflare edge stats (requests, cache hit ratio, throttled/blocked/challenged)
are NOT collected here: read them from the Cloudflare dashboard/analytics API
for the same window and paste them next to this snapshot. Origin-side KPIs are
the capacity source of truth; the edge may mask origin saturation.
EOF

printf 'wrote %s\n' "$OUT"
