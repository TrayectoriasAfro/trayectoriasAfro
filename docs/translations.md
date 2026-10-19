# Translating Content to English

Spanish is the source of truth and stays in the regular columns. English lives
in translation rows: the `Translation` table (all entities + vocabularies) and
`LeccionTranslation` (lessons). Only `published` rows appear on the public site,
in `?lang=en` API responses, and in search; `draft` rows are workbench-only.

## Workbench (recommended)

Open **User → catalogar → traducciones** (`/User/catalogar/traducciones`,
staff only). Pick a model + field + view (Faltantes / Borradores / Publicadas /
Todas). Every row shows the record ID, the Spanish source text, an English
textarea, and the status (Sin traducir / Borrador / Publicado):

- Type the English text and press **Guardar** (per row) or **Guardar N
  borradores** to save the whole page at once.
- Tick rows and press **Publicar selección** to publish in bulk (max 500 per
  call). Only published rows appear on the public site and in search.
- *Despublicar* pulls a live row back to draft.

To find a record elsewhere, its ID matches the public site detail URLs and the
Django admin.

## CSV import (bulk)

For spreadsheet-based translation rounds:

```bash
# Entity / vocabulary rows: object_id, field_name, language_code, value [, status]
python manage.py import_translations --model documento --file drafts.csv
python manage.py import_translations --model tipodocumental --file vocab.csv --publish

# Lessons: object_id, language_code, title, body [, status]
python manage.py import_translations --model leccion --file lecciones.csv
```

`--model` is the lowercase model name (`documento`, `lugar`,
`personaesclavizada`, `corporacion`, `personalugarrel`, `personarelaciones`,
`tipodocumental`, `calidades`, …). Imports upsert on the key tuple, so
re-running a file is safe; rows default to `draft` unless `--publish` is given.
`es` rows and unknown fields/pks are rejected.

## Seeding the reviewed vocabularies

Six registries already have reviewed English drafts and need no manual work
unless a term changes:

```bash
python manage.py seed_vocab_translations_en
```

This covers EstadoCivil, TiposInstitucion, TipoLugar, RolEvento,
TipoDocumental, and SituacionLugar. It only creates missing rows — it never
overwrites team edits or unpublishes anything. Publish from the workbench.

## What NOT to translate

Left in Spanish on purpose: person/archive names, dates (`*_raw` fields),
monetary and event fields, `VariableDefinition`, and internal workflow notes.
Domain-sensitive vocabularies — Calidades, Etónimos, Hispanizaciones,
Actividades, ConductaTerm — need expert review; do not machine-translate them,
use the workbench or a reviewed CSV instead.

## Checking your work

- API: append `?lang=en` to any v2 detail URL (e.g.
  `/api/v2/documentos/123/?lang=en`). Unknown languages fall back to Spanish.
- Search: an English query (e.g. `escaped`) should hit records whose Spanish
  text uses the equivalent term (e.g. `huido`) once the translation is
  published. If it doesn't, re-run
  `python manage.py populate_search_vectors --model <documento|persona|lugar|corporacion>`.
