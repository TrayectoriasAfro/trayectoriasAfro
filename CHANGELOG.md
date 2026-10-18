# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Backend (`mstdb_manager`)

- Search: unified `search/` now expands persona results with people linked to FTS-matched documents (`match_reason`: `directo` vs `documento`; direct matches first, via-document score 0 in multi-type merge). Document `search_vector` now includes `tipo_documento` via correlated subquery with a `post_save` refresh receiver on `TipoDocumental`; reindex with `populate_search_vectors`. Document results carry `personas_esclavizadas_count` / `personas_no_esclavizadas_count`.

- Search → Lugares: eliminated the per-card HTTP fan-out that caused 429s. The lugar search payload now carries `personas_preview` (`total` + up to 3 `{persona_id, nombre_normalizado, persona_model}`), prefetched via `p_x_l_lugar`, replacing the old `persona_lugar_rel` id list that forced one `relaciones-lugares/{id}/` request per related person, per card, on render. `persona_count` is now a single annotated subquery (`lugar_persona_count_q`, shared with the ordering annotation) instead of a per-row query; `LugarListSerializer.get_persona_lugar_rel` is gone. Applies to the unified `search/`, `lugares/`, and `lugares/search/` paths; the CSV export inlines the preview total + names.
- Throttling: rate limits now key on the real client IP (`api.throttling.get_client_ip` — `CF-Connecting-IP` → first `X-Forwarded-For` hop → `X-Real-IP` → `REMOTE_ADDR`) via `ClientIPTrackingMixin`, applied to the anon/user and login/register throttles. Previously DRF used `REMOTE_ADDR` (the frontend nginx container), so behind Cloudflare → host nginx → frontend nginx every anonymous visitor could share one `anon` bucket.
- 429 mitigation note: response caching on the lugar list/search and an `anon` rate bump were deliberately **not** applied yet — the group-by-group fan-out removal, the count annotation, and per-client throttle identity should be measured first (a shared client IP collapse would have made any limit bump cosmetic).
- API: added a `LOADTEST_TOKEN`-gated DRF throttle bypass (`api/throttling.py`, wired as the default throttles in `mdb/settings.py`). Requests sending a matching `X-Loadtest-Token` header (compared with `hmac.compare_digest`) skip the `anon`/`user` rate limits; unset/empty `LOADTEST_TOKEN` keeps the bypass inert, and authentication/permissions are unaffected. Supports the production read-path stress test (see `loadtest/RUNBOOK.md`).
- New management command `audit_lugar_csv`: data-integrity audit of a ground-truth Lugar CSV export against `dbgestor_lugar` (keyed on `lugar_id`). Reports id existence both ways, lat/lon agreement with Decimal tolerance, missing coordinates split into unreferenceable (etnónimo / "no puede ser referenciada" comment semantics) vs. plain missing data, and consolidation hints (consolidar/unificar/combinar) from the CSV `comentarios` column. Console summary plus `--json` and `--report` (flat CSV) outputs.
- Search: lugares now support ordering by person count (`persona_count`). The unified-search ordering annotation mirrors `LugarListSerializer.get_persona_count` (trajectory place, birth/death place, origin) so the sort order matches the displayed numbers; the whitelist and annotation are both required, otherwise ordering silently falls back to the default.
- CSV: the personas-esclavizadas export now includes a `lugares_trayectoria` column (trajectory places ordered by `ordinal`, formatted `lugar (situación)`); the list/export prefetches `p_x_l_pere` with `select_related('lugar','situacion_lugar')` to avoid N+1. The field also appears in the list JSON payload.
- Public config: `GET /api/v2/config/` now exposes `contact_email` (from `PUBLIC_CONTACT_EMAIL`); empty hides the contact links.
- Search: `typeCounts` in `search/` responses is now computed with the same query + sidebar/form filters as the active result set, for **every** entity type (not just the active one, and no longer from the unfiltered base queryset). For single-type requests this guarantees `typeCounts[active] == count`, so each entity-tab badge matches what its table would show with the current filters.
- Data dictionary: new public read-only `GET /api/v2/data-dictionary/` returning documented variables grouped by model plus every controlled vocabulary's terms (value + `descripcion`). Backed by the new `VariableDefinition` model (migration `0022`, admin-editable in `dbgestor`, so the team authors prose without code) and the idempotent `seed_variable_definitions` command, which seeds the key/type/order rows and only fills prose when empty. Response is cached (1h).

### Fixed

- Deploy: `scripts/update.sh` now repairs `/app/media` ownership (named volume is created root-owned, shadowing the image's build-time chown; `web` runs as `appuser`). This was the production cause of lesson PDF/image uploads failing with 400 ("No se pudo guardar...").
- Lessons: `upload_adjunto` now gated by `IsAuthenticated` for parity with `upload_imagen`, and both upload actions return 400 (not 500) on file-save failures.
- Lessons page: added static localized "Introducción a las unidades didácticas" paragraphs (`lessons_intro_p1/p2`, ES + EN) below the hero subtitle.
- Search: `PersonaEsclavizada.salud` is now part of the persona search vector (searching "embarazada" missed most matches). Run `manage.py populate_search_vectors --model persona` after deploying; it also fills ~3,000 personas whose vector was empty.
- Document detail: "Personas relacionadas" links to the wrong detail page (404) for enslaved persons; the persona list API now exposes `persona_model` instead of relying on hardcoded content-type IDs.
- Fix `ModuleNotFoundError: No module named 'pkg_resources'` by restricting `setuptools` to `<81` in `mstdb_manager`.

### Repository

- Added an additive Netdata monitoring layer (`docker-compose.monitoring.yml` + `monitoring/netdata/`) for the live real-user event: a pinned `netdata/netdata:v2.12.1` service joining `trayectorias_network`, host + per-container metrics via a read-only Docker socket, and Postgres/Redis/HTTP-health collectors configured as code. The dashboard binds to `127.0.0.1:19999` only (SSH tunnel; no Cloudflare/public port) and the layer is fully reversible by dropping the `-f` override and its named volumes. No existing compose file or app code is modified.
- Added `loadtest/`: a repeatable k6 stress-test harness for the public read path (`smoke`, `search-stress`, `viz-mix`, `static`, `spike`), a query-inventory generator (`scripts/generate_queries.js`), a read-only telemetry snapshot recorder, a Cloudflare/throttle pre-flight probe, a write-verb guard test, and an operating runbook (`loadtest/RUNBOOK.md`). Reads only; no write verbs.
- `scripts/update.sh` now triggers a database backup before touching the checkout (`manage.py dbbackup -c` against the deployed stack, identical to the nightly cron; output lands in `./backups/`). A failed backup aborts the update; pass `--no-backup` to skip it.
- `scripts/update.sh` and `scripts/update_dev.sh` now populate search vectors for PersonaEsclavizada and Persona models after updating the codebase.
- Added an ephemeral `redis` service to `docker-compose.yml` (image `redis:7-alpine`, `maxmemory 256mb` + `allkeys-lru`, no persistence, not published) with `restart: always` + log rotation in the prod override, and made `web` wait for it via `depends_on: service_healthy`. This fixes the `django_redis` cache that was silently disabled in dev and production (an unreachable Redis host degraded to DB-only under `IGNORE_EXCEPTIONS`); `REDIS_URL` is documented in `.env.example`.
- Deferred (documented, not implemented): vocabulary/language **variants** — display translation of controlled-vocabulary values + facet options, and a synonym/alias layer for lookups and free-text descriptors (generalizing `ConductaTerm`). Only `ConductaTerm` currently has aliases + accent-insensitive matching; every other lookup and the free-text descriptor fields (`ojos`, `cabello`, `marcas_corporales`, `salud`, `conducta`, `altura`) are Spanish-only and accent-sensitive. Resume only after a team taxonomy decision; see `docs/architecture.md` → "Translation / language variants (deferred)".

### Frontend (`mstdb_theme`)

- Search: document cards and table show linked PE/PNE counts; person cards show a "matched via document" badge when `match_reason=documento`.
- Fixed missing `m` (Paraglide message function) imports in `Search/RouteDetailPanel.svelte`, `lessons/[id]/+page.svelte`, and `User/catalogar/relaciones/+page.svelte`. The bare `m` resolved to a global and threw a `ReferenceError` only when the affected branch rendered, so the arc/place detail modal in both maps, the public lesson error state, and the cataloger relations loader were broken.
- Added a durable guard for this class of bug: `scripts/check-i18n-import.js` (npm `check:i18n`) scans `src/` (excluding generated `src/lib/paraglide/**`) and fails if any file calls `m.*` without a `$lib/paraglide/messages.js` import.
- Dashboard → People by Place: fixed the date-range filter so it can be changed repeatedly. `handleYearRangeChange` clamped against the applied opposite bound and silently returned (making the range editable only once, until remount); it now clamps to the dataset bounds, always refreshes, and keeps the inputs able to widen back to the full range. An empty result now clears the chart and shows an explicit "no data" state instead of leaving a stale chart.
- Search browse filters: the year range inputs are now seeded from the applied filters (mount and external changes such as a chart drill-down) instead of staying blank with Apply disabled; `handleClear` also resets the local inputs.
- Search store: `filtersMatch` compares filters as strings (year inputs emit numbers, URL filters are strings), so a normal apply no longer fetches twice; the abort handler now only clears `isLoading` for a real teardown, not for a superseded request; an active crosstab now refreshes when a shared filter changes.
- Search → Lugares: the "Personas relacionadas" card list now renders from the inlined `personas_preview` payload instead of firing one `relaciones-lugares/{id}/` request per related person (the source of the 429s); person links use `persona_model` instead of a hardcoded content-type id.
- Search → Lugares: the "Personas" column is now sortable (asc/desc), with the ordering persisted in the URL.
- Dashboard → Map of trajectories: fixed the timeline for short date ranges (a 1-year range collapsed to a single bucket and froze playback); the bucket step now falls back to 1 year when the span is smaller than the selected granularity, the date inputs use the full dataset range (not the shrinking filtered range) so a narrowed range can be widened again, and a result set always has at least one bucket. Added a "Mostrar trayectorias" toggle (hides arcs/particles, keeps place circles) to both maps.
- Dashboard → Map of trajectories: the arc/place tooltip is now an activator — it has a "Ver personas" button that opens the route/place detail modal, and hiding is delayed so the pointer can reach it. The map re-measures on mount, `resize`, and tab visibility (`ResizeObserver` + `map.invalidateSize()`) to stop the D3 overlay drifting after a container resize.
- Search → trajectory map: added the matching arcs toggle, localized the remaining hardcoded Spanish (places/arcs toggles, counts, loading/empty states, popup), and applied the same resize re-measure.
- Dashboard → Map of trajectories: narrowed the reactive render path — a timeline scrub now updates arc width/opacity, marker radius and particles only (style-only), instead of re-running the full layout/arc/marker data joins on every playhead change. Structural changes (filter, mode, toggle, data) still rebuild the scene.
- Dashboard → People by Place: the "Resumen por Lugar" total column is now "Total Número de Personas Esclavizadas" (`viz_pbp_col_total_personas`), and the remaining hardcoded Spanish (axis labels, table `aria-label`, place dropdown) moved to Paraglide keys.
- Footers (app and landing) and the Accessibility feedback section now render a `mailto:` contact link only when `PUBLIC_CONTACT_EMAIL` is set (no dead link when unset).
- i18n: added the missing English translations (`lessons_read_lesson`, `lessons_error_mss`) to restore full es/en key parity.
- Added an ES/EN language switch to the landing hero, below the account link.
- Migrated the remaining hardcoded UI text in `src/conf` and `src/lib` to Paraglide. Conf modules (`filters`, `columns`, `crosstab`, `local`) now expose message keys (`nameKey`, `labelKey`, `placeholderKey`, `groupKey`, `rangeLabelKey`, option `labelKey`) that consumers resolve at render time, and their Svelte consumers (Search page/tabs, `EntityTable`, `BrowseFilters`, `ColumnConfigModal`, `CrosstabView`, `SearchNetwork`, `Archivos`, `About`) resolve them so labels re-render on locale switch.
- Localized formatting and shared components: `renderCellValue`/`formatDate` now format dates and numbers via `getLocale()`, the landing title suffixes, embed-kind labels, `MultiSelect`, `SearchableSelect`, `FlexDateInput`, `ConfirmDelete`, `Tooltip`, `SuggestMerge`, `RichTextEditor`, `LeccionForm`, `LeccionColaboradores`, and the figure caption are all translated.
- Long-form prose in `conf/archivos.js` and `conf/contributors.js` (archive descriptions, contributor bios/roles, `additionalInfo`, `elaboracion`) is now stored as `_es`/`_en` pairs and resolved with `pickLocale`/`localizeArchivo`/`localizeContributor`; proper data (names, addresses, participants, citations) is never translated.
- Search: entity-tab badges now read only the filter-aware `typeCounts` from `search/`, removing the global `counts/` fallback and the stale/blank values it produced. A known `0` renders, the hourglass shows only while a new query/filter context is loading (`typeCountsLoading`), and `typeCounts` is reset on new searches so a previous context never lingers. Added the pure `searchBadges.js` helper (`tabBadge`) with a vitest unit test.
- Added a public **Diccionario** page (`/Diccionario/`, nav link) rendering the data dictionary: variables grouped by model and all controlled vocabularies, searchable, with per-locale descriptions (`descripcion_es`/`descripcion_en` via `getLocale()`), semantic tables and full keyboard operability. Added a **Lecciones** nav link (the `/lessons` route was previously unlinked; Sabrina's "Archivos · Visualizaciones · Lecciones").
- Dashboard → Map of trajectories: fixed trajectory arcs drifting off their place circles after zooming out/in. The arc geometry cache was keyed only by route + zoom, but a Leaflet layer point is only valid for a specific projection (zoom **and** pixel origin = center); wheel/trackpad zoom recenters the map, so revisiting a cached zoom handed back geometry computed at an old center while the markers kept using the live origin. The cache key now includes the pixel origin (`projectionKey()`), and the cache is cleared on `zoomend`/`viewreset` (panning is projection-stable and still hits the cache, so the scrub/drag perf win is preserved).
- Dashboard and Search maps: fixed arcs being cut at an internal rectangle after zooming. The D3 overlay `<svg>` was sized to exactly the map viewport and clipped its own content, so arcs whose endpoints left the viewport were truncated at the viewport boundary instead of running to the map edge. The overlay box is now padded 200px on every side and set to `overflow: visible`; the map container still performs the final clean clip at its edge (and keeps the rounded corners).
- Dashboard and Search maps (follow-up to the entry above): the real cause of the arcs being cut — and of the whole overlay intermittently disappearing after a drag until the window was resized — was that the overlay `<svg>` box *is* the overlay's clip region, and it was only re-laid-out on `zoomend`/`viewreset`/`moveend`/`resize`. Panning translates the Leaflet map pane without moving the projected geometry, so while a drag (or its inertia glide) was in flight the box drifted out of the viewport: arcs were cut at a moving internal line, and on a long glide the box left the viewport entirely, clipping the whole overlay away until the next re-layout (`invalidateSize`, i.e. a window resize, also forced one). The 200px pad above only masked drifts smaller than that. Both maps now re-lay-out the box on every `move`; panning is projection-stable, so nothing is re-projected (verified: pane alignment stays exact through drags/inertia, arcs stay anchored to their place circles, and edge hover/click still work).
- Dashboard → Map of trajectories: the animated movement dots (`map-particle`) now exist only while the timeline is playing. On pause or reaching the end they fade out (~220 ms) and are removed, and they fade back in on play/resume. Previously the rAF loop stopped but the last dots stayed frozen on screen, so zooming afterwards re-projected the arcs while the dots kept their stale positions and drifted off their trajectories. Dots are decorative, so removing them when not animating keeps the map clean.
- Frontend serving: the SPA document (`index.html`) is now sent with `Cache-Control: no-cache` (`mstdb_theme/nginx.conf`), so a client revalidates the HTML on the next load and picks up new hashed assets immediately after a deploy. Previously the document had no cache headers and browsers cached it heuristically, pinning clients to a stale bundle until a hard refresh (the hashed `/_app/immutable/*` assets stay `immutable` for a year, so revalidation is cheap).

---

## [1.4.0] - 2026-09-28

### Backend (`mstdb_manager`)

#### API

- Added the `lugar_any` drill-down filter to the search, crosstab and search-network endpoints: persons related to any given place by trajectory (`PersonaLugarRel`) or, for `personaesclavizada`, by `procedencia` origin (OR). This is the filter behind the "Personas por lugar" dashboard drill-down, whose results previously only matched `procedencia` (e.g. Puebla 1635: 124 chart records vs 7 search results). Documented in `api/v2/README.md` together with the chart-vs-search count contract.
- Fixed the Archivos N+1 on `documento_count`: `ArchivoViewSet.get_queryset()` now annotates `Count('documento')` in a single query and the list/detail serializers prefer the annotation (fallback to `documento_set.count()`); documented in `api/v2/README.md`.
- Mapa Trayectorias performance: `travel-trajectories/aggregated/` accepts `limit_rutas` (default 500, max 2000), `min_count` (default 1) and `bbox=minLon,minLat,maxLon,maxLat` (all part of the 600s cache key); only places used by the kept routes are serialized and the response reports `truncated/limit_rutas/min_count`. `_build_persona_points` now uses `.only()` on the rel/lugar/documento columns, and `route_detail` pre-filters personas at the DB level (chained filters — one JOIN per M2M condition) before the Python leg check. New `place_detail/?lugar_id=&direction=in|out|all` endpoint with movement-leg totals for the place modal. New `api.v2.tests.test_trajectories_aggregated` suite (8 tests). Documented in `api/v2/README.md`.
- Georreferenciación: migration `0021` moves overseas origin places that were geocoded inside the Gulf of Mexico box to their real-world coordinates (Lisboa, Sevilla, Castilla, Portugal, España, Guinea, Congo, Mozambique, Cabo Verde, Perú, Filipinas; São Tomé resolves to "Santo Tomé" at 0.32, 6.60 and needed no change). The migration only touches rows still carrying the exact bad coordinates, clears the viz cache, and is reversible.

### Frontend (`mstdb_theme`)

- Upgraded the Svelte 5-compatible Vite, Svelte plugin, and Vitest toolchain; removed the unused Svelte 4-only combobox dependency and pinned SvelteKit's transitive `cookie` package to its patched version.
- Fixed server rendering on the landing and login pages after the dependency upgrade by restoring valid Paraglide message references.

#### Bug 1 — Browser history (SPA navigation)

- Migrated the remaining full-reload navigations to SPA `goto()`: the landing hero search, the navbar search, the "Personas por lugar" drill-down and the Archivos "Explorar" button. Removed `on:click|stopPropagation` from the EntityTable detail icon links, which was swallowing clicks before SvelteKit's router could intercept them (causing full page reloads on every drill-down from the results table).
- Fixed the root layout's landing/app chrome branch to resolve from the in-flight navigation target: keyed on `$page.url` it flipped after the new page had mounted, destroying and remounting it mid-fetch (lost results and stuck spinners when navigating landing → Search).
- Set `trailingSlash: 'always'` on the root layout so the app's canonical `/Search/…` URLs no longer trigger SvelteKit client redirects that double-mounted the Search page.
- Search state (q, tab, view, page, page_size, ordering, filters, archivo_id) is now fully encoded in the URL through a central `buildSearchUrl()` helper, with a push/replace policy: push for discrete actions (new search, clear, tab change, page change), replace for filter keystrokes and sort/view changes.
- Restoring state on Back/Forward: Search restores tab, query, exact mode, filters, page, page size, ordering and view mode idempotently from the parsed URL (`applyUrlState`), without extra history entries or duplicate fetches; aborted fetches no longer leave a stuck loading spinner.
- Added an accessible "Volver a resultados" breadcrumb on all five Detail pages that returns to the last Search/Dashboard state (recorded in sessionStorage, referrer-based fallback), instead of relying on blind history navigation.

#### Bug 2 — Drill-down Personas por lugar

- The "Personas por lugar" bubble drill-down now opens `/Search/` with `lugar_any=<id>` and the exact selected year (previously `procedencia` + a wrong `[year, year+1]` window and a full-reload navigation), so result counts match the chart (e.g. Puebla 1635 → 124 records).
- Added the count-contract note to the chart (chart counts trajectory records; Search also includes procedencia) and an `aria-live` status announcement for drill-down activations.
- Fixed the broken `?archivo_id=` deep link from Archivos: it is now mapped onto the real `archivo` form filter in `Search/+page.js`, so the sidebar shows the filter and results are actually filtered.
- Added the missing Paraglide `m` imports on the five Detail pages (`m.loading()` crashed rendering) and new `es`/`en` message keys for the drill-down note, status and breadcrumb.

#### Bug 3 — Archivos live counts

- Counts are live on every page load (`GET /api/v2/archivos/` → annotated `documento_count`): the Archivos page now shows a "live counts" helper line, skeleton placeholders while loading, an `aria-live` status region with an "Updated HH:MM" stamp (locale-formatted), and a retry button on failure instead of failing silently.
- The null-`archivo_id` entry (Orizaba/Córdoba, still being catalogued) now renders an explicit "count coming soon" badge instead of hiding the count row.
- New `es`/`en` message keys (`archivos_live_note`, `archivos_counts_loading/error`, `archivos_retry`, `archivos_counts_updated`, `archivos_docs_count`, `archivos_pending_count`); new styles live in `src/styles/custom.css` with `prefers-reduced-motion` support.

#### Bug 4 — Mapa Trayectorias (rendimiento + clic + São Tomé)

- Performance: arc geometry is cached per route+zoom so the rAF particle loop does pure Bézier math (no `latLngToLayerPoint` per particle per frame); particle budget is adaptive (80 desktop / 30 mobile / 0 with `prefers-reduced-motion`); D3 transitions are skipped above 300 routes; the backend is asked for `limit_rutas=max(routeLimit, 500)` while the slider keeps its half-of-total default (capped at 100 on mobile); a truncation note shows when the server cut the list.
- Click/touch/keyboard: arcs carry an invisible wide hit-stroke (`stroke-width: max(12, visible+8)`) over the thin visual arc; place markers are now `role=button` circles with `tabindex`, localized `aria-label`, hover/focus tooltips and `click/Enter/Espacio` opening a new `PlaceDetailPanel` modal (Entrantes/Salientes tabs via `place_detail/`, paginated, with a "Ver en Búsqueda" `lugar_any` deep-link). A "Ver personas de este lugar" button sits next to the Origen/Destino selects (non-map path for the lesson) and the counts line is a `role=status` region.
- New `es`/`en` message keys (`arcs_map_truncated/view_people/close_place/view_in_search/place_movements/place_in_out/place_tabs/place_all/place_incoming/place_outgoing/place_empty`); hit-area/marker styles in `src/styles/custom.css` (no component-scoped styles).
- São Tomé: "Santo Tomé" was already correct in the live DB (0.32, 6.60, off the African coast); the Brazil-plot was caused by the other overseas placeholders fixed backend-side (migration `0021`); existing lugar edit/merge tooling unchanged.

#### Bug 6 — Valor económico + procedencia en resultados (fase 1: visibilizar lo existente)

- The unified `/api/v2/search/` endpoint now annotates `evento_valor_sp_list`, `evento_forma_de_pago_list` and `evento_total_list` on the enslaved-person queryset, so the previously always-empty Valor/Forma de pago/Total columns now show the aggregated document values.
- New `evento_valor_sp__icontains` text filter on `/api/v2/search/` (personas and documentos) and the crosstab endpoint, matching the free-text archive value (e.g. "200 pesos").
- The documento list/detail serializers and the nested documents in the persona detail now expose `evento_valor_sp`, `evento_forma_de_pago` and `evento_total` (CSV exports include them automatically).
- Search table: the three value columns got clear labels ("Valor (pesos, texto archivo)", "Forma de pago", "Total") and are no longer sortable server-side (free text, ordering silently fell back to the default); the same columns are now available on the Documentos tab, and the value filter is available in the sidebar under Documento. Empty/blank cells render as "—".
- Documento detail shows Archivo plus Valor del evento / Forma de pago / Total when present; persona esclavizada detail shows a linked Procedencia and per-document Valor/Forma de pago/Total, with document titles linking to the document detail.

#### Bug 5 — Vocabulario canónico de conducta (`huído` + alias)

- New `ConductaTerm` vocabulary model (`canonico` unique lowercase, `aliases` array, `descripcion`, timestamps) with a `conducta_terms` M2M on `PersonaEsclavizada`. The archival free-text `conducta` field is untouched; the vocabulary adds a normalized layer on top (canonical term decision — `huído` proposed — and final alias list pending the team meeting; the system supports any outcome without recoding).
- Seeded via data migration: `huído → [huido, hullo, huyo, huyeron, escap*, busque]`. Aliases are normalized on save (lowercase, deduplicated) and validated against collisions with other terms' canonicos.
- New `conducta_canonica=<id|texto>` filter on `/api/v2/search/` and `/api/v2/crosstab/` (plus a new `conducta_canonica` crosstab dimension): matches the M2M link **and** the free-text `conducta` variants accent-insensitively (PostgreSQL `unaccent`), so unlinked records are still found; wildcard aliases (`escap*`) match by prefix.
- Full-text search: `conducta` is now part of the Persona `search_vector` (weight D, unaccented), so `q=huido` finds `huído` records; `populate_search_vectors --model persona` reindexes existing rows.
- New `conductas` facet (canonical term + distinct-person count) in the search response and a `conducta_canonica` searchable-select filter in the Search sidebar (free-text `conducta__icontains` kept as advanced option).
- New `vocabularios/conducta-terms/` endpoint (read public, write authenticated) with collision-validated write serializer; new Admin page with search/import/export; new `conductaterm-autocomplete` for the legacy cataloging form.
- New `link_conducta_terms` management command (idempotent, dry-run by default): matches `casefold+unaccent+icontains` per alias, reports `persona_id, conducta_snippet, matched_alias, action` (CSV via `--csv`); ambiguous aliases (`busque`) and wildcard aliases go to a review queue and are only linked with explicit review, never blind.
- Frontend: catalogar form gets a canonical-vocabulary multi-select with a quick creator and an accent-insensitive "¿Quisiste decir <canónico>?" suggestion over the free-text conducta; persona detail shows canonical badges next to the original text; `MultiSelect` supports the new `canonico` label field. Documented in `api/v2/README.md`.

---

## [1.3.1] - 2026-08-30

### Backend (`mstdb_manager`)

#### API & Data Model

- Fixed the Corporación detail API (`GET /api/v2/corporaciones/{id}/`): the serializer now exposes `notas`, `created_at`/`updated_at`, `tipo_institucion_id`, and nested `documentos`, `personas_asociadas` and `eventos` (institution event roles with document + archive data), and fixed the broken `tipo_institucion_nombre` source (`tipo_institucion.nombre` did not exist).
- Fixed `evento_ids` on the Corporación detail API to use the correct relation, so it no longer returns an empty list.
- Added a robust `persona_type` field (`esclavizada`/`noesclavizada`) to persona reference payloads so detail links no longer depend on environment-specific ContentType ids.
- Removed the `is_published=True` filter from the per-entity search endpoints (`documentos`, `personas-esclavizadas`, `personas-no-esclavizadas`, `corporaciones`). These entities have no publish workflow and all legacy records were `is_published=False`, making them invisible to search (e.g. "Convento de Santa María de Gracia de Guadalajara" returned no results). Lecciones keep their publish control.

#### Relation Types

- Restored the `Asociativa` (`aso`) person↔person relation type that was removed earlier (migration converted former `aso` rows to `Temporal`). Catalogers can again record associative relations (religious brotherhoods, cofradías, etc.); former rows are not auto-reverted and can be reclassified manually. Network endpoints now emit `aso` edges instead of collapsing them into `Temporal`.

#### Templates (old cataloging site)

- Fixed the documento detail place buckets: ordinal `0` now renders as "Lugar del evento/transacción" instead of being mislabeled as "Anteriores".
- Updated the persona↔lugar form help text to state the reserved-`0` ordinal convention explicitly.

### Frontend (`mstdb_theme`)

#### Cataloging

- Added a Corporación edit route (`/User/catalogar/corporacion/edit/[id]`) mirroring the Lugar edit flow: nombre, tipo de institución, nombres alternativos, lugar, documentos, personas asociadas and notas, with per-field validation errors.
- Added an "Editar" button on the Corporación detail page for staff and colectores.
- Restored the `Asociativa` relation type in the relation editor (form option, edge color, legend) and in the persona detail network filters/legends.

#### Detail Pages

- Fixed the "Invalid Date" on the public Corporación page: timestamps now come from the API and render with `formatDate`, the duplicate footer date block was removed, the banner icon alt text no longer says "Persona Esclavizada", and associated-persona links resolve via `persona_type`.
- Unified created/updated date rendering with `formatDate` on persona (esclavizada/no esclavizada) and documento detail pages.

#### Cataloging UX & Conventions

- Documented the reserved-ordinal convention in the trajectory editor: ordinal `0` is the event/transaction place (locked, orange); negative ordinals are places before the event, positive after.
- Added a short note on the Nuevo Lugar page clarifying that georeferencing happens on the website (create/edit lugar with coordinates and «Es parte de» hierarchy), not in the legacy spreadsheet.

---

## [1.3.0] - 2026-08-30

### Backend (`mstdb_manager`)

#### Educational Lessons

- Added role-based lesson access control: lesson owners and collaborators can manage granted access, while API responses expose per-user edit, delete, and ownership permissions.
- Added author and publication metadata to lessons, and published the existing lesson collection.
- Added PDF attachment uploads (`LeccionAdjunto`) for embedding PDFs in lesson content, mirroring the existing image upload flow.

#### API & Data Model

- Fixed Archivo updates to use the `ubicacion_archivo` field.

### Frontend (`mstdb_theme`)

#### Educational Lessons

- Reworked lesson authoring with reusable creation and edit forms, collaborator access management, and draft creation when images are uploaded before the first save.
- Added rich-text support for captioned images and embedded YouTube videos, PDFs, and iframes.
- Added a toolbar button to upload and embed PDF files directly in the lesson editor, reusing the existing embed rendering.
- Fixed blockquote formatting having no visible style in the lesson editor.
- Fixed embeds (YouTube, PDF, iframe) disappearing when reopening a saved lesson for editing (invalid ProseMirror parse rule dropped the node).
- Removed the duplicate image gallery shown below lesson content in the preview and public views.
- Added print-friendly lesson pages and PDF download.
- Improved keyboard focus and contextual tooltips across the lesson editor and other interactive controls.
- Added padding inside the rich-text editor so typed content does not sit against its border.

#### Search

- Reorganized PersonaEsclavizada/PersonaNoEsclavizada sidebar filters: the date range is now always visible below the search bar (no longer nested in a collapsible group), and the "Trayectorias" filter group is expanded by default.

---

## [1.2.0] - 2026-08-29

### Repository

#### Deposit & Data Packaging

- Added versioned deposit snapshot at `deposit/2026-05-08/` with data tables, controlled vocabularies, manifest, and bilingual metadata dictionaries.
- Added deposit reproducibility assets, including network analysis notebook/HTML output and combined report artifacts.
- Added top-level deposit documentation and metadata dictionary for dataset publication workflows.

#### Infrastructure & Configuration

- Added optional deposit environment variables in `.env.example` (`DATAVERSE_API`, `DATAVERSE_API_EXPIRATION_DATE`).
- Added Cloudflare Turnstile environment variables in `.env.example` (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`).
- Added Carto Basemaps API configuration in `.env.example` (`CARTO_API`).
- Fixed production backup volume mount path in `docker-compose.prod.yml` (`./backups:/app/backups`).
- Updated `.gitignore` rules for backup/deposit workflows and versioned deposit snapshots.

### Backend (`mstdb_manager`)

#### User Accounts & Authentication

- Added `POST /api/v2/register/` — open registration endpoint. Validates username uniqueness, email uniqueness, and password via Django's configured `AUTH_PASSWORD_VALIDATORS`. Creates an active user with no group membership; staff assigns roles separately.
- Added `POST /api/v2/whoami/change-password/` — authenticated password change. Verifies current password, calls `set_password`, and preserves the active session via `update_session_auth_hash`.
- Extended `PATCH /api/v2/whoami/` to accept and update User model fields (`username`, `first_name`, `last_name`, `email`) in addition to existing profile fields.
- Added `is_superuser` field to `GET /api/v2/whoami/` response.
- Added `GET /api/v2/config/` — unauthenticated endpoint returning public runtime configuration (`turnstile_site_key`).

#### Security

- Added `LoginRateThrottle` (10 req/min) and `RegisterRateThrottle` (5 req/min) custom throttle classes applied to login and registration endpoints respectively.
- Added global DRF throttle defaults: `anon` 60 req/min, `user` 300 req/min.
- Added Cloudflare Turnstile server-side verification (`_verify_turnstile`) to the registration endpoint using stdlib `urllib` (no new dependency). Dev bypass when `TURNSTILE_SECRET_KEY` is not set.
- Added `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` settings read from environment variables.
- Refactored `api_login` from a plain function to a DRF `@api_view`, enabling safe `request.data` parsing, throttle support, and a stripped response (removed email leakage).

#### Merging & Deduplication

- Added `SugerenciaMerge` model (migration `0012`) for tracking user-submitted merge suggestions with status (`pending`/`accepted`/`rejected`) and audit fields.
- Added `GET /api/v2/merge/candidates/` — fuzzy-search merge candidates via `rapidfuzz` `token_set_ratio` (≥ 50 score, top 30 results).
- Added `POST /api/v2/merge/execute/` — staff-only atomic entity merge. Re-points all foreign key and M2M relations from the duplicate to the canonical record across the full relational graph, then deletes the duplicate.
- Added `POST /api/v2/merge/suggest/` — any authenticated user can flag a potential duplicate; creates a `SugerenciaMerge` record for staff review.
- Added `rapidfuzz` to `pyproject.toml`.
- Added `SugerenciaMerge` to Django admin.

#### Educational Lessons

- Added `Leccion`, `LeccionImagen`, `LeccionNivel`, and `LeccionPalabraClave` models, migrations, and Django admin support.
- Added `/api/v2/lecciones/` CRUD endpoints with facets, image upload, and controlled vocabularies for lesson levels and keywords.

#### API & Data Model

- Extended `PersonaRelacionesViewSet` filter fields with `personas__persona_id` lookup required by the relaciones editor.
- Added `descripcion` field to relation payloads returned by persona detail APIs.
- Added latitude/longitude to `LugarReferenceSerializer` for richer location consumers.
- Extended `Lugar`/`HistoricalLugar` place type options with `hacienda`.
- Enhanced ordering in `LugarViewSet` and filter fields in `PersonaLugarRelViewSet`.
- Added aggregated event fields to PersonaEsclavizada API responses.
- Corrected Search year filtering to accept inclusive year ranges.
- Added `lugar_id` filtering to the places-people distribution endpoint.

#### Visualization API

- Added Redis-backed caching for visualization endpoints.
- Added a server-side Carto basemap tile proxy that keeps the API key private and caches immutable tiles.
- Extended travel trajectory responses with optional per-route timeline data, year counts, and date-range metadata.

#### Deposit & Export

- Added cutoff-date option support in deposit export commands.
- Added metadata-elements handling for deposit export, including field-map updates (e.g., `titulo`).

#### Operations

- Migrated dependency management from `requirements.txt` to `pyproject.toml` and `uv.lock`; updated the production image to use Gunicorn.
- Added backend media serving for user-uploaded files.

### Frontend (`mstdb_theme`)

#### Search

- Search filters, active tab, and query state now synchronize to the URL, allowing filtered results to be shared, bookmarked, and restored from a deep link.

#### User Accounts & Profile

- Added `/User/profile/+page.svelte` — full account page with: read/inline-edit toggle for account fields (username, first/last name, email); collapsible password change form with current-password verification; read/inline-edit toggle for profile fields (institution, URL, semblanza); group and staff/superuser badge display.
- Replaced `/User/profile/edit/` standalone form with a redirect to `/User/profile`; profile editing is now inline.
- Added registration form to `/User/login/` as a toggle alongside the existing login form, consistent with Django admin UX.
- Cloudflare Turnstile widget rendered in the registration form when `TURNSTILE_SITE_KEY` is configured; gracefully absent in dev when key is unset.
- Added `changePassword`, `register`, and `fetchPublicConfig` helpers to `api.js`.

#### Educational Lessons

- Added public lesson list and detail pages, including related-entity navigation.
- Added authenticated lesson capture, edit, delete, rich-text editing, and image upload workflows.

#### Relational Editing & Merging

- Added `/User/catalogar/relaciones/+page.svelte` — PersonaRelaciones (P×P) CRUD panel. Persona search → table of relations → SlideOver add/edit → ConfirmDelete, supporting `?persona_id=` preload from the PE form success flow.
- Added `/User/catalogar/merge/+page.svelte` — staff-only merge execution UI. Entity-type selector → debounced fuzzy search → candidate table with similarity bars → canonical/duplicate selection → confirmation step → `merge/execute/` POST.
- Added `SuggestMerge.svelte` component — modal button allowing any authenticated user to suggest a canonical/duplicate pair for staff review without destructive action.
- Wired `SuggestMerge` into detail pages for PersonaEsclavizada, PersonaNoEsclavizada, Lugar, Documento, and Corporacion.
- Added `relacionesByPersona`, `createPersonaRelacion`, `updatePersonaRelacion`, `deletePersonaRelacion`, `mergeCandidates`, `mergeExecute`, `mergeSuggest`, `updateLugarById`, `updatePersonaEscById` helpers to `api.js`.

#### Trajectory Editing

- Added trajectory editor with CRUD flows and improved add-point UX.
- Added document/persona-aware point creation, including support for foreign-key trajectory points.
- Added `Tooltip.svelte` component wrapping Bootstrap tooltip action for inline contextual hints.
- Wired `Tooltip` into the trayectoria Puntos panel header and the Red de Relaciones panel header.

#### Capture Forms

- PersonaEsclavizada success alert now includes quick-action links to the trayectoria editor and the relaciones editor pre-filtered by the newly created persona.
- Lugar detail page: "Editar lugar" button visible to collectors linking to the lugar edit route.

#### Network & UI

- Added edge tooltips in relations network visualizations.
- Added auth-aware user dashboard footer links based on edit permissions.
- Updated contributor bios and refreshed selected content/visibility settings in app views.

#### Dashboard & Visualization

- Replaced the Personas por Lugar dashboard chart with an interactive D3 visualization and corrected its Search deep links.
- Connected the Personas network dashboard to the live network API with date and cluster filters; fixed graph visibility and DOM-render timing.
- Reworked ArcsMap with compact filter controls, application-configured map tiles, adaptive route limits, accessible labels, and improved performance.
- Added temporal route animation, year-based start/end selectors, route details, and automatic timeline playback to ArcsMap.

---

## [1.2.0-rc.1] - 2026-04-20

### Backend (`mstdb_manager`)

#### Search API

- Added `GET /api/v2/search/network/` endpoint to build Cytoscape-ready networks from the current Search context.
- Network endpoint reuses Search filtering semantics (query, exact search mode, sidebar facets, and form-based filters) to keep parity with table/card/crosstab views.
- Added scope controls for network generation:
  - `scope_mode=strict`: only personas in the filtered Search result set.
  - `scope_mode=expanded`: strict set plus first-degree neighbors.
- Added network response metadata for client UX (`scope_mode`, `node_count`, `edge_count`, `result_count`, `truncated`).
- Added server-side graph size safeguards (node/edge caps) with truncation signaling.

### Frontend (`mstdb_theme`)

#### Network Visualization

- Relationship filter: Added a toolbar row above the network graph with four toggle buttons: Parentesco (fam), Asociación (aso), Temporal (tmp), Subordinación (sub). Each button uses the corresponding edge color.
- Sex/gender distinction — A Sexo toggle button in the same toolbar. When activated, node shapes change:
  - Diamond → Mujer (m)
  - Rounded rectangle → Varón (v)
  - Ellipse (default) → Desconocido (i)

#### Search

- Added a new **Red** view mode in Search for both `PersonaEsclavizada` and `PersonaNoEsclavizada` tabs.
- Search network view is now driven by backend-filtered graph data (no static dashboard network dependency).
- Added strict/expanded scope toggle in Search network controls.
- Added relation toggles (`fam`, `aso`, `tmp`, `sub`) and centrality threshold filtering in Search network.
- Added truncation warning and graph counters in Search network (`nodos`, `aristas`, `resultados base`).
- Added tooltip action button to open the corresponding individual detail page directly from a node.
- Added orphan-node visibility toggle in Search network controls.
- Fixed relation-toggle regression where re-enabling a relation filter did not restore the original graph shape.

---

## [1.1.1] - 2026-04-19

### Backend (`mstdb_manager`)

#### Network API
- Fixed edge directionality for `sub` relations: `persona_sujeto` is now always the edge source, ensuring the arrow points from enslaver to enslaved
- Added `select_related('persona_sujeto')` to the network queryset for both PE and PNE viewsets to avoid N+1 queries

### Frontend (`mstdb_theme`)

#### Network Visualization
- Ego node ("Persona actual") now uses a distinct steel blue (`#3B6D8C`) color on both PE and PNE pages, instead of blending with the type color
- Moved the ego selector after the type selector in the Cytoscape stylesheet so it always takes priority regardless of persona type

#### Export
- Added PNG export button to the network card header (uses Cytoscape's native `cy.png()` at 2× scale)
- Added PNG export button to the map card header (uses `html2canvas` at 2× scale)
- Files download as `red_{nombre}.png` / `mapa_{nombre}.png`
- New dependency: `html2canvas ^1.4.1`

---

## [1.1.0] - 2026-04-17

### Backend (`mstdb_manager`)

#### Relations — Subordinación (ISAAR CPF 5.3.2)
- Added `'sub'` (Subordinación) to `PersonaRelaciones.RELACIONES` choices, completing the ISAAR CPF 5.3.2 vocabulary (`fam`, `aso`, `tmp`, `sub`)
- Added `persona_sujeto` FK on `PersonaRelaciones` to capture directionality (who controls whom); nullable, enforced by form validation only for `sub` type
- Migration `0007_add_subordinacion_relacion` applied; historical records table updated automatically via `django-simple-history`
- `PersonaRelacionesForm`: added `persona_sujeto` Select2 autocomplete field; `clean()` raises a validation error when `naturaleza_relacion='sub'` and `persona_sujeto` is empty
- Create/edit form shows `persona_sujeto` field conditionally (hidden unless relation type is "Subordinación"), via inline JS
- Document detail view: persona cards display "subordinado/a de [nombre]" for `sub` relations
- Enslaved and non-enslaved persona detail pages: same directional label for related persons
- API v2: `PersonaRelacionesNestedSerializer` and `PersonaRelacionesDetailSerializer` expose `persona_sujeto` as a nested `PersonaReferenceSerializer`
- Deposit export (`export_deposit.py`): added `persona_sujeto_idno` column to `relaciones_personas.csv`
- New `dbgestor/utils.py` with `derive_subordination_rels(documento_id)` and `revert_subordination_rels(documento_id)` helpers
  - Derives `sub` relations for all `PersonaNoEsclavizada × PersonaEsclavizada` pairs linked to a document via `Persona.documentos` M2M; idempotent
  - Reverts only auto-derived relations (those with `descripcion_relacion IS NULL`); manually created relations are unaffected
- New management command `derive_subordination_rels`: processes all documents or a single `--documento_id`; reports per-document and total counts
- New `DeriveRelacionesView` and `RevertRelacionesView` (POST-only, permission-checked JSON endpoints) at `documento/<pk>/derive-relations/` and `documento/<pk>/revert-relations/`
- Document detail page: "Derivar relaciones" and "Revertir" buttons (gated by `add_personarelaciones` / `delete_personarelaciones`); page auto-reloads when changes are made; ℹ️ button opens an explanatory modal

#### Search & Filtering
- Added `estado_civil` filter (labeled "Estado matrimonial") for both `PersonaEsclavizada` and `PersonaNoEsclavizada`
- Added `tipo_documental` faceted filter for both persona types
- Added `archivo` faceted filter for both persona types
- Added document date range filter (`fecha_documento__gte` / `fecha_documento__lte`) for both persona types
- Added individual free-text filters for `altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, and `salud` (PE only) — filters combine with AND logic
- Added `procedencia` filter for `PersonaEsclavizada`
- Added `trayectoria_lugar` multi-value lugar filter for both persona types

#### Sorting
- Extended server-side ordering to cover all browsable columns
- Direct-field sorts: `marcas_corporales`, `conducta`, `salud` (PE); `procedencia` via FK traversal (`procedencia__nombre_lugar`)
- Annotation-based sorts using `Subquery` (first M2M value): `etnonimos`, `calidades`, `hispanizacion`, `estado_civil` (PE); `calidades`, `estado_civil`, `ocupaciones` (PNE)
- Annotation-based sorts using `Exists`: `has_relaciones`, `has_lugares` (PE + PNE)
- `Count`-based sort for `documento_list` (PE + PNE)
- Date-diff sort for `documented_span` (PE)
- Annotations are applied conditionally — only when the user requests the relevant ordering field
- Replaced `_validate_ordering` with `_resolve_ordering`, which returns both the ordering expression and any required annotation dict; `ORDERING_ANNOTATIONS` and `ORDERING_FIELD_MAP` class-level configs drive the resolution

#### API
- Added `estado_civil` and physical description fields (`altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, `salud`) to `PersonaEsclavizadaListSerializer`
- Added `estado_civil` to `PersonaNoEsclavizadaListSerializer`
- Added `procedencia` as named lugar string to `PersonaEsclavizadaListSerializer`
- Expanded `_collect_facets` to generate `estados_civiles` and `tipos_documentales` buckets

---

### Frontend (`mstdb_theme`)

#### Browse Filters
- Reorganized filter sidebar into collapsible groups with scroll: *Categorías socioétnicas*, *Trayectorias*, *Biografía*, *Documento*
- Each group shows a badge with the count of active filters
- All groups collapsed by default; Nombre search remains always visible above groups

#### Columns & Sorting
- Added `estado_civil` column ("Estado matrimonial") to both persona type tables
- Added physical description columns to PE table (hidden by default): `altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, `salud`
- All previously non-sortable columns now have sort controls: `etnonimos`, `hispanizacion`, `calidades`, `procedencia`, `estado_civil`, `has_relaciones`, `has_lugares`, `documento_list`, `documented_span`, `marcas_corporales`, `conducta`, `salud` (PE); `ocupaciones`, `calidades`, `estado_civil`, `has_relaciones`, `has_lugares`, `documento_list` (PNE)

#### Views
- Added *Mapa de trayectorias* view to `PersonaEsclavizada` search results, visualizing geographic trajectories for the current result set
- **Map view now respects active search query and all filters** — trajectories are scoped to the current filtered result set (full-text `q`, form filters, sidebar facets)

#### Cross-tabulation (Tabla cruzada)
- New pivot-table view available for `PersonaEsclavizada` and `PersonaNoEsclavizada` tabs
- Configurable row dimension, column dimension, time interval, and cell operation via a control panel
- Available dimensions: Periodo de tiempo, Sexo, Etnónimo (PE), Calidad, Agencia/Adaptación (PE), Procedencia (PE), Lugar (trayectoria), Estado matrimonial, Honorífico (PNE), Tipo documental, Ocupación (PNE)
- Cell operations: Recuento de personas, Edad promedio (PE only, years only via `unidad_temporal_edad`), % del total
- Time-period dimension supports 25, 50, and 100-year intervals
- **Scoped to active search**: crosstab aggregates over the same filtered subset as the list/table/map views (query + all form filters)
- Sortable columns: click any column header to sort ascending/descending; sort indicator icons and `aria-sort` attributes
- CSV export via `export_format=csv` parameter (blob download, no cross-origin issues)
- M2M dimensions (Etnónimo, Calidad, etc.) display a warning banner noting that totals may exceed unique person counts
- Accessible: `<caption>`, `scope` attributes on all header cells, `<tfoot>` totals row
- Backend: `mstdb_manager/api/v2/crosstab.py` — `CrosstabView` and `CrosstabSchemaView` at `/api/v2/crosstab/` and `/api/v2/crosstab/schema/`
- Frontend: `mstdb_theme/src/conf/crosstab.js` dimension registry, `CrosstabView.svelte` component, store additions (`crosstabConfig`, `fetchCrosstab`, `setCrosstabConfig`)

#### Accessibility

- Set `lang="es"` on the root `<html>` element (WCAG 3.1.1).
- Added skip-to-main-content link as the first focusable element on every page (WCAG 2.4.1).
- Added unique, descriptive `<title>` to all routes, including dynamic titles for detail pages (WCAG 2.4.2).
- Added visible focus indicator (`:focus-visible`) to all interactive elements; removed `outline: none` from login inputs (WCAG 2.4.7).
- Added `aria-current="page"` to active navigation links (WCAG 4.1.2).
- Replaced anchor-as-button pattern with semantic `<button>` for the "Acerca de" navbar dropdown trigger (WCAG 4.1.2).
- Added accessible names to all icon-only buttons: search submit, clear, and all pagination controls in the Search view (WCAG 4.1.2).
- Added visually-hidden labels and linked error messages (`aria-describedby`) to all login form fields; added `autocomplete` attributes (WCAG 1.3.5, 3.3.1, 3.3.2).
- Added focus trap (`focusTrap` Svelte action) to SlideOver and ConfirmDelete modals; focus returns to the trigger element on close (WCAG 2.1.2).
- Added `Space` key support alongside `Enter` for keyboard-activated entity section cards (WCAG 2.1.1).
- Added `aria-invalid` and `aria-describedby` to `FlexDateInput` (WCAG 4.1.2).
- Fixed footer link and heading contrast: `#e8d5c4` on `#2c2c2c` (~8:1) replacing `#8e3b23` (~1.86:1) (WCAG 1.4.3).
- Fixed inactive Browse tab label contrast: `#595959` on white (~7.1:1) replacing `#999` (~2.84:1) (WCAG 1.4.3).
- Fixed `btn-outline-secondary` color: `#4d6578` on `#f8f5f2` (~5.7:1) replacing `#5f7a8c` (~4.15:1) (WCAG 1.4.3).
- Added `prefers-reduced-motion` support: disables hero zoom animation, scroll-button bounce, and AOS transitions (WCAG 2.3.3).
- Added `aria-hidden="true"` to all decorative Bootstrap icons across landing, login, and search views (WCAG 1.1.1).
- Added `/Accessibility` route with a Declaration of Accessibility covering conformance status, measures adopted, known limitations, and feedback channel.
- Added GitHub issue template (`accessibility-issue.md`) for structured accessibility barrier reports.
- Added automated WCAG 2.1 AA regression tests with `@axe-core/playwright` covering six main routes (WCAG conformance verification).

---

## [1.0.0] - 2026-03-05

### Backend (`mstdb_manager`)

#### Search
- Replaced Elasticsearch with native PostgreSQL full-text search (GIN indexes + `search_vector` fields on `Lugar`, `Documento`, `Persona`, `Corporacion`)
- Unified global search API with faceted filtering, exact phrase matching, pagination, and entity-type counts

#### API
- New V2 API with authentication and logging endpoints
- Integrated `drf-spectacular` for OpenAPI documentation; deprecated V1 docs removed
- New detail serializers with nested prefetch for `Lugar`, `Persona`, `Documento`, and `Corporacion`
- Added `calidades`, `ocupaciones`, and event fields to enslaved/non-enslaved persona and documento endpoints

#### Infrastructure & Security
- Migrated database backend from MySQL to PostgreSQL
- Dockerized with multi-stage build and `gunicorn` entrypoint
- Whitenoise for static file serving
- Hardened CSRF/session cookie settings via environment variables

---

### Frontend (`mstdb_theme`)

#### Search & Browse
- Unified search store replacing legacy `BrowseView`/`FacetSidebar` components
- Entity-type tabs, control bar, and advanced filter panel with searchable selects
- Column configuration modal per entity type

#### Detail Views
- Revamped persona detail pages (enslaved and non-enslaved): marital status, relations network, trajectory map
- Paginated related personas in documento and lugar detail views

#### New Pages & Visualizations
- Visualization pages: *Mapa de trayectorias*, *Personas por lugar*, *Red de personas*
- New *Archivos* page
- *Memorias Afromexicanas* showcase card

#### UI Polish
- Hero sections with background images across About, Archivos, and Search pages
- Quick-browse row for entity exploration
- Navigation reorganized; dropdown alignment fixes
