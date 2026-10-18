# trayectoriasAfro Architecture Notes

## Stack
- Backend: Django + DRF in `mstdb_manager/`, Docker-only (no local Django)
- Frontend: SvelteKit in `mstdb_theme/`, D3.js + Leaflet for maps
- Syntax validation: `python3 -c "import ast; ast.parse(open('file').read())"`

## Key Models (dbgestor/models.py)
- Persona (polymorphic base) → PersonaEsclavizada, PersonaNoEsclavizada
- PersonaLugarRel: M2M through (personas, lugar, ordinal, situacion_lugar, documento, fechas_inicio/final)
- FK place fields: Persona.lugar_nacimiento, Persona.lugar_defuncion, PersonaEsclavizada.procedencia
- M2M vocabs: calidades, etnonimos (PE only), hispanizacion (PE only), estado_civil, ocupaciones
- Documento: FK archivo, FK lugar_de_produccion, date range (fecha_inicial/final)
- Lugar: geographic (lat/lon), tipo, nombre_lugar, otros_nombres, es_parte_de (self-FK)
- Corporacion: FK lugar_corporacion, M2M documentos, M2M personas_asociadas

## PersonaEsclavizada numeric/date fields (for cross-variable analysis)
- edad, unidad_temporal_edad (d/m/a)
- fecha_nacimiento, fecha_defuncion + _raw + _factual variants
- altura, cabello, ojos (text)
- marcas_corporales, conducta, salud (text fields)
- Relational: documentos (M2M), calidades, etnonimos, hispanizacion, estado_civil, conducta_terms (M2M)

## Canonical conducta vocabulary (ConductaTerm)
- `ConductaTerm{canonico unique lowercase, aliases[], descripcion}` + `PersonaEsclavizada.conducta_terms` M2M; the archival free-text `conducta` field is never rewritten — the vocabulary is a normalized layer on top (canonical decision + alias list pending team meeting; seeded with `huído → [huido, hullo, huyo, huyeron, escap*, busque]`)
- Filter `conducta_canonica=<id|texto>` (search + crosstab, crosstab dimension too) resolves a term via `ConductaTerm.resolve()` (id / canonico / accent-insensitive alias) and matches the M2M link OR `conducta__unaccent__icontains` per alias — unlinked records still surface; wildcard aliases (`escap*`) match by prefix
- FTS: Persona `search_vector` includes `conducta` (weight D) via correlated Subquery + `UNACCENT` (MTI child fields can't be referenced directly from a parent-table UPDATE), so `q=huido` finds `huído`; reindex with `populate_search_vectors --model persona`
- FTS: Documento `search_vector` includes `tipo_documento` (weight C) via correlated Subquery; `post_save` on `TipoDocumental` refreshes member documents; reindex with `populate_search_vectors --model documento`
- Unified search expands persona results with people linked to FTS-matched documents via `pk__in` subqueries on the `Persona.documentos` through table (never a join, preserving doc-date annotations); results carry `match_reason` (`directo`/`documento`), direct first; document payloads carry `personas_esclavizadas_count` / `personas_no_esclavizadas_count`
- Backfill: `link_conducta_terms` (dry-run default, `--apply`, `--csv` review report; ambiguous aliases like `busque` and wildcards are review-only)

## Lugar data integrity audit (`audit_lugar_csv`)
- Compares a ground-truth Lugar CSV export (default `temp/data/Lugar-<today>.csv`; `comentarios` is a CSV-only curator column, not in the DB) against `dbgestor_lugar` on `lugar_id`: existence both ways, lat/lon agreement (`Decimal` + tolerance, DB column is numeric(9,6)), missing coordinates split into unreferenceable (etnónimo / "no puede ser referenciada" semantics) vs. plain, and consolidation hints (consolidar/unificar/combinar)
- Outputs: console summary, `--json` full report, `--report` flat CSV of every finding
- Run inside the web container (`docker exec trayectorias_web python manage.py audit_lugar_csv`); the CSV path must be reachable from the container (mount/copy it in or pass `--csv`)
- Latest run (CSV `temp/data/Lugar-2026-10-11.csv`, 346 rows vs 397 DB rows): 263 match, **38 coordinate mismatches**, 125 DB rows lack lat/lon (115 plain-missing). Several mismatches are gross overseas-place errors that put African/Caribbean/Asian places on Mexican land or in the sea and are the likely cause of "trajectories cross Central America / end at sea": #45/#46 Panama (`db 18.59,-95.91` = Veracruz), #107 Santo Domingo (`16.32,-95.25` = Oaxaca), #136 Porto Rico `16.72,-93.93`, #260 Puerto Rico `17.66,-100.66`, #275 Carabali `16.81,-99.17`, #282 China `17.31,-95.99` = Oaxaca, #288 India + #132 India de Portugal both `2.19,102.38` = Malaysia, #250 Matamba `17.32,-92.56` = Chiapas. **The CSV is not uniformly authoritative** (e.g. its Angola row is `17.79,-91.27`, i.e. Chiapas, while the DB's `-8.84,13.23` African coast is correct), so these must be curated rather than bulk-applied from the CSV. Map-side, the D3-overlay drift is separately mitigated in `ArcsMap`/`TrajectoryMap` by re-measuring on mount + `resize` + tab visibility (`ResizeObserver` + `map.invalidateSize()`); any coordinate data fix must be followed by clearing the viz cache (600s TTL).
- Management UI: `vocabularios/conducta-terms/` API (collision-validated writes), Django admin, legacy-form autocomplete, catalogar multi-select with quick creator + "¿Quisiste decir…?" suggestion, Search sidebar searchable-select on the `conductas` facet, persona detail badges

## API v2 Search & Browse (api/v2/urls.py, SearchAPIView)
- Endpoint: `api/v2/search/?type=personaesclavizada&page=1&page_size=30`
- Query params: q (FTS), type, page, page_size, ordering, search (simple filter)
- Filters: lugar_id, archivo_id, year, etnonimo, calidad, hispanizacion, ocupacion (CSV)
- Form filters: sexo, edad__gte/lte, tipo_documental, etnonimos__etonimo__icontains, etc.
- Drill-down filters: `trayectoria_lugar` (AND across places), `procedencia` (PE origin), `lugar_any` (OR: trajectory place or, for PE, procedencia) — shared by search, crosstab and network endpoints; documented in api/v2/README.md
- Canonical vocabulary filter: `conducta_canonica` (PE only, see "Canonical conducta vocabulary" below)
- Response: {results, count, next, previous, typeCounts, facets}
- View modes: table (EntityTable), card (BrowseCards), map (TrajectoryMap for PE only)

## Existing Aggregation Endpoints (api/v2/views.py)
- `counts/` — EntityCountsView: returns {personaesclavizada, personanoesclavizada, documento, lugar, corporacion} counts
- `gender-status-distribution/` — GROUP BY sexo + hispanizacion, returns [{sexo, hispanizacion, count}]
- `places-people-distribution/` — GROUP BY lugar + tipo + year, aggregates personas per place per year (trajectory document date; `lugar_any` search results may be slightly higher because they also match procedencia)
- `travel-trajectories/all_trajectories_summary/` — merges PersonaLugarRel + FK places (procedencia, nacimiento, defuncion), returns {total_places, places:[...]}
- `travel-trajectories/aggregated/` — route flows for the map; params `limit_rutas` (default 500, max 2000), `min_count` (default 1), `bbox` (keep touching routes); reports `truncated/limit_rutas/min_count`; `route_detail/` (DB pre-filtered) and `place_detail/?lugar_id=&direction=in|out|all` feed the arc/place modals
- `archivos/` list/detail — `documento_count` is a live annotated `Count('documento')` (single query); the Archivos page fetches it on every load and shows loading/error/retry states plus an "updated HH:MM" stamp, so counts never go stale
- Overseas origin places (Lisboa, Sevilla, Guinea, Congo, Mozambique, Cabo Verde, Castilla, Portugal, España, Perú, Filipinas) carry real-world coordinates (migration `0021`); São Tomé resolves to "Santo Tomé" (0.32, 6.60)

## Frontend Search/Browse Store (src/lib/unified-store.js)
- unifiedStore: writable with activeTab, viewMode (table/card/map/crosstab/network), query, exactSearch, counts, typeCounts, facets
- Per-tab state: results, totalResults, currentPage, pageSize, sortField, sortDir, filters, visibleColumns
- Functions: fetchResults(), setViewMode(), setActiveTab(), toggleSort(), setPage(), setPageSize(), applyUrlState()
- URL sync: all state writes go through `buildSearchUrl()` (src/lib/searchUrl.js); discrete actions (search, clear, tab/page change) push history, intermediate filter edits replace; Search/+page.svelte restores state idempotently from +page.js load data on mount and Back/Forward (root layout sets `trailingSlash: 'always'` so internal `/Search/…` URLs never redirect)
- Response shape: data.results (entity objects), data.typeCounts (per-type counts in search context), data.facets (sidebar filter buckets)

## View Components (src/routes/(app)/Search/)
- +page.svelte: main search interface, tabs, search bar, controls, dispatcher to view modes
- EntityTable.svelte: reads visibleColumns from store, renders sortable table with renderCellValue()
- BrowseCards.svelte: maps cardComponent per entity type (PersonasEsclavizadasCard, DocumentCard, etc.)
- TrajectoryMap.svelte: Leaflet + D3 arcs, calls travel-trajectories endpoints
- Dashboard/viz/ArcsMap.svelte: Leaflet + D3 animated arcs; geometry cached per route+zoom (particle loop does no per-frame projection), invisible wide hit-strokes on arcs + clickable/keyboard place markers opening the place modal (`PlaceDetailPanel`, Entrantes/Salientes via `place_detail/`), "Ver personas" deep-link via `lugar_any`, mobile defaults (100 routes, 30 particles), no D3 transitions above 300 routes
- BrowseFilters.svelte: sidebar facets, form-based filters

## Column Config (src/conf/columns.js)
- columnsConfig: per-entity array of {key, label, sortable, visible}
- defaultVisibleColumns: derived, defines default table columns
- entityTabConfig: {icon, detailPath} per entity type
- entityIdField: {persona_id, documento_id, lugar_id, corporacion_id}
- renderCellValue(): custom formatters (edad+unit, date handling, arrays, nested objects)
- filtersDefinition: per-entity filter UI (searchable-select, id-searchable-select, text, select, year, date)

## Serializers (api/v2/serializers.py)
- Reference: lightweight (id, name fields only)
- List: for table/browse views (adds counts, FK references)
- Detail: full nested data with relationships
- PersonaEsclavizadaListSerializer: adds etnonimos, hispanizacion, has_relaciones, documento_count
- Write: for POST/PATCH operations

## Production load testing (`loadtest/`)
- Read-only k6 harness for the public read path, run through the Cloudflare edge from a disposable VM; operating guide in `loadtest/RUNBOOK.md`. Scenarios: `smoke`, `search-stress` (uncached `/search/`), `viz-mix` (cache-miss vs cache-hit for `search/network`, `crosstab`, `travel-trajectories/aggregated`, `places-people-distribution`), `static`, `spike`.
- Auto-abort is threshold-driven: `baselineThresholds()` in `loadtest/config.js` aborts on any 5xx/429/CF-challenge, and cached latency thresholds use `abortOnFail` + `delayAbortEval`.
- Throttle bypass (`api/throttling.py`): `LOADTEST_TOKEN`-gated `X-Loadtest-Token` header skips the global DRF `anon`/`user` throttles; inert when the env var is unset, reversible, and does not touch auth/permissions. Views with explicit `@throttle_classes` (login/register) are not bypassed.
- `loadtest/scripts/generate_queries.js` expands `data/queries.seed.json` into `data/queries.json`; `guard_no_writes.sh` fails the build on any write verb; `snapshot.sh` records read-only origin telemetry (`docker stats`, `pg_stat_activity`, `pg_stat_statements`, Redis).

## Production monitoring (`docker-compose.monitoring.yml`)
- Additive Netdata layer for the live event and ongoing prod observability. It is
  a separate `-f` layer appended to the prod invocation used by `scripts/update.sh`
  (`docker compose -f docker-compose.yml -f docker-compose.server.yml
  -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d`); no existing
  compose file is modified, so removing the layer + named volumes fully reverts it.
- Service `netdata` (`netdata/netdata:v2.12.1`, pinned) joins `trayectorias_network`,
  mounts the Docker socket and host `/proc` `/sys` `/etc/{os-release,passwd,group}`
  read-only (`pid: host`, `cap_add: SYS_PTRACE`), and binds the dashboard to
  `127.0.0.1:19999` only — reach it via `ssh -L 19999:localhost:19999 <user>@<host>`,
  never through Cloudflare. Config-as-code lives in `monitoring/netdata/`: retention
  in `netdata.conf` (~2 GB) and `go.d/{postgres,redis,httpcheck}.conf` collectors.
- Postgres credentials are compose-interpolated from the root `.env` into the
  container env and consumed via Netdata `${env:...}` resolvers (password
  URI-encoded); no secret is committed. Redis is `redis:6379` (no auth). The
  httpcheck jobs probe `https://trayectoriasafro.org` and `/api/v2/health/`.
- Complements, not replaces, the synthetic harness: `loadtest/scripts/snapshot.sh`
  remains the text fallback and post-hoc correlation source. Prometheus + Grafana
  is the documented durable follow-up.

## Infra gotchas (found during Phase 1 / Lecciones Educativas work, July 2026)
- Backend dependency mgmt is uv-only: update `mstdb_manager/pyproject.toml` with
  `uv add <pkg>` and commit the resulting `mstdb_manager/uv.lock` change.
- Docker installs backend deps via `uv sync --frozen --no-dev --no-install-project`.
  If deps change, rebuild the `web` image (`docker compose build web`).
- mstdb_theme/nginx.conf (the `frontend` service's nginx, NOT the incomplete
  root-level `nginx/` dir referenced by docker-compose.prod.yml which doesn't exist)
  proxies /api/, /admin/, /static/ to `web:8000`. It used `proxy_set_header Host $host;`
  which strips the port — use `$http_host` instead or Django's build_absolute_uri()
  produces broken URLs (e.g. missing :3000).
- No route ever served MEDIA_ROOT (dev or prod) — mdb/urls.py had no static()/serve()
  for media. Added `path('media/<path:path>', serve, {'document_root': MEDIA_ROOT})`.
  frontend nginx also needs `/media/` proxied to `web:8000` (it has no filesystem
  access to Django's media dir).
- @tiptap/starter-kit v3 already bundles the Link extension — don't also import
  @tiptap/extension-link separately (causes a "duplicate extension" warning);
  configure it via `StarterKit.configure({ link: {...} })`.
- Repo has git submodules (mstdb_manager, mstdb_theme). Commit inside each submodule
  first, then `git add <submodule>` + commit in the superproject to bump the pointer.
- To stage only part of a dirty file while leaving unrelated WIP hunks untouched
  (e.g. someone else's in-progress edit in the same file), `git add -p` run via the
  sync terminal tool auto-answers "y" to all hunks (no real interactivity) — instead
  build a minimal patch file with just the wanted hunk and `git apply --cached patch.diff`.
- Redis cache runs as the `redis` service in `docker-compose.yml` (ephemeral, no
  persistence, `maxmemory 256mb` + `allkeys-lru`, not published; `restart: always`
  in the prod override). `web` waits on it via `depends_on: service_healthy`.
  `mdb/settings.py` `CACHES` points at `REDIS_URL` (default
  `redis://redis:6379/1`) with `IGNORE_EXCEPTIONS=True`, so an unreachable Redis
  still degrades silently to DB-only — a `None` from a cache round-trip in the
  `web` container means the cache is not actually working.

## Public data dictionary
- Model `VariableDefinition` (`dbgestor`): one row per documented model field —
  `variable_id` (unique slug), `modelo`, `clave`, `tipo`, `descripcion_es/_en`,
  `orden`. Editable in Django admin (`dbgestor.admin.VariableDefinitionAdmin`).
- Seed: `manage.py seed_variable_definitions` is idempotent — it creates/refreshes
  the key/type/order rows and only fills prose when empty (pass
  `--overwrite-descriptions` to force), so team edits are never clobbered. Run it
  after adding variables; it is not a data migration.
- API: `GET /api/v2/data-dictionary/` (`api/v2/views.py::DataDictionaryView`,
  cached 1h) returns `{models:[{modelo,variables:[...]}], vocabularies:[{modelo,
  label_es,label_en,terms:[{value,descripcion}]}]}`. Variables come from the model;
  vocabulary terms come live from the lookup tables, so they never drift.
- Page: `(app)/Diccionario/+page.svelte` (nav "Diccionario"); searchable, grouped
  by model, `descripcion_es/_en` chosen via `getLocale()`.

## Translation / language variants (en rollout in progress)
Phases 1–3 shipped (es source in-place + en rows): `Translation` (GFK
`(content_type, object_id, field_name, language_code)`, `draft`/`published`) +
dedicated `LeccionTranslation`; `TranslatableFieldsMixin` on 21 models;
`?lang=` on api/v2 read serializers (published-only, Spanish fallback);
staff-only `workbench/translations|leccion-translations` endpoints + Svelte
workbench at `User/catalogar/traducciones`; published en values feed the
`english`-config half of each `search_vector`. pt/de need zero schema change
(`language_code` free text + `SUPPORTED_CONTENT_LANGUAGES`) but no FTS configs,
import paths, or UI locales yet. Still deferred: synonym/alias layer
generalizing `ConductaTerm` (b) — requires the team taxonomy decision; person
descriptor free text (`ojos`, `cabello`, `altura`) stays Spanish-only.
