# Plan — Fix arcs "cut off" after zoom in/out (Dashboard → mapa-trayectorias)

Follow-up to the zoom-drift fix (`mstdb_theme` commit `8e4f310`, root pointer already at it). Drift is fixed, but the user now reports that after zooming, **arc/line strokes get visibly cut** (`temp/screenshots/Screenshot-lines-cutted.png`). Frontend-only, `mstdb_theme` (submodule). No backend/API change. Goal: keep scroll-wheel zoom (the familiar behavior) and remove the cut, instead of falling back to button-controlled zoom.

## Root cause (verified against the source + Leaflet 1.9.4 CSS)

The D3 overlay `<svg>` is sized to **exactly** the map viewport, and an SVG element clips its own content to that box (default `overflow: hidden`; Leaflet does not override it — confirmed in `leaflet@1.9.4/dist/leaflet.css`: only `.leaflet-container { overflow: hidden }` is set, plus `max-width/max-height:none` on the overlay svg).

- `mstdb_theme/src/routes/(app)/Dashboard/viz/ArcsMap.svelte:457-467` `layoutSvg()` sets the svg `width`/`height` to `bottomRight - topLeft` (the map bounds) and positions it at `topLeft`, with `gRoot` translated by `-topLeft`.
- Layer point `(0,0)` corresponds to the container's top-left, so the svg box ≈ the visible map rectangle. Any arc whose endpoint is off-screen is therefore **clipped at the viewport rectangle** instead of running to the map edge.
- On initial load (zoom 6, centered on Mexico) most endpoints are on-screen → no visible cut. Zooming in/out moves place endpoints off-screen → arcs are cut "sometimes", exactly as reported.

This is the classic D3+Leaflet overlay limitation; the standard remedy is to make the overlay larger than the viewport so the browser's own clipping happens off-screen, while the Leaflet container (`.leaflet-container { overflow: hidden }`) does the final, clean clip at the map edge.

## Tasks

1. **Pad the overlay svg beyond the map bounds** — `ArcsMap.svelte` `layoutSvg()` (`:457-467`). Keep the layer-point mapping identical; only enlarge the box:
   ```js
   const PAD = 200; // px beyond the viewport on every side
   const bounds = map.getBounds();
   const topLeft = map.latLngToLayerPoint(bounds.getNorthWest()).subtract([PAD, PAD]);
   const bottomRight = map.latLngToLayerPoint(bounds.getSouthEast()).add([PAD, PAD]);
   svg
     .attr('width', bottomRight.x - topLeft.x)
     .attr('height', bottomRight.y - topLeft.y)
     .style('left', `${topLeft.x}px`)
     .style('top', `${topLeft.y}px`);
   gRoot.attr('transform', `translate(${-topLeft.x},${-topLeft.y})`);
   ```
   `L.Point.subtract/add` accept `[x, y]` and return a new point, so the rest of the pipeline (including `projectPoint`/`arcGeometry`, which stay in un-padded layer space) is untouched. A fixed pixel pad is sufficient: it only needs to push the svg's clip boundary outside the container, since arcs farther off-screen are clipped by the container edge anyway.
2. **Belt-and-braces: never self-clip** — at svg creation (`:288`) add `.style('overflow', 'visible')` so the overlay can never clip its own content regardless of box size. The container still clips at the map edge (and `#map`'s `border-radius` still rounds the corners); `leaflet-interactive` pointer events outside the container remain clipped by `.leaflet-container`.
3. **Keep the existing re-layout wiring** — `zoomend`/`viewreset`/`moveend`/`resize` and the mount `rAF` already call `renderScene()` → `layoutSvg()` with fresh `getSize()`/`getBounds()`, so the padded box is recomputed on every projection change. No change needed; do not move padding into a cached/keyed value.
4. **Parity (optional, recommended)** — `mstdb_theme/src/routes/(app)/Search/TrajectoryMap.svelte` `updateArcs()` (`:138-149`) uses the identical exact-bounds sizing and has the same clip. Apply the same pad there. The two `Detail/{personaesclavizada,personanoesclavizada}/[id]` and `User/trayectoria` maps share the pattern; treat those as a separate follow-up (not part of this fix).
5. **CHANGELOG + commit** — add an `[Unreleased]` → `### Frontend (mstdb_theme)` entry in root `CHANGELOG.md` (arcs were clipped at the overlay viewport rectangle after zoom; overlay svg is now padded/overflow-visible so arcs run to the map edge). Commit inside `mstdb_theme` (style matching `8e4f310`), then bump the root submodule pointer.

## Validation

- `cd mstdb_theme && npx prettier --check src/routes/'(app)'/Dashboard/viz/ArcsMap.svelte` and `npm run build`.
- Manual repro on `Dashboard/mapa-trayectorias`:
  1. Wheel-zoom in until some place markers leave the viewport; arcs to those places must now run **continuously to the map edge** (clipped only at the edge), not cut at an internal rectangle.
  2. Zoom in/out several times off-center and pan; arcs stay anchored to their place circles (drift remains fixed) and no internal cuts appear at z4–z8.
  3. Wheel-zoom out fully: arcs may still exit the viewport, but always at the container edge.
  4. Toggle "Mostrar trayectorias" and scrub the timeline while zoomed; particles and arcs stay consistent.
  5. Confirm interaction/a11y unaffected: hover/focus tooltips and arc/place click→modal still work, including near the edges; the map's rounded corners are still clean.

## Risks / notes

- If arcs are **still** cut after padding/`overflow: visible`, the diagnosis is wrong (the cut would not be overlay-box clipping) — next resort is the user's fallback: constrain zoom to discrete button/`+`/`-` levels, or move the overlay to a canvas layer.
- Do not put `overflow: visible` on `#map`/`.leaflet-container`; that would let the overlay spill outside the card.
- Padding grows the svg element modestly; per-frame cost is unchanged (same path count, and the particle loop is cached Bézier math).
- Zoom-drift behavior from `8e4f310` must not regress: padding only changes the svg box, not the projection key or cache logic.
