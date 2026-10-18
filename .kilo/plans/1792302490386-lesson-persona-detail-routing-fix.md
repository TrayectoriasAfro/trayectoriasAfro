# Fix: Lesson Detail Persona Links Route to Wrong Detail Type (404)

## Problem
`mstdb_theme/src/routes/(app)/lessons/[id]/+page.svelte` lines 31-35 (`personaDetailPath`) routes some enslaved personas to `/Detail/personanoesclavizada/<id>` → 404. Reported: `lessons/5` → P7969 (personaesclavizada) → `/Detail/personanoesclavizada/7969` → 404.

## Root cause (confirmed in code)
- `LeccionDetailSerializer.personas` uses `PersonaReferenceSerializer` (`mstdb_manager/api/v2/serializers.py:33-39`), which returns: `persona_id`, `persona_idno`, `nombre_normalizado`, `polymorphic_ctype`, `persona_type`.
- `polymorphic_ctype` is a FK serialized by default as a numeric PK (content-type id). The Svelte helper checks `ct === 25 || ct.includes('esclavizada')`. The hardcoded `25` is environment-specific (content-type IDs differ per DB), and a numeric PK has no `.includes`, so the check silently falls through to `'personanoesclavizada'` for every persona whose ctype id ≠ 25.
- The stable discriminator `persona_type` (`'esclavizada'` | `'noesclavizada'`, from `Persona.persona_type`, `dbgestor/models.py:622-627`) is already in the payload but ignored by the frontend.

Precedent: `Detail/documento/[id]/+page.svelte:58` already routes via `persona.persona_model === 'personaesclavizada'`, and `PersonaListSerializer.get_persona_model` documents "content-type IDs differ between environments" (`serializers.py:109-111`).

## Plan
1. **Frontend fix** — `mstdb_theme/src/routes/(app)/lessons/[id]/+page.svelte`, `personaDetailPath(persona)`:
   - Primary: use `persona.persona_type === 'esclavizada' ? 'personaesclavizada' : 'personanoesclavizada'`.
   - Keep `polymorphic_ctype` string check as fallback only (for stale/cached payloads): `typeof ct === 'string' && /esclavizada/i.test(ct) && !/no.?esclavizada/i.test(ct)` — note naive `includes('esclavizada')` also matches `'noesclavizada'`, so the negation matters.
   - Remove the hardcoded `ct === 25` comparison.
   - No backend change needed (`persona_type` already serialized).
2. **Check for the same bug pattern** in sibling helpers that branch on `polymorphic_ctype` numeric id:
   - `Detail/lugar/[id]/+page.svelte:134-136` (same `ct === 25`-style logic — verify and fix identically).
   - `PlaceDetailPanel.svelte:122`, `RouteDetailPanel.svelte:82`, `NetworkGraph.svelte:149` hardcode `/Detail/personaesclavizada/` — verify whether those lists are esclavizada-only by construction or need the same discriminator.
3. **Validation**
   - `GET /api/v2/lecciones/5/` → confirm `personas[0]` has `persona_type: 'esclavizada'`.
   - Load `/lessons/5`, inspect persona chip href for P7969 → expect `/Detail/personaesclavizada/7969`; click through → 200, not 404.
   - Spot-check a lesson containing a non-enslaved persona → still routes to `/Detail/personanoesclavizada/<id>`.
   - Run frontend lint/typecheck per project tooling.
4. **Changelog**: add entry under `[Unreleased]` in `CHANGELOG.md` per AGENTS.md.

## Out of scope
- Backend serializer changes; unifying all Detail routes to a single polymorphic route; changing `persona_type` values.

## Risks
- Cached API responses without `persona_type` (very old cache): mitigated by keeping the string-ctype fallback.
- `Detail/personaesclavizada/[id]` 404s for other reasons (unpublished record, wrong id space): verify P7969 loads directly before attributing to routing.
