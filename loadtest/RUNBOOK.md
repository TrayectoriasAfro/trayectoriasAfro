# Production Stress Test — Runbook

Read-only stress test for the trayectoriasAfro content read path, run against
**live production through Cloudflare** during a bounded low-traffic window.
The implementation plan is `.kilo/plans/1791775637229-production-stress-test-plan.md`;
this file is the operational companion.

## Targets

| What | URL |
|---|---|
| API | `https://db.trayectoriasafro.org/api/v2/` |
| Frontend | `https://trayectoriasafro.org` (its nginx also proxies `/api/`) |

Traffic goes through the **Cloudflare edge** from a **disposable VM**. Direct
origin access is out of scope.

## Scope and safety contract

- **Read paths only.** The harness contains no write verb; enforced by
  `scripts/guard_no_writes.sh` (a failed run blocks the build).
- **Bounded window:** weekday 23:00–04:00 `America/Mexico_City`.
- **Auto-abort** on any threshold breach, plus a manual kill switch (`Ctrl-C`,
  load off in < 5 s).
- **Reversible bypass:** a token-gated throttle skip, inert unless
  `LOADTEST_TOKEN` is set.

## Layout

```
loadtest/
  config.js                  shared env/caps/thresholds
  data/queries.seed.json     curated query inventory (edit this)
  data/queries.json          generated expansion (do not edit by hand)
  k6/{smoke,search-stress,viz-mix,static,spike}.js
  lib/{data,summary}.js
  scripts/generate_queries.js   seed -> queries.json expansion
  scripts/preflight.sh          edge/throttle/bypass probe
  scripts/snapshot.sh           read-only production telemetry snapshot
  scripts/guard_no_writes.sh    read-only guard test
  results/                      timestamped reports + snapshots (gitignored)
```

## Phase 0 — Pre-work

### 1. Throttle bypass (backend, inside `mstdb_manager`)

The bypass lives in `mstdb_manager/api/throttling.py` and is wired as the DRF
default throttles in `mdb/settings.py`. It skips `anon`/`user` rate limits only
when the request sends a matching `X-Loadtest-Token` header (compared with
`hmac.compare_digest`), and is **inert when `LOADTEST_TOKEN` is unset/empty**.

Deploy for the window:

1. Set `LOADTEST_TOKEN=<random>` in the production `.env` (never commit it).
2. Redeploy/restart `web` so the env is loaded.
3. Confirm with `scripts/preflight.sh` (see below).
4. **Tests:** `python manage.py test api.v2.tests.test_loadtest_throttle`.

Notes:
- `login`/`register` views set explicit `@throttle_classes`, so they are **not**
  bypassed — they also stay out of scope.
- The bypass never changes authentication or permissions; a token-bearing
  request to an authenticated endpoint is still rejected (`whoami` test).

### 2. Cloudflare exemptions

Add an **IP-scoped rule** that skips Managed/Bot Fight challenges, rate
limiting, and WAF for the runner VM IP; record the exact rule(s) for revert.
The origin always sees a Cloudflare egress IP, so do not rely on `REMOTE_ADDR`.

### 3. Disposable VM

Provision a small VM with a stable IP, install `k6` (>= 0.45 for `abortOnFail` /
`delayAbortEval`) + `curl` + `bash`, verify outbound reachability to both
hostnames, and note the IP for the CF rule.

### 4. Health probe

`/api/v2/health/` is served by `api/urls.py` (`health_check`) and returns
`{"status": "healthy", ...}`. Verify it through the public hostname:

```bash
API_BASE_URL=https://db.trayectoriasafro.org/api/v2 \
LOADTEST_TOKEN=<token> loadtest/scripts/preflight.sh
```

Expected: health 200/healthy, an un-tokened search is observed (ideally 429,
proving the throttle), a tokened search is 2xx (bypass works), no
`cf-mitigated`.

### 5. Test data

Edit `data/queries.seed.json` with real combinations harvested from production
logs/DB, then regenerate:

```bash
node loadtest/scripts/generate_queries.js
```

`varying` pools change the cache key between iterations (cache-miss cost);
`fixed` pools repeat URLs (cache-hit latency). Keep at least one expensive
query class in `search.expensive` (tagged `search_expensive`).

### 6. Baseline

Start the recorder before any load and capture an idle baseline (5–10 min):

```bash
loadtest/scripts/snapshot.sh baseline
```

Also record ambient RPS and Cloudflare edge stats (dashboard/API) for the same
window. Set `MAX_RPS`/`MAX_VUS` in the environment (or `.env`) from the baseline
— cap the first prod run at a conservative fraction of the declared ceiling.

## Phase 1 — Stage execution (gates)

Run from the **repo root** on the VM so `results/` paths resolve. Export shared
settings once:

```bash
export API_BASE_URL=https://db.trayectoriasafro.org/api/v2
export FRONTEND_URL=https://trayectoriasafro.org
export LOADTEST_TOKEN=<token>
export MAX_RPS=10 MAX_VUS=30        # from baseline; conservative first run
mkdir -p loadtest/results
```

**Kill switch:** `Ctrl-C` the running `k6` process (SIGTERM). Verify load stops
within 5 s. Do not auto-progress between stages — hold the gate and review.

### Stage 1 — smoke (gate)

```bash
k6 run loadtest/k6/smoke.js        # 1-2 rps, SMOKE_DURATION=3m
```

Pass criteria: `error_429=0`, no 5xx, no CF interference, health/search 200.
Any 429 → stop and fix the bypass. All thresholds carry `abortOnFail`.

### Stage 2 — ramp (search stress) + viz mix (gate)

```bash
k6 run loadtest/k6/search-stress.js   # ramps toward MAX_RPS in steps
k6 run loadtest/k6/viz-mix.js         # cache-miss vs cache-hit mix
k6 run loadtest/k6/static.js          # edge/static assets (optional same window)
```

Hold ≥ 2 min between increments (set by `STAGE_HOLD`). Watch the first metric to
cross **warn** — that is the binding constraint. Auto-abort is armed on latency
(p95/p99), 5xx and 429.

### Stage 3 — spike (optional, small)

```bash
k6 run loadtest/k6/spike.js           # short step, SPIKE_RPS small for run #1
```

### Stage 4 — recovery

Stop all load and keep `snapshot.sh recovery` running for 10 min. Confirm
latency back to baseline and connection pools draining.

## Abort thresholds (baked into the scripts)

| KPI | Abort (auto-stop) |
|---|---|
| 5xx rate | ≥ 1% sustained |
| 429 | **any** (bypass broken) |
| CF challenge / `cf-mitigated` | **any** (allowlist missing) |
| `search` p95 | > 1500 ms |
| `search_expensive` p95 / all p99 | > 3000 ms |
| error_5xx / error_429 / cf_interference | `count==0` |

`delayAbortEval` gives a 10–30 s grace window before an abort trips.

## Monitoring

- **Origin (source of truth):** `scripts/snapshot.sh {baseline,during,recovery}`
  captures `docker stats`, `pg_stat_activity` (vs `max_connections`),
  `pg_stat_statements` top queries, DB size, Redis `INFO`, nginx config, host
  load/memory. Run it periodically during the window.
- **Client:** each k6 `handleSummary` writes JSON + HTML to `results/` and prints
  a text summary (per-endpoint p95/p99, error splits, dropped iterations).
- **Edge:** read Cloudflare edge/cache/blocked stats from the dashboard/API; the
  edge absorbs load, so treat client latency as an upper bound.
- **Caveat:** `docker stats`/PG/Redis cannot be collected from the VM — snapshot
  on the production host.

## Phase 5 — Cleanup (immediately after)

1. **Revoke the bypass:** clear `LOADTEST_TOKEN` in `.env` and restart `web`.
2. **Revert Cloudflare** IP-scoped rules; confirm no lingering exceptions.
3. **Destroy** the disposable VM and its credentials.
4. Post "all clear"; confirm production SLO recovered.

## Rollback

- Degraded origin: restart `web` (and `frontend`) containers.
- Last resort: `./scripts/restore_latest_backup.sh` from fresh `backups/`.

## Findings

Correlate the k6 summaries with the snapshot timeline, identify the binding
constraint (workers vs DB vs Redis vs nginx), classify each breach (capacity /
bug / cache), and file normal issues. No production tuning during the test.
