# Fix: Search tab badge desyncs from the actual result count

## Goal
Make the entity-tab badges on `/Search/` (`badge ms-1`) always show the number of rows the
current query + sidebar/form filters actually return, for **every** tab. Never show a global,
unfiltered, stale, or blank value when a count is known; show `0` when the filtered result set is
empty, and an hourglass only while a count is genuinely unknown/loading.

## Root cause (verified)
The badge picks between three independent, independently-updated sources in
`mstdb_theme/src/routes/(app)/Search/+page.svelte:86-100` (`badgeCount`):

1. `counts` — global DB totals from the separate `counts/` endpoint (`loadCounts()`), e.g.
   `personaesclavizada ≈ 5,510`. This is the source of the reported `5,485`.
2. `typeCounts` — returned by `search/`, used for the fallback and non-active tabs.
3. `$unifiedStore.tabs[et].totalResults` — the active tab's filtered count (`data.count`).

Two defects combine:

- **Backend (`mstdb_manager/api/v2/views.py:2063-2067`)**: `typeCounts` is computed from the
  FTS/browse base querysets **before** sidebar/form filters are applied, and in browse mode it
  only covers `active_types` (one key). Verified live against
  `https://db.trayectoriasafro.org/api/v2/`:
  - `search/?type=personaesclavizada&q=maria&sexo=Hombre` → `count: 0` but
    `typeCounts.personaesclavizada: 660` (unfiltered).
  - Browse (no `q`) → `typeCounts` is the full-table count regardless of filters.
- **Frontend**: `badgeCount` uses truthiness (`> 0`) to decide the source, which conflates
  "loading", "not yet loaded", and "genuinely zero". It therefore falls back to the global
  `counts`/unfiltered `typeCounts` (→ `5,485`) or renders `0`/`''` (badge disappears). Because
  `performSearch`/`clearSearch` reset `totalResults` to `0` but do **not** reset `typeCounts`,
  the stale global value is displayed while the real query is in flight.

Decision (confirmed with user): every tab badge reflects the current query **and** filters — i.e.
the single source of truth is the server-computed, filter-aware `typeCounts` map.

## Affected files
- `mstdb_manager/api/v2/views.py` — `SearchAPIView.get` (type-count computation).
- `mstdb_manager/api/v2/tests/` — new test.
- `mstdb_theme/src/routes/(app)/Search/+page.svelte` — badge derivation + template.
- `mstdb_theme/src/lib/unified-store.js` — `typeCounts` lifecycle.
- `mstdb_theme/src/lib/` — optional pure helper + vitest unit test.
- `CHANGELOG.md` (repo root) — `[Unreleased]` entry.

## Implementation tasks

### 1. Backend: make `typeCounts` filter-aware for all types
In `SearchAPIView.get`, replace the type-count block (`views.py:2063-2067`) with a loop that
applies the same filter pipeline used for results, for **all** `TYPE_CONFIGS` keys:

```python
# Counts must match what each tab's table would show, so apply the
# same filters used for the active result set to every entity type.
type_counts = {}
for tk in self.TYPE_CONFIGS:
    qs = base_querysets[tk]
    if has_filters:
        qs = self._apply_filters(qs, tk, filters)
    qs = self._apply_form_filters(qs, tk, request)
    if search_text:
        qs = self._apply_simple_search(qs, tk, search_text)
    type_counts[tk] = qs.count()
```

Notes:
- `base_querysets` is populated for every type in both search and browse modes
  (`views.py:2026-2034`), so iterating `self.TYPE_CONFIGS` is safe.
- `_apply_filters` (1539), `_apply_form_filters` (1591) and `_apply_simple_search` (1699) are
  already type-aware and guard with `p.get(...)`, so they are safe to call for non-active types.
- Keep `facets` (`views.py:2059-2061`) computed from the **unfiltered** base querysets — facet
  option lists should not shrink as the user narrows filters. Do not change facets.
- Guarantee `type_counts[active_type] == total_count` for single-type requests (same annotations +
  same filters ⇒ same `.count()`).
- Leave the multi-type in-memory branch and its `cap=500` unchanged; it is not used by the UI
  (frontend always sends `type=<one>`). Document that `type=all` badges may not equal `count`
  there.

### 2. Frontend: single source of truth for badges
`mstdb_theme/src/lib/unified-store.js`:
- In `fetchResults` (`unified-store.js:268-283`) set `typeCounts: data.typeCounts || {}` (replace,
  not merge) so removed keys never linger.
- In `performSearch` (`:585-598`) and `clearSearch` (`:603-616`), reset `typeCounts: {}` alongside
  the per-tab reset, so a new query never displays the previous context's badges.
- Optionally add `typeCountsLoading: true|false` toggled around the fetch so non-active tabs can
  show the hourglass while a new context loads. (Acceptable alternative: key off
  `tabs[activeTab].isLoading` only.)

`mstdb_theme/src/routes/(app)/Search/+page.svelte`:
- Remove the now-unused `loadCounts` import (`:12`) and its `onMount` call (`:102-105`); remove the
  `counts` reactive declaration (`:80`). `loadCounts` stays in the store for the landing page.
- Replace `badgeCount` (`:86-100`) with a filter-aware map read only:
  ```js
  function badgeCount(entityType) {
      const c = typeCounts[entityType];
      return typeof c === 'number' ? c : '';
  }
  ```
- Update the badge markup (`:260-268`) so a known `0` renders (currently hidden) and the hourglass
  shows only while the count is unknown:
  ```svelte
  {@const badge = badgeCount(et)}
  {#if badge !== ''}
      <span class="badge ms-1" class:bg-primary={activeTab === et}
            class:bg-secondary={activeTab !== et}>{badge.toLocaleString()}</span>
  {:else if $unifiedStore.tabs[et]?.isLoading || $unifiedStore.typeCountsLoading}
      <span class="badge bg-secondary ms-1"><i class="bi bi-hourglass-split"></i></span>
  {/if}
  ```

### 3. Frontend: extract a testable helper (recommended)
- Add `mstdb_theme/src/lib/searchBadges.js` exporting a pure `tabBadge(typeCounts, entityType)`
  (returns number or `''`), and use it from `+page.svelte`.
- Add `mstdb_theme/src/lib/searchBadges.test.js` (vitest, mirroring `searchUrl.test.js`) covering:
  number passthrough, `0` → `0`, `undefined`/`{}` → `''`, and no cross-type leakage.

### 4. Tests
- Backend: add `mstdb_manager/api/v2/tests/test_search_type_counts.py` (DRF `APITestCase`, follow
  the style of `test_trajectories_aggregated.py`; use `APIPerm`-permitted credentials as in
  `test_leccion_permissions.py`):
  - Browse with a filter: `typeCounts[active] == count` and all 5 keys present.
  - Search with a narrowing filter (e.g. `q` + `sexo`): `typeCounts[active] == count`, and
    `typeCounts[active] < typeCounts` for the same request without the filter.
- Frontend: `npm run test:unit` for the new helper.

## Data flow (after fix)
`/Search/` → `fetchResults(activeTab)` → `GET search/?type=<active>&q&page_size&<filters>` →
response `{ count, typeCounts: {all 5 types, filtered} }` → store `tabs[active].totalResults = count`
and `unifiedStore.typeCounts = typeCounts` → every tab badge reads `typeCounts[et]`, so
`typeCounts[active] === totalResults === count` and non-active badges match what their tables would
show with the same filters.

## Failure modes / edge cases
- **Zero results**: badge shows `0` (matches pagination showing 0).
- **Loading new query/filter**: `typeCounts` reset on new query ⇒ hourglass, never a stale global.
- **`type=all`** (unused by UI): `typeCounts` are accurate `.count()`s but the merged `count` is
  capped; documented as out of scope.
- **Filters invalid for a type**: handled by type-aware `_apply_form_filters`/`_apply_filters`.
- **Performance**: 5 `.count()` queries per request instead of ~1. Verify p95 latency on the
  low-traffic window; add a cache later only if needed.

## Validation
1. Backend unit tests (above) via the project's Django test runner.
2. `npm run test:unit` and `npm run lint` in `mstdb_theme`.
3. Manual/API checks against a local or staging backend:
   - `search/?type=personaesclavizada&q=maria` → badge active tab `=== count`, all 5 tab badges
     populated.
   - `search/?type=personaesclavizada&q=maria&sexo=Hombre` → active badge `0`, not `660`/`5,485`.
   - Browse + a sidebar filter → active badge equals the filtered row count.
   - Confirm the badge never matches the global `counts/` value unless the filter set genuinely
     yields the full table.

## Out of scope
- Facet option lists stay unfiltered (intentional).
- `type=all` merged-mode count semantics.
- `browse-store.js` / `search-store.js` / `searchFull-store.js` (dead/legacy paths) are not touched.

## Rollout
No schema or data migration. Deploy backend first (or together) so the frontend's `typeCounts`
reads receive filter-aware counts; the frontend degrades gracefully (hourglass/blank) if it lands
first. No API contract change beyond corrected values in an existing field.
