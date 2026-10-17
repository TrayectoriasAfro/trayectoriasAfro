# Plan — Fix `ArcsMap` trajectory drift on zoom out/in (mapa-trayectorias)

Follow-up to workstream **C2** of `1792205128254-sabrina-class-feedback-remediation.md`. The earlier C2 attempt (commit `f06ee12`, this repo's `c7619b0`) added resize/visibility re-measure but did **not** fix the reported drift. User report: on `Dashboard/mapa-trayectorias` (`ArcsMap.svelte`) the arcs *are* aligned on load, but after zooming out/in they slide off the place circles (and off the tile map) and never come back until a reload. Repo: `mstdb_theme` (git submodule). Frontend-only fix; no backend/API change.

## Root cause (verified in code + Leaflet 1.9.4 source)

`ArcsMap` caches arc geometry in *layer-point* pixel space keyed only by route + zoom:

- `mstdb_theme/src/routes/(app)/Dashboard/viz/ArcsMap.svelte:358-379` `arcGeometry()` cache key = `` `${routeKey(route)}@${geometryCacheZoom}` `` (`:359`), where `geometryCacheZoom` is a single scalar (`:46`).
- `projectPoint()` (`:353-356`) uses `map.latLngToLayerPoint()`, and in Leaflet `leaflet-src.js:4116-4119` that is `project(latlng, zoom) - map.getPixelOrigin()`.
- `getPixelOrigin()` returns `_pixelOrigin` (`leaflet-src.js:4031-4034`), which is recomputed on every `_move` / `_resetView` (`leaflet-src.js:4337`) from `project(center)` (`_getNewPixelOrigin`, `:4616-4619`). So a cached layer point is only valid for a specific **(zoom, pixel origin = center)** pair.
- `invalidateGeometryCache()` (`:381-386`) only sets `geometryCacheZoom = map.getZoom()` and never clears entries (it only clears when the map grows past 2000). It is called for both `zoomend` and `moveend` (`:294-297`).

Consequence: panning is safe (Leaflet pans by moving the map pane; `_pixelOrigin` is unchanged — `_rawPanBy`, `:4378-4380`), so the cache-hit is still correct. **Zooming is not**: wheel/trackpad zoom uses `setZoomAround`, which changes the map center. When the user zooms back to a zoom level already in the cache, `arcGeometry()` returns the **stale** geometry computed at the old center under key `route@6`, while `layoutSvg()` (`:447-457`) and the markers (`renderMarkers`, `:552-596`, calls `projectPoint` live) use the *current* pixel origin. Arcs/particles are then offset by exactly the center shift; markers stay correct. Because every nearby zoom level eventually has a stale entry, further zooming reuses stale geometry → the drift "never returns to the right position" until remount (cache discarded). `zoomend` alone is not enough because the key collides across visits to the same zoom.

Note: `Search/TrajectoryMap.svelte` recomputes path `d` from live `projectPoint()` on every `updateArcs()` and has no cache (`:138-185`), so it does not have this bug; no change required there (optional `viewreset`/`invalidateSize` parity only).

## Tasks

1. **Make the geometry cache projection-aware** (`ArcsMap.svelte`). Replace the zoom-only cache dimension with one that also captures the pixel origin, so a hit is only possible when the projection is identical:
   - Add a helper, e.g. `function projectionKey() { const o = map.getPixelOrigin(); return `${map.getZoom()}@${o.x},${o.y}`; }`.
   - In `arcGeometry()` use `` const cacheKey = `${routeKey(route)}@${projectionKey()}`; `` and drop the reliance on the scalar `geometryCacheZoom`.
   - Keep the existing 2000-entry bound (drop the oldest vs. `clear()`); on pan the key is unchanged → cache still hit (perf preserved); on zoom/reset the key changes → fresh, correctly-positioned geometry.
   - Optional micro-optimization if per-frame `projectionKey()` cost matters in the particle loop (`drawParticles`, `:694-706`): memoize the current key in a variable refreshed at the start of `renderScene()` and in `invalidateGeometryCache()`. Correctness must not depend on the memo being fresh mid-zoom (the layer has `leaflet-zoom-hide`, so mid-animation frames are hidden anyway).
2. **Replace the scalar with a clear invalidation on view reset**, as belt-and-braces (either is sufficient once task 1 lands, but this also documents intent):
   - Keep `geometryCacheZoom` removal OR, if kept, make `invalidateGeometryCache()` actually clear: `geometryCache.clear()` on `viewreset`/zoom, but **not** on plain pan `moveend` (pan is cache-stable; clearing there would re-introduce the full rebuild on every drag).
   - Preferred wiring: `map.on('viewreset', () => { geometryCache.clear(); renderScene(); })` for the projection reset, and keep `map.on('zoomend moveend')` → `renderScene()` for re-layout. Add the same for the mount `requestAnimationFrame` block (`:318-324`).
3. **Remove now-dead state/comments**: delete/rename `geometryCacheZoom` (`:45-46`) usages (`:359`, `:382`, `:423`) and update the stale comment at `:43-44`/`:381-386` that claims pan offsets alone keep the cache valid.
4. **Guard the particle loop** (`drawParticles` `:694-706`): it reads cached geometry; confirm arcs and particles use the same projection key so they cannot diverge from each other.
5. **CHANGELOG + submodule**: add an `[Unreleased]` entry in `mstdb_theme/CHANGELOG.md` (zoom drift root cause = projection-origin-stale geometry cache). Commit inside `mstdb_theme`, then bump the root submodule pointer.

## Validation

- Build/lint: `cd mstdb_theme && npm run build`; `npx prettier --check` on the touched file (and the `check:svelte`/scan guard if present).
- Manual repro (desktop + trackpad/mobile):
  1. Load `Dashboard/mapa-trayectorias`; leave the cursor **off-center**, wheel-zoom in 2–3 levels, then zoom back out to the original zoom. Arcs and place circles must stay aligned (pre-fix: arcs slide off by the center shift).
  2. Repeat zoom in/out several times at different cursor positions alternating with drag-pan; arcs must stay anchored to their place circles at z4–z8 (tile `maxZoom: 8`).
  3. Confirm markers, arc endpoints, focus tooltip (`onArcFocus`, `:850-860`) and timeline particles all agree.
  4. Confirm panning still does not rebuild geometry unnecessarily (no visible stutter; cache still hits on `moveend` without zoom).
  5. Toggle "Mostrar trayectorias" and scrub the timeline while zoomed — verify no drift is introduced by `renderStyles()` (`:437-445`).

## Risks / notes

- Do not "fix" this by simply calling `geometryCache.clear()` on every `moveend`: that clears on drag-pan too and negates the C1 perf win. Distinguish `viewreset`/zoom (clear) from pan (`moveend`, keep).
- If the fix is applied and arcs *still* misalign on specific routes, then (and only then) fall through to the C2 data path: audit `Lugar` coordinates (`audit_lugar_csv`, null/`0,0`/out-of-bounds, duplicate "Santo Tomé"/"São Tomé") — that would be a data bug (wrong from first load), which is *not* consistent with the current report ("worked at the beginning").
- The attached screenshot (`temp/screenshots/Screenshot 2026-10-16 at 10.05.05 PM.png`) could not be opened by tooling — its filename contains a narrow no-break space (U+202F) before `PM` that the reader path does not resolve (a sibling screenshot with a normal space opened fine). The user confirmed the plan is correct and that the image does not change it. The diagnosis above is from the source and the Leaflet projection math. If the image turns out to show something other than "arcs offset from the still-correct place circles", re-open this plan before implementing.
