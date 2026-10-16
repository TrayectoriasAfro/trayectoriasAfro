# Fix: enable the Redis cache service in dev + production

## Goal
Make Django's configured Redis cache actually reachable so visualization
responses (`viz:*`) and CARTO tiles (`carto_tile:*`) get cached, instead of
every `cache.get/set` silently no-op'ing and falling back to DB/upstream on every
request.

## Root cause (confirmed on production host)
- `mstdb_manager/mdb/settings.py:119-132` selects `django_redis.cache.RedisCache`
  with `LOCATION = os.getenv('REDIS_URL', 'redis://redis:6379/1')` and
  `IGNORE_EXCEPTIONS: True` (fail-open).
- **No `redis` service exists in any `docker-compose*.yml`** (base/dev/prod/server).
- Production evidence:
  - `printenv REDIS_URL` -> empty (falls back to `redis://redis:6379/1`)
  - `redis.from_url(...).ping()` -> `ConnectionError ... Temporary failure in name resolution` for host `redis`
  - `cache.set('__probe__',123); cache.get('__probe__')` -> `None`
  - `loadtest/scripts/snapshot.sh baseline` -> `[redis container 'trayectorias_redis' not found; using REDIS_URL if set]`
- Consumers that degrade silently: `api/v2/cache_utils.py` (search_network,
  travel-trajectories/aggregated, places-people-distribution) and
  `api/v2/tiles.py` (tile cache + per-IP rate limit).

## Decisions (locked)
- Define Redis in the **base `docker-compose.yml`** so dev and prod share one definition.
- **Ephemeral cache-only**: no volume, no persistence, `maxmemory 256mb`,
  `maxmemory-policy allkeys-lru`, no password, port not published. Redis is only
  reachable on the private `trayectorias_network`.
- **Keep `IGNORE_EXCEPTIONS=True`** (fail-open stays; a Redis outage must not 500 the site).

## Changes

### 1. `docker-compose.yml` (base) — add service + dependency
Add a `redis` service and make `web` wait for it. Match the existing
`container_name`/`healthcheck`/`networks` style.

```yaml
  redis:
    image: redis:7-alpine
    container_name: trayectorias_redis
    command:
      - redis-server
      - --maxmemory
      - 256mb
      - --maxmemory-policy
      - allkeys-lru
      - --save
      - ""
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - trayectorias_network
```

In the existing `web` service, extend `depends_on` (currently only `postgres`):

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

No `ports`, no `volumes` (ephemeral), no password.

### 2. `docker-compose.prod.yml` — prod hardening (match `postgres` block)
Add `restart: always` + log rotation to the `redis` service override so it
matches the repo's prod conventions:

```yaml
  redis:
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. `.env.example` — clarify the existing `REDIS_URL` block
`REDIS_URL=redis://redis:6379/1` already exists (line ~112). Update its comment
to state the service is now defined in `docker-compose.yml` (the default host
`redis` is the compose service name).

### 4. Production host `.env` (gitignored, NOT a repo edit)
Append explicitly to the server's `~/trayectoriasafro/.env`:
```
REDIS_URL=redis://redis:6379/1
```
(The default already resolves once the service exists, but set it explicitly for
clarity.)

### 5. `docs/architecture.md` — replace the stale gotcha
Replace the paragraph at lines 114-118 ("Redis is configured ... but is **not**
defined in any `docker-compose*.yml` ...") with a short note that Redis now runs
as the `redis` service in `docker-compose.yml` (ephemeral, LRU-capped, fail-open)
so cache metrics are meaningful.

### 6. `CHANGELOG.md` — Unreleased
Under `### Repository` (or `### Backend`), add an entry: added an ephemeral,
LRU-capped `redis` service to `docker-compose.yml` (with `restart: always` in the
prod override) and made `web` wait for it, fixing the silently-disabled
`django_redis` cache in dev and production.

## Deployment (on the production host)
1. `git pull --ff-only` (or run `./scripts/update.sh`, which does this + backup + rebuild).
2. Add `REDIS_URL` to `.env` (step 4).
3. `./scripts/update.sh` — its `up -d --force-recreate --wait web frontend` will
   start `redis` automatically because `web` now `depends_on` it with
   `condition: service_healthy`. No `scripts/update.sh` edit required.
   - Manual alternative: `docker compose -f docker-compose.yml -f docker-compose.server.yml -f docker-compose.prod.yml up -d --wait redis`.

## Validation (run on the production host after deploy)
```bash
C="docker compose -f docker-compose.yml -f docker-compose.server.yml -f docker-compose.prod.yml"

$C ps                                   # trayectorias_redis present + healthy

# Django round-trip (must print 123, not None)
$C exec -T web python -c "from django.core.cache import cache; cache.set('__probe__',123,30); print('readback:', cache.get('__probe__'))"

# Redis is alive and capped
$C exec -T redis redis-cli ping         # PONG
$C exec -T redis redis-cli config get maxmemory maxmemory-policy

# Real traffic populates keys, then snapshot shows it
$C exec -T redis redis-cli dbsize       # grows after hitting viz endpoints
loadtest/scripts/snapshot.sh verify     # 'redis info' section now populated
```
Also hit one expensive read endpoint (e.g. `travel-trajectories/aggregated`)
twice and confirm the second response is measurably faster / does no upstream work.

## Risks / notes
- `maxmemory 256mb` may evict week-long CARTO tiles under heavy navigation;
  eviction is safe (fail-open, tiles refetch upstream). Tunable later.
- Tests have no CI workflow. Locally, `manage.py test` will now talk to real
  Redis db 1; the affected tests already call `cache.clear()` in `setUp`, and the
  throttle tests override to `LocMemCache`, so this is acceptable.
- Migration `dbgestor/migrations/0021_fix_overseas_place_coords.py` calls
  `cache.clear()`; it now clears real Redis (intended).
- Keep the `/api/v2/health/` endpoint DB-only. Do **not** add a Redis check there:
  it would mark `web` unhealthy during a fail-open Redis outage.

## Out of scope
Persistence/AOF (surviving restarts), password auth, external/managed Redis,
adding Redis to the health check, and Grafana/Prometheus cache dashboards.
