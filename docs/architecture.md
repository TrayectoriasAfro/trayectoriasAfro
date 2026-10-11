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
- Backfill: `link_conducta_terms` (dry-run default, `--apply`, `--csv` review report; ambiguous aliases like `busque` and wildcards are review-only)

## Lugar data integrity audit (`audit_lugar_csv`)
- Compares a ground-truth Lugar CSV export (default `temp/data/Lugar-<today>.csv`; `comentarios` is a CSV-only curator column, not in the DB) against `dbgestor_lugar` on `lugar_id`: existence both ways, lat/lon agreement (`Decimal` + tolerance, DB column is numeric(9,6)), missing coordinates split into unreferenceable (etnónimo / "no puede ser referenciada" semantics) vs. plain, and consolidation hints (consolidar/unificar/combinar)
- Outputs: console summary, `--json` full report, `--report` flat CSV of every finding
- Run inside the web container (`docker exec trayectorias_web python manage.py audit_lugar_csv`); the CSV path must be reachable from the container (mount/copy it in or pass `--csv`)
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
