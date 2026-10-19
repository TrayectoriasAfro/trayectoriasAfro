# Age Unit Localization Fix (Personas Esclavizadas / No Esclavizadas)

## Diagnosis verdict
Prior diagnosis CONFIRMED against code:
- `mstdb_manager/api/v2/serializers.py:145` (list) and `:433` (detail) serialize `unidad_temporal_edad` via `get_unidad_temporal_edad_display` → always Spanish (`años/meses/días`) under `LANGUAGE_CODE='es-mx'`. Non-null rows render verbatim.
- `mstdb_theme/src/conf/columns.js:550`: `row.unidad_temporal_edad || m.conf_unit_anios()` — NULL-unit rows (incl. P136, P8457) fall back to localized Paraglide key → "years" in EN UI. Stored-unit rows show Spanish. Hence the mix.
- `Detail/personaesclavizada/[id]/+page.svelte:639` and `Detail/personanoesclavizada/[id]/+page.svelte:535`: `{edad} {unidad || 'años'}` — hardcoded Spanish fallback, so NULL rows always show "años" on detail regardless of locale.
- Model codes (`dbgestor/models.py:716-724`): `d/m/a` + null; PersonaNoEsclavizada shares the same field (migration 0001 line 640). Same fix applies to both tabs.
- Out of scope per user: v1 serializers, card components, Django `Detail/personaesclavizada.html:46`.

## Goal
All age units localize fully in EN/ES UI on: search table (both persona tabs) + both Svelte detail pages. Raw codes cross the API; display strings resolve in frontend via Paraglide.

## Constraints
- ES + EN only (PT/DE deferred).
- Paraglide keys = natural language + `{param}` placeholders only, no JS logic in JSON.
- Svelte reactive translation: derive display strings with `$:` so locale switches update live.
- `aria-label`/alt localization where touched; no component-scoped `<style>` (use custom.css if needed — not expected).
- Update CHANGELOG.md `[Unreleased]`.
- PersonaNoEsclavizada detail serializer path: verify whether it inherits the display-string field or raw field before editing (check v2 serializers around PersonaNoEsclavizada + v2 views for which serializer serves `/Detail/personanoesclavizada/`).

## Plan
1. **Backend (v2 only): serialize raw code.**
   - In `api/v2/serializers.py`, change `unidad_temporal_edad` on `PersonaEsclavizadaListSerializer` (:145), `PersonaEsclavizadaDetailSerializer` (:433), and the PersonaNoEsclavizada equivalent (locate first) from `CharField(source='get_..._display')` to plain model field (remove override or use `CharField(read_only=True)` without source). Result: API returns `a/m/d/null`.
   - Check `documents.py:255` (search index TextField on raw attr) and v2 search/list views: confirm they pass through serializer output or need no change; do NOT alter index mapping.
   - Regression check: `api/v2/crosstab.py:560-564` filters on raw codes (`'a'`/null) — unaffected. `export_deposit.py:156` uses model attr directly — unaffected.
   - Validate: `pytest mstdb_manager/api` (or repo's backend test cmd) + manual GET list/detail shows `a/m/d/null`.
2. **Paraglide keys (ES+EN).**
   - Add three unit keys, e.g. `unit_days`/`unit_months`/`unit_years`: es `días/meses/años`, en `days/months/years`. Keep existing `conf_unit_anios` untouched (used by ArcsMap viz).
   - Files: `mstdb_theme/messages/es.json`, `messages/en.json` (~line 312).
3. **Frontend helper + table.**
   - Add small mapper (e.g. in `src/conf/columns.js` or shared util): code `a→years`, `m→months`, `d→days`, `null/unknown→years` (preserve current NULL-means-years convention). Must be reactive (called during render so `m.*()` re-evaluates on locale change).
   - Replace `columns.js:550` fallback with mapper.
4. **Detail pages (2).**
   - `Detail/personaesclavizada/[id]/+page.svelte:639`, `Detail/personanoesclavizada/[id]/+page.svelte:535`: replace `{unidad || 'años'}` with `$: ageUnit = mapUnit(...)` reactive display.
5. **Validation.**
   - Svelte: `npm run check` (or repo equivalent) + lint; backend tests.
   - Manual matrix, cabo verde filter EN + ES: stored-unit row (e.g. 17 años → 17 years), P8457/P136 (null → years/años), detail pages match table language, locale toggle updates without reload.
   - Edge: `edad` null → no age shown (unchanged); unknown code → default years.

## Open question
- None blocking. Only pre-edit check: which v2 serializer serves PersonaNoEsclavizada detail (implementer to locate).
