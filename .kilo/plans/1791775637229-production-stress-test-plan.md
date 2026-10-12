# Production Stress Test — Guide & Implementation Plan (trayectoriasAfro)

## Goal

Stand up a repeatable, safe **stress-test harness** for the trayectoriasAfro read path, and run it against **live production** during a bounded low-traffic canary window with automatic abort thresholds. Deliverable is a documented harness under `loadtest/` plus a runbook — not a one-off manual session.

## Scope (confirmed)

- **Targets (public hostnames, behind Cloudflare):**
  - Frontend: `https://trayectoriasafro.org`
  - API: `https://db.trayectoriasafro.org/api/v2/` (the frontend nginx also proxies `/api/`, so `https://trayectoriasafro.org/api/v2/` reaches the same origin)
  - Confirmed by `.env` `ALLOWED_HOSTS` + `CORS_ALLOWED_ORIGINS` (`.env.example:25,59-60`) and `mdb/settings.py:303` (`DEFAULT_DOMAIN`).
- **Stack behind the edge:** Cloudflare → nginx → web:8000 gunicorn → PostgreSQL 16, Redis cache.
- **Path (confirmed):** traffic goes **through the Cloudflare edge** from an **ephemeral cloud VM runner** with a stable IP (real user path). Direct-to-origin is **out of scope** — origin reachability/firewall is unknown, and CF-only is both safer and representative. Expect the CF edge to absorb some load, add latency, and cache static assets — so static-asset numbers reflect the edge, not origin, and origin saturation may under-report.
- **Runner (confirmed):** a small **disposable cloud VM** (stable, allowlistable IP), provisioned for the window and **destroyed after**. Not run from a home/residential IP (dynamic/CGNAT makes IP allowlisting unreliable).
- **Window (confirmed):** a weekday **23:00–04:00 America/Mexico_City** (the site's low-traffic window per owner; site traffic is low overall).
- **Under load:** public read API + frontend static assets. Specifically:
  - `/api/v2/search/` (uncached — primary DB stress target)
  - `/api/v2/counts/`, `/api/v2/crosstab/`, `/api/v2/search/network/`
  - `/api/v2/travel-trajectories/all_trajectories_summary/`, `/api/v2/travel-trajectories/aggregated/`, `/api/v2/places-people-distribution/`
  - SvelteKit static bundle + a handful of HTML/JS asset requests via the edge/nginx
- **Out of scope:** any write/mutating path (`catalogar`, `merge/*`, `login`, `register`, `change-password`), admin, media/tile-proxy egress burn. Turnstile only guards register/login, which are out of scope.

## Current-state facts that drive the design

| Fact | Source | Consequence for the test |
|---|---|---|
| gunicorn `--workers 3 --timeout 120` | `docker-compose.yml:25` | Max concurrent request slots = 3; expect queuing well before CPU saturates. Latency knee = saturation signal. |
| No external pooler; `conn_max_age=600`, `conn_health_checks=True` | `mdb/settings.py:111-117` | Each gunicorn worker holds long-lived PG connections. Watch `pg_stat_activity` growth and `max_connections`. |
| DRF throttles hardcoded: `anon 60/min`, `user 300/min` | `mdb/settings.py:328-337` | Single-IP load generator gets **429 in seconds**. Must add a load-test bypass before any run. |
| `/api/v2/search/` **not** cache-decorated | `api/v2/views.py` (no `@cache_visualization`) | True backend/DB load — the headline scenario. |
| `search_network` (300s), `travel_trajectories_aggregated` (600s), `places_people_distribution` (600s) **are** cache-decorated by querystring | `api/v2/cache_utils.py`, `views.py:2203,2545,3268` | Repeating identical URLs will return Redis hits and hide DB cost. Scripts must vary params per iteration, or test cache-hit vs cache-miss paths deliberately. |
| Redis cache `IGNORE_EXCEPTIONS=True` | `mdb/settings.py:129` | A Redis outage silently degrades to DB-only (worst-case amplification). Must watch Redis during the run. |
| Cloudflare fronts the origin (Turnstile + `HTTP_CF_CONNECTING_IP`) | `mdb/settings.py:305`, `views.py:2988,3199` | Edge may bot-challenge/rate-limit the runner and may cache/serve requests; origin may see a CF egress IP. Must allowlist runner at CF and verify origin IP resolution. |
| nginx sets only `X-Forwarded-For`, no `real_ip_header CF-Connecting-IP` | `mstdb_theme/nginx.conf:40-62` | Origin-IP allowlisting for throttle bypass should key on `HTTP_CF_CONNECTING_IP` (as `views.py:3199` already does), not `REMOTE_ADDR`. |
| `restore_latest_backup.sh` + `backups/` exist | `scripts/`, `backups/` | Provided fallback if live prod must be rolled back / restored. |

## 1. Methodology

### Stress vs load (the distinction the plan relies on)

- **Load test:** validate behavior at *expected* peak (or a defined target) traffic. Assertion: "system meets SLO at planned load." Steady, shaped like a normal day.
- **Stress test:** push *beyond* expected peak until a defined breaking point, or to prove the system holds at a declared ceiling. Assertion: "system fails *gracefully* at X, and recovers." Ramp/spike shaped.
- **Soak/endurance:** long steady run for leaks/pool exhaustion (secondary; do after the stress run if time allows).
- **Spike:** near-instant step to catch autoscaling/queueing weakness.

This plan runs: `smoke (1-2 rps) → ramp (stress to knee) → spike (short) → recovery`, all inside one bounded window, with abort thresholds as the primary stop control.

### Defining success/failure thresholds

Thresholds are **contractual** and are baked into the tool so a breach auto-aborts. Baseline first, then set SLO-relative limits. Proposed starting thresholds (tune after the baseline stage, do not exceed during first prod run):

| KPI | Pass (green) | Warn | **Abort (auto-stop)** |
|---|---|---|---|
| HTTP error rate (5xx) | < 0.1% | < 1% | **≥ 1% sustained 30s** |
| Non-5xx error mix (429/499) | 0 (bypass confirmed) | any | **any 429 → stop & fix bypass** |
| Latency p95 (`search/`) | < 800 ms | < 1500 ms | **> 1500 ms sustained 30s** |
| Latency p99 (all read) | < 2 s | < 3 s | **> 3 s sustained 30s** |
| gunicorn worker saturation | < 80% busy | < 95% | **100% busy + rising queue 30s** |
| PG active connections | < 60% `max_connections` | < 80% | **≥ 80%** |
| PG slow queries (> 1s) | stable | +50% | **+200% vs baseline** |
| Host CPU / mem | < 70% | < 85% | **> 85% sustained 60s** |
| Redis hit rate / errors | normal | rising errors | **Redis connection errors** |

Rule: **abort threshold ≥ 2× the warning threshold**, and never abort-threshold a metric you haven't baselined.

## 2. Tool selection

### Recommendation: **k6** (primary)

Why it fits *this* project best:
- **Thresholds with `abortOnFail`** give the live-prod kill switch natively — the single most important safety feature here.
- JS scripting → parametrized URLs to defeat the Redis cache keys; can generate realistic query combinations.
- Single static binary / Docker image; runs from a controlled runner with one pinned source IP.
- Native Prometheus/InfluxDB/Grafana output for the KPI dashboards.

### Alternatives and when to choose them

| Tool | Pick it when | Fit for this repo |
|---|---|---|
| **k6** | API-heavy, CI-friendly, threshold-gated, low resource generator | **Primary.** API-heavy + needs auto-abort. |
| **Locust** | Team wants Python, complex user journeys/state, distributed generators | Good secondary — Python aligns with Django team; heavier to gate on thresholds. |
| **JMeter** | Enterprise GUI, protocol breadth (JMS/JDBC), existing team expertise | Heavy/overkill; use only if the org standardizes on it. |
| **Vegeta / wrk / hey** | Quick constant-rate smoke on a single endpoint | Fine for the **smoke** stage only; no scenarios/thresholds. |

Architecture mapping: monolithic Django + Redis cache → **k6 HTTP scenarios with cache-aware param variation** (not service-mesh tooling). If the app later splits into microservices, k6 `scenarios` + per-service tags still applies; Locust only if cross-service stateful journeys dominate. API-heavy already → k6 is the direct match.

## 3. Safety protocols (live production)

### Pre-conditions (must all be true before the window opens)

1. **Change record / approval** for the window; named rollback owner on call.
2. **Disposable VM up**, k6 installed, outbound reachability verified; note its IP for CF allowlisting.
3. **Read-only guarantee:** harness has no write verbs; re-verify in tests (`grep -i 'post\|put\|patch\|delete'` on scripts must be empty).
4. **Throttle bypass in place** (token release deployed, `LOADTEST_TOKEN` set) — otherwise the run is meaningless (all 429).
5. **Cloudflare exemptions in place** for the VM IP (challenge/rate-limit/WAF skip), and a probe confirms no CF 403/429/challenge.
6. **Baseline captured** (5-10 min idle production baseline: RPS, latency, PG/Redis/CPU/mem, CF edge stats).
7. **Backups fresh** (`./scripts/restore_latest_backup.sh` verified runnable) as last-resort recovery.
8. **Observability live:** standalone snapshot recorder + `docker stats` + `pg_stat_activity` polling open and recording before load starts (no Grafana/Prometheus — snapshots + k6 report only).
9. **Low-traffic window confirmed** (weekday 23:00–04:00 America/Mexico_City); record the observed ambient RPS.

### Cloudflare handling (required pre-work)

Because traffic goes through the CF edge from the disposable VM's stable IP:
- **Allowlist the VM IP** in Cloudflare: add an IP-scoped rule that **skips** Managed/Bot Fight challenges, rate-limiting, and WAF for that IP. Record the exact rule(s) for revert in the runbook.
- **Origin IP:** the origin sees a **CF egress IP**, and nginx sets only `X-Forwarded-For` (`mstdb_theme/nginx.conf:40-62`). Do **not** rely on `REMOTE_ADDR` for the bypass; the **token header** (below) is independent of IP and needs no origin IP resolution. (Optionally, also match `HTTP_CF_CONNECTING_IP`, which `views.py:3199` already reads, if you want belt-and-suspenders.)
- **Edge caching:** CF may serve static assets (and possibly GETs) from cache, so `static.js` measures the edge, not origin. Confirm CF cache rules and tag cached-vs-origin-pass results.
- **Measurement caveat:** the edge absorbs load and adds latency, so origin saturation may be masked. Treat observed client latency as an upper bound and rely on origin-side KPIs for capacity truth.

### Throttle handling (required pre-work)

`ANON`/`USER` rates are hardcoded at `mdb/settings.py:332-337`. On prod you cannot safely edit+redeploy just for this. Ship **Option A** as a normal, reversible release *before* the window:

- **Option A (chosen):** env-configured `LOADTEST_TOKEN` (unset/empty = bypass inert by default) + a small custom throttle class that skips rate limits only when the request presents a matching `X-Loadtest-Token` header, compared with `hmac.compare_digest`. Optionally also require `HTTP_CF_CONNECTING_IP` to equal the VM IP. Keep it inert in normal operation; **rotate/clear the token and revert after the run**.
- Fallbacks if Option A is rejected: (B) source-IP allowlist keyed on `HTTP_CF_CONNECTING_IP`; (C) env-driven temporary rate bump. Both are less precise.

Never solve this by raising limits for everyone, and never run without it — 429s would both hide real behavior and mask failures.

### During the run — abort & kill switch

- Run in **stages with gate reviews**: smoke → ramp. Do not auto-progress to spike/soak without a human go/no-go.
- **Auto-abort** on any threshold breach (`abortOnFail: true`, `delayAbortEval` ~10s).
- **Manual kill switch**: operator can `^C`/SIGTERM the k6 run at any moment; document the exact command in the runbook. Target: load off within **< 5 s**.
- **Hard caps** baked into scripts: `maxVUs`, `max rate`, per-endpoint share caps, total run duration ceiling. Cap total offered load at a % of the declared ceiling for the first prod run.
- **No more than one stage increment at a time**; hold ≥ 2 min between increments to observe.
- **Ramp *down* gracefully** — never stop instantly from peak if connection state matters.

### Guardrails on shared resources

- PG: monitor `max_connections` headroom; abort before 80%. Prefer a read-only test identity.
- Redis: watch for evictions/errors; abort if cache errors appear (fail-open amplification risk).
- Disk: watch Postgres WAL/disk from any heavy aggregation; abort on disk > 85%.
- Networking: exclude tile-proxy egress bursts (external dependency, not our capacity).

### Post-run

- Immediate traffic stop, then **watch recovery for 10 min** (latency back to baseline, pools drain).
- Maintain a **comms channel** (status updates at each stage gate); post "all clear" after recovery.
- If degraded: rollback lever = restart `web`/`frontend` containers; last resort = restore from latest backup.

## 4. Step-by-step implementation workflow

### Phase 0 — Pre-work (before the window)

1. Create `loadtest/` at repo root (tooling stays out of `mstdb_manager`/`mstdb_theme`).
2. Provision the disposable cloud VM, install k6 + utilities, verify outbound reachability to the public hostnames.
3. Implement the throttle bypass (Option A: `LOADTEST_TOKEN` + token throttle class) as its own small, reversible backend change + tests. Commit separately.
4. Configure Cloudflare exemptions for the VM IP (skip challenge/rate-limit/WAF) and record the exact rules for revert.
5. Verify/normalize the health endpoint used as the canary probe (`/api/v2/health/`) — through the public `db.trayectoriasafro.org` host.
6. Build the observability snapshot script (captures `docker stats`, `pg_stat_activity`, `pg_stat_statements` top queries, Redis `INFO`, host CPU/mem, CF edge stats) to a timestamped file.

### Phase 1 — Script development

7. `loadtest/k6/` scenarios:
   - `smoke.js` — 1-2 rps health + one search call; asserts 200s.
   - `search-stress.js` — ramping VUs against `/api/v2/search/` with **varied** params (see data below); tags per endpoint; thresholds + `abortOnFail`.
   - `viz-mix.js` — `counts`/`crosstab`/`network`/`aggregated`; explicitly label cache-busting vs cache-hit iterations.
   - `static.js` — SvelteKit bundle asset mix via the CF edge/nginx (label edge-cached vs origin-pass).
   - `spike.js` — short step spike (kept small for first prod run).
8. Shared `config.js`: `API_BASE_URL=https://db.trayectoriasafro.org/api/v2`, `FRONTEND_URL=https://trayectoriasafro.org`, `X-Loadtest-Token`, stage definitions, per-endpoint caps, thresholds. All env-overridable.
9. Standalone reporting: `handleSummary` → timestamped JSON + HTML into `loadtest/results/` (no external dashboard).
10. Lint: assert no write methods present (guard test).

### Phase 2 — Test data preparation

11. Harvest **real, valid** query combinations from logs / DB (unique `q`, `type`, filter combos, `lugar_id`, `year`, `page_size`, `limit_rutas`, `bbox`) into `loadtest/data/queries.json`. Source from actual usage so the load is representative.
12. Build a **variation generator** so cache keys differ per iteration for the cached viz endpoints (defeats Redis to measure true DB cost) — and a separate small set of *fixed* URLs to measure cache-hit latency.
13. Ensure at least one deliberately expensive query class (broad FTS, multi-filter crosstab) is included and separately tagged, so its cost is attributable.

### Phase 3 — Execution (inside the canary window)

14. Confirm go/no-go checklist (§3 pre-conditions); start snapshot recorder.
15. **Stage 1 – smoke:** 2-5 min at 1-2 rps. Verify 0% 429, 200s, error-free. Gate review.
16. **Stage 2 – ramp (stress):** step increments every ~2 min toward the declared ceiling; observe knee. Auto-abort armed.
17. **Stage 3 – spike (optional, small):** 30-60s step; watch queueing + recovery.
18. **Stage 4 – recovery hold:** stop load, watch 10 min return to baseline.
19. Keep the run **paused between gates**; record the observed numbers at each gate in the runbook.

### Phase 4 — Post-test analysis

20. Correlate k6 summary (`handleSummary` → JSON/HTML) with the resource snapshot timeline.
21. Identify the **binding constraint** (workers vs DB vs Redis vs nginx) from the first metric to cross warn.
22. Compare vs baseline; classify each breach (capacity vs bug vs cache).
23. Produce findings + recommended changes (e.g., `conn_max_age`, worker count, pgbouncer, query indexes, cache TTLs). File as normal issues; no prod tuning happens during the test.

### Phase 5 — Cleanup (immediately after the run)

24. **Revoke the bypass:** clear `LOADTEST_TOKEN` (or redeploy without it), rotate if it was exposed.
25. **Revert Cloudflare rules** for the VM IP; confirm no lingering exceptions.
26. **Destroy the disposable VM** and its credentials.
27. Post "all clear" to the comms channel; confirm production SLO recovered.

## 5. Monitoring & metrics (KPIs)

Capture all of these for baseline, during-run, and recovery. Record to timestamped files so the timeline is reconstructable.

**Client-side (k6):**
- Throughput (rps) per endpoint + total.
- Latency p50/p90/p95/p99 per endpoint (and time-to-first-byte).
- Error rate: split 5xx / 4xx / 429 / timeouts; per endpoint.
- Cloudflare interference detector: flag any CF 403 / `cf-mitigated` header / challenge markup / CF 429 — abort if any appears (means an exemption is missing).
- VUs active, dropped iterations (load generator vs SUT saturation distinction).

**Application (gunicorn/web container):**
- Worker busy vs idle; queue depth; timeout (`--timeout 120`) hits → 502/504 at nginx.
- Container CPU %, memory RSS (`docker stats trayectorias_web`).
- Request duration histograms per view if available.

**Database (PostgreSQL 16):**
- Active connections vs `max_connections` (long-lived, `conn_max_age=600`).
- `pg_stat_activity` states (active/idle/idle in transaction — leak signal).
- Slow queries (`pg_stat_statements` top-N by total time) — baseline diff.
- Locks/waits, deadlocks.
- Cache hit ratio; disk read/write and WAL growth for aggregations.

**Cache (Redis):**
- Ops/sec, hit/miss ratio, evictions, connection errors, memory.
- Specifically: did the run degrade to DB-only (fail-open) at any point?

**Edge (Cloudflare):**
- Edge requests, cache hit ratio, origin requests, and any `throttled`/`blocked`/`challenged` counts for the runner.
- Edge 5xx vs origin 5xx, to separate "CF absorbed it" from "origin failed".
- Confirm the runner produced **no** CF challenges/blocks throughout.

**Edge/infra (nginx + host):**
- Active/reading/writing connections, 499 (client abort), 502/504 upstream.
- Host CPU, load average, memory, disk I/O (`iostat`), network.

**Business/UX canary (to bound real harm):**
- Ambient user RPS during the window (from logs) — ensure human traffic stays unaffected.
- Any user-visible error spike (server 5xx in access log).

## Affected boundaries & artifacts

- **New:** `loadtest/` (k6 scripts, `data/queries.json`, `config.js`, snapshots, runbook `loadtest/RUNBOOK.md`, `loadtest/results/`).
- **Backend change (small, isolated):** `LOADTEST_TOKEN`-gated throttle bypass + tests in `mstdb_manager/api/` + `mdb/settings.py`. Committed separately and revertible (inert when token unset).
- **Cloudflare config (external, reversible):** VM-IP skip rule for challenge/rate-limit/WAF; record exact changes for revert.
- **Ephemeral infra:** disposable cloud VM (provisioned for the window, destroyed after).
- **No** changes to models, serializers, or the SvelteKit app.
- Update `CHANGELOG.md [Unreleased]` when the harness + throttle bypass land (per AGENTS.md).

## Risks

- **Throttle masking** → mitigated by mandatory bypass verification (0 expected 429).
- **Cloudflare interference/validity** → VM-IP allowlist + challenge detection + tag CF-cached vs origin-pass; origin-side KPIs are the capacity source of truth.
- **Cache hiding DB cost** → mitigated by param variation + explicit cache-hit/miss tagging.
- **Redis fail-open amplification** → watch Redis; abort on errors.
- **Single worker pool (3) saturating fast** → treat latency knee as the real stress signal, not CPU.
- **Impact on real users** → canary window (weekday 23:00–04:00 MX) + abort thresholds + < 5s kill switch + stage gates + recovery watch.
- **Long-lived PG connections** → connection exhaustion is the most likely breaking mode; guard at 80%.
- **Bypass left enabled** → mitigated by Phase 5 cleanup (token cleared, CF rules reverted, VM destroyed).

## Validation

- `smoke.js` passes with 0 errors and 0 429 before any ramp.
- Guard test fails the build if any write verb appears in `loadtest/`.
- Baseline vs run vs recovery snapshots exist and are correlated in a summary.
- Post-run: production back to baseline SLO within 10 min of load stop; bypass revoked and CF rules reverted.

## Resolved decisions

1. **Reporting:** no Grafana/Prometheus → **standalone** k6 `handleSummary` JSON + HTML in `loadtest/results/`.
2. **Runner:** **disposable cloud VM** with a stable IP (not a home/residential IP).
3. **Window:** weekday **23:00–04:00 America/Mexico_City**; site traffic is low overall.
4. **Traffic ceiling:** not yet fixed — derive from the pre-window baseline and cap the first prod run at a conservative fraction (record the number in `config.js` after the baseline stage).
5. **Throttle bypass:** **Option A** (`LOADTEST_TOKEN` header-gated, inert by default) — approved.
6. **Cloudflare:** dashboard + API token available; add an IP-scoped skip rule for the VM IP and read edge analytics.
7. **Direct-to-origin:** **out of scope** (origin reachability/firewall unknown; CF-only path is representative and safer).

## Execution tasks (order)

1. Provision the disposable VM (k6 + utils); record its IP for CF allowlisting.
2. Create `loadtest/` scaffold + `config.js` (env-driven, public hostnames).
3. Implement throttle bypass (Option A, `X-Loadtest-Token` via `LOADTEST_TOKEN`) + tests; verify 0×429 with a probe.
4. Configure Cloudflare VM-IP exemptions; probe for 0 challenges/403; record rules for revert.
5. Add write-verb guard test + health-probe verification through `db.trayectoriasafro.org`.
6. Harvest query data → `data/queries.json`; build variation generator.
7. Write `smoke.js`, `search-stress.js`, `viz-mix.js`, `static.js`, `spike.js` with thresholds + `abortOnFail` + caps + `handleSummary` reports.
8. Write snapshot recorder + `RUNBOOK.md` (gates, kill switch, CF revert, rollback).
9. Capture pre-window baseline (incl. CF edge stats); set the declared ceiling.
10. Execute stages with human gates during the canary window; record per-gate numbers.
11. Phase 5 cleanup: clear token, revert CF rules, destroy VM, post all-clear.
12. Post-run correlation + findings/issues; update `CHANGELOG.md`.
