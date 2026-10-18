# Plan: Link matched documents to their personas in search

## Goal

A text search (e.g. "libertad") returns, besides direct matches, every enslaved (PE) and non-enslaved (PNE) person linked to a matched document. A document matches when `Documento.search_vector` matches: `titulo`, `descripcion`, `notas`, `sigla_documento`, and (new) document type. The Documentos tab shows, per document, the count of linked PE and PNE.

## Decisions (resolved)

1. Document match set = existing document FTS (`search_vector`), no trigram. Trigram fuzzy hits would pull unrelated people.
2. Document type (`TipoDocumental.tipo_documental`) is added to the document vector.
3. Linked people = all `Persona` rows in `Persona.documentos` for matched documents, both PE and PNE. Corporaciones are out of scope.
4. Persons reached only via a document get `match_reason = "documento"`. Direct matches get `"directo"`. A person matched both ways is `"directo"`.
5. Ordering: direct matches first, then by `search_rank`; via-document persons follow.
6. Expansion applies to the unified `SearchAPIView.get` (type=all and per-type tabs). `PersonaEsclavizadaViewSet.search`, `PersonaNoEsclavizadaViewSet.search`, crosstab and network views keep current behavior (out of scope).

## Backend tasks (mstdb_manager)

1. **Document vector** (`dbgestor/signals.py`, `update_documento_search_vector`): add document type via a correlated subquery, mirroring the `conducta` pattern in `persona_search_vector_expression`:
   `Subquery(TipoDocumental.objects.filter(pk=OuterRef('tipo_documento_id')).values('tipo_documental')[:1])`, weight `C`, `config='spanish'`.
2. **Refresh on vocabulary change**: add a `post_save` receiver on `TipoDocumental` that re-runs the document vector update for documents with that type (`Documento.objects.filter(tipo_documento=instance)`). Without this, renaming a type leaves stale vectors.
3. **Backfill**: run `python manage.py populate_search_vectors` after the change. No schema migration needed (vector field already exists).
4. **Expansion in `SearchAPIView.get`** (`api/v2/views.py`, ~L2073–2082 and per-type branches ~L2149, ~L2199):
   - Build `doc_sq_qs = Documento.objects.filter(search_vector=search_query).values('pk')` (exact/plain per `is_exact`, FTS only).
   - For persona types only, add `Q(pk__in=Persona.documentos.through.objects.filter(documento_id__in=doc_sq_qs).values('persona_id'))` to the text-match OR, using `pk__in` subqueries, not joins (avoids duplicating rows and corrupting the `Min`/`Max`/`StringAgg` document annotations).
   - Annotate `match_reason` (`directo` if the direct FTS/trigram condition holds, else `documento`) with a `Case/When` on the same conditions.
   - Keep the existing `.distinct()` and ordering; order by `-is_direct` (annotated boolean), then `-search_rank`, `-name_similarity`.
   - Multi-type merge branch: include `match_reason` in each item; score for via-document items is 0 so they sort last.
   - `typeCounts` must use the same expanded queryset (it already re-applies filters per type).
5. **Document counts**: for `documento` results, annotate per document
   `personas_esclavizadas_count = Count('persona', filter=Q(persona__personaesclavizada__isnull=False), distinct=True)` and the PNE equivalent. Verify the reverse query name (`persona`) with `Documento._meta` before coding. Expose both in `DocumentoListSerializer` (`api/v2/serializers.py` L76).
6. **Serializer**: add `match_reason` to the search result item shape (`results[].match_reason`), not inside `source`.
7. **CSV export** (`_export_csv` in the single-type branch): keep behaviour; export includes `match_reason` only if simple to add. Otherwise out of scope.

## Frontend tasks (mstdb_theme)

1. Show per-document counts (PE / PNE) in the Documentos result card and table.
2. Show a badge for `match_reason = documento` on person results, with a Paraglide message (natural-language key, `{param}` placeholders only, per project constraint). Badge text must meet WCAG 2.1 AA contrast; no component-scoped styles, use `custom.css`/`custom.scss`.
3. Use reactive declarations for any translated static arrays.

## Edge cases to test

- Phrase search `"carta de libertad"` (exact): expansion uses `search_type='phrase'` on documents too.
- A person directly matched and linked to a matched document appears once, labeled `directo`.
- Document matched only by `descripcion` brings in its people (intended under decision 1).
- Document type rename refreshes the vector (receiver test).
- Document with no linked people: count 0, no empty persona rows.
- Sidebar filters (`year`, `archivo_id`, `lugar_id`, etc.) apply to via-document personas through the same `_apply_filters` path.
- Pagination: `count` equals the number of distinct persons across pages.

## Validation

- Unit/API tests in `mstdb_manager/api/v2/tests/` (existing `APITestCase` pattern): fixtures with a document titled "…libertad…" linked to two personas, one unlinked persona; assert result set, `match_reason`, ordering, and document counts.
- Run `EXPLAIN ANALYZE` on the expanded `search` for "libertad" against a production-like copy before deploy; compare with the current query timing.
- Run the project lint/typecheck commands and the backend test suite.

## Risks

- **Noise**: generic document types (e.g. "Carta de libertad") or notes with common words link many people. Mitigated by `match_reason` labeling and ordering; the result count will grow noticeably.
- **Count drift**: `count` and `typeCounts` must both use the expanded set; verify in tests.
- **Stale vectors**: document type changes require the new receiver and a backfill.

## Rollout

1. Backend changes and tests, then `populate_search_vectors` on staging.
2. Verify the Jetrudes example (mx-sv-doc-000753): P2412, P2413, P820, P2414 appear with `documento`.
3. Frontend counts and badge.
4. Update `mstdb_manager` and `mstdb_theme` CHANGELOG.md `[Unreleased]` and `docs/architecture.md` (search data flow) per AGENTS.md. Commit per phase in each submodule.

## Out of scope

- Corporaciones linked to matched documents.
- Crosstab, network, and map endpoints.
- Changing the per-entity `search` endpoints.
