# Frontend i18n for `mstdb_theme/src/conf` + `src/lib` — Paraglide Hybrid Recommendation

## 1. Goal
Provide an implementation-ready recommendation for translating labels in `mstdb_theme/src/conf` and `mstdb_theme/src/lib` within the existing Paraglide + Sherlock + `scripts/translate.js` stack (Paraglide-JS 2.25, sourceLocale `es`, locales `es,en`, strategy `['cookie','baseLocale']`, messages in `messages/{es,en}.json`, generated runtime in `src/lib/paraglide/`).

User decisions captured:
- Scope = Translate everything (chrome + long prose).
- Architecture = Hybrid: Paraglide messages for short UI-chrome; locale-keyed data modules for long-form provenance prose.

## 2. Current state (verified in repo)
- `project.inlang/settings.json`: `sourceLanguageTag es`, `pathPattern ./messages/{locale}.json`, plugins message-format + m-function-matcher.
- `vite.config.js`: `paraglideVitePlugin({ project:'./project.inlang', outdir:'./src/lib/paraglide', strategy:['cookie','baseLocale'] })`.
- Consumers call `import { m } from '$lib/paraglide/messages.js'` + `getLocale/setLocale` from `$lib/paraglide/runtime.js`. `setLocale` defaults to full reload — locale switch is not fully reactive client-side.
- `messages/*.json` use opaque Sherlock keys (e.g. `just_fluffy_grizzly_grip: "Documentos"`), values are natural-language strings with `{count}/{time}/{limit}` params. `scripts/translate.js` + `translate:verify` syncs missing `es.json` keys → `en.json` via gateway/Ollama with domain glossary.
- `src/conf` hardcodes Spanish:
  - `filters.js`: `filtersConfig[].name` (Todo, Documentos, Personas Esclavizadas…).
  - `columns.js`: `columnsConfig[][].label`, `filtersDefinition[][].label/placeholder/options[].label/group`, `entityTabConfig[].label`, plus `renderCellValue` hardcoded `'—'`, `'años'`, `toLocaleDateString('es',…)`.
  - `crosstab.js`: `DIMENSIONS[].label`, `CELL_OPS[].label`.
  - `local.js`: `titleStem`, `titleSuffixes`.
  - `archivos.js`: `nombre/nombre_abreviado/estado/direccion/participante` (proper data — DO NOT translate), `descripcion` (multi-paragraph ES), `catalogos/informes` (bibliographic citations — DO NOT translate), `enlaces[].label`, `elaboracion.text`.
  - `contributors.js`: `name/institution/institutionurl` (DO NOT translate), `role` (Coordinador/a, Ayudante…), `bio/additionalInfo` (long ES HTML).
- `src/lib` hardcodes Spanish:
  - `maintitle.js`: imports `titleSuffixes` from `$conf/local`.
  - `utils.js:formatDate`: hardcoded `'es-ES'`.
  - `datatable.js` (legacy): `title: 'Nombre'…`, `languageES` import, button text `'Mostrar/Ocultar columnas'`, `render 'años'`.
  - `editor/embed.js`: `EMBED_KIND_LABELS` (Vídeo de YouTube…).
  - `lib/components/**/*.svelte`: scattered literals (LeccionForm, SuggestMerge, RichTextEditor aria-labels/titles, ConfirmDelete, MultiSelect placeholder, Tooltips).
- Consumers import conf statically, e.g. `BrowseFilters.svelte` iterates `filtersDefinition` and renders `filter.label/placeholder/group` directly; `EntityTable.svelte` renders `col.label`; `Search/+page.svelte` renders `entityTabConfig[et].label`; `CrosstabView.svelte` renders `dim.label/op.label`; `Archivos/+page.svelte` renders `archivo.descripcion/catalogos/informes/enlaces`; `About/+page.svelte` renders `contributors.*`.

## 3. Recommendation (answers to the 3 questions)

### Q1 — Best Paraglide integration for `conf`/`lib`?
Use Paraglide key-references, never resolved strings, in `conf`/non-component `lib` JS.

Pattern:
- In `messages/es.json` add namespaced semantic keys for short chrome only, e.g. `conf_filters_nombre`, `conf_column_nombre`, `conf_tab_personaesclavizada`, `conf_crosstab_dim_sexo`, `conf_embed_youtube`, `lib_datatable_show_hide_columns`. Keep existing opaque keys untouched. Values = natural language only with `{param}` placeholders (repo constraint).
- In `conf/*.js` replace `label/name/placeholder` string literals with `labelKey/placeholderKey/groupKey/options[].labelKey` holding the message key name (plain string), OR a lazy resolver `label: ( ) => m.conf_x()`. Prefer `*Key` string fields: serializable, SSR-safe, searchable, Sherlock-compatible. Do NOT call `m.*()` at module top-level (locale frozen to `baseLocale`, breaks SSR AsyncLocalStorage, no reactivity).
- Resolve at render site in `.svelte` via reactive declaration so locale reload/re-render picks it up, e.g.:
  ```svelte
  import { m } from '$lib/paraglide/messages.js';
  $: cols = (columnsConfig[entityType]||[]).map(c => ({ ...c, displayLabel: m[c.labelKey]() }));
  ```
  Follow repo rule: translate static arrays/objects with `$:` not `const`.
- For `lib/*.js` pure functions (e.g. `renderCellValue`, `formatDate`, `detectEmbed`), pass locale in or call `getLocale()` inside the function body (not module scope), and use `Intl`/locale-aware formatting. `EMBED_KIND_LABELS` → `EMBED_KIND_KEYS` + resolver helper.
- Add keys via Sherlock VS Code extension (Ctrl/Cmd+Shift+P → Sherlock → extract), then run `npm run translate` to fill `en.json`, `npm run translate:verify` to polish.

This keeps single source of truth (`messages/*.json`), reuses LLM pipeline + glossary, no new loader, minimal bundle delta (tree-shaken per-message modules).

### Q2 — If Paraglide not feasible, alternative?
For short chrome Paraglide IS feasible — do not build sidecars. For long prose (multi-paragraph `descripcion`, `bio`, `role`, `elaboracion.text`, `enlaces[].label` where it is descriptive), pure Paraglide is technically possible but rejected: it bloats `messages/*.json` (10 archives × multi-KB + 15 bios), pollutes Sherlock opaque-key list, inflates generated `messages/*.js` bundle, and invites LLM drift on every `--verify` pass over archival prose.

Adopted Hybrid alternative for long prose only:
- Keep `archivos.js` / `contributors.js` shape/ordering/`archivo_id` stable; add `_es`/`_en` field pairs, e.g. `descripcion_es/descripcion_en`, `bio_es/bio_en`, `role_es/role_en`, `enlaces[]:{label_es,label_en,url}`, `elaboracion:{text_es,text_en,url}`. Spanish fields remain source of truth; English filled once via `translate.js` glossary then hand-reviewed by domain owners.
- Add tiny selector in same module, e.g. `export function pickLocale(es,en){ return getLocale()==='en' && en ? en : es; }` or `localizeArchivo(a)` / `localizeContributor(c)`, called from Svelte (`getLocale()` already imported in `Archivos/+page.svelte`). No new JSON loader, no `$conf` alias change, no i18n framework swap.
- Explicitly DO NOT translate and DO NOT duplicate: `nombre/nombre_abreviado/estado/direccion/participante`, person/institution names, `catalogos/informes` citation strings, geographic proper nouns. Render those directly. This preserves provenance fidelity despite "translate everything" scope.

Sidecar `en.json/es.json` per-conf-file (e.g. `conf/i18n/columns.en.json`) is documented as fallback only if Paraglide codegen is ever removed; it would duplicate the `translate.js` workflow, require a custom loader + reactivity wiring, and diverge from Sherlock — higher maintenance, not recommended now.

### Q3 — Workflow efficiency vs architectural impact
| Approach | Workflow | Architecture |
|---|---|---|
| A. Pure Paraglide (all strings incl. prose) | Best reuse: Sherlock extract + `npm run translate`/`translate:verify`. Worst noise: hundreds of long keys, slow verify, glossary misfires on citations/names, opaque keys unreadable for prose. | Largest `messages/_index.js` + per-key chunks; every prose edit regenerates Paraglide output; SSR-safe if resolved in components, but bundle + build time grow. |
| B. Hybrid (RECOMMENDED: Paraglide chrome + locale-keyed prose modules) | Chrome stays in fast LLM loop; prose translated once, reviewed as data, excluded from `--verify` churn. Slight extra step: author must fill `_en` when adding archive/contributor. | Minimal impact: no new deps, no alias/loader change, ordering/grouping logic untouched; prose selection is one `getLocale()` call at render; bundle grows only by English prose actually shipped. Preserves `svelte.config.js $conf` alias and cookie+reload strategy. |
| C. Manual sidecar `en.json/es.json` per conf/lib | Worst: parallel pipeline, no Sherlock, no glossary, manual sync + custom reactive store, easy drift. | New loader + store + reactivity wiring; duplicates Paraglide; highest long-term cost. Use only if Paraglide removed. |

Conclusion: B wins on both axes for this stack.

## 4. Implementation task list (for implementation agent)
1. Inventory: grep `src/conf` + `src/lib` for literals (labels, placeholders, groups, titles, aria-labels, button text). Classify each as `chrome → Paraglide key`, `prose → _es/_en`, `proper/citation → do-not-translate`. Output checklist in PR description.
2. Messages: add namespaced semantic keys to `messages/es.json` for all chrome items (columns labels, filter labels/placeholders/groups/options, tab labels, crosstab dim/op labels, `filtersConfig` names, `titleStem/suffixes` if UI-visible, `EMBED_KIND_*`, `datatable` titles/button, lib component literals incl. aria-labels). Values natural language only, `{param}` for interpolation. Do not edit existing opaque keys.
3. Run `npm run translate` then `npm run translate:verify`; hand-fix glossary terms (Personas Esclavizadas→Enslaved People, Lugares→Places, etc.), verify `{vars}` preserved.
4. Refactor `conf/filters.js`, `columns.js`, `crosstab.js`, `local.js`: add `*Key` fields alongside (then replacing) hardcoded strings; keep `key/value/icon/sortable/visible/entities` intact; keep `defaultVisibleColumns`, `dimsForEntity/opsForEntity`, `getFilterConfigByValue` signatures. No `m.*()` calls at module top-level.
5. Refactor `conf/archivos.js`, `contributors.js`: add `_es/_en` pairs + `pickLocale/localize*` helpers using `getLocale()`; leave IDs/order/grouping (`estados`, `archivo_id`) and citation arrays untouched; `enlace.url`, names, addresses stay single-language.
6. Update Svelte consumers: `Search/+page.svelte`, `EntityTable.svelte`, `BrowseFilters.svelte`, `ColumnConfigModal.svelte`, `BrowseCards/cards/*`, `CrosstabView.svelte`, `Archivos/+page.svelte`, `About/+page.svelte`, `lib/components/**/*.svelte` — resolve `*Key` via `m[key]()` inside `$:` derived values; use `getLocale()` for `toLocaleString/getLocaleDateString`, numbers, aria-labels/alt per repo localization rules; ensure keyboard/focus/contrast unchanged (WCAG 2.1 AA).
7. Fix `lib` utilities: `utils.js:formatDate` → `toLocaleDateString(getLocale(),…)` with fallback; `maintitle.js` → localized suffixes; `datatable.js` → localized `title`s + dynamic `languageES`/English pack + button text via keys (flag if legacy DataTables path is dead — prefer `EntityTable.svelte`); `editor/embed.js` → key-based labels.
8. Docs/tests: update `CHANGELOG.md [Unreleased]`; run `npm run lint` (prettier check), `vite build`, relevant `vitest` + `playwright` suites + axe checks on Search/Archivos/About; manually verify cookie locale switch ES↔EN updates all chrome + prose without console errors or frozen labels; verify no `m.*()` at conf module scope and no JS expressions inside `messages/*.json`.

## 5. Risks / edge cases
- Top-level `m.*()` in `conf` freezes to `baseLocale` and breaks SSR — enforce key-reference rule in review.
- `setLocale` reloads page: reactivity via `$:` is for correctness on reload/SSR, not live switch without reload.
- Citation/proper-noun leakage into translation: `catalogos/informes`, archive names, person names, `estado`, URLs must never enter `messages/*.json`.
- Placeholder `{param}` mismatch and HTML in `additionalInfo/bio` (`{@html}`) — sanitize/allow-list unchanged, translate text only.
- `renderCellValue` em-dash/age-unit/date formatting must be locale-aware, not hardcoded `'es'`.
- DataTables legacy path may double-translate if both `datatable.js` and `EntityTable` ship — confirm which table is live before duplicating keys.

## 6. Validation
- `npm run translate` clean (0 missing), `npm run translate:verify` passes without prose churn.
- `npm run lint`, `vite build`, unit + integration + axe green.
- Manual ES/EN toggle: column headers, filters/placeholders/groups/options, tabs, crosstab selects, filter names, titles, embed labels, archive descriptions/bios switch; citations/names/addresses unchanged.
- No new dependencies; no `$conf` alias or strategy change; `docs/architecture.md` updated only if prose-module shape is deemed architectural.
