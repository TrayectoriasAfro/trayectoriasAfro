# Multilingual Database Transformation

## Language scope

**Now: es (source) + en only.** The schema stores `language_code` as a free string so pt/de can be added later with zero schema change, but all implementation, search config work, API validation, and content rollout in this plan cover en only. Design rules: never hardcode a 4-language list in code (use a `SUPPORTED_CONTENT_LANGUAGES = ["es", "en"]` setting); keep `english` as the only non-Spanish FTS config for now; do not build pt/de import paths, UI-chrome locales, or coverage dashboards for them.

## Goal

Transform the monolingual (Spanish-first) database into a bilingual one (es source + en) for semantically relevant textual fields: document titles/abstracts/notes, place names, all vocabularies, lessons, and cataloguer notes. Dates, person names (`nombres`/`apellidos`/`nombre_normalizado`), archive names, and source-transcribed free text stay monolingual.

## Chosen approach: translation rows (Option 2) — hybrid storage

Rejected: JSONB per-cell (breaks the existing PostgreSQL FTS stack: `SearchVector(config='spanish')`, GIN + trigram indexes, `Unaccent` in `dbgestor/signals.py`, `populate_search_vectors`, and `api/v2/views.py` ranking; no FK/tenant semantics for the workbench). Rejected: columns-per-language.

Design:

- **Source language is Spanish, stored in-place.** Existing columns remain the authoritative `es` values. No migration of current content, zero risk to legacy Django templates and deprecated v1/v1beta APIs (both explicitly out of scope — translations are served only via `api/v2`).
- **One generic translation table per kind of text**, not per model:
  - `Translation` — field-level translations of entity fields, keyed by `(content_type, object_id, field_name, language_code)` using a `GenericForeignKey`. Covers Documento, Lugar, Persona(+children), Corporacion, and relation models.
  - `VocabTranslation` — keyed by `(vocab_model_content_type, object_id, field_name, language_code)`. Vocab term classes have PK-type collisions (`CharField` vs `AutoField`) across the 13 registries, so a dedicated table with its own composite unique constraint keeps things clean. (If simpler: reuse `Translation` with the same GFK pattern — decide during implementation; both satisfy the constraints.)
  - Columns: `field_name`, `language_code`, `value` (TextField), `status` (`draft`|`published`, default `draft`), `updated_by`, timestamps. Unique on the key tuple. `django-simple-history` on both tables.
- **Leccion is different** because it already has draft/publish + collaborators: use a dedicated `LeccionTranslation(leccion FK, language_code, title, body, status)` instead of GFK.

## Search semantics (decided: unified recall)

- A user searching any language finds matches across es + all **published** translations; results display in the UI language with fallback to Spanish.
- Implementation: extend the per-model `search_vector` expression to concatenate source fields **plus an aggregate of published translation values** (subquery over `Translation`/`VocabTranslation` filtered by `status='published'`). Keep `config='spanish'` for source fields; add a second vector component built with the `english` config for en translations via `SearchVector(..., config='english')` combined with `|`. Trigram indexes on source fields stay as-is; translation matching goes through the GIN `search_vector`. (pt/de configs are a future Phase 5, not this plan.)
- The built-in `english` config in PG 16 (`postgres:16-alpine`) needs no extension work; verify against the `0003_enable_search_extensions.py` pattern only if a new dictionary is required.
- Translation save/delete signals must refresh the parent object's `search_vector` (reuse the existing signal helpers; extract a shared `refresh_search_vector(model, instance)` utility).

## Field scope (decided: core + relation/physical-descriptor notes)

Entity fields made translatable:

| Model | Fields |
|---|---|
| Documento | `titulo`, `descripcion`, `notas` |
| Lugar | `nombre_lugar`, `otros_nombres` |
| Persona | `notas` |
| PersonaEsclavizada | `notas`, `marcas_corporales`, `conducta`, `salud` (descriptive fields; free-text archival source stays untouched in-place) |
| PersonaNoEsclavizada | `notas` |
| Corporacion | `nombres_alternativos`, `notas` |
| PersonaLugarRel | `notas` |
| PersonaRelaciones | `notas`, `descripcion_relacion` |
| Leccion | `title`, `body` (dedicated table) |

Vocabulary models (all 13): `SituacionLugar.situacion+descripcion`, `TipoDocumental.tipo_documental+descripcion`, `RolEvento.rol_evento+descripcion`, `TipoLugar.tipo_lugar+descripcion`, `Calidades.calidad+descripcion`, `Actividades.actividad+descripcion`, `Hispanizaciones.hispanizacion+descripcion`, `Etonimos.etonimo+descripcion`, `ConductaTerm.canonico+descripcion` (+ `aliases` NOT translated — they are documented source variants), `EstadoCivil.estado_civil+descripcion`, `LeccionNivel.nivel+descripcion`, `LeccionPalabraClave.palabra_clave+descripcion`, `TiposInstitucion.tipo+descripcion`.

Explicitly NOT translated: `Archivo.*`, `Persona.nombres/apellidos/nombre_normalizado`, all `*_raw` date fields, monetary/event fields (`evento_valor_sp`, `evento_forma_de_pago`, `evento_total`), `VariableDefinition`, `SugerenciaMerge.notas` (internal workflow).

Note: `Documento.fondo/subfondo/serie/subserie/unidad_documental_compuesta/sigla_documento` are archival identifiers — treated like archive names (not translated). Confirm during Phase 1 review.

## Public display & vocabulary policy (decided)

- Translated labels everywhere when the UI language has a **published** translation; fall back to Spanish otherwise. This means launching `en` requires coverage of every currently-used vocab term — track coverage in the workbench dashboard.
- API shape (decided, option 1): `api/v2` endpoints accept `?lang=` (default `es`). Serializers resolve each translatable field to the requested language's published translation with Spanish fallback. Current consumers see unchanged output when no `lang` is passed. Workbench CRUD uses separate authenticated endpoints exposing raw translation rows.
- Only `published` translations are visible via public endpoints/site; `draft` rows appear only in the workbench to authorized users.

## Workbench (Svelte, decided)

- Dedicated translation workbench in `mstdb_theme`: per-entity inline translation editor (fields listed above) + queue views ("missing translations", "drafts pending publish") + bulk draft import (CSV per content type / vocab registry, imported as `draft`).
- Access control reuses the `LeccionAcceso`-style role pattern at a project level (who may translate/publish) — define a simple permission rule (e.g., staff or explicit role) in Phase 3; exact roles to confirm then.
- Paraglide already has `languageTags: ["es","en"]` (`mstdb_theme/project.inlang/settings.json`) — matches this plan's scope, no UI-chrome work needed.

## Phased execution (each phase ships independently)

### Phase 1 — Schema + backend core (Django)
1. Create `Translation` (+ `LeccionTranslation`, vocab decision) models in `dbgestor/models.py`, migrations, `django-simple-history`.
2. Helper API: `get_translation(obj, field, lang)` / template-tag-free resolver; `TranslatableFieldsMixin` declaring per-model translatable field lists (single source of truth, reused by serializers, signals, admin, import command).
3. Signals: update parent `search_vector` when a translation changes status/content.
4. Management command `import_translations --file <csv> --model <name> [--publish]` loading drafts idempotently (upsert on key tuple).
5. Tests: uniqueness, fallback resolution, vector refresh, CSV upsert.

### Phase 2 — Unified search
1. Extend `documento/persona/lugar/corporacion_search_vector_expression()` in `signals.py` + `populate_search_vectors` command to include published translations with per-language configs.
2. Data migration/backfill: repopulate vectors after deploy window.
3. Verify ranking behavior in `api/v2/views.py` (`SearchRank` unchanged) and cross-language recall tests (English query hits Spanish record).

### Phase 3 — api/v2 serving + workbench
1. `?lang=` param on v2 list/detail/viewset endpoints; serializer fields resolved with fallback; vocab endpoints (`vocabularios/*`) return resolved labels.
2. Authenticated workbench endpoints: list/create/update/publish/import translations.
3. Svelte workbench UI (WCAG 2.1 AA: keyboard operable, visible focus, labeled forms/errors, localized aria-labels/alt via getLocale()).
4. Update `docs/architecture.md` + CHANGELOG.

### Phase 4 — Content rollout (en only)
1. Import en drafts for all vocab terms (blocking prerequisite for switching `en` label display).
2. Translate incrementally: vocabularies → Lugares → Documentos (títulos/descripciones) → Personas/Corporaciones notes → Lecciones.
3. Publish when coverage reviewed. pt/de repeat this cycle later as a separate Phase 5 (not in scope here).

## Risks

- **Search vector cost**: concatenating translation subqueries in every save signal could slow writes on large batches; mitigate by refreshing vectors asynchronously or only on status transitions (measure in Phase 2).
- **Vocab label switch**: "translated labels everywhere" makes filter chips change identity per language — ensure URLs/filters key off IDs, not label strings (audit current filter params in Phase 3).
- **GFK integrity**: generic relations lose DB-level FK protection; mitigate with `content_type` allowlist validation in the mixin and tests.
- **Double translation drift**: source `es` edits make translations stale; mark parent-edited rows (compare `updated_at`) in the workbench queue — nice-to-have, not blocking.
- **simple_history**: historical tables won't include translations (separate tables) — acceptable; history remains source-field audit.

## Validation

- `python manage.py makemigrations --check` clean; migrations apply forward/backward on a scratch DB copy.
- Test suite green incl. new translation/search tests; `populate_search_vectors` rerun produces expected vectors.
- Manual: same record fetched with `?lang=es|en` shows correct fallback chain; unknown/unsupported `lang` values fall back to `es`; search 'escaped' returns records whose canonical term is 'huido' once published.
- Legacy check: v1/v1beta responses byte-identical to before; Django admin/template pages unaffected.

## Out of scope

- v1/v1beta API changes; legacy Django templates UI i18n.
- Person name normalization, dates, archive names, transcription free text.
- LLM-assisted suggestion features.
- pt/de content languages, their FTS configs, and their UI-chrome locales (future Phase 5).

## Open questions (non-blocking, resolve during phases)

1. Exact permission model for who may publish translations (Phase 3 start).
2. Whether `aliases` of ConductaTerm ever need per-language variants (assumed no).
3. Coverage threshold required before flipping `en` labels live (100% of used terms assumed).
