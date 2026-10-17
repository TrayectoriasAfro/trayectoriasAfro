# Plan — Sabrina class feedback (Oct 2026): map, 429, refresh, data dictionary, tutorials

Context: new feedback from Sabrina (PI) after a ~12-person class used the public site (desktop + mobile/tablet). This is a **follow-up** to `sabrina-feedback-triage-plan.md`, `1789404209966-afro-bugs-corrections-triage.md` and `1791778279156-student-feedback-fixes.md`; several earlier items (lugar_any OR, ConductaTerm aliases, ArcsMap clickable markers, georeferencing migration `0021`, Redis cache, loadtest throttle bypass) are already done and are **not** re-planned here.

Repos: `mstdb_manager` (Django/DRF, Docker-only, `uv`) and `mstdb_theme` (SvelteKit + D3/Leaflet) are git submodules — commit inside each, then bump the root pointer. Update `CHANGELOG.md [Unreleased]` per workstream.

## Decisions locked with the user

| # | Thread | Decision |
|---|--------|----------|
| 1 | Scope | Cover **all six** threads, triaged. |
| 2 | Translation / vocab language variants | **Deferred.** Extending the alias/synonym pattern to every vocabulary + free-text descriptor is a large refactor; skip translation work for now. Record the finding (below) and answer Sabrina. |
| 3 | Which map | Target **`Dashboard/mapa-trayectorias` (`ArcsMap.svelte`)** primarily (it has the timeline/year-range/circles); also verify the Search-view map (`Search/TrajectoryMap.svelte`). |
| 4 | Variable descriptions (`descripción de variables`) | New **public data-dictionary page + read-only API**. |
| 5 | Tutorial videos | Record to **YouTube (unlisted)**, embed with the existing Tiptap Embed node inside **Lecciones**; add a nav link. |

## Answer to the question this plan was opened for

**Do the DB vocabularies accept language variations? No — not generally.**

- Only `ConductaTerm` (`dbgestor/models.py:399-489`) has `aliases` + accent-insensitive `resolve()`/`match_q()`. It is the sole vocabulary with synonyms, and the seed is only `huído` (`migrations/0020_seed_conducta_terms.py`).
- Every other lookup (`Calidades`, `Etonimos`, `Hispanizaciones`, `EstadoCivil`, `Actividades`, `TipoDocumental`, `SituacionLugar`, `RolEvento`, `TiposInstitucion`, `TipoLugar`) is a single Spanish string; matching is `exact`/`icontains` (**accent-sensitive**), no synonyms, no language column, `descripcion` fields effectively empty.
- `ojos`, `cabello`, `marcas_corporales`, `salud`, `conducta`, `altura` are **free-text** (`models.py:675-694`), filtered by raw `icontains` (`views.py:1648-1657`). So `blue`→`azul`, `branding`→`herrado/carimbo/calimbado/columbado` have nowhere to map; `calimbado` works only as a literal substring.
- Frontend translates only **labels/headers/facet option labels** (Paraglide `labelKey`); result **values** and facet options are raw DB strings (`serializers.py:144-178`, `views.py:1885-1906`). Hence "filters translated, results not", and English terms fail.

→ Interim answer for Sabrina: free-text and vocabulary **search is Spanish-only** (accent-sensitive for everything except `conducta`); the EN toggle changes UI labels, not data values. Variable **descriptions** (workstream D) can still be authored and shown bilingually as documentation even though search stays Spanish.

## Workstream A — Search/date-range "doesn't refresh" (highest priority; deterministic)

Symptom: under **Personas por lugar**, enter a place, change the date range, then changing the dates again does nothing; user must return to landing / re-enter the site.

Root cause (verified):
- `mstdb_theme/src/routes/(app)/Dashboard/viz/PlacePeople.svelte:101-124` `handleYearRangeChange` validates the new bound against the **already-applied** opposite bound (not dataset bounds), then silently `return`s without calling `updateFilteredData()`. A remount (`onMount` `:319-334`) resets the bounds → this is exactly the "go back to landing fixes it" workaround.
- `yearRangeMin = Infinity` / `yearRangeMax = -Infinity` initially (`:22-25`): until data loads, every edit is rejected and the chart stays blank.
- `renderVisualization` returns early on `filteredData.length === 0` (`:141`) leaving the previous SVG/bubbles on screen (looks like "no refresh").

Secondary defects on the Search drill-down path (`Search/…` reached from the chart/lugares):
- `Search/BrowseFilters.svelte:96-107` year inputs are never seeded from active filters (the sync block only writes `''`), so after a drill-down the date fields are blank and Apply is disabled.
- `lib/unified-store.js:72-77` `filtersMatch` uses strict `===`; the year inputs emit **numbers** while URL filters are **strings** → a normal apply fetches twice, and the aborted first fetch clears `isLoading` while the replacement is still in flight (`:300-311`).
- `setFilter`/`setFilters`/`applyUrlState` never refresh the crosstab view (`:506-538`, `:166-169`).

Tasks:
1. `PlacePeople.svelte` — validate against `minYear`/`maxYear` (dataset bounds), always call `updateFilteredData()` on a valid change, clear/blank the chart when a valid change yields 0 rows, and guard the pre-load state (don't reject edits before data arrives). Keep inputs able to widen back to full range.
2. `BrowseFilters.svelte` — seed `yearFrom`/`yearTo` from `currentFilters` (both on mount and when the filter changes); fix `handleClear` to clear the applied filter too.
3. `unified-store.js` — coerce compared values in `filtersMatch` (e.g. `String(a[k]) === String(b[k])`); make the abort handler only clear `isLoading` for a real teardown (check the current controller), not for a superseded request.
4. Decide crosstab refresh: either refresh crosstab in `setFilter/setFilters/applyUrlState` or document that crosstab has its own Apply (recommend refreshing, since filters are shared).
5. QA exact repro: `Dashboard/personas-por-lugar` place + change range twice; and drill-down `→ Search` then change the year range again twice.

## Workstream B — Lugares cards 429

Root cause: an **N+1 HTTP fan-out** on the browsed page, all against the shared `anon 60/min` bucket.
- `Search/cards/LugaresCard.svelte:17-21` fires `Promise.all(relationIds.map(personaLugarRel))` — **one `GET relaciones-lugares/{id}/` per related person, per card, on render**. One Lugares browse load = `1 + Σ len(persona_lugar_rel)` requests and can exceed 60/min on its own.
- Server-side N+1 too: `LugarListSerializer.get_persona_count` (`serializers.py:244-250`) + `get_persona_lugar_rel` (`:252-257`) each run one query **per lugar row**.
- No response caching on `search/`, `lugares/*`, `relaciones-lugares/*` (cache is only on `search/network`, `travel-trajectories/aggregated`, `places-people-distribution`).
- Throttle identification: DRF `anon` keys on `REMOTE_ADDR`/`X-Forwarded-For`; no `NUM_PROXIES` is set. **Verify** how the client IP reaches Django behind Cloudflare + host nginx + frontend nginx; if it collapses (shared bucket), every anon user competes for 60/min.

Tasks:
1. Kill the per-card XHR: batch the related-person data into the **search payload**. In `UnifiedSearchViewSet` (lugar branch) prefetch `Prefetch('p_x_l_pere', queryset=PersonaLugarRel.objects.select_related('documento','situacion_lugar').prefetch_related('personas'), to_attr=…)` and have `LugarListSerializer` expose a `personas_preview` (first N names + `persona_id`/content-type + total) instead of raw relation ids; rewrite `LugaresCard.svelte` to render from the payload (no `Promise.all`).
2. Remove the DB N+1: annotate `persona_count` once for the lugar queryset (mirror the count semantics already used for sorting) and drop `get_persona_lugar_rel`.
3. Verify/repair throttle identity: confirm the effective client IP; if collapsed, add a custom `get_ident` (prefer `CF-Connecting-IP`, then XFF) or set `NUM_PROXIES` on the throttles in `api/throttling.py`/`settings.py`.
4. Consider `cache_visualization` on the lugar list/search (short TTL) and a modest `anon` rate bump; measure first.
5. QA: load Lugares in a fresh anon session; confirm the request count is O(1–2) per page and no 429; click several cards.

## Workstream C — Trajectory map (`ArcsMap.svelte` primary; verify `TrajectoryMap.svelte`)

### C1. Slow load / performance
- Backend `travel-trajectories/aggregated/` (`views.py:2596+`) is a Python loop over all `PersonaEsclavizada` for `include_timeline=1`, cached 600s; `limit_rutas/min_count/bbox` already exist — the frontend must actually send a viewport `bbox` and a sane default limit.
- Frontend `ArcsMap.svelte:346-347` runs a full `renderScene` on **every** reactive dependency change; `computeSeries` (`:114-151`) is O(routes×buckets); `rebuildParticles` (`:534-567`) re-sorts/rebuilds each playhead; and `renderScene` ignores its passed args (`:349`).
- Tasks: narrow reactive triggers so playhead changes only touch particles/markers; memoize `computeSeries` by `(granularity, filters)`; send `bbox` on `moveend` (debounced) so the server returns only relevant routes; keep geometry cache (`:299-327`). Move any residual `<style>` to `custom.css` if touched (AGENTS.md).

### C2. Zoom drift ("trajectories move outside México / to Centroamérica / the sea")
Root cause is **unconfirmed** — treat as diagnostics-first. Candidates already visible in code:
- Both maps re-project only on `zoomend moveend`; **no `resize`/`viewreset`** handler and **no `map.invalidateSize()`** after mount/visibility. Transition the map inside responsive/flex containers can leave a stale pixel origin, offsetting the D3 overlay (`layoutSvg` `:358-368`, `TrajectoryMap` `:116-127`).
- `ArcsMap` geometry cache is keyed by `route+zoom` only (`:300`); `invalidateGeometryCache` sets the zoom but never clears entries (`:322-327`) — confirm layer points are pan-stable in the deployed Leaflet version (they should be), and that `viewreset` doesn't need cache clearing.
- **Wrong `Lugar` coordinates** remain the most likely cause of routes plotted in the sea / Central America; `0021` fixed overseas origins but other rows may still be bad.

Tasks:
1. Reproduce and capture the moving route(s)/places (network tab + which `lugar_id`).
2. Add `map.invalidateSize()` on mount and on `resize`/visibility change; handle `resize` + `viewreset` (invalidate geometry cache); prefer `ResizeObserver` on the container.
3. Run the coordinate integrity check (`audit_lugar_csv` and a quick query for null/`0,0`/out-of-bounds lat/lon, duplicates like "Santo Tomé"/"São Tomé"); fix data and clear the viz cache after data fixes.
4. Re-test zoom in/out at z4–z8 on desktop and tablet for both maps.

### C3. Single-year timeline breaks the map
- `buildBuckets` (`:96-107`) with default `granularity=5` yields **one bucket** for a 1-year range; `startPlaybackTimer` (`:626-636`) then can't advance and instantly sets `playing=false`; the date inputs' `min`/`max` are bound to the current `meta` (`:895-911`), so a narrowed range can't be widened again.
- Date-source mismatch: filters use `Documento.fecha_inicial` (`views.py:2539-2544`) while per-route `years` use leg dates (`views.py:2565, 2736-2747`).
- "Map won't load after changing the range" is consistent with an empty result set (`routes=[]`, `meta.min_year=null` → empty overlay `:1035-1042`) or a stuck timeline state.

Tasks: auto-pick granularity ≤ the selected span (or fall back to 1-year buckets when the span is small); keep at least one animatable bucket while preserving the user's granularity choice; source the input `min`/`max` from the full dataset range (not the filtered `meta`) so ranges can be widened; make an empty result render a clear state; verify `loadData()` never leaves the map without arcs/markers and a recovery path.

### C4. Arc tooltip → "see the associated data" (clicking trajectories)
Clarified: Sabrina means the **arc hover tooltip** (e.g. `Angola → México / Cumulative: 2 / Period: 1750-1754, 0 / Years: 1627-1627`) and wants to click it to see the underlying people. **No trajectories search table is needed** — the data path already exists and only needs to be fixed and made discoverable.

Already implemented (reuse, don't rebuild):
- `GET travel-trajectories/route_detail/?from_lugar_id=&to_lugar_id=` (`views.py:2819-2890`) returns the paginated personas on that from→to route (name, sexo, edad, etnónimos, calidades, hispanización).
- `Search/RouteDetailPanel.svelte` renders that table; both maps open it on arc click (`ArcsMap.svelte:394,768-773,1123-1130`; `Search/TrajectoryMap.svelte:157-159,253-260`). Circles use `PlaceDetailPanel` + `place_detail/` (ArcsMap `:489,779-784,1146-1150`).

Confirmed bug (explains the report): `Search/RouteDetailPanel.svelte:59` calls `m.loading()` but the file **never imports `m`** (only `PlaceDetailPanel.svelte:4` imports it). Since `m` is the Paraglide message function (`import { m } from '$lib/paraglide/messages.js'`), Svelte treats the bare `m` as a global → `ReferenceError` when the modal's loading branch renders, so the arc detail modal fails to open in **both** maps. An audit found **two more** instances of the same bug (§C4 task 1). This class of bug is currently unguarded because `mstdb_theme` has no static analysis (`prettier` only) — hence task 2.

Tasks:
1. Fix the missing `m` import (`import { m } from '$lib/paraglide/messages.js';`) in **all** components that call `m.*` without importing it. Audited (Svelte treats `m` as a global → runtime `ReferenceError` when the branch renders):
   - `Search/RouteDetailPanel.svelte:59` (`m.loading()`) — the arc-detail modal in **both** maps.
   - `lessons/[id]/+page.svelte:22` (`m.lessons_error_mss()`) — public lesson error branch.
   - `User/catalogar/relaciones/+page.svelte:1248` (`m.loading()`) — cataloger relations page.
   (`src/lib/paraglide/runtime.js` also matches a naive scan but is generated — exclude `src/lib/paraglide/**` from any check.)
2. Add a **durable guard** so this cannot recur. Today `mstdb_theme` has only `prettier` (no `svelte-check`, no eslint, no tsconfig), so undefined identifiers like `m` are never caught. Recommend `svelte-check` with a `jsconfig.json` (`checkJs`) plus an npm script (e.g. `check:svelte`) run in CI/local; if the pre-existing warning volume is too high to adopt immediately, add a small targeted scan script (mirroring `scripts/translate.js`) that flags `m.` usage without a paraglide import — and ratchet to `svelte-check` later.
3. Make the tooltip itself an activator: currently it is a passive `<div>` (`ArcsMap.svelte:1043-1050`) shown on hover; add a click affordance (e.g. a "Ver personas" button/link inside the tooltip) that calls `openRouteModal`/`openPlaceModal`, and add pointer/touch handlers so tapping the tooltip works on tablets. Check `custom.css` `.map-tooltip` for `pointer-events` (must not be `none`).
4. Keep/verify the existing keyboard path on arcs/markers (`:768-784`) and focus styles; confirm the modal focus trap/return works.
5. Optional deep-link (do **not** build a trajectories table): a "Ver en búsqueda" link can approximate a route with `trayectoria_lugar=<from>&trayectoria_lugar=<to>` (AND across places). Note it is an approximation (people who touched both places, not necessarily as consecutive legs), so prefer the modal as the primary answer.
6. Verify on desktop + tablet: hover arc → tooltip → click/Enter → modal lists the people; same for a place circle.

### C5. Option to hide trajectories (show only circles)
Neither map has an "arcs on/off" toggle (`TrajectoryMap` toggles **circles**, not arcs; `ArcsMap` has no toggle).

Tasks: add a "Mostrar trayectorias" toggle to `ArcsMap` (both static and timeline modes) that hides `gArcs`/`gArcsHit` while keeping markers; mirror an arcs toggle in `Search/TrajectoryMap.svelte`. Persist in component state; label/aria in both locales.

## Workstream D — Variable descriptions (public data dictionary)

Deliverable: a read-only API + public page describing every variable and its controlled values.

Design (recommend; confirm exact schema at implementation):
- Data source: a small registry. Preferred: a `VariableDefinition` model (`variable_id`, `model`/`scope`, `key`, `tipo`, `descripcion` (ES/EN), `vocabulario` ref, `orden`) editable in Django admin; seeded from the existing content in `deposit/2026-05-08/METADATA_DICTIONARY_ES.md` and `mstdb_manager/docs/msdb_metadata.txt` (re-encode; it is mojibake). Alternative if a model is unwanted: an equivalent read-only Python conf module.
- Endpoint: `GET /api/v2/data-dictionary/` returning variables (by model) + controlled vocabulary terms and their `descripcion` (author the empty `descripcion` fields). Public/anon, cacheable.
- Page: new `(app)/Diccionario/+page.svelte` (+ nav entry), grouped by model, searchable, i18n via Paraglide, WCAG 2.1 AA; styles in `custom.css`.
- Cover at minimum: `Persona`, `PersonaEsclavizada` (incl. `ojos`, `cabello`, `marcas_corporales`, `conducta`, `salud`, `altura`, `edad`+unit), `PersonaLugarRel` (incl. `ordinal`), `Documento`, `Lugar`, `Corporacion`, and the lookup vocabularies.

Note: descriptions are content — the team authors them; the plan provides the place to store and serve them. Translation of values remains deferred (workstream F).

## Workstream E — Tutorial videos

- The `/lessons` route exists (`mstdb_theme/src/routes/(app)/lessons/…`) with the Tiptap editor (`User/catalogar/leccion/…`) whose Embed node already auto-detects YouTube (nocookie) — use it; **no new infra/storage**.
- Tasks: add a nav entry for Lecciones (currently unlinked in `+layout.svelte:141-169`; Sabrina suggests "Archivos · Visualizaciones · Lecciones") or a dedicated "Tutoriales" lesson; create the lesson, embed the unlisted YouTube videos; verify the embed renders in the public lesson view (Tiptap content sanitizer allow-list) and that frameborders work (no CSP in `mstdb_theme/nginx.conf`; confirm host/Cloudflare doesn't block `youtube-nocookie.com`).
- Reply to Sabrina with the exact URL(s) and upload guidance (unlisted, embed via "Insertar/Embed" in the lesson editor).

## Workstream F — Translation / language variants (DEFERRED)

Do **not** implement now (decision #2). Record in `docs/architecture.md` and answer Sabrina with the finding above. When resumed, the shape is: (a) a display-translation layer for controlled-vocabulary values + facet options, and (b) a synonym/alias layer for lookups and free-text descriptors (generalizing `ConductaTerm`). Leave a pointer in `CHANGELOG.md`/open-questions so it is not lost.

## Cross-cutting

- i18n: new strings go in `messages/es.json` + `en.json` as natural language with `{param}` only (never JS/ternaries); use `getLocale()` for formatting; localize `aria-label`/`alt`; translate static arrays via reactive `$:` declarations.
- Styles: no component-scoped `<style>`; use `custom.css`/`custom.scss`.
- A11y (WCAG 2.1 AA): full keyboard operability, visible focus, semantic roles/ARIA, contrast, `role=status/alert`, `prefers-reduced-motion`.
- Docker/uv: backend deps via `uv add` + `uv.lock`, rebuild `web`; run migrations inside the container.
- Submodules: commit per submodule, then bump root pointers; `CHANGELOG.md [Unreleased]` per workstream.

## Suggested order

1. Quick wins: **C4.1–C4.2** (fix the three missing-`m`-import components — restores the arc-detail modal and two other broken branches — and add the static-check guard), **A** (deterministic, user-visible, cheap), **B1–B2** (429 fan-out + DB N+1).
2. **B3** throttle-identity verification; **C3/C5** (single-year fix + toggle); **C4.3–C4.6** (clickable tooltip, touch/keyboard QA).
3. **C1** perf; **C2** zoom-drift diagnostics + coordinate data fix.
4. **D** data dictionary; **E** tutorials; **F** documented as deferred.

## Validation summary

- Backend: `python manage.py check`; `search/?type=lugar` payload carries `personas_preview`; `relaciones-lugares` no longer hammered; `data-dictionary/` returns variables + vocab descriptions; throttle identity verified (distinct keys per client).
- Frontend: `cd mstdb_theme && npm run build`; `npx prettier --check` on touched files. After C4.2 lands, also run the new static check (`npm run check:svelte` or the scan script) and confirm it reports 0 missing-`m`/undefined-identifier findings on `src/`.
- Manual QA (desktop + tablet): (A) two sequential date-range edits under Personas por lugar and in Search drill-down; (B) Lugares browse + card clicks → no 429, request count O(1–2); (C) zoom in/out z4–z8 → arcs stay anchored, one-year range animates/loads, arc tooltip click opens the people modal (route + place), hide-trajectories toggle works; (D) dictionary page renders and is keyboard-navigable; (E) tutorial lesson plays embedded video.

## Risks / open questions

- **C2 zoom drift**: root cause unconfirmed — may be data (bad coordinates) rather than code; do not promise a code-only fix until reproduced.
- **B** throttle: confirm the real client-IP path (Cloudflare → host nginx → frontend nginx → Django) before changing `get_ident`; a wrong assumption could either keep everyone rate-limited or weaken protection.
- **D** variable descriptions are content-heavy; scope of which variables/values to document and who authors them is a team decision.
- **F** resume trigger: revisit alias/translation only after a team decision on taxonomy (which vocabularies, English alias curation source, and whether free-text descriptors get a synonym table).
- Resolved (was an open question): Sabrina's "thumbnail per place" = the **arc hover tooltip** (not an image; no image/thumbnail source exists in the data). The tooltip already carries route/place data, and clicking should open the existing route/place detail modal — see C4. The `RouteDetailPanel` missing-`m`-import bug is the concrete blocker.
