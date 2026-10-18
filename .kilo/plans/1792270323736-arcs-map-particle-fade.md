# Plan: Fade out trajectory movement dots when the animation is not playing

## Goal

In the Dashboard **Map of trajectories** (`ArcsMap.svelte`), the animated movement dots (`circle.map-particle`) must only be visible while the timeline is **playing**. When playback is paused or reaches the end, the dots fade out and are removed. On play/resume they fade back in. This fixes the bug where frozen dots detach from their arcs on zoom-out after pause.

## Context / Root cause

- Particle positions are only written inside the rAF loop `drawParticles()` (`mstdb_theme/src/routes/(app)/Dashboard/viz/ArcsMap.svelte:722`), which runs only while `playing` (`:700`).
- On pause/end the loop stops, but `rebuildParticles`/`syncParticleDom` (`:650`, `:685`) still keep the `<circle>` nodes with their stale `cx`/`cy`.
- On zoom, `geometryCache.clear()` + `renderScene()` re-project the arcs and re-join the particle DOM, but positions are never recomputed, so the frozen dots detach from the re-projected arcs (the reported screenshots).
- Only `ArcsMap.svelte` has particles; `Search/TrajectoryMap.svelte` does not, so no change there.

## Decisions (agreed)

- **Paused:** dots fade out (~220 ms) and are removed. Dots are an animation artifact only.
- **Ended (playhead at last bucket, not playing):** dots disappear (firm requirement).
- **Resume:** dots fade back in and animate.
- **Reduced motion:** unchanged — no dots ever (`prefersReducedMotion`).
- Rough phase (t) continuity across resume is out of scope: dots are only indicative and the fade hides any phase jump.

## Implementation (single file: `ArcsMap.svelte`)

1. **Constant:** near the other constants (`:16`–`:18`) add `const PARTICLE_FADE_MS = 220;`.

2. **`rebuildParticles()` (`:650`)** — add `|| !playing` to the early-return guard so a scrub while paused also clears particles:
   ```js
   if (mode !== 'timeline' || prefersReducedMotion || !playing) {
     particles = [];
     syncParticleDom();
     return;
   }
   ```
   (Everything else in the function stays.)

3. **`syncParticleDom()` (`:685`)** — make it fade in/out instead of hard add/remove:
   - `.exit()` → `interrupt('particle-fade')` then `transition('particle-fade').duration(PARTICLE_FADE_MS).style('opacity', 0).remove()`.
   - `.enter().append('circle')` keeps current attrs (`class`, `r`, `fill`, `stroke`, `stroke-width`) and starts at `style('opacity', 0)`.
   - `enter.merge(sel)` → `interrupt('particle-fade')` then `transition('particle-fade').duration(PARTICLE_FADE_MS).style('opacity', 1)`.
   - Use a named transition (`'particle-fade'`) so a resume during the fade cancels the pending `.remove()`.

4. **Reactive playing gate (`:700`–`:704`)** — rebuild on both branches:
   ```js
   $: if (browser && playing && mode === 'timeline' && !prefersReducedMotion && showArcs) {
     rebuildParticles();
     startParticleLoop();
   } else {
     stopParticleLoop();
     rebuildParticles();
   }
   ```
   The `else` branch now empties the list → `syncParticleDom` fades the dots out for pause, end, `mode` change, `showArcs` off, and reduced motion.

## Notes / risks

- `syncParticleDom` runs on every playhead change while playing; the extra no-op transitions on the merged selection (~≤80 nodes) are cheap.
- `.remove()` is registered on the named transition's end; `interrupt('particle-fade')` on resume cancels it, so quickly pausing then resuming does not strand opacity-0 nodes.
- No ARIA change: particles are decorative and already non-focusable.
- No CSS change; opacity is applied inline.

## Validation

- `cd mstdb_theme && npm run lint` (prettier check).
- Manual (dev server → Dashboard → Map of trajectories):
  1. Play → dots animate along arcs.
  2. Pause mid-timeline → dots fade out within ~220 ms, none remain.
  3. Resume → dots fade in and animate.
  4. Let playback reach the last bucket → dots disappear automatically.
  5. Pause, then zoom in/out → no frozen/detached dots.
  6. Toggle "Mostrar trayectorias" off then on (while playing) → dots hide and return.
  7. Enable OS reduced-motion → no dots.
- No component tests exist for this map; an automated regression test needs a live Leaflet map + mocked data and is out of scope.

## Changelog

Add one bullet under `## [Unreleased]` → `### Frontend (mstdb_theme)` in `CHANGELOG.md` describing the fix (dots now fade out when the timeline is paused or ends and are removed, so they no longer drift off their arcs on zoom).

## Out of scope

- Re-attaching frozen dots on zoom (the discarded Option 2), since dots no longer persist when paused.
- Phase/t continuity across resume; any change to `Search/TrajectoryMap.svelte`.
