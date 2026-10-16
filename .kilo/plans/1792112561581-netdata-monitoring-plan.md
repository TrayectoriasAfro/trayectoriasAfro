# Netdata Monitoring for the Live Real-User Event (trayectoriasAfro)

## Goal

Give the production host real-time visibility for tomorrow's **real-user** soft
stress event (a few dozen simultaneous users exploring landing/search/filters/viz),
using **Netdata** as an out-of-the-box OSS monitoring stack. No app changes, no
public exposure, fully reversible.

## Why Netdata (decision)

- **No from-scratch build.** Netdata is a single container that auto-discovers
  the host (CPU/mem/disk/net) and **every Docker container**, plus Postgres,
  Redis, and nginx when reachable.
- **Fast and low-risk for a one-night install** (vs. Prometheus+Grafana+exporters,
  which stays the documented durable follow-up, not tonight's task).
- Chosen access: **dashboard bound to `127.0.0.1:19999`, reached via SSH tunnel**
  (no Cloudflare change, no public port).
- This complements, not replaces, the existing synthetic harness:
  `loadtest/scripts/snapshot.sh` + k6 remain for the planned load test. Netdata
  is for the live human event and ongoing production observability.

## Current-state facts that drive the design

| Fact | Source | Consequence |
|---|---|---|
| Single host, Docker Compose: `postgres`, `redis`, `web` (gunicorn `--workers 3`), `frontend` (nginx) | `docker-compose.yml` | Netdata on the same host sees everything. |
| Production stack runs as layered overrides | `docker-compose.prod.yml`, `docker-compose.server.yml` | Add monitoring as **another `-f` layer**; do not edit existing files. |
| No metrics/APM anywhere (no Prometheus/Sentry/`/metrics`) | `grep` over `mstdb_manager/` | Netdata is the first real telemetry; nothing to integrate with. |
| Redis is now a real service: `trayectorias_redis` (`redis:7-alpine`), `allkeys-lru`, **256 MB** `maxmemory`, **no persistence** (`--save ""`), `web` depends on its health | `docker-compose.yml:20-37`, `docker-compose.prod.yml`, commit `b894d86` | Netdata must monitor Redis too (memory vs ceiling, evictions, ops). Caching is live, so a burst can trigger LRU evictions or a cold cache after restart. |
| `app`'s own health: `/api/v2/health/` | `docker-compose.yml:36`, `api/urls.py` | Usable as an external uptime probe (Netdata HTTP check) if wanted. |
| Existing manual telemetry collector | `loadtest/scripts/snapshot.sh` | Keep it; Netdata makes ad-hoc `docker stats` unnecessary during the event. |

## Design decisions

1. **New file only:** `docker-compose.monitoring.yml` at repo root. It is added
   as an extra `-f` layer to the existing production invocation so the `netdata`
   service joins the project's `trayectorias_network` and resolves `postgres`
   by name. No existing compose file is modified.
2. **Image:** `netdata/netdata:stable` (pin the digest/tag used at install).
3. **Host access:** `pid: host`, mount `/proc`, `/sys`, `/etc/os-release`,
   `/etc/passwd`, `/etc/group` read-only, and `/var/run/docker.sock` read-only;
   `cap_add: SYS_PTRACE`; `security-opt apparmor=unconfined`.
4. **Bind mount, not published:** `127.0.0.1:19999:19999` only.
5. **Persistence:** named volumes for config/lib/cache (`netdata_config`,
   `netdata_lib`, `netdata_cache`) so history survives a container restart.
   Named volumes (not bind mounts) to avoid `.gitignore` churn.
6. **Postgres collector:** enable Netdata's `go.d/postgres` module with a DSN
   built from `.env` (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, host
   `postgres`). Pass via env/config mount; **never commit the credentials**.
7. **Redis collector:** enable Netdata's `go.d/redis` module targeting host
   `redis` port `6379` (same bridge network). No auth is set on Redis today. This
   surfaces `used_memory` vs the 256 MB ceiling, hit/miss ratio, ops/sec,
   connected clients, and **evicted_keys** — the key signal for the LRU cache
   under a burst.
8. **Retention:** raise `dbengine` disk budget (e.g. ~2 GB / a few days) so the
   whole event + recovery window is retained and reviewable after.
9. **Alerts:** keep Netdata's stock health alarms; optionally add a
   Discord/Slack webhook via `health_alarm_notify.conf`. Optional, not required
   to observe the event.
10. **Reversibility:** stopping = `docker compose ... -f docker-compose.monitoring.yml
    down` and removing the file/volumes. The production services are untouched.

## Affected boundaries & artifacts

- **New:** `docker-compose.monitoring.yml` (root), optional `monitoring/netdata/`
  config dir (`netdata.conf`, `go.d/postgres.conf`, `go.d/redis.conf`) if
  config-as-code is desired. Secrets referenced via env, never committed.
- **No** changes to `mstdb_manager/`, `mstdb_theme/`, models, or the running prod
  stack. Additive compose layer only.
- Update `CHANGELOG.md [Unreleased]` (per AGENTS.md) and add a short note in
  `docs/architecture.md` under the monitoring/load-testing section.

## Ordered tasks

1. **Create `docker-compose.monitoring.yml`** with the `netdata` service per the
   design decisions (image, host mounts, `pid: host`, caps, `127.0.0.1:19999`,
   named volumes, `restart: unless-stopped`, network `trayectorias_network`).
2. **(Optional) Add `monitoring/netdata/netdata.conf`** to set `[db]` retention
   MB and `[web]` bind; plus `monitoring/netdata/go.d/postgres.conf` (PG DSN from
   `.env`) and `go.d/redis.conf` (host `redis:6379`). Mount read-only.
3. **Confirm the production compose invocation** used on the host (expected:
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml
   -f docker-compose.server.yml up -d`) and append
   `-f docker-compose.monitoring.yml`.
4. **Bring it up** (`up -d`) and confirm the container is healthy
   (`docker logs netdata`, no fatal errors).
5. **Open the tunnel** from the laptop:
   `ssh -L 19999:localhost:19999 <user>@<prod-host>`, then browse
   `http://localhost:19999`.
6. **Verify the panels that matter for the event:**
   - Host: CPU, load, memory, disk I/O, network.
   - Containers: `trayectorias_web` (gunicorn), `trayectorias_postgres`,
     `trayectorias_redis`, `trayectorias_frontend` per-container CPU/mem/net/disk.
   - Postgres: connections vs `max_connections`, active/idle, throughput,
     queries (if the PG collector connected).
   - Redis: `used_memory` vs the 256 MB ceiling, hit/miss ratio, ops/sec,
     connected clients, and `evicted_keys` (must stay 0 under the expected load).
7. **Add an HTTP uptime probe (optional)** for
   `https://trayectoriasafro.org` and `/api/v2/health/` using a Netdata HTTP
   check or Uptime Kuma, so end-user reachability is visible even if the edge
   masks latency.
8. **Capture a pre-event baseline** 10-15 min before the users arrive and note
   it, so you can tell normal from stressed.
9. **Keep `loadtest/scripts/snapshot.sh` available** as a text fallback and for
   post-hoc correlation.
10. **Update `CHANGELOG.md [Unreleased]`** and `docs/architecture.md`; commit the
    new compose layer (and optional config) in the superproject.

## Validation

- `docker compose ... config` renders the combined stack with the new `netdata`
  service and no errors.
- After `up -d`: Netdata UI reachable only via the tunnel; it lists all four
  `trayectorias_*` containers (web, postgres, redis, frontend) with live metrics;
  host CPU/mem/disk/network stream.
- Postgres panels show connection counts (proves the collector connected); if
  they don't, the DSN is wrong — fix before the event, not during it.
- Redis panels show memory usage and ops (proves the Redis collector connected);
  `evicted_keys` reads 0 on an idle baseline.
- A restart of the `netdata` container preserves history (named volumes).
- No new port is reachable from the public internet (`curl http://<public-ip>:19999`
  from outside must fail).

## Risks & mitigations

- **Docker-socket mount grants Netdata host-level access.** Mount it read-only,
  keep the UI on localhost + SSH tunnel, and remove the stack after it is no
  longer needed if desired.
- **Resource overhead on the prod host.** Netdata is light (~100-250 MB), but set
  a container memory limit and watch it in its own charts during the event.
- **Redis LRU evictions / cold cache.** Redis is ephemeral (`--save ""`, 256 MB,
  `allkeys-lru`): a burst can evict hot keys, and a `redis` restart empties the
  cache entirely (cold-start DB spike). Watch `evicted_keys` and memory; a
  restart during the event would cause a DB-only thundering herd — treat it as a
  finding, not a Netdata fault.
- **PG collector auth.** Use a read-only DSN; if only superuser is available,
  prefer a dedicated monitoring role. Never commit the DSN.
- **Installing close to the event.** The change is additive and reversible; if
  anything looks off, `down` the monitoring layer and fall back to
  `snapshot.sh`.

## Out of scope (explicit)

- Prometheus + Grafana + exporters (durable follow-up).
- App-level instrumentation (`django-prometheus`, Sentry).
- Public/Cloudflare-exposed dashboards and automatic alerting integrations
  (optional webhook only).

## Open questions

- Confirm the exact production compose command and the image tag/digest to pin.
- Confirm whether a dedicated read-only Postgres monitoring role exists, or
  whether to reuse the app role for the DSN.
