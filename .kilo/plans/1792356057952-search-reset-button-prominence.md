# Full Search Reset Button (BrowseFilters + global query)

## Goal
Single prominent "reset all" control in the main search sidebar that clears BOTH the sidebar filters AND the global search query. Resolves the PI complaint: today reset takes two separate actions that users miss, so "queda cargada la búsqueda anterior y se traba".

## Context (verified in code)
- `BrowseFilters.svelte:129-133`: `Limpiar (N)` link button, only visible when `activeCount > 0`, calls `handleClear()` → `clearFilters(entityType)` (single tab's filters only) + resets local year inputs.
- `unified-store.js:618-631` `clearSearch()`: clears global `query`/`exactSearch` + pagination, but does NOT touch `tabs[*].filters`.
- `unified-store.js:551-561` `clearFilters(entityType)`: clears one tab's filters only, keeps query.
- `+page.svelte:96-99` `handleClearSearch()` (hero `[x]`): sets local `query=''` + `clearSearch()` — filters persist. This is the trap: user clears the search bar, filters stay applied, results still constrained, looks "stuck".
- Each function calls `updateUrl` + `fetchResults` separately — a combined reset must avoid double fetch/double URL write.

## Scope / Non-goals
- IN: prominent always-visible reset in `BrowseFilters.svelte` header; new or extended store action clearing active-tab filters + global query in one update, one URL write, one fetch.
- OUT: cross-tab filter reset (other tabs keep filters — tab switch preserves context by design), column config / sort / page-size reset, URL-persistence redesign.

## Plan
1. `unified-store.js`: add `resetSearchAndFilters(entityType)` (name TBD by implementer):
   - Single `unifiedStore.update`: `query: ''`, `exactSearch: false`, `typeCounts: {}`, active tab `filters: {}`, `currentPage: 1`, clear active-tab results/counters (mirror `clearSearch` lines 619-624 + `clearFilters` line 556 for the active tab only).
   - One `updateUrl({ push: true })` + one `fetchResults(entityType)`.
   - Abort in-flight fetch for the tab first (reuse `abortPrevious` pattern) to avoid stale results overwriting the reset.
2. `BrowseFilters.svelte` header (lines 127-134):
   - Button always rendered (remove `{#if activeCount > 0}` gate); `disabled` when `activeCount === 0 && !$unifiedStore.query`.
   - Prominent style: `btn btn-sm btn-outline-secondary w-100` (or header-aligned outline button) with `bi-x-circle me-1` icon + `m.conf_browse_clear({count})` label; keep reactive count.
   - `handleClear`: call new store action + reset local `yearFrom/yearTo/yearDirty`; also notify parent to clear hero input — hero `query` is local state in `+page.svelte` synced via `syncQueryInputs($unifiedStore.query, ...)` (lines 63-74), so clearing store query propagates automatically unless the hero input is focused; verify this edge (focused input keeps typing — acceptable, document it).
3. i18n: reuse `conf_browse_clear`; if "0" count string reads oddly when only query is active, accept it (no new keys — keeps paraglide pipeline untouched).
4. Styles: Bootstrap utilities only, no new CSS (AGENTS.md §5).

## Validation
- `npm run check` in `mstdb_theme`.
- Manual: (a) query + filters set → click reset → hero input clears, filters clear, URL drops `q`+filter params, results refresh unfiltered; (b) only query → button enabled, clears it; (c) clean state → button disabled; (d) locale switch still renders label; (e) Tab/Enter/Space operability, visible focus.
- Edge: reset while fetch in-flight → no stale overwrite; reset with hero input focused → store clears, input syncs on blur/next tick (acceptable).

## Risks / Notes
- Other tabs' filters intentionally preserved; if PIs expect cross-tab wipe, that's a follow-up decision.
- "Se traba" could also involve store persistence across visits — if reports persist after this, investigate separately.

## Open questions
- None; ready to implement.
