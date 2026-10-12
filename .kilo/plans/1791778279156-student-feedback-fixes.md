# Plan: Class feedback fixes (Sabrina's student feedback)

Context: feedback email relayed by Sabrina after a class used the public site. The
trajectory map not rendering (email #1) and the translation are already handled by
you, so this plan covers only the remaining actionable items.

Repos: `mstdb_manager` (Django/DRF) and `mstdb_theme` (SvelteKit) are git
submodules. Commit each change in its submodule, then bump the root pointer.

## Decisions (locked)

- **Contact email (email #8):** expose it from server-side env via the existing
  `/api/v2/config/` runtime config, rendered in **both footers**; link hidden when
  unset. No rebuild needed when you create the inbox and set the env var.
- **Age filter units (email #6):** out of scope. Keep the numeric `edad` range
  filter; the answer to students is "normalize units in Excel".
- **CSV export (email #5):** add a trajectory-places column to the
  **personas-esclavizadas** CSV only.

## Out of scope / already answered

- **#1 map render** — you fixed it.
- **#4 (second question answered via the map)** — no code work.
- **"Red de personas relacionadas"** — Sabrina deprioritized it.
- **#6** — see decision above. Optional low-risk follow-up (NOT in this plan):
  align the sidebar `edad` range with the crosstab by restricting it to
  `unidad_temporal_edad='a'` or null, so `6 meses` and `6 años` are not mixed.

---

## T1 — Lugares table: sort by "Personas" (email #2)

Problem: the Search → Lugares table shows a `personas` column (`persona_count`)
but it is not sortable; students can only sort by Nombre/Tipo.

- `mstdb_theme/src/conf/columns.js:122` — set `sortable: true` on the lugar
  `persona_count` column (frontend already sends `ordering` via
  `unified-store`/`EntityTable`).
- `mstdb_manager/api/v2/views.py` (`UnifiedSearchViewSet`, used by the Search page
  via `search/?`):
  - `ORDERING_FIELDS['lugar']` (~line 1460) — add `'persona_count'`.
  - `ORDERING_ANNOTATIONS` (~line 1692) — add a `lugar` entry, e.g.:

    ```python
    'lugar': {
        'persona_count': ('persona_count_sort', lambda: Coalesce(
            Subquery(
                Persona.objects.filter(
                    Q(p_x_l_pere__lugar=OuterRef('pk')) |
                    Q(lugar_nacimiento=OuterRef('pk')) |
                    Q(lugar_defuncion=OuterRef('pk')) |
                    Q(personaesclavizada__procedencia=OuterRef('pk'))
                ).order_by().values(_one=Value(1))
                 .annotate(c=Count('persona_id', distinct=True)).values('c')[:1]
            ), 0)),
    },
    ```
  - Add `Coalesce` / `Value` to the `django.db.models` import (line 8).
  - The subquery MUST mirror `LugarListSerializer.get_persona_count`
    (`serializers.py:229-235`) so the sort order matches the displayed numbers.
- Only `UnifiedSearchViewSet` is needed: the Search page uses `searchAll`
  (`search/`), not `lugares/`. Do not change `LugarViewSet`.

Verify: `GET /api/v2/search/?type=lugar&ordering=-persona_count` returns lugares
descending by the same count shown in the table; clicking the Personas header
toggles asc/desc and the ordering persists in the URL. Confirm no perf
regression on the Lugares tab.

## T2 — Rename "Total" in the "Resumen por Lugar" table (email #3)

- `mstdb_theme/src/routes/(app)/Dashboard/viz/PlacePeople.svelte:276` — the header
  uses `m.conf_col_total()`. Replace with a new dedicated key and add it to both
  message files:
  - `mstdb_theme/messages/es.json` → `"viz_pbp_col_total_personas": "Total Número de Personas Esclavizadas"`
  - `mstdb_theme/messages/en.json` → `"viz_pbp_col_total_personas": "Total Number of Enslaved People"`
- Do NOT change `conf_col_total` (reused by `evento_total` columns elsewhere).
- Message values must be natural language only (no JS expressions) per project
  constraint.

Note: `StaticPlacePeople.svelte` / `DinamicPlacePeople.svelte` also hardcode
"Total" but are unused (not imported anywhere). Leave them or align in T5.

## T3 — CSV export includes transaction/trajectory places (email #5)

Problem: the personas-esclavizadas CSV only carries `procedencia`; the transaction
places (`PersonaLugarRel`) are missing.

- `mstdb_manager/api/v2/serializers.py` `PersonaEsclavizadaListSerializer`
  (~line 111): add `lugares_trayectoria = serializers.SerializerMethodField()` and
  include it in `Meta.fields`. Implementation: iterate `obj.p_x_l_pere.all()`
  ordered by `ordinal`, skip records with no `lugar`, format each as
  `f"{lugar.nombre_lugar} ({situacion_lugar})"` (omit `(situacion)` when null),
  return the list.
- `BaseV2ViewSet.flatten_for_csv` (`views.py:221`) already joins list-of-strings
  with `; `, so the CSV cell becomes e.g.
  `Antequera (venta); Oaxaca (libertad)`. No change needed there.
- Avoid N+1 during export: in `UnifiedSearchViewSet` personaesclavizada prefetch
  (`views.py:2005-2007`) replace `'p_x_l_pere'` with
  `Prefetch('p_x_l_pere', queryset=PersonaLugarRel.objects.select_related('lugar','situacion_lugar').order_by('ordinal'))`.
  Mirror in `PersonaEsclavizadaViewSet.get_queryset` for the `list` action
  (`views.py:409`) so the web table does not regress.
- Side effect: the field also appears in the list API JSON. The web table only
  renders configured columns, so no UI change; payload growth is minor. (If that
  is undesirable, use a dedicated export serializer instead — not recommended.)

Verify: apply the search, click CSV, open it; the new column shows the ordered
places and matches the trajectory map on the person's detail page. Confirm DB query
count does not scale with row count (prefetch effective).

## T4 — Contact email in the footers (email #8)

- Backend:
  - `mstdb_manager/mdb/settings.py` (~line 307) add
    `PUBLIC_CONTACT_EMAIL = os.getenv('PUBLIC_CONTACT_EMAIL', '')`.
  - `mstdb_manager/api/v2/views.py` `public_config` (~line 2962) add
    `'contact_email': django_settings.PUBLIC_CONTACT_EMAIL`.
  - Root `.env.example` add `PUBLIC_CONTACT_EMAIL=` (documented, no real value).
- Frontend:
  - Add a small `mstdb_theme/src/lib/publicConfig.js` writable store +
    `loadPublicConfig()` wrapping `fetchPublicConfig()` (`$lib/api`), loaded once
    from the root layout `onMount`.
  - Root `mstdb_theme/src/routes/+layout.svelte` footer (~line 274-286) and
    landing `mstdb_theme/src/routes/(landing)/+page.svelte` footer (~line 343-355):
    add a conditional list item `<a href="mailto:{contactEmail}">{m.footer_contact()}</a>`
    rendered only when the address is non-empty.
  - Message keys (both files): `footer_contact` = "Dudas y sugerencias" /
    "Questions & suggestions".
- Optional: also surface it in the Accessibility "Retroalimentación" section
  (`Accessibility/+page.svelte:134-153`) linking the same address.

Verify: with `PUBLIC_CONTACT_EMAIL` empty the link is absent (no dead mailto);
set the env var, restart the backend, reload → the link appears in both footers and
opens the mail client. No frontend rebuild required.

## T5 — Translation pass (email #7)

- Ensure key parity and quality between `messages/es.json` and `en.json`; add the
  new keys from T2/T4 to both. Run `npm run translate:verify` (or `npm run translate`
  for missing keys) and review, especially lessons strings.
- Move user-visible hardcoded Spanish in `PlacePeople.svelte` into message keys:
  axis labels "Año" / "Número de Personas", aria "Resumen de personas por lugar",
  and the "Todos los Lugares" dropdown option. (Same for
  `StaticPlacePeople`/`DinamicPlacePeople` if they stay.)
- Constraint: message values are natural language with `{param}` placeholders only
  (never raw JS/ternary).

Verify: `npm run translate:verify` runs clean; no user-visible Spanish literals
remain in the viz components; `npm run build` passes.

## T6 — Housekeeping

- Update `CHANGELOG.md [Unreleased]` (root) for T1-T5.
- Commit per submodule (`mstdb_manager`, `mstdb_theme`), then bump the root
  submodule pointers. Update `docs/architecture.md` only if the public-config
  surface changes materially.

---

## Validation summary

- Backend: `python manage.py check`; hit `search/?type=lugar&ordering=-persona_count`,
  `search/?type=personaesclavizada&export_format=csv`, and `config/` (contact_email).
- Frontend: `cd mstdb_theme && npm run build`; `npx prettier --check .` on touched
  files (no svelte-check in repo).
- Manual: Lugares column sorts; Resumen table header text; CSV trajectory column;
  footer contact link appears/absent per env; language toggle shows EN strings.
- Accessibility (WCAG 2.1 AA): footer link is keyboard operable with visible focus;
  new column header exposes `aria-sort` (already provided by `EntityTable`).

## Risks

- T1: correlated subquery cost per lugar row and exact-match to the serializer
  count — validate ordering equals the displayed value.
- T3: extra field in list JSON — verify no frontend breakage; prefetch must be in
  place or export becomes N+1.
- T4: requires a backend restart when the address is set; link stays hidden until
  then (intentional).

## Open items to confirm at implementation time

- Exact env var name `PUBLIC_CONTACT_EMAIL` and that production env provisioning
  can set it (root `.env` is not committed).
- Whether to also add the contact link to the Accessibility feedback section.
